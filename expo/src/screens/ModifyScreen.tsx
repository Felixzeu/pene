import React, { useEffect, useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useVideoPlayer } from 'expo-video';
import * as ImagePicker from 'expo-image-picker';
import {
  AlertTriangle, Check, CheckCircle2, Eye, ImagePlus, Info, Minus, Move, Pause, Play, Plus, Sparkles, Trash2, Type as TypeIcon,
  Volume2, VolumeX, Wand2,
} from 'lucide-react-native';
import { Badge, Btn, ChipRow, Header, Input, ProgressBar, Screen, TextArea } from '../components/ui';
import { RangeBar, VideoTimeline, fmt } from '../components/Timeline';
import { TEXT_COLORS } from '../lib/textColors';
import { colors, fonts, radius } from '../theme';
import { aiEdit, getJob, jobMediaSource, renderEdit, uploadMedia } from '../services/api';
import LivePreview, { overlayLook } from '../components/LivePreview';
import { overlayBox } from '../lib/stickerLayout';
import { upsertProject } from '../services/history';
import type { EditSpec, Job, OverlayItem, Project, TextItem } from '../types';

type SubStyle = NonNullable<EditSpec['subStyle']>;
const SUB_DEFAULT: SubStyle = { size: 'medium' };
const EMPTY: EditSpec = { trimStart: 0, trimEnd: 0, subtitles: true, subStyle: SUB_DEFAULT, texts: [], overlays: [], stickers: [] };

const POSITIONS = { Alto: 'top', Centro: 'center', Basso: 'bottom' } as const;
const SIZES = { Piccolo: 'small', Medio: 'medium', Grande: 'large' } as const;
const MODES = { 'Schermo intero': 'full', Riquadro: 'pip' } as const;
const PIP_POS = { 'Alto sx': 'top-left', 'Alto dx': 'top-right', Centro: 'center', 'Basso sx': 'bottom-left', 'Basso dx': 'bottom-right' } as const;
const SUB_SIZES = { Piccoli: 'small', Medi: 'medium', Grandi: 'large' } as const;
const labelOf = <T extends string>(map: Record<string, T>, v: T) =>
  Object.keys(map).find((k) => map[k] === v) as string;

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Palette di colori: un tocco e si vede subito nell'anteprima. */
function ColorPicker({ value, onChange }: { value?: string; onChange: (hex: string) => void }) {
  const cur = (value ?? '#FFFFFF').toUpperCase();
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.colors}>
      {TEXT_COLORS.map((c) => {
        const on = c.hex === cur;
        return (
          <Pressable key={c.hex} onPress={() => onChange(c.hex)} hitSlop={4} accessibilityLabel={c.name} style={[styles.swatchRing, on && { borderColor: colors.accent }]}>
            <View style={[styles.swatch, { backgroundColor: c.hex }]}>
              {on && <Check size={14} color={c.hex === '#FFFFFF' || c.hex === '#FFD42B' ? '#000' : '#fff'} />}
            </View>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

/** Tasto "Sposta" / "Fatto": blocca l'anteprima sull'elemento per trascinarlo. */
function MoveButton({ on, onPress }: { on: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.moveBtn, on && styles.moveBtnOn, pressed && { opacity: 0.8 }]}>
      {on ? <Check size={15} color={colors.onAccent} /> : <Move size={15} color={colors.text} />}
      <Text style={[styles.moveText, on && { color: colors.onAccent }]}>{on ? 'Fatto' : 'Sposta'}</Text>
    </Pressable>
  );
}
const newId = (p: string) => `${p}${Date.now().toString(36).slice(-5)}`;

// Modifiche dopo il primo montaggio: testi a schermo, foto/video della galleria, sottotitoli,
// taglio di inizio/fine sulla timeline e istruzioni libere all'IA. Ogni modifica si vede
// subito nell'anteprima live; il backend rifà l'export solo premendo "Applica modifiche".
export default function ModifyScreen({ project, onBack, onDone }: {
  project: Project;
  onBack: () => void;
  onDone: (p: Project) => void;
}) {
  const jobId = project.jobId as string;
  const [job, setJob] = useState<Job | null>(null);
  const [spec, setSpec] = useState<EditSpec>(EMPTY);
  const [applied, setApplied] = useState<EditSpec>(EMPTY);
  const [instruction, setInstruction] = useState('');
  const [aiBusy, setAiBusy] = useState(false);
  const [aiSummary, setAiSummary] = useState<string | null>(null);
  const [aiNotes, setAiNotes] = useState<string | null>(null);
  const [rendering, setRendering] = useState(false);
  const [uploadPct, setUploadPct] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const stopRef = useRef(false);
  const [moving, setMoving] = useState<string | null>(null); // foto che si sta spostando a mano
  const [movingText, setMovingText] = useState<string | null>(null); // testo che si sta spostando a mano
  const [dragging, setDragging] = useState(false);

  const previewSrc = job?.previewUrl ?? null;
  const previewPlayer = useVideoPlayer(previewSrc ? { uri: previewSrc } : null, (p) => { p.loop = true; p.play(); });
  // Posizione della testina sulla timeline (secondi del video originale).
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(true);
  useEffect(() => {
    const id = setInterval(() => setTime(previewPlayer.currentTime ?? 0), 120);
    return () => clearInterval(id);
  }, [previewPlayer]);
  const seek = (t: number) => { previewPlayer.pause(); setPlaying(false); previewPlayer.currentTime = t; setTime(t); };
  const togglePlay = () => {
    if (playing) { previewPlayer.pause(); setPlaying(false); } else { setMoving(null); setMovingText(null); previewPlayer.play(); setPlaying(true); }
  };
  // Audio originale: si sente (o no) già nell'anteprima, e così sarà nel video finale.
  useEffect(() => { previewPlayer.muted = !!spec.muted; }, [previewPlayer, spec.muted]);

  // Stato iniziale dal backend (spec attuale e media già caricati).
  useEffect(() => {
    getJob(jobId).then((j) => {
      setJob(j);
      const s = { ...EMPTY, ...(j.spec ?? {}), subStyle: j.spec?.subStyle ?? SUB_DEFAULT, stickers: j.spec?.stickers ?? [] };
      setSpec(s);
      setApplied(s);
    }).catch((e) => setError(e instanceof Error ? e.message : 'Backend non raggiungibile.'));
    return () => { stopRef.current = true; };
  }, [jobId]);

  const finalLen = Math.max(1, (job?.duration ?? 60) - spec.trimStart - spec.trimEnd);
  // "Ora" = punto attuale dell'anteprima, in secondi sul video finale.
  const now = () => round1(Math.min(Math.max(0, (previewPlayer.currentTime ?? 0) - spec.trimStart), finalLen));
  const dirty = JSON.stringify(spec) !== JSON.stringify(applied);

  const patchText = (id: string, p: Partial<TextItem>) =>
    setSpec((s) => ({ ...s, texts: s.texts.map((t) => (t.id === id ? { ...t, ...p } : t)) }));
  const patchOverlay = (id: string, p: Partial<OverlayItem>) =>
    setSpec((s) => ({ ...s, overlays: s.overlays.map((o) => (o.id === id ? { ...o, ...p } : o)) }));
  // "Sposta": ferma l'anteprima nel momento della foto, così resta visibile mentre la trascini.
  const toggleMove = (o: OverlayItem) => {
    if (moving === o.id) { setMoving(null); previewPlayer.play(); setPlaying(true); return; }
    previewPlayer.pause();
    setPlaying(false);
    previewPlayer.currentTime = spec.trimStart + o.start + Math.min(0.3, (o.end - o.start) / 2);
    setMovingText(null);
    setMoving(o.id);
  };
  const toggleMoveText = (t: TextItem) => {
    if (movingText === t.id) { setMovingText(null); previewPlayer.play(); setPlaying(true); return; }
    previewPlayer.pause();
    setPlaying(false);
    previewPlayer.currentTime = spec.trimStart + t.start + Math.min(0.3, (t.end - t.start) / 2);
    setMoving(null);
    setMovingText(t.id);
  };
  const resize = (o: OverlayItem, factor: number) => {
    const m = job?.media?.find((x) => x.id === o.mediaId);
    const look = overlayLook(o, m);
    if (look.aspect == null) return;
    const b = overlayBox(o, look.aspect);
    // Tiene fermo il centro: se la foto era in un angolo, da ora ha una posizione libera.
    patchOverlay(o.id, {
      w: Math.round(Math.max(160, Math.min(1080, b.w * factor))),
      x: Math.round(b.left + b.w / 2),
      y: Math.round(b.top + b.h / 2),
    });
  };
  const addText = () => {
    const start = now();
    setSpec((s) => ({
      ...s,
      texts: [...s.texts, { id: newId('t'), text: '', start, end: round1(Math.min(start + 3, finalLen)), position: 'top', size: 'medium' }],
    }));
  };

  const addMedia = async () => {
    setError(null);
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images', 'videos'],
      quality: 0.9,
      // Converte HEIC/HEVC in formati che FFmpeg legge sempre (JPEG/H.264).
      preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
    });
    if (res.canceled || !res.assets?.[0]) return;
    const a = res.assets[0];
    const isVideo = a.type === 'video';
    const ext = isVideo ? 'mp4' : 'jpg';
    setUploadPct(0);
    try {
      const media = await uploadMedia(jobId, {
        uri: a.uri,
        name: a.fileName ?? `media.${ext}`,
        type: a.mimeType ?? (isVideo ? 'video/mp4' : 'image/jpeg'),
      }, setUploadPct);
      setJob((j) => (j ? { ...j, media: [...(j.media ?? []), media] } : j));
      setUploadPct(null);
      // L'IA sceglie momento, durata, schermo intero o riquadro guardando cosa dici nel video.
      setAiBusy(true);
      try {
        const cut = media.cutout ? ' La foto è già scontornata (senza sfondo): usala con "cutout": true come elemento sopra il video.' : '';
        const out = await aiEdit(jobId, `Inserisci il nuovo media "${media.id}" (${media.kind}, "${media.name}") nel punto più adatto in base alla trascrizione, con durata, modalità, grandezza e posizione ottimali.${cut} Non cambiare nient'altro.`, spec);
        setSpec(out.spec);
        setAiSummary(`${out.summary} Guarda l'anteprima: con "Sposta" la trascini e con due dita cambi la grandezza. Poi premi Applica modifiche.`);
      } catch {
        const start = now();
        const len = media.kind === 'video' && media.duration ? Math.min(media.duration, 5) : 3;
        setSpec((s) => ({
          ...s,
          overlays: [...s.overlays, media.cutout
            ? { id: newId('o'), mediaId: media.id, start, end: round1(Math.min(start + len, finalLen)), mode: 'pip', position: 'bottom-right', w: 560, cutout: true }
            : { id: newId('o'), mediaId: media.id, start, end: round1(Math.min(start + len, finalLen)), mode: 'full' }],
        }));
      } finally {
        setAiBusy(false);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Caricamento non riuscito.');
    } finally {
      setUploadPct(null);
    }
  };

  // Export con le modifiche e polling finché non è pronto.
  const render = async (next: EditSpec) => {
    setError(null);
    setMoving(null);
    setMovingText(null);
    setRendering(true);
    try {
      await renderEdit(jobId, { ...next, texts: next.texts.filter((t) => t.text.trim()) });
      while (!stopRef.current) {
        await new Promise((r) => setTimeout(r, 3000));
        const j = await getJob(jobId).catch(() => null);
        if (!j) continue;
        setJob(j);
        if (j.stage === 'ready') {
          setApplied(next);
          const p = { ...project, finalVideoUrl: j.finalVideoUrl };
          upsertProject(p);
          break;
        }
        if (j.stage === 'error') { setError(j.message ?? 'Export non riuscito.'); break; }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Export non riuscito.');
    } finally {
      setRendering(false);
    }
  };

  const askAi = async () => {
    if (instruction.trim().length < 3) return;
    setError(null);
    setAiSummary(null);
    setAiNotes(null);
    setAiBusy(true);
    try {
      const out = await aiEdit(jobId, instruction.trim(), spec);
      setSpec({ ...out.spec, subStyle: out.spec.subStyle ?? spec.subStyle ?? SUB_DEFAULT });
      if (out.media) setJob((j) => (j ? { ...j, media: out.media } : j));
      setAiSummary(`${out.summary} È solo un'anteprima: premi Applica modifiche per salvarla nel video.`);
      setAiNotes(out.notes ?? null);
      setInstruction('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'L IA non ha risposto.');
    } finally {
      setAiBusy(false);
    }
  };

  const busy = rendering || aiBusy || uploadPct !== null;
  const mediaName = (id: string) => job?.media?.find((m) => m.id === id);

  return (
    <Screen>
      <Header title="Modifica il video" subtitle="Testi, foto e video, o chiedi all'IA" onBack={onBack} />
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }} keyboardShouldPersistTaps="handled" scrollEnabled={!dragging}>
        {previewSrc ? (
          <LivePreview
            player={previewPlayer}
            spec={spec}
            words={job?.words ?? []}
            media={job?.media ?? []}
            duration={job?.duration ?? 0}
            mediaUri={(id, cut) => jobMediaSource(jobId, id, cut)}
            selectedId={moving}
            onMoveOverlay={(id, x, y, w) => patchOverlay(id, { x, y, w })}
            selectedTextId={movingText}
            onMoveText={(id, x, y) => patchText(id, { x, y })}
            onDrag={setDragging}
          />
        ) : null}
        {/* Timeline: scorri il video e trascina le maniglie rosa per tagliare inizio e fine. */}
        {job?.duration ? (
          <View style={styles.player}>
            <View style={styles.playerRow}>
              <Pressable
                onPress={togglePlay}
                hitSlop={6}
                accessibilityLabel={playing ? 'Pausa' : 'Riproduci'}
                style={({ pressed }) => [styles.playBtn, pressed && { transform: [{ scale: 0.94 }] }]}
              >
                {playing
                  ? <Pause size={20} color={colors.onAccent} fill={colors.onAccent} />
                  : <Play size={20} color={colors.onAccent} fill={colors.onAccent} style={{ marginLeft: 2 }} />}
              </Pressable>
              <Text style={styles.playerTime}>
                {fmt(Math.max(0, time - spec.trimStart))}
                <Text style={{ color: colors.textDim }}> / {fmt(finalLen)}</Text>
              </Text>
              <View style={{ flex: 1 }} />
              <Pressable
                onPress={() => setSpec((s) => ({ ...s, muted: !s.muted }))}
                hitSlop={6}
                accessibilityLabel={spec.muted ? 'Riattiva audio' : 'Togli audio'}
                style={[styles.muteBtn, spec.muted && styles.muteOn]}
              >
                {spec.muted ? <VolumeX size={17} color={colors.accent} /> : <Volume2 size={17} color={colors.text} />}
                <Text style={[styles.muteText, spec.muted && { color: colors.accent }]}>{spec.muted ? 'Audio tolto' : 'Audio'}</Text>
              </Pressable>
            </View>
            <VideoTimeline
              duration={job.duration}
              trimStart={spec.trimStart}
              trimEnd={spec.trimEnd}
              time={time}
              onSeek={seek}
              onTrim={(p) => setSpec((s) => ({ ...s, ...p }))}
              onDrag={setDragging}
            />
          </View>
        ) : null}
        <View style={{ alignItems: 'center', marginBottom: 12 }}>
          {dirty && (
            <View style={styles.dirtyRow}><Eye size={13} color={colors.warm} /><Text style={styles.dirtyText}>Modifiche non ancora applicate</Text></View>
          )}
        </View>

        {rendering && (
          <View style={styles.renderBox}>
            <Text style={styles.renderText}>{job?.message ?? 'Applico le modifiche…'}</Text>
            <ProgressBar pct={Math.round((job?.progress ?? 0.1) * 100)} />
          </View>
        )}
        {aiSummary && !rendering && (
          <View style={styles.okBox}>
            <CheckCircle2 size={17} color={colors.ok} />
            <Text style={styles.okText}>{aiSummary}</Text>
          </View>
        )}
        {aiNotes && !rendering && (
          <View style={styles.noteBox}>
            <Info size={17} color={colors.warm} />
            <Text style={styles.noteText}>{aiNotes}</Text>
          </View>
        )}
        {error && (
          <View style={styles.errorBox}>
            <AlertTriangle size={17} color={colors.err} />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        {/* IA */}
        <Text style={styles.section}>Chiedi all'IA</Text>
        <TextArea
          value={instruction}
          onChangeText={setInstruction}
          placeholder={'Es. "metti il tasto segui al secondo 3", "una foto della Torre Eiffel quando la nomino", "togli i primi 2 secondi"'}
          maxLength={1000}
          style={{ minHeight: 90 }}
        />
        <Btn
          label="Applica con l'IA"
          variant="warm"
          icon={<Sparkles size={17} color={colors.onWarm} />}
          onPress={askAi}
          loading={aiBusy}
          disabled={busy || instruction.trim().length < 3}
          style={{ marginTop: 10 }}
        />

        {/* Testi */}
        <Text style={styles.section}>Testi a schermo</Text>
        {spec.texts.map((t) => (
          <View key={t.id} style={styles.card}>
            <View style={styles.cardHead}>
              <TypeIcon size={16} color={colors.textDim} />
              <Input
                value={t.text}
                onChangeText={(v) => patchText(t.id, { text: v })}
                placeholder="Scrivi il testo"
                maxLength={200}
                style={{ flex: 1, height: 44 }}
              />
              <Pressable hitSlop={10} onPress={() => setSpec((s) => ({ ...s, texts: s.texts.filter((x) => x.id !== t.id) }))}>
                <Trash2 size={18} color={colors.err} />
              </Pressable>
            </View>
            <RangeBar total={finalLen} start={t.start} end={t.end} onChange={(p) => patchText(t.id, p)} onDrag={setDragging} color={colors.accent2} />
            <ChipRow
              options={Object.keys(POSITIONS)}
              value={t.x != null ? '' : labelOf(POSITIONS, t.position)}
              onChange={(v) => patchText(t.id, { position: POSITIONS[v as keyof typeof POSITIONS], x: undefined, y: undefined })}
            />
            <View style={{ height: 8 }} />
            <ChipRow options={Object.keys(SIZES)} value={labelOf(SIZES, t.size)} onChange={(v) => patchText(t.id, { size: SIZES[v as keyof typeof SIZES] })} />
            <Text style={styles.subLabel}>Colore</Text>
            <ColorPicker value={t.color} onChange={(hex) => patchText(t.id, { color: hex })} />
            <View style={styles.moveRow}>
              <MoveButton on={movingText === t.id} onPress={() => toggleMoveText(t)} />
              {t.x != null && <Text style={styles.moveHint}>posizione tua</Text>}
            </View>
            {movingText === t.id && <Text style={styles.moveHint}>Trascina il testo nell'anteprima: al centro compaiono le linee guida.</Text>}
          </View>
        ))}
        <Btn label="Aggiungi testo" variant="ghost" icon={<Plus size={17} color={colors.text} />} onPress={addText} disabled={busy} />

        {/* Media */}
        <Text style={styles.section}>Foto e video</Text>
        {spec.overlays.map((o) => {
          const m = mediaName(o.mediaId);
          return (
            <View key={o.id} style={styles.card}>
              <View style={styles.cardHead}>
                <Badge text={m?.kind === 'video' ? 'VIDEO' : 'FOTO'} tone="warm" />
                <Text style={styles.mediaName} numberOfLines={1}>{m?.name ?? o.mediaId}</Text>
                <Pressable hitSlop={10} onPress={() => setSpec((s) => ({ ...s, overlays: s.overlays.filter((x) => x.id !== o.id) }))}>
                  <Trash2 size={18} color={colors.err} />
                </Pressable>
              </View>
              <RangeBar total={finalLen} start={o.start} end={o.end} onChange={(p) => patchOverlay(o.id, p)} onDrag={setDragging} color={colors.warm} />
              <ChipRow options={Object.keys(MODES)} value={labelOf(MODES, o.mode)} onChange={(v) => patchOverlay(o.id, { mode: MODES[v as keyof typeof MODES] })} />
              {m?.kind === 'image' && m.cutout && (
                <View style={{ marginTop: 8 }}>
                  <ChipRow
                    options={['Sfondo tolto', 'Foto intera']}
                    value={o.cutout === false ? 'Foto intera' : 'Sfondo tolto'}
                    onChange={(v) => patchOverlay(o.id, { cutout: v === 'Sfondo tolto' })}
                  />
                </View>
              )}
              {o.mode === 'pip' && (
                <View style={{ marginTop: 8 }}>
                  <ChipRow
                    options={Object.keys(PIP_POS)}
                    value={o.x != null ? '' : labelOf(PIP_POS, o.position ?? 'top-right')}
                    onChange={(v) => patchOverlay(o.id, { position: PIP_POS[v as keyof typeof PIP_POS], x: undefined, y: undefined })}
                  />
                </View>
              )}
              {overlayLook(o, m).aspect != null && (
                <View style={styles.moveRow}>
                  <MoveButton on={moving === o.id} onPress={() => toggleMove(o)} />
                  <Pressable hitSlop={6} onPress={() => resize(o, 1 / 1.15)} style={styles.sizeBtn}><Minus size={16} color={colors.text} /></Pressable>
                  <Pressable hitSlop={6} onPress={() => resize(o, 1.15)} style={styles.sizeBtn}><Plus size={16} color={colors.text} /></Pressable>
                  {o.x != null && <Text style={styles.moveHint}>posizione tua</Text>}
                </View>
              )}
              {moving === o.id && <Text style={styles.moveHint}>Nell'anteprima qui sopra: un dito per spostarla, due dita per allargarla o stringerla. Al centro compaiono le linee guida.</Text>}
            </View>
          );
        })}
        {uploadPct !== null && (
          <View style={{ marginBottom: 10 }}>
            <Text style={styles.renderText}>Caricamento… {uploadPct}%</Text>
            <ProgressBar pct={uploadPct} />
          </View>
        )}
        <Btn label="Aggiungi dalla galleria" variant="ghost" icon={<ImagePlus size={17} color={colors.text} />} onPress={addMedia} disabled={busy} />

        {/* Sottotitoli */}
        <Text style={styles.section}>Sottotitoli</Text>
        <View style={styles.card}>
          <ChipRow options={['Sì', 'No']} value={spec.subtitles ? 'Sì' : 'No'} onChange={(v) => setSpec((s) => ({ ...s, subtitles: v === 'Sì' }))} />
          {spec.subtitles && (
            <>
              <Text style={styles.subLabel}>Grandezza</Text>
              <ChipRow
                options={Object.keys(SUB_SIZES)}
                value={labelOf(SUB_SIZES, (spec.subStyle ?? SUB_DEFAULT).size)}
                onChange={(v) => setSpec((s) => ({ ...s, subStyle: { ...(s.subStyle ?? SUB_DEFAULT), size: SUB_SIZES[v as keyof typeof SUB_SIZES] } }))}
              />
              <Text style={styles.subLabel}>Colore</Text>
              <ColorPicker
                value={(spec.subStyle ?? SUB_DEFAULT).color}
                onChange={(hex) => setSpec((s) => ({ ...s, subStyle: { ...(s.subStyle ?? SUB_DEFAULT), color: hex } }))}
              />
              <Text style={styles.hintSmall}>Stanno sempre in basso, sopra i tasti di TikTok e Instagram. Il bordo si adatta al colore, così si leggono su qualsiasi sfondo.</Text>
            </>
          )}
        </View>
        <Text style={styles.hint}>Sottotitoli e testi restano sempre lontani dai bordi, dove TikTok e Instagram mettono descrizione e pulsanti. Per tagliare l'inizio o la fine trascina le maniglie rosa della timeline sotto il video.</Text>

        <View style={{ flexDirection: 'row', gap: 10, marginTop: 22 }}>
          <Btn
            label="Fatto"
            variant="ghost"
            onPress={() => {
              const done = () => onDone({ ...project, finalVideoUrl: job?.finalVideoUrl ?? project.finalVideoUrl });
              if (!dirty) { done(); return; }
              Alert.alert('Modifiche non applicate', 'Le modifiche che vedi nell anteprima non sono ancora nel video. Vuoi uscire lo stesso?', [
                { text: 'Resta', style: 'cancel' },
                { text: 'Esci senza applicare', style: 'destructive', onPress: done },
              ]);
            }}
            disabled={busy}
            style={{ flex: 1 }}
          />
          <Btn
            label="Applica modifiche"
            icon={<Wand2 size={17} color={colors.onAccent} />}
            onPress={() => render(spec)}
            loading={rendering}
            disabled={busy || !dirty}
            style={{ flex: 1.6 }}
          />
        </View>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  moveRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10 },
  moveBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 16, height: 38, borderRadius: radius.full,
    borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceAlt,
  },
  moveBtnOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  moveText: { color: colors.text, fontFamily: fonts.semibold, fontSize: 13.5 },
  colors: { gap: 8, paddingVertical: 2 },
  swatchRing: { padding: 2, borderRadius: 18, borderWidth: 2, borderColor: 'transparent' },
  swatch: {
    width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.25)',
  },
  sizeBtn: {
    width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceAlt,
  },
  moveHint: { color: colors.textDim, fontSize: 12, marginTop: 6 },
  player: {
    backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border,
    padding: 12, gap: 12, marginBottom: 6,
  },
  playerRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  playBtn: {
    width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accent,
    shadowColor: colors.accent, shadowOpacity: 0.45, shadowRadius: 10, shadowOffset: { width: 0, height: 0 },
  },
  playerTime: { color: colors.text, fontFamily: fonts.semibold, fontSize: 14, fontVariant: ['tabular-nums'] },
  muteBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6, height: 36, paddingHorizontal: 12, borderRadius: radius.full,
    backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border,
  },
  muteOn: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  muteText: { color: colors.text, fontSize: 12.5, fontFamily: fonts.medium },
  subLabel: { color: colors.textDim, fontSize: 12.5, marginTop: 12, marginBottom: 6 },
  hintSmall: { color: colors.textDim, fontSize: 11.5, marginTop: 8 },
  noteBox: {
    flexDirection: 'row', gap: 10, alignItems: 'center', marginBottom: 12,
    backgroundColor: 'rgba(255,214,107,0.1)', borderRadius: radius.md, padding: 12,
  },
  noteText: { color: colors.warm, flex: 1, fontSize: 13.5, lineHeight: 19 },
  section: { color: colors.text, fontSize: 15, fontWeight: '800', marginTop: 24, marginBottom: 10 },
  card: {
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.lg, padding: 14, marginBottom: 10,
  },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  mediaName: { color: colors.text, flex: 1, fontSize: 14, fontWeight: '600' },
  hint: { color: colors.textDim, fontSize: 12, marginTop: 8, lineHeight: 17 },
  dirtyRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8 },
  dirtyText: { color: colors.warm, fontSize: 12, fontWeight: '600' },
  renderBox: { marginBottom: 12, gap: 8 },
  renderText: { color: colors.textDim, fontSize: 13, marginBottom: 6 },
  okBox: {
    flexDirection: 'row', gap: 10, alignItems: 'center', marginBottom: 12,
    backgroundColor: 'rgba(124,255,203,0.1)', borderRadius: radius.md, padding: 12,
  },
  okText: { color: colors.ok, flex: 1, fontSize: 13.5, lineHeight: 19 },
  errorBox: {
    flexDirection: 'row', gap: 10, alignItems: 'center', marginBottom: 12,
    backgroundColor: 'rgba(255,107,107,0.1)', borderRadius: radius.md, padding: 12,
  },
  errorText: { color: colors.err, flex: 1, fontSize: 13.5, lineHeight: 19 },
});
