import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as KeepAwake from 'expo-keep-awake';
import * as Haptics from 'expo-haptics';
import {
  Camera as CameraFlip, FlipHorizontal2, Gauge, Minus, Plus, Square, Type as TypeIcon, X,
} from 'lucide-react-native';
import { colors } from '../theme';
import type { Project } from '../types';

// Registrazione con teleprompter sovrapposto: scroll automatico regolabile,
// dimensione testo, mirror per prompter a cristalli, countdown 3-2-1 e cambio camera.
export default function RecordScreen({ project, onClose, onDone }: {
  project: Project; onClose: () => void; onDone: (uri: string) => void;
}) {
  const [permission, requestPermission] = useCameraPermissions();
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
  KeepAwake.useKeepAwake();

  useEffect(() => {
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, []);

  useEffect(() => {
    if (!recording) { setElapsed(0); return; }
    const t = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(t);
  }, [recording]);

  // Scroll automatico del teleprompter: un passo ogni frame circa.
  useEffect(() => {
    if (!scrolling || countdown > 0) return;
    const id = setInterval(() => {
      scrollY.current += speed * 0.55;
      if (scrollY.current > maxScroll.current) scrollY.current = 0;
      scrollRef.current?.scrollTo({ y: scrollY.current, animated: false });
    }, 33);
    return () => clearInterval(id);
  }, [scrolling, speed, countdown]);

  if (!permission) return <View style={styles.center} />;
  if (!permission.granted) {
    return (
      <View style={[styles.center, { paddingHorizontal: 32 }]}>
        <Text style={styles.permTitle}>Serve la fotocamera</Text>
        <Text style={styles.permText}>
          Per registrare con il teleprompter, autorizza fotocamera e microfono.
        </Text>
        <Pressable style={styles.permBtn} onPress={requestPermission}>
          <Text style={{ color: '#fff', fontWeight: '700' }}>Concedi il permesso</Text>
        </Pressable>
        <Pressable onPress={onClose} style={{ marginTop: 18 }}>
          <Text style={{ color: colors.textDim }}>Torna indietro</Text>
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

  const startRecording = async () => {
    try {
      setRecording(true);
      await cameraRef.current?.recordAsync({ maxDuration: 300 });
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

  return (
    <View style={styles.fill}>
      <CameraView
        ref={cameraRef}
        style={StyleSheet.absoluteFill}
        mode="video"
        facing={facing}
        videoQuality="1080p"
      >
        <View style={styles.prompterZone} pointerEvents="box-none">
          <ScrollView
            ref={scrollRef}
            showsVerticalScrollIndicator={false}
            onScroll={(e) => { if (!recording) scrollY.current = e.nativeEvent.contentOffset.y; }}
            scrollEventThrottle={16}
            onContentSizeChange={(_, h) => { maxScroll.current = Math.max(1, h); }}
          >
            <View style={{ height: '55%' }} />
            <Text
              style={[
                styles.promptText,
                { fontSize, transform: mirror ? [{ scaleX: -1 }] : [] },
              ]}
            >
              {script}
            </Text>
            <View style={{ height: '70%' }} />
          </ScrollView>
        </View>
      </CameraView>

      {/* Barra superiore */}
      <View style={styles.topBar}>
        <Pressable style={styles.circleBtn} onPress={onClose}>
          <X size={20} color="#fff" />
        </Pressable>
        {recording && (
          <View style={styles.recTimer}>
            <View style={styles.recDot} />
            <Text style={styles.recTimerText}>
              {String(Math.floor(elapsed / 60)).padStart(2, '0')}:{String(elapsed % 60).padStart(2, '0')}
            </Text>
          </View>
        )}
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <Pressable style={[styles.circleBtn, mirror && { backgroundColor: colors.accent }]} onPress={() => setMirror((m) => !m)}>
            <FlipHorizontal2 size={20} color="#fff" />
          </Pressable>
          <Pressable
            style={styles.circleBtn}
            onPress={() => { setRecording(false); setFacing((f) => (f === 'front' ? 'back' : 'front')); }}
          >
            <CameraFlip size={20} color="#fff" />
          </Pressable>
        </View>
      </View>

      {/* Controlli teleprompter */}
      <View style={styles.controls}>
        <ControlStepper
          icon={<Gauge size={15} color={colors.textDim} />}
          label="Vel."
          value={speed}
          onMinus={() => setSpeed((s) => Math.max(1, s - 1))}
          onPlus={() => setSpeed((s) => Math.min(5, s + 1))}
        />
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

      {/* REC / STOP */}
      <View style={styles.bottomBar}>
        <Pressable
          onPress={recording ? stopRecording : startCountdown}
          style={({ pressed }) => [styles.recBtn, pressed && { transform: [{ scale: 0.93 }] }]}
        >
          {recording
            ? <View style={styles.stopSquare} />
            : <View style={styles.recInner} />}
        </Pressable>
      </View>

      {/* Countdown 3-2-1 */}
      {countdown > 0 && (
        <View style={styles.countdown}>
          <Text style={styles.countdownNum}>{countdown}</Text>
        </View>
      )}
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
  prompterZone: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, justifyContent: 'center' },
  promptText: {
    color: '#fff', textAlign: 'center', paddingHorizontal: 28,
    lineHeight: 46, fontWeight: '600', textShadowColor: 'rgba(0,0,0,0.9)',
    textShadowRadius: 8, textShadowOffset: { width: 0, height: 1 },
  },
  topBar: {
    position: 'absolute', top: 0, left: 0, right: 0, paddingTop: 54, paddingHorizontal: 18,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
  },
  circleBtn: {
    width: 42, height: 42, borderRadius: 21, backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)',
  },
  recTimer: {
    flexDirection: 'row', alignItems: 'center', gap: 7, backgroundColor: 'rgba(0,0,0,0.5)',
    paddingHorizontal: 14, height: 32, borderRadius: 16,
  },
  recDot: { width: 9, height: 9, borderRadius: 5, backgroundColor: colors.accent },
  recTimerText: { color: '#fff', fontWeight: '700', fontVariant: ['tabular-nums'] },
  controls: {
    position: 'absolute', left: 18, right: 18, bottom: 128,
    flexDirection: 'row', gap: 10, justifyContent: 'center',
  },
  stepper: {
    flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: 'rgba(0,0,0,0.5)',
    paddingHorizontal: 12, height: 38, borderRadius: 19, borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)',
  },
  stepperVal: { color: '#fff', fontSize: 12.5, fontWeight: '600' },
  pauseBtn: {
    width: 38, height: 38, borderRadius: 19, backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.accent,
  },
  pauseText: { color: '#fff', fontSize: 12 },
  bottomBar: { position: 'absolute', bottom: 44, left: 0, right: 0, alignItems: 'center' },
  recBtn: {
    width: 78, height: 78, borderRadius: 39, borderWidth: 4, borderColor: 'rgba(255,255,255,0.85)',
    alignItems: 'center', justifyContent: 'center',
    shadowColor: colors.accent, shadowOpacity: 0.7, shadowRadius: 18, shadowOffset: { width: 0, height: 0 },
  },
  recInner: { width: 58, height: 58, borderRadius: 29, backgroundColor: colors.accent },
  stopSquare: { width: 28, height: 28, borderRadius: 6, backgroundColor: colors.accent },
  countdown: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center' },
  countdownNum: { color: '#fff', fontSize: 110, fontWeight: '900' },
});
