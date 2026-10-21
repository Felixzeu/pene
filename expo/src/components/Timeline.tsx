import React, { useRef, useState } from 'react';
import { LayoutChangeEvent, PanResponder, StyleSheet, Text, View } from 'react-native';
import { colors } from '../theme';

// Timeline col dito, senza librerie: tutto con PanResponder.
// VideoTimeline: tutto il video, con le maniglie per tagliare inizio e fine e la testina per scorrere.
// RangeBar: quando compare un elemento (foto, testo) sul video finale; si sposta e si allunga col dito.

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

/** Timeline del video intero (secondi del video originale). */
export function VideoTimeline({ duration, trimStart, trimEnd, time, onSeek, onTrim, onDrag }: {
  duration: number;
  trimStart: number;
  trimEnd: number;
  time: number;
  onSeek: (t: number) => void;
  onTrim: (p: { trimStart?: number; trimEnd?: number }) => void;
  onDrag?: (d: boolean) => void;
}) {
  const [w, setW] = useState(0);
  const total = Math.max(0.1, duration);
  const px = (s: number) => (s / total) * w;
  const end = total - trimEnd;
  const base = useRef(0);

  const seek = useHDrag({
    onStart: (x) => { base.current = x; onSeek(clamp((x / w) * total, trimStart, end)); },
    onMove: (dx) => onSeek(clamp(((base.current + dx) / w) * total, trimStart, end)),
    onDrag,
  });
  const left = useHDrag({
    onStart: () => { base.current = trimStart; },
    onMove: (dx) => onTrim({ trimStart: r1(clamp(base.current + (dx / w) * total, 0, end - 1)) }),
    onDrag,
  });
  const right = useHDrag({
    onStart: () => { base.current = end; },
    onMove: (dx) => onTrim({ trimEnd: r1(total - clamp(base.current + (dx / w) * total, trimStart + 1, total)) }),
    onDrag,
  });

  return (
    <View>
      <View style={styles.track} onLayout={(e: LayoutChangeEvent) => setW(e.nativeEvent.layout.width)} {...seek}>
        {w > 0 && (
          <>
            <View pointerEvents="none" style={[styles.cut, { left: 0, width: px(trimStart) }]} />
            <View pointerEvents="none" style={[styles.cut, { right: 0, width: px(trimEnd) }]} />
            <View pointerEvents="none" style={[styles.kept, { left: px(trimStart), width: Math.max(0, px(end) - px(trimStart)) }]} />
            <View style={[styles.head, { left: px(clamp(time, 0, total)) - 1 }]} pointerEvents="none" />
            <View {...left} style={[styles.handle, { left: px(trimStart) - 14 }]}><View style={styles.grip} /></View>
            <View {...right} style={[styles.handle, { left: px(end) - 14 }]}><View style={styles.grip} /></View>
          </>
        )}
      </View>
      <View style={styles.labels}>
        <Text style={styles.label}>{trimStart > 0 ? `taglio ${r1(trimStart)}s` : fmt(0)}</Text>
        <Text style={[styles.label, { color: colors.text }]}>{fmt(Math.max(0, time - trimStart))} / {fmt(end - trimStart)}</Text>
        <Text style={styles.label}>{trimEnd > 0 ? `taglio ${r1(trimEnd)}s` : fmt(total)}</Text>
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
  track: { height: 46, borderRadius: 10, backgroundColor: colors.surfaceAlt, overflow: 'visible', justifyContent: 'center' },
  kept: { position: 'absolute', top: 0, bottom: 0, backgroundColor: colors.accentSoft, borderTopWidth: 2, borderBottomWidth: 2, borderColor: colors.accent },
  cut: { position: 'absolute', top: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.45)' },
  head: { position: 'absolute', top: -4, bottom: -4, width: 3, borderRadius: 2, backgroundColor: '#fff' },
  handle: { position: 'absolute', top: 0, bottom: 0, width: 28, alignItems: 'center', justifyContent: 'center' },
  grip: { width: 10, height: 34, borderRadius: 5, backgroundColor: colors.accent },
  labels: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 },
  label: { color: colors.textDim, fontSize: 11.5 },
  rangeTrack: { height: 34, borderRadius: 8, backgroundColor: colors.surfaceAlt },
  block: { position: 'absolute', top: 0, bottom: 0, borderRadius: 8, opacity: 0.9 },
  edgeL: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 18, alignItems: 'center', justifyContent: 'center' },
  edgeR: { position: 'absolute', right: 0, top: 0, bottom: 0, width: 18, alignItems: 'center', justifyContent: 'center' },
  edgeGrip: { width: 4, height: 16, borderRadius: 2, backgroundColor: 'rgba(11,7,22,0.6)' },
});
