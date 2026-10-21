import React, { useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { VideoView, useVideoPlayer } from 'expo-video';
import { AlertTriangle, CheckCircle2, Loader2, Share2, Sparkles, Subtitles, Wand2, Zap } from 'lucide-react-native';
import { Badge, Btn, Header, Screen } from '../components/ui';
import { colors, radius } from '../theme';
import { getJob, uploadForEdit } from '../services/api';
import { upsertProject } from '../services/history';
import type { Job, Project, Word } from '../types';

const STEPS = [
  { key: 'queued', label: 'In coda', icon: Loader2 },
  { key: 'transcribing', label: 'Trascrizione', icon: Subtitles },
  { key: 'editing', label: 'Montaggio', icon: Wand2 },
  { key: 'ready', label: 'Pronto', icon: CheckCircle2 },
] as const;

const STEP_ORDER: Record<string, number> = { queued: 0, transcribing: 1, editing: 2, ready: 3 };

// Avanzamento del montaggio sul backend: polling con stati chiari.
// Quando la pipeline ha tagliato i silenzi, il backend espone anche un video
// "anteprima" (già tagliato, senza sottotitoli incollati) e la timeline delle
// parole: qui li componiamo in tempo reale mentre l'export finale prosegue.
export default function EditScreen({ project, onBack, onReady, onHome }: {
  project: Project;
  onBack: () => void;
  onReady: (p: Project) => void;
  onHome: () => void;
}) {
  const [jobId, setJobId] = useState(project.jobId);
  const [job, setJob] = useState<Job | null>(
    project.jobId ? { jobId: project.jobId, stage: 'queued', progress: 0.1 } : null,
  );
  const [failed, setFailed] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const stopRef = useRef(false);
  const finalUrl = job?.finalVideoUrl;
  const previewUrl = job?.previewUrl;
  const isPreview = !finalUrl && !!previewUrl;

  const player = useVideoPlayer(
    finalUrl ? { uri: finalUrl } : isPreview ? { uri: previewUrl as string } : null,
    (p) => { p.loop = true; },
  );

  useEffect(() => {
    if (!jobId) return;
    stopRef.current = false;
    const poll = async () => {
      while (!stopRef.current) {
        try {
          const j = await getJob(jobId);
          setJob(j);
          if (j.stage === 'ready' || j.stage === 'error') {
            if (j.stage === 'error') setFailed(true);
            return;
          }
        } catch {
          // errore di rete momentaneo: riprova al giro successivo
        }
        await new Promise((r) => setTimeout(r, 3000));
      }
    };
    poll();
    return () => { stopRef.current = true; };
  }, [jobId]);

  // Autoplay sia dell'anteprima live che del video finale.
  useEffect(() => {
    if ((isPreview || finalUrl) && !player.playing) {
      player.play();
    }
  }, [player, isPreview, finalUrl]);

  // Sincronizzazione dei sottotitoli con la posizione di riproduzione.
  const [now, setNow] = useState(0);
  useEffect(() => {
    if (!isPreview) return;
    player.timeUpdateEventInterval = 0.1; // 10 aggiornamenti al secondo bastano per il karaoke
    const sub = player.addListener('timeUpdate', (payload) => {
      const t = payload.currentTime;
      setNow((prev) => (Math.abs(prev - t) > 0.05 ? t : prev));
    });
    return () => sub.remove();
  }, [player, isPreview]);

  // Quando il job è pronto salviamo il risultato nella cronologia.
  useEffect(() => {
    if (finalUrl) {
      const next = { ...project, jobId, finalVideoUrl: finalUrl };
      upsertProject(next);
    }
  }, [finalUrl]);

  // Riprova: ricarica il video grezzo e avvia un nuovo job di montaggio.
  const retry = async () => {
    if (!project.rawVideoUri) return;
    setRetrying(true);
    try {
      const { jobId: next } = await uploadForEdit(project.rawVideoUri, project, () => {});
      upsertProject({ ...project, jobId: next });
      setFailed(false);
      setJob({ jobId: next, stage: 'queued', progress: 0.1 });
      setJobId(next);
    } catch (e) {
      setJob((j) => (j ? { ...j, message: e instanceof Error ? e.message : 'Riprova non riuscita.' } : j));
    } finally {
      setRetrying(false);
    }
  };

  if (!jobId) return null;

  const current = job ? STEP_ORDER[job.stage] ?? 0 : 0;
  const errorMsg = failed ? job?.message ?? 'Il montaggio è fallito. Riprova.' : null;

  return (
    <Screen>
      <Header
        title={finalUrl ? 'Video pronto' : isPreview ? 'Montaggio live' : 'Montaggio in corso'}
        subtitle={
          finalUrl
            ? 'Ecco il risultato finale'
            : isPreview
              ? 'Guarda sottotitoli e taglio dei silenzi mentre li applichiamo'
              : 'Lavoriamo sul tuo video, puoi tenere aperta questa schermata'
        }
        onBack={onBack}
      />
      <ScrollView contentContainerStyle={{ padding: 20 }}>

        {(finalUrl || isPreview) ? (
          <View style={styles.playerWrap}>
            <VideoView player={player} style={styles.player} contentFit="contain" />
            {isPreview && <SubtitleOverlay words={job?.words ?? []} now={now} />}
            {isPreview && (
              <View style={styles.liveBadge} pointerEvents="none">
                <Zap size={12} color={colors.warm} />
                <Text style={styles.liveText}>ANTEPRIMA LIVE · {Math.round((job?.progress ?? 0) * 100)}%</Text>
              </View>
            )}
          </View>
        ) : (
          <View style={steps.card}>
            {STEPS.map((s, i) => {
              const done = i < current || (!failed && job?.stage === 'ready');
              const active = i === current && !failed;
              const Icon = s.icon;
              return (
                <View key={s.key} style={[steps.row, i === STEPS.length - 1 && { borderBottomWidth: 0 }]}>
                  <View style={[steps.dot, done && { backgroundColor: 'rgba(61,220,132,0.15)' }, active && { backgroundColor: colors.accentSoft }]}>
                    {failed && i > current
                      ? <AlertTriangle size={16} color={colors.err} />
                      : done
                        ? <CheckCircle2 size={16} color={colors.ok} />
                        : <Icon size={16} color={active ? colors.accent : colors.textDim} />}
                  </View>
                  <Text style={[steps.label, { color: active || done ? colors.text : colors.textDim }]}>
                    {s.label}
                  </Text>
                  {active && <Badge text="in corso" tone="accent" />}
                </View>
              );
            })}
            <View style={{ marginTop: 14 }}>
              <Text style={steps.pct}>{Math.round((job?.progress ?? current / 4) * 100)}%</Text>
            </View>
          </View>
        )}

        {isPreview && (
          <View style={steps.stageStrip}>
            {STEPS.slice(0, 3).map((s, i) => {
              const done = i < current;
              const active = i === current && !failed;
              return (
                <View key={s.key} style={[steps.stageChip, active && { borderColor: colors.accent }]}>
                  <View style={[steps.stageDot, done && { backgroundColor: colors.ok }, active && { backgroundColor: colors.accent }]} />
                  <Text style={[steps.stageLabel, { color: done || active ? colors.text : colors.textDim }]}>{s.label}</Text>
                </View>
              );
            })}
          </View>
        )}

        {errorMsg && (
          <View style={steps.errorBox}>
            <AlertTriangle size={18} color={colors.err} />
            <Text style={steps.errorText}>{errorMsg}</Text>
          </View>
        )}

        <View style={{ flexDirection: 'row', gap: 10, marginTop: 24 }}>
          {finalUrl ? (
            <>
              <Btn label="Home" variant="ghost" onPress={onHome} style={{ flex: 1 }} />
              <Btn label="Pubblica" icon={<Share2 size={17} color="#fff" />} onPress={() => onReady({ ...project, jobId, finalVideoUrl: finalUrl })} style={{ flex: 1.6 }} />
            </>
          ) : (
            <>
              <Btn label="Chiudi" variant="ghost" onPress={onHome} style={{ flex: 1 }} />
              <Btn
                label="Riprova montaggio"
                variant="warm"
                icon={<Sparkles size={17} color="#221704" />}
                onPress={retry}
                loading={retrying}
                disabled={!failed || !project.rawVideoUri}
                style={{ flex: 1.6 }}
              />
            </>
          )}
        </View>
      </ScrollView>
    </Screen>
  );
}

// Sottotitoli in tempo reale: finestra di parole centrata su quella corrente,
// evidenziata in ambra — lo stesso stile che verrà incollato nel video finale.
function SubtitleOverlay({ words, now }: { words: Word[]; now: number }) {
  if (words.length === 0) return null;
  let active = -1;
  for (let i = 0; i < words.length; i++) {
    if (now >= words[i].start && now < words[i].end) { active = i; break; }
  }
  if (active < 0) {
    // tra due parole: mostra la finestra della successiva senza evidenziare nulla
    const next = words.findIndex((w) => w.start > now);
    if (next < 0) return null;
    active = next;
  }
  const window = words.slice(Math.max(0, active - 2), active + 4);
  return (
    <View style={overlay.wrap} pointerEvents="none">
      <Text style={overlay.text}>
        {window.map((w, i) => (
          <Text
            key={`${w.start}-${i}`}
            style={words[active] === w ? { color: colors.warm } : { color: '#fff' }}
          >
            {w.word}{' '}
          </Text>
        ))}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  playerWrap: {
    borderRadius: 22, overflow: 'hidden', backgroundColor: '#000',
    aspectRatio: 9 / 16, maxHeight: 540, alignSelf: 'center', width: '100%',
  },
  player: { flex: 1 },
  liveBadge: {
    position: 'absolute', top: 12, left: 12, flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: 'rgba(0,0,0,0.65)', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5,
  },
  liveText: { color: colors.warm, fontSize: 10.5, fontWeight: '800', letterSpacing: 0.8 },
});

const overlay = StyleSheet.create({
  wrap: { position: 'absolute', left: 12, right: 12, bottom: 60, alignItems: 'center' },
  text: {
    fontSize: 19, fontWeight: '800', textAlign: 'center', lineHeight: 27,
    textShadowColor: 'rgba(0,0,0,0.9)', textShadowRadius: 6, textShadowOffset: { width: 0, height: 1 },
  },
});

const steps = StyleSheet.create({
  card: {
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.lg, padding: 18,
  },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  dot: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceAlt },
  label: { flex: 1, fontSize: 15, fontWeight: '600' },
  pct: { color: colors.textDim, fontSize: 12.5, textAlign: 'right' },
  stageStrip: { flexDirection: 'row', gap: 8, marginTop: 14, flexWrap: 'wrap' },
  stageChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    borderWidth: 1, borderColor: colors.border, borderRadius: 999,
    paddingHorizontal: 11, paddingVertical: 6, backgroundColor: colors.surface,
  },
  stageDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.textDim },
  stageLabel: { fontSize: 11.5, fontWeight: '700' },
  errorBox: {
    flexDirection: 'row', gap: 10, alignItems: 'center', marginTop: 16,
    backgroundColor: 'rgba(255,107,107,0.1)', borderRadius: radius.md, padding: 14,
  },
  errorText: { color: colors.err, flex: 1, fontSize: 13.5, lineHeight: 19 },
});
