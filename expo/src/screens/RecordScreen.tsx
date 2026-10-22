import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { CameraView, useCameraPermissions, useMicrophonePermissions } from 'expo-camera';
import * as KeepAwake from 'expo-keep-awake';
import * as Haptics from 'expo-haptics';
import { setAudioModeAsync, setIsAudioActiveAsync } from 'expo-audio';
import {
  Camera as CameraFlip, FlipHorizontal2, Gauge, Minus, Plus, Square, Type as TypeIcon, X,
} from 'lucide-react-native';
import { colors } from '../theme';
import type { Project } from '../types';
import { t } from '../i18n';

// Registrazione a schermo diviso: script e comandi sopra, camera sotto. Teleprompter con scroll automatico regolabile,
// dimensione testo, mirror per prompter a cristalli, countdown 3-2-1 e cambio camera.
export default function RecordScreen({ project, onClose, onDone }: {
  project: Project; onClose: () => void; onDone: (uri: string) => void;
}) {
  // request: true chiede il permesso fotocamera appena si apre la schermata.
  const [permission, requestPermission] = useCameraPermissions({ request: true });
  const [micPermission, requestMicPermission] = useMicrophonePermissions();
  const { height: screenH } = useWindowDimensions();
  // Metà alta per lo script e i comandi, metà bassa libera per la camera.
  const topH = Math.round(screenH * 0.46);
  const [facing, setFacing] = useState<'front' | 'back'>('front');
  const [mirror, setMirror] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [scrolling, setScrolling] = useState(true);
  const [speed, setSpeed] = useState(2); // 1..5
  const [fontSize, setFontSize] = useState(30);

  const cameraRef = useRef<React.ComponentRef<typeof CameraView>>(null);
  const scrollRef = useRef<React.ComponentRef<typeof ScrollView> | null>(null);
  const scrollY = useRef(0);
  const maxScroll = useRef(1);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const script = project.scriptResult?.script ?? '';
  // Prima di registrare mostriamo solo la prima frase, ferma, per prepararsi.
  const firstLine = script.trim().match(/^[^\n.!?]*[.!?]?/)?.[0] ?? '';

  // iOS mostra una richiesta alla volta: il microfono si chiede dopo la fotocamera.
  useEffect(() => {
    if (permission?.granted && micPermission && !micPermission.granted && micPermission.canAskAgain) {
      requestMicPermission();
    }
  }, [permission?.granted, micPermission?.status]);
  KeepAwake.useKeepAwake();

  // I player video (expo-video) lasciano la sessione audio di iOS in sola riproduzione:
  // così la fotocamera registrerebbe un video senza audio. Va rimessa in "registrazione".
  const enableMic = async () => {
    try {
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await setIsAudioActiveAsync(true);
    } catch { /* se fallisce, il backend avvisa che manca l'audio */ }
  };
  useEffect(() => { enableMic(); }, []);

  useEffect(() => {
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, []);

  useEffect(() => {
    if (!recording) { setElapsed(0); return; }
    const t = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(t);
  }, [recording]);

  // Il teleprompter riparte dall'inizio a ogni registrazione.
  useEffect(() => {
    if (!recording) return;
    scrollY.current = 0;
    scrollRef.current?.scrollTo({ y: 0, animated: false });
  }, [recording]);

  // Scroll automatico del teleprompter, solo durante la registrazione: un passo ogni frame circa.
  useEffect(() => {
    if (!recording || !scrolling) return;
    const id = setInterval(() => {
      scrollY.current += speed * 0.55;
      if (scrollY.current > maxScroll.current) scrollY.current = 0;
      scrollRef.current?.scrollTo({ y: scrollY.current, animated: false });
    }, 33);
    return () => clearInterval(id);
  }, [recording, scrolling, speed]);

  if (!permission || !micPermission) return <View style={styles.center} />;
  if (!permission.granted || !micPermission.granted) {
    // Se l'utente ha già negato, iOS non mostra più la richiesta: serve aprire Impostazioni.
    const blocked = (!permission.granted && !permission.canAskAgain) || (!micPermission.granted && !micPermission.canAskAgain);
    return (
      <View style={[styles.center, { paddingHorizontal: 32 }]}>
        <Text style={styles.permTitle}>{t('Servono fotocamera e microfono')}</Text>
        <Text style={styles.permText}>
          {blocked
            ? (!micPermission.granted
              ? t('Hai negato il microfono: attivalo in Impostazioni › Expo Go, poi torna qui.')
              : t('Hai negato la fotocamera: attivala in Impostazioni › Expo Go, poi torna qui.'))
            : t('Per registrare con il teleprompter, autorizza fotocamera e microfono.')}
        </Text>
        <Pressable
          style={styles.permBtn}
          onPress={async () => {
            if (blocked) { Linking.openSettings(); return; }
            if (!permission.granted) await requestPermission();
            if (!micPermission.granted) await requestMicPermission();
          }}
        >
          <Text style={{ color: '#fff', fontWeight: '700' }}>{blocked ? t('Apri Impostazioni') : t('Concedi il permesso')}</Text>
        </Pressable>
        <Pressable onPress={onClose} style={{ marginTop: 18 }}>
          <Text style={{ color: colors.textDim }}>{t('Torna indietro')}</Text>
        </Pressable>
      </View>
    );
  }

  const startCountdown = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const tick = (n: number) => {
      if (n === 0) {
        setCountdown(0);
        startRecording();
        return;
      }
      setCountdown(n);
      setTimeout(() => tick(n - 1), 900);
    };
    tick(3);
  };

  // recordAsync si risolve quando la registrazione viene fermata (o raggiunge maxDuration):
  // è lì che arriva il file da passare alla revisione.
  const startRecording = async () => {
    try {
      await enableMic();
      setRecording(true);
      const res = await cameraRef.current?.recordAsync({ maxDuration: 300 });
      setRecording(false);
      onRecorded(res);
    } catch {
      setRecording(false);
    }
  };

  const stopRecording = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    setRecording(false);
    cameraRef.current?.stopRecording();
  };

  const onRecorded = (res: { uri: string } | undefined) => {
    if (res?.uri) onDone(res.uri);
  };

  const timer = `${String(Math.floor(elapsed / 60)).padStart(2, '0')}:${String(elapsed % 60).padStart(2, '0')}`;

  return (
    <View style={styles.fill}>
      {/* Parte alta: script, istruzioni e tutti i comandi. */}
      <View style={[styles.top, { height: topH }]}>
        <View style={styles.topBar}>
          <Pressable style={styles.circleBtn} onPress={onClose}>
            <X size={20} color="#fff" />
          </Pressable>
          {recording ? (
            <View style={styles.recTimer}>
              <View style={styles.recDot} />
              <Text style={styles.recTimerText}>{timer}</Text>
            </View>
          ) : (
            <Text style={styles.hint}>{t('Leggi da qui, guarda in camera')}</Text>
          )}
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Pressable style={[styles.circleBtn, mirror && { backgroundColor: colors.accent }]} onPress={() => setMirror((m) => !m)}>
              <FlipHorizontal2 size={20} color="#fff" />
            </Pressable>
            <Pressable
              style={[styles.circleBtn, recording && { opacity: 0.4 }]}
              disabled={recording}
              onPress={() => setFacing((f) => (f === 'front' ? 'back' : 'front'))}
            >
              <CameraFlip size={20} color="#fff" />
            </Pressable>
          </View>
        </View>

        {/* Teleprompter */}
        <View style={styles.prompterZone}>
          <ScrollView
            ref={scrollRef}
            showsVerticalScrollIndicator={false}
            scrollEnabled={recording}
            onScroll={(e) => { if (!recording) scrollY.current = e.nativeEvent.contentOffset.y; }}
            scrollEventThrottle={16}
            onContentSizeChange={(_, h) => { maxScroll.current = Math.max(1, h); }}
          >
            <View style={{ height: 12 }} />
            <Text
              style={[
                styles.promptText,
                { fontSize, lineHeight: Math.round(fontSize * 1.45), transform: mirror ? [{ scaleX: -1 }] : [] },
              ]}
            >
              {recording ? script : firstLine}
            </Text>
            <View style={{ height: topH * 0.7 }} />
          </ScrollView>
          {countdown > 0 && (
            <View style={styles.countdown}>
              <Text style={styles.countdownNum}>{countdown}</Text>
            </View>
          )}
        </View>

        {/* Comandi: velocità, testo, REC, pausa */}
        <View style={styles.controls}>
          <ControlStepper
            icon={<Gauge size={15} color={colors.textDim} />}
            label={t('Vel.')}
            value={speed}
            onMinus={() => setSpeed((s) => Math.max(1, s - 1))}
            onPlus={() => setSpeed((s) => Math.min(5, s + 1))}
          />
          <Pressable
            onPress={recording ? stopRecording : startCountdown}
            style={({ pressed }) => [styles.recBtn, pressed && { transform: [{ scale: 0.93 }] }]}
          >
            {recording ? <View style={styles.stopSquare} /> : <View style={styles.recInner} />}
          </Pressable>
          <ControlStepper
            icon={<TypeIcon size={15} color={colors.textDim} />}
            label={`${fontSize}`}
            onMinus={() => setFontSize((f) => Math.max(18, f - 2))}
            onPlus={() => setFontSize((f) => Math.min(52, f + 2))}
          />
          <Pressable
            style={[styles.pauseBtn, scrolling && { borderColor: colors.accent }]}
            onPress={() => setScrolling((s) => !s)}
          >
            <Text style={styles.pauseText}>{scrolling ? '❚❚' : '▶'}</Text>
          </Pressable>
        </View>
      </View>

      <View style={styles.divider} />

      {/* Parte bassa: solo la camera, senza niente sopra. */}
      <CameraView
        ref={cameraRef}
        style={{ flex: 1 }}
        mode="video"
        facing={facing}
        videoQuality="1080p"
        mute={false}
      />
    </View>
  );
}

function ControlStepper({ icon, label, value, onMinus, onPlus }: {
  icon: React.ReactNode; label: string; value?: number;
  onMinus: () => void; onPlus: () => void;
}) {
  return (
    <View style={styles.stepper}>
      {icon}
      {value !== undefined && <Text style={styles.stepperVal}>{label} {value}</Text>}
      {value === undefined && <Text style={styles.stepperVal}>{label}</Text>}
      <Pressable hitSlop={8} onPress={onMinus}><Minus size={15} color="#fff" /></Pressable>
      <Pressable hitSlop={8} onPress={onPlus}><Plus size={15} color="#fff" /></Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: '#000' },
  center: { flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' },
  permTitle: { color: colors.text, fontSize: 20, fontWeight: '800' },
  permText: { color: colors.textDim, textAlign: 'center', marginTop: 8, lineHeight: 20 },
  permBtn: { marginTop: 22, backgroundColor: colors.accent, paddingHorizontal: 26, height: 50, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  top: { backgroundColor: colors.bg, paddingTop: 54 },
  prompterZone: { flex: 1 },
  promptText: { color: '#fff', textAlign: 'center', paddingHorizontal: 24, fontWeight: '600' },
  topBar: { paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  hint: { color: colors.textDim, fontSize: 12.5, flexShrink: 1, textAlign: 'center' },
  circleBtn: {
    width: 42, height: 42, borderRadius: 21, backgroundColor: colors.surface,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border,
  },
  recTimer: {
    flexDirection: 'row', alignItems: 'center', gap: 7, backgroundColor: colors.surface,
    paddingHorizontal: 14, height: 32, borderRadius: 16,
  },
  recDot: { width: 9, height: 9, borderRadius: 5, backgroundColor: colors.accent },
  recTimerText: { color: '#fff', fontWeight: '700', fontVariant: ['tabular-nums'] },
  controls: {
    flexDirection: 'row', gap: 8, justifyContent: 'center', alignItems: 'center',
    paddingHorizontal: 12, paddingVertical: 10,
  },
  divider: { height: 3, backgroundColor: colors.accent },
  stepper: {
    flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.surface,
    paddingHorizontal: 9, height: 38, borderRadius: 19, borderWidth: 1, borderColor: colors.border,
  },
  stepperVal: { color: '#fff', fontSize: 12.5, fontWeight: '600' },
  pauseBtn: {
    width: 38, height: 38, borderRadius: 19, backgroundColor: colors.surface,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.accent,
  },
  pauseText: { color: '#fff', fontSize: 12 },
  recBtn: {
    width: 64, height: 64, borderRadius: 32, borderWidth: 4, borderColor: 'rgba(255,255,255,0.85)',
    alignItems: 'center', justifyContent: 'center',
    shadowColor: colors.accent, shadowOpacity: 0.7, shadowRadius: 18, shadowOffset: { width: 0, height: 0 },
  },
  recInner: { width: 46, height: 46, borderRadius: 23, backgroundColor: colors.accent },
  stopSquare: { width: 24, height: 24, borderRadius: 6, backgroundColor: colors.accent },
  countdown: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' },
  countdownNum: { color: '#fff', fontSize: 96, fontWeight: '900' },
});
