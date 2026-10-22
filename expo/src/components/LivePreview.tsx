import React, { useEffect, useRef, useState } from 'react';
import { Image, LayoutChangeEvent, PanResponder, StyleSheet, Text, View } from 'react-native';
import { VideoView, type VideoPlayer } from 'expo-video';
import * as Haptics from 'expo-haptics';
import { colors } from '../theme';
import type { EditSpec, MediaItem, OverlayItem, StickerKind, TextItem, Word } from '../types';
import { layoutStickers, overlayBox } from '../lib/stickerLayout';
import { outlineOf, subHighlight } from '../lib/textColors';

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
// Come SAFE / SUB_SIZE in backend/src/lib/render.ts: spazio lasciato all'interfaccia di TikTok e Instagram.
export const SAFE = { left: 90, right: 180, top: 260, bottom: 560 } as const;
const SUB_SIZE = { small: 58, medium: 74, large: 92 } as const;

/** Come overlaySource nel backend: usa la foto scontornata? e proporzioni (null = copre tutto lo schermo). */
export function overlayLook(o: OverlayItem, m?: MediaItem): { cut: boolean; aspect: number | null } {
  const cut = m?.kind === 'image' && o.cutout !== false && !!m.cutout;
  if (o.mode === 'full' && !cut) return { cut, aspect: null };
  return { cut, aspect: (cut ? m?.cutoutAspect : m?.aspect) ?? 1 };
}

// Centro dello schermo (px su 1080×1920) e distanza in px sul telefono entro cui l'elemento "si aggancia".
const MID_X = 540;
const MID_Y = 960;
const SNAP_PX = 7;
/** Larghezza in cui vanno a capo i testi: come i margini SAFE nel video finale. */
const TEXT_W = 1080 - 90 - 180;

type Box = { cx: number; cy: number; w: number; h: number }; // centro e misure in px su 1080×1920

/**
 * Elemento da spostare (foto o testo): un dito lo trascina, due dita lo allargano (se `pinch`).
 * Il gesto si può fare su tutta l'anteprima, non solo sull'elemento (più comodo se è piccolo).
 * Vicino al centro dello schermo si aggancia e compaiono le linee guida, come negli editor grafici.
 */
function DragBox({ box, s, pinch, inside, onMove, onDrag, render }: {
  box: Box;
  s: number;
  pinch?: boolean;
  /** Tiene tutto l'elemento dentro lo schermo (per i testi, che non devono essere tagliati). */
  inside?: boolean;
  onMove: (x: number, y: number, w: number) => void;
  onDrag?: (dragging: boolean) => void;
  render: (cx: number, cy: number, k: number) => React.ReactNode;
}) {
  const [g, setG] = useState({ cx: box.cx, cy: box.cy, k: 1, sx: false, sy: false, on: false });
  const ref = useRef({ box, s, pinch, inside, onMove, onDrag, pinch0: 0, k: 1, sx: false, sy: false });
  Object.assign(ref.current, { box, s, pinch, inside, onMove, onDrag });
  const dist = (t: readonly { pageX: number; pageY: number }[]) =>
    Math.hypot(t[0].pageX - t[1].pageX, t[0].pageY - t[1].pageY);

  // Posizione dopo uno spostamento di (dx, dy) px sul telefono: limiti e aggancio al centro.
  const resolve = (dx: number, dy: number, k: number) => {
    const { box: b, s: sc, inside: keep } = ref.current;
    const w = ref.current.pinch ? Math.max(160, Math.min(1080, b.w * k)) : b.w;
    const h = b.h * (w / b.w);
    let cx = b.cx + dx / sc;
    let cy = b.cy + dy / sc;
    if (keep) {
      cx = Math.max(Math.min(w / 2, MID_X), Math.min(1080 - Math.min(w / 2, MID_X), cx));
      cy = Math.max(Math.min(h / 2, MID_Y), Math.min(1920 - Math.min(h / 2, MID_Y), cy));
    } else {
      cx = Math.max(0, Math.min(1080, cx));
      cy = Math.max(0, Math.min(1920, cy));
    }
    const snap = SNAP_PX / sc;
    const sx = Math.abs(cx - MID_X) < snap;
    const sy = Math.abs(cy - MID_Y) < snap;
    if (sx) cx = MID_X;
    if (sy) cy = MID_Y;
    return { cx, cy, w, sx, sy };
  };

  const pan = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: () => {
      Object.assign(ref.current, { pinch0: 0, k: 1, sx: false, sy: false });
      ref.current.onDrag?.(true);
    },
    onPanResponderMove: (e, st) => {
      const t = e.nativeEvent.touches;
      if (ref.current.pinch && t.length >= 2) {
        const d = dist(t);
        if (!ref.current.pinch0) ref.current.pinch0 = d / ref.current.k;
        ref.current.k = Math.max(0.3, Math.min(4, d / ref.current.pinch0));
      }
      const p = resolve(st.dx, st.dy, ref.current.k);
      // Piccola vibrazione quando si aggancia al centro.
      if ((p.sx && !ref.current.sx) || (p.sy && !ref.current.sy)) Haptics.selectionAsync().catch(() => {});
      ref.current.sx = p.sx;
      ref.current.sy = p.sy;
      setG({ cx: p.cx, cy: p.cy, k: ref.current.k, sx: p.sx, sy: p.sy, on: true });
    },
    onPanResponderRelease: (_e, st) => {
      const p = resolve(st.dx, st.dy, ref.current.k);
      setG((x) => ({ ...x, on: false, sx: false, sy: false }));
      ref.current.onMove(Math.round(p.cx), Math.round(p.cy), Math.round(p.w));
      ref.current.onDrag?.(false);
    },
    onPanResponderTerminate: () => { setG((x) => ({ ...x, on: false, sx: false, sy: false })); ref.current.onDrag?.(false); },
  })).current;

  // Fermo: segue la posizione salvata; durante il gesto quella del dito.
  const cx = (g.on ? g.cx : box.cx) * s;
  const cy = (g.on ? g.cy : box.cy) * s;
  return (
    <View {...pan.panHandlers} style={StyleSheet.absoluteFill}>
      {g.on && g.sx && <View pointerEvents="none" style={[styles.guideV, { left: MID_X * s - 0.75 }]} />}
      {g.on && g.sy && <View pointerEvents="none" style={[styles.guideH, { top: MID_Y * s - 0.75 }]} />}
      {render(cx, cy, g.on ? g.k : 1)}
    </View>
  );
}

/** Dove sta il centro di un testo: quello scelto a mano o quello della posizione Alto/Centro/Basso. */
function textCenter(x: TextItem, h: number): { cx: number; cy: number } {
  if (x.x != null && x.y != null) return { cx: x.x, cy: x.y };
  const cx = 90 + TEXT_W / 2;
  if (x.position === 'top') return { cx, cy: 260 + h / 2 };
  if (x.position === 'bottom') return { cx, cy: 1920 - SAFE.bottom - h / 2 };
  return { cx, cy: MID_Y };
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

export default function LivePreview({ player, spec, words, media, duration, mediaUri, selectedId, onMoveOverlay, selectedTextId, onMoveText, onDrag }: {
  player: VideoPlayer;
  spec: EditSpec;
  words: Word[];
  media: MediaItem[];
  duration: number;
  mediaUri: (id: string, cutout: boolean) => { uri: string; headers?: Record<string, string> };
  /** Foto da spostare: resta visibile e si trascina col dito. */
  selectedId?: string | null;
  onMoveOverlay?: (id: string, x: number, y: number, w: number) => void;
  /** Testo da spostare: resta visibile e si trascina col dito. */
  selectedTextId?: string | null;
  onMoveText?: (id: string, x: number, y: number) => void;
  onDrag?: (dragging: boolean) => void;
}) {
  const [w, setW] = useState(0);
  // Misure del testo che si sta spostando (px su 1080×1920), per tenerlo dentro lo schermo.
  const [textSize, setTextSize] = useState<{ w: number; h: number } | null>(null);
  useEffect(() => setTextSize(null), [selectedTextId]);
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
  const selectedText = spec.texts.find((x) => x.id === selectedTextId);
  const textStyle = (x: TextItem) => [
    styles.outline,
    { fontSize: TEXT_SIZE[x.size] * s, lineHeight: TEXT_SIZE[x.size] * 1.2 * s },
    x.color ? { color: x.color, textShadowColor: outlineOf(x.color) } : null,
  ];

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
            const ss = spec.subStyle ?? { size: 'medium' };
            const fs = SUB_SIZE[ss.size];
            const place = { bottom: SAFE.bottom * s };
            return (
            <View style={[styles.lineBox, { left: SAFE.left * s, right: SAFE.right * s }, place]}>
              <Text style={[styles.outline, { fontSize: fs * s, lineHeight: fs * 1.19 * s }, ss.color ? { color: ss.color, textShadowColor: outlineOf(ss.color) } : null]}>
                {sub.words.map((x, i) => (
                  <Text key={i} style={x === sub.current ? { color: subHighlight(ss.color) } : undefined}>{x.word}{i < sub.words.length - 1 ? ' ' : ''}</Text>
                ))}
              </Text>
            </View>
            );
          })()}

          {spec.texts.filter(on).filter((x) => x.text.trim() && x.id !== selectedTextId).map((x) => (
            <View
              key={x.id}
              style={[
                styles.lineBox,
                x.x != null && x.y != null
                  // Spostato a mano: centrato nel punto scelto (riquadro alto, testo al centro).
                  ? { left: (x.x - TEXT_W / 2) * s, width: TEXT_W * s, top: x.y * s - w, height: 2 * w, justifyContent: 'center' }
                  : [{ left: SAFE.left * s, right: SAFE.right * s },
                    x.position === 'top' ? { top: 260 * s } : x.position === 'bottom' ? { bottom: SAFE.bottom * s } : { top: 0, bottom: 0, justifyContent: 'center' }],
              ]}
            >
              <Text style={textStyle(x)}>{x.text}</Text>
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
          <DragBox
            key={selected.id}
            box={{ cx: b.left + b.w / 2, cy: b.top + b.h / 2, w: b.w, h: b.h }}
            s={s}
            pinch
            onDrag={onDrag}
            onMove={(x, y, bw) => onMoveOverlay?.(selected.id, x, y, bw)}
            render={(cx, cy, k) => {
              const bw = b.w * s * k;
              const bh = b.h * s * k;
              return (
                <View pointerEvents="none" style={[styles.dragBox, { left: cx - bw / 2, top: cy - bh / 2, width: bw, height: bh }]}>
                  {m?.kind === 'image'
                    ? <Image source={mediaUri(m.id, look.cut)} style={StyleSheet.absoluteFill} resizeMode="contain" />
                    : <View style={[StyleSheet.absoluteFill, styles.videoBox]}><Text style={styles.videoText}>VIDEO</Text></View>}
                </View>
              );
            }}
          />
        );
      })()}
      {w > 0 && selectedText && (() => {
        const size = textSize ?? { w: TEXT_W, h: TEXT_SIZE[selectedText.size] * 1.2 };
        const c = textCenter(selectedText, size.h);
        return (
          <DragBox
            key={selectedText.id}
            box={{ cx: c.cx, cy: c.cy, w: size.w, h: size.h }}
            s={s}
            inside
            onDrag={onDrag}
            onMove={(x, y) => onMoveText?.(selectedText.id, x, y)}
            render={(cx, cy) => (
              <View pointerEvents="none" style={[styles.lineBox, { left: cx - (TEXT_W / 2) * s, width: TEXT_W * s, top: cy - (size.h * s) / 2 }]}>
                <View
                  style={styles.textBox}
                  onLayout={(e) => {
                    const l = e.nativeEvent.layout;
                    const next = { w: l.width / s, h: l.height / s };
                    if (!textSize || Math.abs(next.w - textSize.w) > 2 || Math.abs(next.h - textSize.h) > 2) setTextSize(next);
                  }}
                >
                  <Text style={textStyle(selectedText)}>{selectedText.text || 'Testo'}</Text>
                </View>
              </View>
            )}
          />
        );
      })()}
      <View style={styles.badge} pointerEvents="none">
        <Text style={styles.badgeText}>{selected ? 'TRASCINA · 2 DITA PER LA GRANDEZZA' : selectedText ? 'TRASCINA IL TESTO' : 'ANTEPRIMA'}</Text>
      </View>
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
  textBox: { borderWidth: 1.5, borderColor: colors.accent, borderStyle: 'dashed', borderRadius: 6 },
  // Linee guida al centro dello schermo (compaiono solo quando l'elemento è agganciato).
  guideV: { position: 'absolute', top: 0, bottom: 0, width: 1.5, backgroundColor: '#3BE3FF' },
  guideH: { position: 'absolute', left: 0, right: 0, height: 1.5, backgroundColor: '#3BE3FF' },
  videoBox: { backgroundColor: 'rgba(255,45,45,0.3)', alignItems: 'center', justifyContent: 'center' },
  videoText: { color: '#fff', fontWeight: '800', fontSize: 12 },
  badge: { position: 'absolute', top: 10, left: 10, backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  badgeText: { color: colors.accent, fontSize: 10, fontWeight: '800', letterSpacing: 1 },
});
