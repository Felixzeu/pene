import React, { useEffect, useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useVideoPlayer } from 'expo-video';
import * as ImagePicker from 'expo-image-picker';
import {
  AlertTriangle, Ban, Check, CheckCircle2, Eye, ImagePlus, Info, Pause, Play, Plus, Scissors, Sparkles, Trash2, Type as TypeIcon,
  Volume2, VolumeX, Wand2,
} from 'lucide-react-native';
import { Badge, Btn, ChipRow, Header, Input, ProgressBar, Screen, TextArea } from '../components/ui';
import { RangeBar, SeekBar, fmt } from '../components/Timeline';
import { TEXT_COLORS } from '../lib/textColors';
import { colors, fonts, radius } from '../theme';
import { aiEdit, getJob, jobMediaSource, renderEdit, uploadMedia } from '../services/api';
import LivePreview, { overlayLook, type Selection, type Transform } from '../components/LivePreview';
import { upsertProject } from '../services/history';
import { getLanguage } from '../services/language';
import { t, tServer } from '../i18n';
import type { EditSpec, Job, OverlayItem, Project, TextItem } from '../types';

type SubStyle = NonNullable<EditSpec['subStyle']>;
const SUB_DEFAULT: SubStyle = { size: 'medium' };
const EMPTY: EditSpec = { trimStart: 0, trimEnd: 0, subtitles: true, subStyle: SUB_DEFAULT, texts: [], overlays: [], stickers: [] };

const round1 = (n: number) => Math.round(n * 10) / 10;
const newId = (p: string) => `${p}${Date.now().toString(36).slice(-5)}`;

/** Palette di colori: un tocco e si vede subito nell'anteprima. Con `none` c'è anche "nessuno". */
function ColorPicker({ value, onChange, none }: { value?: string; onChange: (hex: string | undefined) => void; none?: boolean }) {
  const cur = value?.toUpperCase() ?? (none ? undefined : '#FFFFFF');
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.colors}>
      {none && (
        <Pressable onPress={() => onChange(undefined)} hitSlop={4} accessibilityLabel={t('Nessuno')} style={[styles.swatchRing, !cur && { borderColor: colors.accent }]}>
          <View style={[styles.swatch, { backgroundColor: colors.surfaceAlt }]}><Ban size={14} color={colors.textDim} /></View>
        </Pressable>
      )}
      {TEXT_COLORS.map((c) => {
        const on = c.hex === cur;
        return (
          <Pressable key={c.hex} onPress={() => onChange(c.hex)} hitSlop={4} accessibilityLabel={t(c.name)} style={[styles.swatchRing, on && { borderColor: colors.accent }]}>
            <View style={[styles.swatch, { backgroundColor: c.hex }]}>
              {on && <Check size={14} color={c.hex === '#FFFFFF' || c.hex === '#FFD42B' ? '#000' : '#fff'} />}
            </View>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

/** Il primo elemento aggiunto o cambiato dall'IA: lì si porta l'anteprima per farlo vedere subito. */
function firstChange(before: EditSpec, after: EditSpec): { sel: NonNullable<Selection>; start: number } | null {
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  const found: { sel: NonNullable<Selection>; start: number }[] = [];
  for (const x of after.texts) {
    if (!same(x, before.texts.find((y) => y.id === x.id))) found.push({ sel: { kind: 'text', id: x.id }, start: x.start });
  }
  for (const o of after.overlays) {
    if (!same(o, before.overlays.find((y) => y.id === o.id))) found.push({ sel: { kind: 'overlay', id: o.id }, start: o.start });
  }
  if (!same(after.subStyle, before.subStyle) && after.subtitles) found.push({ sel: { kind: 'sub', id: 'sub' }, start: -1 });
  found.sort((a, b) => a.start - b.start);
  return found[0] ?? null;
}

// Modifiche dopo il primo montaggio: testi a schermo, foto/video della galleria, sottotitoli,
// taglio di inizio/fine e istruzioni libere all'IA. Gli elementi si toccano, spostano e
// ingrandiscono direttamente nell'anteprima; il backend rifà l'export solo con "Applica modifiche".
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
  const [selected, setSelected] = useState<Selection>(null);
  const [dragging, setDragging] = useState(false);
  // Ultima spec e numero dell'ultima richiesta all'IA: una risposta vecchia non sovrascrive quelle nuove.
  const specRef = useRef(spec);
  specRef.current = spec;
  const aiSeq = useRef(0);

  const previewSrc = job?.previewUrl ?? null;
  const previewPlayer = useVideoPlayer(previewSrc ? { uri: previewSrc } : null, (p) => { p.loop = true; p.play(); });
  // Posizione della testina (secondi del video originale).
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(true);
  useEffect(() => {
    const id = setInterval(() => setTime(previewPlayer.currentTime ?? 0), 120);
    return () => clearInterval(id);
  }, [previewPlayer]);
  const pause = () => { previewPlayer.pause(); setPlaying(false); };
  const seek = (tt: number) => { pause(); previewPlayer.currentTime = tt; setTime(tt); };
  const togglePlay = () => {
    if (playing) pause();
    else { setSelected(null); previewPlayer.play(); setPlaying(true); }
  };
  // Muto solo nell'anteprima: il video esportato tiene sempre il suo audio.
  const [previewMuted, setPreviewMuted] = useState(false);
  useEffect(() => { previewPlayer.muted = previewMuted; }, [previewPlayer, previewMuted]);

  // Stato iniziale dal backend (spec attuale e media già caricati).
  useEffect(() => {
    getJob(jobId).then((j) => {
      setJob(j);
      const s = { ...EMPTY, ...(j.spec ?? {}), subStyle: j.spec?.subStyle ?? SUB_DEFAULT, stickers: j.spec?.stickers ?? [] };
      setSpec(s);
      setApplied(s);
    }).catch((e) => setError(e instanceof Error ? tServer(e.message) : t('Backend non raggiungibile.')));
    return () => { stopRef.current = true; };
  }, [jobId]);

  const finalLen = Math.max(1, (job?.duration ?? 60) - spec.trimStart - spec.trimEnd);
  // "Ora" = punto attuale dell'anteprima, in secondi sul video finale.
  const now = () => round1(Math.min(Math.max(0, (previewPlayer.currentTime ?? 0) - spec.trimStart), finalLen));
  const dirty = JSON.stringify(spec) !== JSON.stringify(applied);

  const patchText = (id: string, p: Partial<TextItem>) =>
    setSpec((s) => ({ ...s, texts: s.texts.map((x) => (x.id === id ? { ...x, ...p } : x)) }));
  const patchOverlay = (id: string, p: Partial<OverlayItem>) =>
    setSpec((s) => ({ ...s, overlays: s.overlays.map((o) => (o.id === id ? { ...o, ...p } : o)) }));

  // Selezione: ferma l'anteprima e la porta nel momento dell'elemento, così resta visibile.
  const select = (sel: Selection, start?: number) => {
    setSelected(sel);
    if (!sel) return;
    pause();
    if (start != null && start >= 0) {
      const tt = specRef.current.trimStart + start + 0.3;
      previewPlayer.currentTime = tt;
      setTime(tt);
    }
  };
  const isSel = (kind: NonNullable<Selection>['kind'], id: string) => selected?.kind === kind && selected.id === id;

  // Fine di un gesto nell'anteprima: salva posizione e grandezza.
  const transform = (sel: NonNullable<Selection>, tr: Transform) => {
    if (sel.kind === 'overlay') {
      const o = specRef.current.overlays.find((x) => x.id === sel.id);
      const m = job?.media?.find((x) => x.id === o?.mediaId);
      // Una foto a schermo intero diventa una foto intera libera, che si sposta e si ridimensiona.
      const full = o && overlayLook(o, m).aspect == null;
      patchOverlay(sel.id, { x: tr.x, y: tr.y, w: tr.w, ...(full ? { mode: 'pip' as const, cutout: false } : {}) });
    } else if (sel.kind === 'text') {
      // La maniglia laterale cambia solo la larghezza: la grandezza resta quella di prima.
      patchText(sel.id, { x: tr.x, y: tr.y, ...(tr.fs != null ? { fs: tr.fs } : {}), ...(tr.tw != null ? { tw: tr.tw } : {}) });
    } else {
      setSpec((s) => ({ ...s, subStyle: { ...(s.subStyle ?? SUB_DEFAULT), x: tr.x, y: tr.y, ...(tr.fs != null ? { fs: tr.fs } : {}) } }));
    }
  };

  const addText = () => {
    const start = now();
    const id = newId('t');
    // Di default: testo nero su riquadro bianco, in alto al centro (lontano dai sottotitoli).
    setSpec((s) => ({
      ...s,
      texts: [...s.texts, {
        id, text: '', start, end: round1(Math.min(start + 3, finalLen)),
        position: 'top', size: 'medium', x: 540, y: 560, fs: 64, color: '#000000', bg: '#FFFFFF',
      }],
    }));
    select({ kind: 'text', id }, start);
  };

  // Risposta dell'IA: si applica solo se è l'ultima chiesta, e si mostra subito nell'anteprima.
  const applyAi = (seq: number, before: EditSpec, out: Awaited<ReturnType<typeof aiEdit>>) => {
    if (seq !== aiSeq.current) return false;
    const next = { ...out.spec, subStyle: out.spec.subStyle ?? before.subStyle ?? SUB_DEFAULT };
    setSpec(next);
    if (out.media) setJob((j) => (j ? { ...j, media: out.media } : j));
    const ch = firstChange(before, next);
    if (ch) select(ch.sel, ch.start);
    return true;
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
      const seq = ++aiSeq.current;
      const before = specRef.current;
      try {
        const cut = media.cutout ? ' La foto è già scontornata (senza sfondo): usala con "cutout": true come elemento sopra il video.' : '';
        const out = await aiEdit(jobId, `Inserisci il nuovo media "${media.id}" (${media.kind}, "${media.name}") nel punto più adatto in base alla trascrizione, con durata, modalità, grandezza e posizione ottimali.${cut} Non cambiare nient'altro.`, before, getLanguage());
        if (applyAi(seq, before, out)) setAiSummary(`${out.summary} ${t('Toccala nell\'anteprima per spostarla e ingrandirla, poi premi Applica modifiche.')}`);
      } catch {
        const start = now();
        const len = media.kind === 'video' && media.duration ? Math.min(media.duration, 5) : 3;
        const id = newId('o');
        setSpec((s) => ({
          ...s,
          overlays: [...s.overlays, media.cutout
            ? { id, mediaId: media.id, start, end: round1(Math.min(start + len, finalLen)), mode: 'pip', position: 'bottom-right', w: 560, cutout: true }
            : { id, mediaId: media.id, start, end: round1(Math.min(start + len, finalLen)), mode: 'full' }],
        }));
        select({ kind: 'overlay', id }, start);
      } finally {
        setAiBusy(false);
      }
    } catch (e) {
      setError(e instanceof Error ? tServer(e.message) : t('Caricamento non riuscito.'));
    } finally {
      setUploadPct(null);
    }
  };

  // Export con le modifiche e polling finché non è pronto.
  const render = async (next: EditSpec) => {
    setError(null);
    setSelected(null);
    setRendering(true);
    try {
      await renderEdit(jobId, { ...next, texts: next.texts.filter((x) => x.text.trim()) });
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
        if (j.stage === 'error') { setError(j.message ? tServer(j.message) : t('Export non riuscito.')); break; }
      }
    } catch (e) {
      setError(e instanceof Error ? tServer(e.message) : t('Export non riuscito.'));
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
    const seq = ++aiSeq.current;
    const before = specRef.current;
    try {
      const out = await aiEdit(jobId, instruction.trim(), before, getLanguage());
      if (applyAi(seq, before, out)) {
        setAiSummary(`${out.summary} ${t('È solo un\'anteprima: premi Applica modifiche per salvarla nel video.')}`);
        setAiNotes(out.notes ?? null);
        setInstruction('');
      }
    } catch (e) {
      if (seq === aiSeq.current) setError(e instanceof Error ? tServer(e.message) : t('L\'IA non ha risposto.'));
    } finally {
      if (seq === aiSeq.current) setAiBusy(false);
    }
  };

  const busy = rendering || aiBusy || uploadPct !== null;
  const mediaOf = (id: string) => job?.media?.find((m) => m.id === id);
  const ss = spec.subStyle ?? SUB_DEFAULT;

  return (
    <Screen>
      <Header title={t('Modifica il video')} subtitle={t('Tocca un elemento nell\'anteprima per spostarlo')} onBack={onBack} />
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }} keyboardShouldPersistTaps="handled" scrollEnabled={!dragging}>
        {previewSrc ? (
          <LivePreview
            player={previewPlayer}
            spec={spec}
            words={job?.words ?? []}
            media={job?.media ?? []}
            duration={job?.duration ?? 0}
            mediaUri={(id, cut) => jobMediaSource(jobId, id, cut)}
            selected={selected}
            onSelect={(sel) => select(sel)}
            onTransform={transform}
            onDrag={setDragging}
          />
        ) : null}
        <Text style={styles.previewHint}>
          {selected
            ? t('Trascina per spostare · maniglie o due dita per ingrandire · tocca fuori per deselezionare')
            : t('Tocca foto, testi o sottotitoli nell\'anteprima per spostarli e ingrandirli')}
        </Text>

        {/* Riproduzione: play, tempo, audio dell'anteprima e barra classica; sotto, il taglio. */}
        {job?.duration ? (
          <View style={styles.player}>
            <View style={styles.playerRow}>
              <Pressable
                onPress={togglePlay}
                hitSlop={6}
                accessibilityLabel={playing ? t('Pausa') : t('Riproduci')}
                style={({ pressed }) => [styles.playBtn, pressed && { transform: [{ scale: 0.94 }] }]}
              >
                {playing
                  ? <Pause size={20} color={colors.onAccent} fill={colors.onAccent} />
                  : <Play size={20} color={colors.onAccent} fill={colors.onAccent} style={{ marginLeft: 2 }} />}
              </Pressable>
              <View style={{ flex: 1 }}>
                <SeekBar
                  duration={finalLen}
                  time={Math.max(0, time - spec.trimStart)}
                  onSeek={(tt) => seek(spec.trimStart + tt)}
                  onDrag={setDragging}
                />
              </View>
              <Pressable
                onPress={() => setPreviewMuted((m) => !m)}
                hitSlop={8}
                accessibilityLabel={previewMuted ? t('Riattiva audio') : t('Silenzia anteprima')}
                style={[styles.muteBtn, previewMuted && styles.muteOn]}
              >
                {previewMuted ? <VolumeX size={18} color={colors.accent} /> : <Volume2 size={18} color={colors.text} />}
              </Pressable>
            </View>
            <View style={styles.trimHead}>
              <Scissors size={14} color={colors.textDim} />
              <Text style={styles.trimLabel}>{t('Parte da tenere')}</Text>
              <Text style={styles.trimLen}>{fmt(finalLen)}</Text>
            </View>
            <RangeBar
              total={job.duration}
              start={spec.trimStart}
              end={job.duration - spec.trimEnd}
              onChange={(p) => setSpec((s) => ({ ...s, trimStart: round1(p.start), trimEnd: round1(Math.max(0, job.duration! - p.end)) }))}
              onDrag={setDragging}
            />
          </View>
        ) : null}
        <View style={{ alignItems: 'center', marginBottom: 12 }}>
          {dirty && (
            <View style={styles.dirtyRow}><Eye size={13} color={colors.warm} /><Text style={styles.dirtyText}>{t('Modifiche non ancora applicate')}</Text></View>
          )}
        </View>

        {rendering && (
          <View style={styles.renderBox}>
            <Text style={styles.renderText}>{job?.message ? tServer(job.message) : t('Applico le modifiche…')}</Text>
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
        <Text style={styles.section}>{t('Chiedi all\'IA')}</Text>
        <TextArea
          value={instruction}
          onChangeText={setInstruction}
          placeholder={t('Es. "metti il tasto segui al secondo 3", "una foto della Torre Eiffel quando la nomino", "togli i primi 2 secondi"')}
          maxLength={1000}
          style={{ minHeight: 90 }}
        />
        <Btn
          label={t('Applica con l\'IA')}
          variant="warm"
          icon={<Sparkles size={17} color={colors.onWarm} />}
          onPress={askAi}
          loading={aiBusy}
          disabled={busy || instruction.trim().length < 3}
          style={{ marginTop: 10 }}
        />

        {/* Testi */}
        <Text style={styles.section}>{t('Testi a schermo')}</Text>
        {spec.texts.map((x) => (
          <View key={x.id} style={[styles.card, isSel('text', x.id) && styles.cardOn]}>
            <View style={styles.cardHead}>
              <Pressable hitSlop={8} onPress={() => select({ kind: 'text', id: x.id }, x.start)}>
                <TypeIcon size={16} color={isSel('text', x.id) ? colors.accent : colors.textDim} />
              </Pressable>
              <Input
                value={x.text}
                onChangeText={(v) => patchText(x.id, { text: v })}
                onFocus={() => select({ kind: 'text', id: x.id }, x.start)}
                placeholder={t('Scrivi il testo')}
                maxLength={200}
                style={{ flex: 1, height: 44 }}
              />
              <Pressable hitSlop={10} onPress={() => { setSpec((s) => ({ ...s, texts: s.texts.filter((y) => y.id !== x.id) })); if (isSel('text', x.id)) setSelected(null); }}>
                <Trash2 size={18} color={colors.err} />
              </Pressable>
            </View>
            <RangeBar total={finalLen} start={x.start} end={x.end} onChange={(p) => patchText(x.id, p)} onDrag={setDragging} color={colors.accent2} />
            <Text style={styles.subLabel}>{t('Colore del testo')}</Text>
            <ColorPicker value={x.color} onChange={(hex) => patchText(x.id, { color: hex })} />
            <Text style={styles.subLabel}>{t('Riquadro')}</Text>
            <ColorPicker none value={x.bg} onChange={(hex) => patchText(x.id, { bg: hex })} />
          </View>
        ))}
        <Btn label={t('Aggiungi testo')} variant="ghost" icon={<Plus size={17} color={colors.text} />} onPress={addText} disabled={busy} />

        {/* Media */}
        <Text style={styles.section}>{t('Foto e video')}</Text>
        {spec.overlays.map((o) => {
          const m = mediaOf(o.mediaId);
          const full = overlayLook(o, m).aspect == null;
          return (
            <View key={o.id} style={[styles.card, isSel('overlay', o.id) && styles.cardOn]}>
              <Pressable style={styles.cardHead} onPress={() => select({ kind: 'overlay', id: o.id }, o.start)}>
                <Badge text={m?.kind === 'video' ? 'VIDEO' : t('FOTO')} tone="warm" />
                <Text style={styles.mediaName} numberOfLines={1}>{m?.name ?? o.mediaId}</Text>
                <Pressable hitSlop={10} onPress={() => { setSpec((s) => ({ ...s, overlays: s.overlays.filter((y) => y.id !== o.id) })); if (isSel('overlay', o.id)) setSelected(null); }}>
                  <Trash2 size={18} color={colors.err} />
                </Pressable>
              </Pressable>
              <RangeBar total={finalLen} start={o.start} end={o.end} onChange={(p) => patchOverlay(o.id, p)} onDrag={setDragging} color={colors.warm} />
              <ChipRow
                options={[t('Schermo intero'), t('Libera')]}
                value={full ? t('Schermo intero') : t('Libera')}
                onChange={(v) => patchOverlay(o.id, v === t('Schermo intero')
                  ? { mode: 'full', cutout: false, x: undefined, y: undefined, w: undefined }
                  : { mode: 'pip', x: 540, y: 960, w: 760 })}
              />
              {m?.kind === 'image' && m.cutout && !full && (
                <View style={{ marginTop: 8 }}>
                  <ChipRow
                    options={[t('Sfondo tolto'), t('Foto intera')]}
                    value={o.cutout === false ? t('Foto intera') : t('Sfondo tolto')}
                    onChange={(v) => patchOverlay(o.id, { cutout: v === t('Sfondo tolto') })}
                  />
                </View>
              )}
            </View>
          );
        })}
        {uploadPct !== null && (
          <View style={{ marginBottom: 10 }}>
            <Text style={styles.renderText}>{t('Caricamento… {pct}%', { pct: uploadPct })}</Text>
            <ProgressBar pct={uploadPct} />
          </View>
        )}
        <Btn label={t('Aggiungi dalla galleria')} variant="ghost" icon={<ImagePlus size={17} color={colors.text} />} onPress={addMedia} disabled={busy} />

        {/* Sottotitoli */}
        <Text style={styles.section}>{t('Sottotitoli')}</Text>
        <View style={[styles.card, isSel('sub', 'sub') && styles.cardOn]}>
          <ChipRow
            options={[t('Sì'), t('No')]}
            value={spec.subtitles ? t('Sì') : t('No')}
            onChange={(v) => { setSpec((s) => ({ ...s, subtitles: v === t('Sì') })); if (v !== t('Sì') && isSel('sub', 'sub')) setSelected(null); }}
          />
          {spec.subtitles && (
            <>
              <Text style={styles.subLabel}>{t('Colore')}</Text>
              <ColorPicker
                value={ss.color}
                onChange={(hex) => setSpec((s) => ({ ...s, subStyle: { ...(s.subStyle ?? SUB_DEFAULT), color: hex } }))}
              />
              <Text style={styles.hintSmall}>{t('Toccali nell\'anteprima per spostarli e ingrandirli. Il bordo si adatta al colore, così si leggono su qualsiasi sfondo.')}</Text>
              {(ss.x != null || ss.fs != null) && (
                <Pressable onPress={() => setSpec((s) => ({ ...s, subStyle: { size: 'medium', color: s.subStyle?.color } }))} style={{ marginTop: 8 }}>
                  <Text style={styles.link}>{t('Rimetti posizione e grandezza di default')}</Text>
                </Pressable>
              )}
            </>
          )}
        </View>
        <Text style={styles.hint}>{t('Di default sottotitoli e testi stanno lontani dai bordi, dove TikTok e Instagram mettono descrizione e pulsanti.')}</Text>

        <View style={{ flexDirection: 'row', gap: 10, marginTop: 22 }}>
          <Btn
            label={t('Fatto')}
            variant="ghost"
            onPress={() => {
              const done = () => onDone({ ...project, finalVideoUrl: job?.finalVideoUrl ?? project.finalVideoUrl });
              if (!dirty) { done(); return; }
              Alert.alert(t('Modifiche non applicate'), t('Le modifiche che vedi nell\'anteprima non sono ancora nel video. Vuoi uscire lo stesso?'), [
                { text: t('Resta'), style: 'cancel' },
                { text: t('Esci senza applicare'), style: 'destructive', onPress: done },
              ]);
            }}
            disabled={busy}
            style={{ flex: 1 }}
          />
          <Btn
            label={t('Applica modifiche')}
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
  previewHint: { color: colors.textDim, fontSize: 12, textAlign: 'center', marginTop: -6, marginBottom: 12, paddingHorizontal: 12 },
  colors: { gap: 8, paddingVertical: 2 },
  swatchRing: { padding: 2, borderRadius: 18, borderWidth: 2, borderColor: 'transparent' },
  swatch: {
    width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.25)',
  },
  player: {
    backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border,
    padding: 12, gap: 8, marginBottom: 6,
  },
  playerRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  playBtn: {
    width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accent,
    shadowColor: colors.accent, shadowOpacity: 0.45, shadowRadius: 10, shadowOffset: { width: 0, height: 0 },
  },
  muteBtn: {
    width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border,
  },
  muteOn: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  trimHead: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
  trimLabel: { color: colors.textDim, fontSize: 12.5, fontFamily: fonts.medium, flex: 1 },
  trimLen: { color: colors.text, fontSize: 12.5, fontFamily: fonts.semibold },
  subLabel: { color: colors.textDim, fontSize: 12.5, marginTop: 12, marginBottom: 6 },
  hintSmall: { color: colors.textDim, fontSize: 11.5, marginTop: 8, lineHeight: 16 },
  link: { color: colors.accent, fontSize: 12.5, fontFamily: fonts.semibold },
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
  cardOn: { borderColor: colors.accent },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  mediaName: { color: colors.text, flex: 1, fontSize: 14, fontWeight: '600' },
  hint: { color: colors.textDim, fontSize: 12, marginTop: 8, lineHeight: 17 },
  dirtyRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8 },
  dirtyText: { color: colors.warm, fontSize: 12, fontWeight: '600' },
  renderBox: { marginBottom: 12, gap: 8 },
  renderText: { color: colors.textDim, fontSize: 13, marginBottom: 6 },
  okBox: {
    flexDirection: 'row', gap: 10, alignItems: 'center', marginBottom: 12,
    backgroundColor: 'rgba(91,228,155,0.1)', borderRadius: radius.md, padding: 12,
  },
  okText: { color: colors.ok, flex: 1, fontSize: 13.5, lineHeight: 19 },
  errorBox: {
    flexDirection: 'row', gap: 10, alignItems: 'center', marginBottom: 12,
    backgroundColor: 'rgba(255,138,92,0.1)', borderRadius: radius.md, padding: 12,
  },
  errorText: { color: colors.err, flex: 1, fontSize: 13.5, lineHeight: 19 },
});
