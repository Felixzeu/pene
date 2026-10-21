import React, { useEffect, useRef, useState } from 'react';
import { Image, LayoutChangeEvent, PanResponder, StyleSheet, Text, View } from 'react-native';
import { VideoView, type VideoPlayer } from 'expo-video';
import { colors } from '../theme';
import type { EditSpec, MediaItem, OverlayItem, StickerKind, Word } from '../types';
import { layoutStickers, overlayBox } from '../lib/stickerLayout';

// Anteprima live del montaggio: il video tagliato (senza nulla incollato) con sopra
// testi, sottotitoli, sticker e immagini disegnati dall'app nei tempi giusti.
// Così si vede subito ogni modifica senza aspettare l'export: è un'approssimazione
// fedele del video finale (stesse posizioni, scalate da 1080×1920).

const STICKER: Record<StickerKind, { label: string; bg: string }> = {
  follow: { label: '+ SEGUI', bg: '#FE2255' },
  like: { label: '♥ MI PIACE', bg: '#FE2255' },
  subscribe: { label: 'ISCRIVITI', bg: '#FF0000' },
  comment: { label: 'COMMENTA', bg: '#A15CFF' },
  share: { label: 'CONDIVIDI', bg: '#A15CFF' },
  link: { label: 'LINK IN BIO', bg: '#FF5CC8' },
};
const TEXT_SIZE = { small: 56, medium: 72, large: 96 } as const;
// Come SAFE / SUB_SIZE / SUB_POS in backend/src/lib/render.ts: spazio lasciato all'interfaccia di TikTok e Instagram.
export const SAFE = { left: 90, right: 180, top: 260, bottom: 560 } as const;
const SUB_SIZE = { small: 58, medium: 74, large: 92 } as const;

/** Come overlaySource nel backend: usa la foto scontornata? e proporzioni (null = copre tutto lo schermo). */
export function overlayLook(o: OverlayItem, m?: MediaItem): { cut: boolean; aspect: number | null } {
  const cut = m?.kind === 'image' && o.cutout !== false && !!m.cutout;
  if (o.mode === 'full' && !cut) return { cut, aspect: null };
  return { cut, aspect: (cut ? m?.cutoutAspect : m?.aspect) ?? 1 };
}

/**
 * Foto da spostare: un dito la trascina, due dita la allargano o la stringono.
 * Il gesto si può fare su tutta l'anteprima, non solo sulla foto (più comodo se è piccola).
 */
function DragBox({ box, s, onMove, onDrag, children }: {
  box: { left: number; top: number; w: number; h: number };
  s: number;
  onMove: (x: number, y: number, w: number) => void;
  onDrag?: (dragging: boolean) => void;
  children: React.ReactNode;
}) {
  const [g, setG] = useState({ x: 0, y: 0, k: 1 });
  const ref = useRef({ box, s, onMove, onDrag, pinch0: 0, k: 1 });
  Object.assign(ref.current, { box, s, onMove, onDrag });
  const dist = (t: readonly { pageX: number; pageY: number }[]) =>
    Math.hypot(t[0].pageX - t[1].pageX, t[0].pageY - t[1].pageY);
  const pan = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: () => { ref.current.pinch0 = 0; ref.current.k = 1; ref.current.onDrag?.(true); },
    onPanResponderMove: (e, st) => {
      const t = e.nativeEvent.touches;
      if (t.length >= 2) {
        const d = dist(t);
        if (!ref.current.pinch0) ref.current.pinch0 = d / ref.current.k;
        ref.current.k = Math.max(0.3, Math.min(4, d / ref.current.pinch0));
      }
      setG({ x: st.dx, y: st.dy, k: ref.current.k });
    },
    onPanResponderRelease: (_e, st) => {
      const { box: b, s: k } = ref.current;
      const w = Math.round(Math.max(160, Math.min(1080, b.w * ref.current.k)));
      const cx = Math.round(Math.max(0, Math.min(1080, b.left + b.w / 2 + st.dx / k)));
      const cy = Math.round(Math.max(0, Math.min(1920, b.top + b.h / 2 + st.dy / k)));
      setG({ x: 0, y: 0, k: 1 });
      ref.current.onMove(cx, cy, w);
      ref.current.onDrag?.(false);
    },
    onPanResponderTerminate: () => { setG({ x: 0, y: 0, k: 1 }); ref.current.onDrag?.(false); },
  })).current;
  const bw = box.w * s * g.k;
  const bh = box.h * s * g.k;
  const cx = (box.left + box.w / 2) * s + g.x;
  const cy = (box.top + box.h / 2) * s + g.y;
  return (
    <View {...pan.panHandlers} style={StyleSheet.absoluteFill}>
      <View pointerEvents="none" style={[styles.dragBox, { left: cx - bw / 2, top: cy - bh / 2, width: bw, height: bh }]}>
        {children}
      </View>
    </View>
  );
}

/** Gruppi di max 4 parole come nel video finale. */
function pageAt(words: Word[], t: number): { words: Word[]; current: Word } | null {
  const pages: Word[][] = [];
  for (const w of words) {
    const page = pages[pages.length - 1];
    const prev = page?.[page.length - 1];
    if (!page || page.length >= 4 || (prev && (w.start - prev.end > 0.6 || /[.!?…]$/.test(prev.word)))) pages.push([w]);
    else page.push(w);
  }
  for (const page of pages) {
    for (let i = 0; i < page.length; i++) {
      const end = i < page.length - 1 ? page[i + 1].start : page[i].end + 0.15;
      if (t >= page[i].start && t < end) return { words: page, current: page[i] };
    }
  }
  return null;
}

export default function LivePreview({ player, spec, words, media, duration, mediaUri, selectedId, onMoveOverlay, onDrag }: {
  player: VideoPlayer;
  spec: EditSpec;
  words: Word[];
  media: MediaItem[];
  duration: number;
  mediaUri: (id: string, cutout: boolean) => { uri: string; headers?: Record<string, string> };
  /** Foto da spostare: resta visibile e si trascina col dito. */
  selectedId?: string | null;
  onMoveOverlay?: (id: string, x: number, y: number, w: number) => void;
  onDrag?: (dragging: boolean) => void;
}) {
  const [w, setW] = useState(0);
  const [t, setT] = useState(0); // tempo sul video FINALE (dopo il taglio iniziale)
  const end = Math.max(spec.trimStart + 0.5, duration - spec.trimEnd);

  // Segue il video e rispetta il taglio: riparte da trimStart quando arriva alla fine tagliata.
  useEffect(() => {
    const id = setInterval(() => {
      const cur = player.currentTime ?? 0;
      if (cur < spec.trimStart - 0.05 || cur > end) {
        player.currentTime = spec.trimStart;
        setT(0);
      } else {
        setT(cur - spec.trimStart);
      }
    }, 80);
    return () => clearInterval(id);
  }, [player, spec.trimStart, end]);

  const s = w / 1080; // scala da 1080 px
  const shifted = words.map((x) => ({ ...x, start: x.start - spec.trimStart, end: x.end - spec.trimStart }));
  const sub = spec.subtitles ? pageAt(shifted, t) : null;
  const aspectOf = (o: OverlayItem) => overlayLook(o, media.find((x) => x.id === o.mediaId)).aspect;
  const stickerY = layoutStickers({ ...spec, stickers: spec.stickers ?? [] }, (o) => aspectOf(o as OverlayItem));
  const on = (a: { start: number; end: number }) => t >= a.start && t < Math.max(a.end, a.start + 0.2);
  const selected = spec.overlays.find((o) => o.id === selectedId);

  return (
    <View style={styles.wrap} onLayout={(e: LayoutChangeEvent) => setW(e.nativeEvent.layout.width)}>
      <VideoView player={player} style={StyleSheet.absoluteFill} contentFit="contain" nativeControls={false} />
      {w > 0 && (
        <View style={StyleSheet.absoluteFill} pointerEvents="none">
          {spec.overlays.filter((o) => on(o) && o.id !== selectedId).map((o) => {
            const m = media.find((x) => x.id === o.mediaId);
            const look = overlayLook(o, m);
            const b = look.aspect == null ? null : overlayBox(o, look.aspect);
            const pos = b
              ? { position: 'absolute' as const, left: b.left * s, top: b.top * s, width: b.w * s, height: b.h * s }
              : { position: 'absolute' as const, top: 0, left: 0, right: 0, bottom: 0 };
            return m?.kind === 'image' ? (
              <Image
                key={o.id}
                source={mediaUri(m.id, look.cut)}
                style={[pos, b && !look.cut && { borderRadius: 12 * s }]}
                resizeMode={b ? 'contain' : 'cover'}
              />
            ) : (
              <View key={o.id} style={[pos, styles.videoBox]}><Text style={styles.videoText}>VIDEO</Text></View>
            );
          })}
        </View>
      )}
      {w > 0 && (
        <View style={StyleSheet.absoluteFill} pointerEvents="none">
          {sub && (() => {
            const ss = spec.subStyle ?? { size: 'medium', position: 'low' };
            const fs = SUB_SIZE[ss.size];
            const place = ss.position === 'low' ? { bottom: SAFE.bottom * s }
              : ss.position === 'high' ? { top: 420 * s } : { top: 0, bottom: 0, justifyContent: 'center' as const };
            return (
            <View style={[styles.lineBox, { left: SAFE.left * s, right: SAFE.right * s }, place]}>
              <Text style={[styles.outline, { fontSize: fs * s, lineHeight: fs * 1.19 * s }]}>
                {sub.words.map((x, i) => (
                  <Text key={i} style={x === sub.current ? { color: '#FFD42B' } : undefined}>{x.word}{i < sub.words.length - 1 ? ' ' : ''}</Text>
                ))}
              </Text>
            </View>
            );
          })()}

          {spec.texts.filter(on).filter((x) => x.text.trim()).map((x) => (
            <View
              key={x.id}
              style={[
                styles.lineBox,
                { left: SAFE.left * s, right: SAFE.right * s },
                x.position === 'top' ? { top: 260 * s } : x.position === 'bottom' ? { bottom: SAFE.bottom * s } : { top: 0, bottom: 0, justifyContent: 'center' },
              ]}
            >
              <Text style={[styles.outline, { fontSize: TEXT_SIZE[x.size] * s, lineHeight: TEXT_SIZE[x.size] * 1.2 * s }]}>{x.text}</Text>
            </View>
          ))}

          {(spec.stickers ?? []).filter(on).map((x) => {
            const def = STICKER[x.kind];
            const label = (x.label || def.label).toUpperCase();
            const bw = Math.max(360, Math.min(900, 70 + label.length * 42)) * s;
            const bh = 130 * s;
            return (
              <View key={x.id} style={[styles.sticker, { width: bw, height: bh, borderRadius: bh / 2, backgroundColor: def.bg, left: (w - bw) / 2, top: (stickerY[x.id] ?? 960) * s - bh / 2 }]}>
                <Text style={{ color: '#fff', fontWeight: '900', fontSize: 62 * s }}>{label}</Text>
              </View>
            );
          })}
        </View>
      )}
      {w > 0 && selected && (() => {
        const m = media.find((x) => x.id === selected.mediaId);
        const look = overlayLook(selected, m);
        if (look.aspect == null) return null; // a schermo intero non si sposta
        const b = overlayBox(selected, look.aspect);
        return (
          <DragBox box={b} s={s} onDrag={onDrag} onMove={(x, y, bw) => onMoveOverlay?.(selected.id, x, y, bw)}>
            {m?.kind === 'image'
              ? <Image source={mediaUri(m.id, look.cut)} style={StyleSheet.absoluteFill} resizeMode="contain" />
              : <View style={[StyleSheet.absoluteFill, styles.videoBox]}><Text style={styles.videoText}>VIDEO</Text></View>}
          </DragBox>
        );
      })()}
      <View style={styles.badge}><Text style={styles.badgeText}>{selected ? 'TRASCINA · 2 DITA PER LA GRANDEZZA' : 'ANTEPRIMA'}</Text></View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderRadius: 22, overflow: 'hidden', backgroundColor: '#000',
    aspectRatio: 9 / 16, width: '68%', alignSelf: 'center', marginBottom: 16,
  },
  lineBox: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  outline: {
    color: '#fff', fontWeight: '900', textAlign: 'center',
    textShadowColor: 'rgba(16,16,20,0.95)', textShadowRadius: 6, textShadowOffset: { width: 0, height: 0 },
  },
  sticker: {
    position: 'absolute', alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOpacity: 0.5, shadowRadius: 4, shadowOffset: { width: 3, height: 3 },
  },
  dragBox: { position: 'absolute', borderWidth: 2, borderColor: colors.accent, borderStyle: 'dashed', borderRadius: 6 },
  videoBox: { backgroundColor: 'rgba(161,92,255,0.35)', alignItems: 'center', justifyContent: 'center' },
  videoText: { color: '#fff', fontWeight: '800', fontSize: 12 },
  badge: { position: 'absolute', top: 10, left: 10, backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  badgeText: { color: colors.accent, fontSize: 10, fontWeight: '800', letterSpacing: 1 },
});
