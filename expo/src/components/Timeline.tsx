import React, { useRef, useState } from 'react';
import { LayoutChangeEvent, PanResponder, StyleSheet, Text, View } from 'react-native';
import { colors } from '../theme';

// Barre col dito, senza librerie: tutto con PanResponder.
// SeekBar: barra di avanzamento classica per scorrere il video.
// RangeBar: un intervallo (quando compare un elemento, o la parte di video da tenere); si sposta e si allunga col dito.

const clamp = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n));
const r1 = (n: number) => Math.round(n * 10) / 10;
export const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/** Gesto orizzontale: chiama onMove con lo spostamento in px dall'inizio del tocco. */
function useHDrag(cb: {
  onStart?: (x: number) => void;
  onMove: (dx: number) => void;
  onEnd?: () => void;
  onDrag?: (d: boolean) => void;
}) {
  const ref = useRef(cb);
  ref.current = cb;
  return useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: (e) => { ref.current.onDrag?.(true); ref.current.onStart?.(e.nativeEvent.locationX); },
    onPanResponderMove: (_e, g) => ref.current.onMove(g.dx),
    onPanResponderRelease: () => { ref.current.onEnd?.(); ref.current.onDrag?.(false); },
    onPanResponderTerminate: () => { ref.current.onEnd?.(); ref.current.onDrag?.(false); },
  })).current.panHandlers;
}

/** Barra di avanzamento classica: tempo sul video finale, si trascina il cursore per spostarsi. */
export function SeekBar({ duration, time, onSeek, onDrag }: {
  duration: number;
  time: number;
  onSeek: (t: number) => void;
  onDrag?: (d: boolean) => void;
}) {
  const [w, setW] = useState(0);
  const total = Math.max(0.1, duration);
  const base = useRef(0);
  const seek = useHDrag({
    onStart: (x) => { base.current = x; onSeek(clamp((x / Math.max(1, w)) * total, 0, total)); },
    onMove: (dx) => onSeek(clamp(((base.current + dx) / Math.max(1, w)) * total, 0, total)),
    onDrag,
  });
  const pos = w > 0 ? (clamp(time, 0, total) / total) * w : 0;
  return (
    <View>
      <View style={styles.seekHit} onLayout={(e: LayoutChangeEvent) => setW(e.nativeEvent.layout.width)} {...seek}>
        <View style={styles.seekTrack} pointerEvents="none">
          <View style={[styles.seekFill, { width: pos }]} />
        </View>
        {w > 0 && <View pointerEvents="none" style={[styles.thumb, { left: pos - 8 }]} />}
      </View>
      <View style={styles.labels}>
        <Text style={[styles.label, { color: colors.text }]}>{fmt(clamp(time, 0, total))}</Text>
        <Text style={styles.label}>{fmt(total)}</Text>
      </View>
    </View>
  );
}

/** Quando compare un elemento sul video finale (0..total): trascina il blocco o le sue estremità. */
export function RangeBar({ total, start, end, onChange, onDrag, color = colors.accent }: {
  total: number;
  start: number;
  end: number;
  onChange: (p: { start: number; end: number }) => void;
  onDrag?: (d: boolean) => void;
  color?: string;
}) {
  const [w, setW] = useState(0);
  const T = Math.max(0.5, total);
  const px = (s: number) => (clamp(s, 0, T) / T) * w;
  const base = useRef({ start, end });
  const sec = (dx: number) => (dx / Math.max(1, w)) * T;

  const body = useHDrag({
    onStart: () => { base.current = { start, end }; },
    onMove: (dx) => {
      const len = base.current.end - base.current.start;
      const s = r1(clamp(base.current.start + sec(dx), 0, T - len));
      onChange({ start: s, end: r1(s + len) });
    },
    onDrag,
  });
  const a = useHDrag({
    onStart: () => { base.current = { start, end }; },
    onMove: (dx) => onChange({ start: r1(clamp(base.current.start + sec(dx), 0, base.current.end - 0.5)), end: base.current.end }),
    onDrag,
  });
  const b = useHDrag({
    onStart: () => { base.current = { start, end }; },
    onMove: (dx) => onChange({ start: base.current.start, end: r1(clamp(base.current.end + sec(dx), base.current.start + 0.5, T)) }),
    onDrag,
  });

  return (
    <View style={{ marginBottom: 10 }}>
      <View style={styles.rangeTrack} onLayout={(e: LayoutChangeEvent) => setW(e.nativeEvent.layout.width)}>
        {w > 0 && (
          <View {...body} style={[styles.block, { left: px(start), width: Math.max(28, px(end) - px(start)), backgroundColor: color }]}>
            <View {...a} style={styles.edgeL}><View style={styles.edgeGrip} /></View>
            <View {...b} style={styles.edgeR}><View style={styles.edgeGrip} /></View>
          </View>
        )}
      </View>
      <View style={styles.labels}>
        <Text style={styles.label}>0:00</Text>
        <Text style={[styles.label, { color: colors.text }]}>{r1(start)}s → {r1(end)}s</Text>
        <Text style={styles.label}>{fmt(T)}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  seekHit: { height: 28, justifyContent: 'center' },
  seekTrack: { height: 4, borderRadius: 2, backgroundColor: colors.surfaceAlt, overflow: 'hidden' },
  seekFill: { height: '100%', backgroundColor: colors.accent },
  thumb: { position: 'absolute', width: 16, height: 16, borderRadius: 8, backgroundColor: colors.accent, borderWidth: 2, borderColor: '#fff' },
  labels: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 },
  label: { color: colors.textDim, fontSize: 11.5 },
  rangeTrack: { height: 34, borderRadius: 8, backgroundColor: colors.surfaceAlt },
  block: { position: 'absolute', top: 0, bottom: 0, borderRadius: 8, opacity: 0.9 },
  edgeL: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 18, alignItems: 'center', justifyContent: 'center' },
  edgeR: { position: 'absolute', right: 0, top: 0, bottom: 0, width: 18, alignItems: 'center', justifyContent: 'center' },
  edgeGrip: { width: 4, height: 16, borderRadius: 2, backgroundColor: 'rgba(11,7,22,0.6)' },
});
