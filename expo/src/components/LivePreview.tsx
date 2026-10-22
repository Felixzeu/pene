import React, { useEffect, useRef, useState } from 'react';
import { Animated, Image, LayoutChangeEvent, PanResponder, StyleSheet, Text, View } from 'react-native';
import { VideoView, type VideoPlayer } from 'expo-video';
import * as Haptics from 'expo-haptics';
import { colors } from '../theme';
import type { EditSpec, MediaItem, OverlayItem, StickerKind, TextItem, Word } from '../types';
import { SUB_X, SUB_Y, layoutStickers, overlayBox } from '../lib/stickerLayout';
import { outlineOf, subHighlight } from '../lib/textColors';

// Anteprima live del montaggio: il video tagliato (senza nulla incollato) con sopra
// testi, sottotitoli, sticker e immagini disegnati dall'app nei tempi giusti.
// È anche l'editor: si tocca un elemento per selezionarlo, lo si trascina, e con le
// maniglie agli angoli (o con due dita) lo si ingrandisce. Tutto in px su 1080×1920,
// come il video finale, scalato sulla larghezza dell'anteprima.

const STICKER: Record<StickerKind, { label: string; bg: string }> = {
  follow: { label: '+ SEGUI', bg: '#FE2255' },
  like: { label: '♥ MI PIACE', bg: '#FE2255' },
  subscribe: { label: 'ISCRIVITI', bg: '#FF0000' },
  comment: { label: 'COMMENTA', bg: '#A15CFF' },
  share: { label: 'CONDIVIDI', bg: '#A15CFF' },
  link: { label: 'LINK IN BIO', bg: '#FF5CC8' },
};
export const TEXT_SIZE = { small: 56, medium: 72, large: 96 } as const;
// Come SAFE / SUB_SIZE in backend/src/lib/render.ts: spazio lasciato all'interfaccia di TikTok e Instagram.
export const SAFE = { left: 90, right: 180, top: 260, bottom: 560 } as const;
export const SUB_SIZE = { small: 58, medium: 74, large: 92 } as const;
/** Larghezza in cui vanno a capo testi e sottotitoli: come i margini SAFE nel video finale. */
const WRAP_W = 1080 - SAFE.left - SAFE.right;
/** Spazio tra il testo e il bordo del suo riquadro (come Outline dello stile TextBox nel backend). */
export const BOX_PAD = 16;

// Centro dello schermo e distanza in px sul telefono entro cui l'elemento "si aggancia" a una guida.
const MID_X = 540;
const MID_Y = 960;
const SNAP_PX = 6;
const HANDLE_PX = 26; // raggio in cui un tocco prende una maniglia
const HANDLE_DOT = 10; // maniglia disegnata (il tocco la prende in un raggio più ampio)

/** Come overlaySource nel backend: usa la foto scontornata? e proporzioni (null = copre tutto lo schermo). */
export function overlayLook(o: OverlayItem, m?: MediaItem): { cut: boolean; aspect: number | null } {
  const cut = m?.kind === 'image' && o.cutout !== false && !!m.cutout;
  if (o.mode === 'full' && !cut) return { cut, aspect: null };
  return { cut, aspect: (cut ? m?.cutoutAspect : m?.aspect) ?? 1 };
}

/** Grandezza effettiva di un testo (px su 1080×1920). */
export const textFs = (x: TextItem) => x.fs ?? TEXT_SIZE[x.size];
/** Grandezza effettiva dei sottotitoli. */
export const subFs = (ss?: EditSpec['subStyle']) => ss?.fs ?? SUB_SIZE[ss?.size ?? 'medium'];

/** Centro di un testo: quello scelto nell'anteprima o quello della vecchia posizione Alto/Centro/Basso. */
export function textCenter(x: TextItem): { cx: number; cy: number } {
  if (x.x != null && x.y != null) return { cx: x.x, cy: x.y };
  const h = textFs(x) * 1.2 + (x.bg ? 2 * BOX_PAD : 0);
  const cx = SAFE.left + WRAP_W / 2;
  if (x.position === 'top') return { cx, cy: SAFE.top + h / 2 };
  if (x.position === 'bottom') return { cx, cy: 1920 - SAFE.bottom - h / 2 };
  return { cx, cy: MID_Y };
}

export type Selection = { kind: 'overlay' | 'text' | 'sub'; id: string } | null;
/** Risultato di uno spostamento: centro, e larghezza (foto) o grandezza del testo. */
export type Transform = { x: number; y: number; w?: number; fs?: number; tw?: number };

/** Gruppi di max 4 parole come nel video finale. */
function pages(words: Word[]): Word[][] {
  const out: Word[][] = [];
  for (const w of words) {
    const page = out[out.length - 1];
    const prev = page?.[page.length - 1];
    if (!page || page.length >= 4 || (prev && (w.start - prev.end > 0.6 || /[.!?…]$/.test(prev.word)))) out.push([w]);
    else page.push(w);
  }
  return out;
}
function pageAt(all: Word[][], t: number): { words: Word[]; current: Word | null } | null {
  for (const page of all) {
    for (let i = 0; i < page.length; i++) {
      const end = i < page.length - 1 ? page[i + 1].start : page[i].end + 0.15;
      if (t >= page[i].start && t < end) return { words: page, current: page[i] };
    }
  }
  return null;
}

// Elemento toccabile: centro e misure in px su 1080×1920.
type El = {
  sel: NonNullable<Selection>;
  cx: number; cy: number; w: number; h: number;
  inside: boolean;            // deve restare tutto dentro lo schermo (testi)
  kMin: number; kMax: number; // limiti di ingrandimento
  pad: number;                // riquadro attorno al testo (0 se non c'è): per la larghezza
};
/** Gesto in corso: posizione, ingrandimento, larghezza del testo e guide da mostrare. */
type Live = { key: string; cx: number; cy: number; k: number; tw?: number; gx: number | null; gy: number | null; grid?: boolean };

// Linee orizzontali fisse a cui ci si aggancia (px su 1920): margini sicuri, quarti, terzi e centro.
const GRID_Y = [SAFE.top, 480, 640, MID_Y, 1280, 1920 - SAFE.bottom, 1440];
const keyOf = (s: NonNullable<Selection>) => `${s.kind}:${s.id}`;

/** Guida a cui l'elemento è agganciato: la linea (target) e quale suo punto la tocca (offset dal centro). */
type Lock = { target: number; off: number } | null;
const RELEASE = 1.8; // si sgancia solo oltre 1.8 volte la distanza di aggancio: niente tremolii

/**
 * Aggancio su un asse. Punti dell'elemento: bordi e centro (offs); linee possibili: targets.
 * Se era già agganciato e resta vicino, tiene la stessa linea; altrimenti cerca la più vicina.
 */
function snapAxis(c: number, offs: number[], targets: number[], snap: number, prev: Lock): { c: number; lock: Lock } {
  if (prev && offs.some((o) => Math.abs(o - prev.off) < 0.5) && Math.abs(c + prev.off - prev.target) < snap * RELEASE) {
    return { c: prev.target - prev.off, lock: prev };
  }
  let best: Lock = null;
  let bestD = snap;
  for (const off of offs) {
    for (const t of targets) {
      const d = Math.abs(c + off - t);
      // A parità di distanza vince il centro (off 0), che viene prima in offs.
      if (d < bestD - 0.01) { bestD = d; best = { target: t, off }; }
    }
  }
  return best ? { c: best.target - best.off, lock: best } : { c, lock: null };
}

export default function LivePreview({
  player, spec, words, media, duration, mediaUri, selected, onSelect, onTransform, onDrag,
}: {
  player: VideoPlayer;
  spec: EditSpec;
  words: Word[];
  media: MediaItem[];
  duration: number;
  mediaUri: (id: string, cutout: boolean) => { uri: string; headers?: Record<string, string> };
  selected: Selection;
  onSelect: (s: Selection) => void;
  onTransform: (s: NonNullable<Selection>, t: Transform) => void;
  onDrag?: (dragging: boolean) => void;
}) {
  const [w, setW] = useState(0);
  const [t, setT] = useState(0); // tempo sul video FINALE (dopo il taglio iniziale)
  const end = Math.max(spec.trimStart + 0.5, duration - spec.trimEnd);
  // Misure reali di testi e sottotitoli (px su 1080×1920), prese dal layout.
  const sizes = useRef<Record<string, { w: number; h: number }>>({});
  const [, bump] = useState(0);
  // Posizione durante il gesto: resta finché la spec non riporta il valore nuovo (niente salti).
  const [live, setLive] = useState<Live | null>(null);
  useEffect(() => { setLive(null); }, [spec]);

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
  const allPages = pages(shifted);
  const isSel = (k: NonNullable<Selection>) => !!selected && selected.kind === k.kind && selected.id === k.id;
  // Sottotitoli: la pagina del momento; se non si parla ma sono selezionati (o il video è fermo), la più vicina.
  let sub = spec.subtitles ? pageAt(allPages, t) : null;
  if (spec.subtitles && !sub && allPages.length && (isSel({ kind: 'sub', id: 'sub' }) || !player.playing)) {
    const near = allPages.reduce((a, b) => (Math.abs(b[0].start - t) < Math.abs(a[0].start - t) ? b : a));
    sub = { words: near, current: null };
  }
  const on = (a: { start: number; end: number }) => t >= a.start && t < Math.max(a.end, a.start + 0.2);
  const ss = spec.subStyle ?? { size: 'medium' as const };

  // Tutti gli elementi toccabili in questo momento, dal più in basso al più in alto.
  const els: El[] = [];
  for (const o of spec.overlays) {
    const sel = { kind: 'overlay' as const, id: o.id };
    if (!on(o) && !isSel(sel)) continue;
    const m = media.find((x) => x.id === o.mediaId);
    const look = overlayLook(o, m);
    if (look.aspect == null) {
      // A schermo intero: si seleziona e si sposta anche lei (diventa una foto intera ridimensionabile).
      els.push({ sel, cx: 540, cy: 960, w: 1080, h: 1920, inside: false, kMin: 0.15, kMax: 1, pad: 0 });
    } else {
      const b = overlayBox(o, look.aspect);
      els.push({ sel, cx: b.left + b.w / 2, cy: b.top + b.h / 2, w: b.w, h: b.h, inside: false, kMin: 160 / b.w, kMax: 1080 / b.w, pad: 0 });
    }
  }
  if (sub) {
    const fs = subFs(ss);
    const m = sizes.current['sub:sub'] ?? { w: WRAP_W * 0.8, h: fs * 1.2 };
    els.push({ sel: { kind: 'sub', id: 'sub' }, cx: ss.x ?? SUB_X, cy: ss.y ?? SUB_Y, w: m.w, h: m.h, inside: true, kMin: 30 / fs, kMax: 170 / fs, pad: 0 });
  }
  for (const x of spec.texts) {
    const sel = { kind: 'text' as const, id: x.id };
    if (!x.text.trim() || (!on(x) && !isSel(sel))) continue;
    const fs = textFs(x);
    const pad = x.bg ? BOX_PAD : 0;
    const m = sizes.current[`text:${x.id}`]
      ?? { w: Math.min(x.tw ?? WRAP_W, x.text.length * fs * 0.55) + 2 * pad, h: fs * 1.2 + 2 * pad };
    const c = textCenter(x);
    els.push({ sel, cx: c.cx, cy: c.cy, w: m.w, h: m.h, inside: true, kMin: 28 / fs, kMax: 220 / fs, pad });
  }

  // Geometria mostrata: quella salvata, o quella del gesto in corso.
  const geo = (e: El) => {
    const l = live && live.key === keyOf(e.sel) ? live : null;
    return { cx: l ? l.cx : e.cx, cy: l ? l.cy : e.cy, k: l ? l.k : 1, tw: l?.tw };
  };

  const measure = (key: string, k: number) => (ev: LayoutChangeEvent) => {
    if (!s) return;
    const { width, height } = ev.nativeEvent.layout;
    const next = { w: width / s / k, h: height / s / k };
    const old = sizes.current[key];
    if (!old || Math.abs(old.w - next.w) > 1 || Math.abs(old.h - next.h) > 1) {
      sizes.current[key] = next;
      bump((n) => n + 1);
    }
  };

  // ---- Gesti: un solo livello trasparente sopra l'anteprima riceve tutti i tocchi. ----
  // locationX/Y sono relativi a questo livello (non ha figli), quindi non dipendono da
  // cosa c'è sotto il dito; durante il gesto si usano gli spostamenti dx/dy.
  const g = useRef({
    mode: 'none' as 'none' | 'move' | 'resize' | 'width',
    el: null as El | null,
    x0: 0, y0: 0, d0: 1, pinch0: 0, k: 1, tw0: 0, tw: 0, moved: false,
    tx: [] as number[], ty: [] as number[], // linee a cui agganciarsi
    lx: null as Lock, ly: null as Lock,
  });
  const ctx = useRef({ els, s, spec, selected, onSelect, onTransform, onDrag });
  ctx.current = { els, s, spec, selected, onSelect, onTransform, onDrag };

  const pan = useRef((() => {
    type Hit = { el: El; mode: 'move' | 'resize' | 'width'; side?: number };
    const hit = (x: number, y: number): Hit | null => {
      const { els: list, s: sc, selected: cur } = ctx.current;
      const curEl = cur ? list.find((e) => keyOf(e.sel) === keyOf(cur)) : undefined;
      if (curEl) {
        const l = (curEl.cx - curEl.w / 2) * sc, r = (curEl.cx + curEl.w / 2) * sc;
        const tp = (curEl.cy - curEl.h / 2) * sc, b = (curEl.cy + curEl.h / 2) * sc;
        for (const [hx, hy] of [[l, tp], [r, tp], [l, b], [r, b]]) {
          if (Math.hypot(x - hx, y - hy) <= HANDLE_PX) return { el: curEl, mode: 'resize' };
        }
        // Maniglie laterali dei testi: cambiano la larghezza (il testo va a capo), non la grandezza.
        if (curEl.sel.kind === 'text') {
          const my = curEl.cy * sc;
          for (const hx of [l, r]) {
            if (Math.abs(x - hx) <= HANDLE_PX * 0.8 && Math.abs(y - my) <= Math.max(HANDLE_PX, (b - tp) / 2)) return { el: curEl, mode: 'width' };
          }
        }
        if (x >= l && x <= r && y >= tp && y <= b) return { el: curEl, mode: 'move' };
      }
      for (let i = list.length - 1; i >= 0; i--) {
        const e = list[i];
        const pad = 8; // un po' di margine: i testi piccoli si prendono più facilmente
        if (x >= (e.cx - e.w / 2) * sc - pad && x <= (e.cx + e.w / 2) * sc + pad
          && y >= (e.cy - e.h / 2) * sc - pad && y <= (e.cy + e.h / 2) * sc + pad) return { el: e, mode: 'move' };
      }
      return null;
    };

    // Nuova posizione: limiti dello schermo e aggancio a centro, margini e altri elementi.
    const resolve = (e: El, dx: number, dy: number, k: number, snapOn: boolean) => {
      const st = g.current;
      const sc = ctx.current.s;
      const kk = Math.max(e.kMin, Math.min(e.kMax, k));
      const bw = e.w * kk;
      const bh = e.h * kk;
      let cx = e.cx + dx / sc;
      let cy = e.cy + dy / sc;
      let lx: Lock = null;
      let ly: Lock = null;
      if (snapOn) {
        const snap = SNAP_PX / sc;
        const rx = snapAxis(cx, [0, -bw / 2, bw / 2], st.tx, snap, st.lx);
        const ry = snapAxis(cy, [0, -bh / 2, bh / 2], st.ty, snap, st.ly);
        cx = rx.c; lx = rx.lock;
        cy = ry.c; ly = ry.lock;
      }
      if (e.inside) {
        cx = bw >= 1080 ? MID_X : Math.max(bw / 2, Math.min(1080 - bw / 2, cx));
        cy = bh >= 1920 ? MID_Y : Math.max(bh / 2, Math.min(1920 - bh / 2, cy));
      } else {
        cx = Math.max(0, Math.min(1080, cx));
        cy = Math.max(0, Math.min(1920, cy));
      }
      // Se i limiti dello schermo l'hanno spostato, la guida non vale più.
      if (lx && Math.abs(cx + lx.off - lx.target) > 0.5) lx = null;
      if (ly && Math.abs(cy + ly.off - ly.target) > 0.5) ly = null;
      return { cx, cy, k: kk, lx, ly };
    };

    const dist = (a: { pageX: number; pageY: number }, b: { pageX: number; pageY: number }) =>
      Math.hypot(a.pageX - b.pageX, a.pageY - b.pageY);

    return PanResponder.create({
      // Prende il tocco solo se c'è qualcosa da selezionare o deselezionare: altrimenti la pagina scorre.
      onStartShouldSetPanResponder: (e) => !!hit(e.nativeEvent.locationX, e.nativeEvent.locationY) || !!ctx.current.selected,
      onMoveShouldSetPanResponder: () => false,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (e) => {
        const { locationX: x, locationY: y } = e.nativeEvent;
        const h = hit(x, y);
        const st = g.current;
        Object.assign(st, { mode: h ? h.mode : 'none', el: h?.el ?? null, x0: x, y0: y, pinch0: 0, k: 1, moved: false, lx: null, ly: null });
        if (!h) return;
        const sc = ctx.current.s;
        const el = h.el;
        st.d0 = Math.max(12, Math.hypot(x - el.cx * sc, y - el.cy * sc));
        // Larghezza di partenza: quella che il testo occupa ora (così la maniglia non fa salti).
        st.tw0 = st.tw = Math.max(120, el.w - 2 * el.pad + 4);
        st.d0 = h.mode === 'width' ? Math.max(6, Math.abs(x / sc - el.cx)) : st.d0;
        // Linee di aggancio: centro, bordi e margini sicuri dello schermo, e bordi/centri degli altri elementi.
        const others = ctx.current.els.filter((o) => keyOf(o.sel) !== keyOf(el.sel) && o.w < 1080);
        st.tx = [MID_X, 0, 1080, SAFE.left, 1080 - SAFE.right, ...others.flatMap((o) => [o.cx, o.cx - o.w / 2, o.cx + o.w / 2])];
        st.ty = [...GRID_Y, 0, 1920, ...others.flatMap((o) => [o.cy, o.cy - o.h / 2, o.cy + o.h / 2])];
        const cur = ctx.current.selected;
        if (!cur || keyOf(cur) !== keyOf(el.sel)) ctx.current.onSelect(el.sel);
        ctx.current.onDrag?.(true);
      },
      onPanResponderMove: (e, gs) => {
        const st = g.current;
        const el = st.el;
        if (!el) return;
        const sc = ctx.current.s;
        const touches = e.nativeEvent.touches;
        const two = touches.length >= 2;
        if (Math.hypot(gs.dx, gs.dy) > 4 || two) st.moved = true;
        if (!st.moved) return; // finché il dito non si muove è solo un tocco
        const key = keyOf(el.sel);
        if (st.mode === 'width' && !two) {
          // Maniglia laterale: il centro resta fermo, la larghezza segue il dito su entrambi i lati.
          const d = Math.abs((st.x0 + gs.dx) / sc - el.cx);
          const max = Math.max(120, 2 * Math.min(el.cx, 1080 - el.cx) - 2 * el.pad);
          st.tw = Math.max(120, Math.min(max, st.tw0 + 2 * (d - st.d0)));
          setLive({ key, cx: el.cx, cy: el.cy, k: 1, tw: st.tw, gx: null, gy: null });
          return;
        }
        let k = st.k;
        if (two) {
          // Due dita: ingrandisce o rimpicciolisce, qualunque sia il punto toccato.
          const d = dist(touches[0], touches[1]);
          if (!st.pinch0) st.pinch0 = d / st.k;
          k = d / st.pinch0;
        } else if (st.mode === 'resize') {
          // Maniglia d'angolo: la distanza dal centro dice quanto ingrandire (le proporzioni restano).
          k = Math.hypot(st.x0 + gs.dx - el.cx * sc, st.y0 + gs.dy - el.cy * sc) / st.d0;
        }
        st.k = k;
        // Con la maniglia d'angolo il centro resta fermo; le guide servono solo spostando.
        const moving = st.mode === 'move' || two;
        const p = resolve(el, moving ? gs.dx : 0, moving ? gs.dy : 0, k, moving);
        const newLock = (a: Lock, b: Lock) => !!a && (!b || a.target !== b.target || a.off !== b.off);
        if (newLock(p.lx, st.lx) || newLock(p.ly, st.ly)) Haptics.selectionAsync().catch(() => {});
        st.lx = p.lx;
        st.ly = p.ly;
        setLive({ key, cx: p.cx, cy: p.cy, k: p.k, gx: p.lx?.target ?? null, gy: p.ly?.target ?? null, grid: moving });
      },
      onPanResponderRelease: (_e, gs) => {
        const st = g.current;
        const el = st.el;
        st.el = null;
        if (!el) {
          // Tocco su un punto vuoto: deseleziona.
          if (Math.hypot(gs.dx, gs.dy) < 6) ctx.current.onSelect(null);
          return;
        }
        ctx.current.onDrag?.(false);
        if (!st.moved) { setLive(null); return; } // solo selezione
        // Le guide spariscono appena si stacca il dito; la posizione resta finché arriva la spec nuova.
        setLive((l) => (l ? { ...l, gx: null, gy: null, grid: false } : l));
        const sp = ctx.current.spec;
        const text = el.sel.kind === 'text' ? sp.texts.find((x) => x.id === el.sel.id) : undefined;
        if (st.mode === 'width' && st.pinch0 === 0) {
          ctx.current.onTransform(el.sel, { x: Math.round(el.cx), y: Math.round(el.cy), tw: Math.round(st.tw) });
          return;
        }
        const moving = st.mode === 'move' || st.pinch0 > 0;
        const p = resolve(el, moving ? gs.dx : 0, moving ? gs.dy : 0, st.k, moving);
        const out: Transform = { x: Math.round(p.cx), y: Math.round(p.cy) };
        if (el.sel.kind === 'overlay') out.w = Math.round(Math.max(160, Math.min(1080, el.w * p.k)));
        else {
          const base = el.sel.kind === 'sub' ? subFs(sp.subStyle) : textFs(text!);
          out.fs = Math.round(base * p.k);
          // Il testo si ingrandisce tutto insieme: anche la larghezza in cui va a capo.
          if (text && p.k !== 1) out.tw = Math.round(Math.max(120, Math.min(1080, (text.tw ?? WRAP_W) * p.k)));
        }
        ctx.current.onTransform(el.sel, out);
      },
      onPanResponderTerminate: () => { g.current.el = null; setLive(null); ctx.current.onDrag?.(false); },
    });
  })()).current;

  // Selezione: compare con una leggera dissolvenza.
  const selKey = selected ? keyOf(selected) : '';
  const selFade = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    selFade.setValue(0);
    if (selKey) Animated.timing(selFade, { toValue: 1, duration: 140, useNativeDriver: true }).start();
  }, [selKey, selFade]);

  const selEl = selected ? els.find((e) => keyOf(e.sel) === keyOf(selected)) : undefined;
  const stickerY = layoutStickers(
    { ...spec, stickers: spec.stickers ?? [] },
    (o) => overlayLook(o as OverlayItem, media.find((x) => x.id === (o as OverlayItem).mediaId)).aspect,
  );

  return (
    <View style={styles.wrap} onLayout={(e: LayoutChangeEvent) => setW(e.nativeEvent.layout.width)}>
      <VideoView player={player} style={StyleSheet.absoluteFill} contentFit="contain" nativeControls={false} />
      {w > 0 && (
        <View style={StyleSheet.absoluteFill} pointerEvents="none">
          {/* Foto e video sopra il video */}
          {els.filter((e) => e.sel.kind === 'overlay').map((e) => {
            const o = spec.overlays.find((x) => x.id === e.sel.id)!;
            const m = media.find((x) => x.id === o.mediaId);
            const look = overlayLook(o, m);
            const { cx, cy, k } = geo(e);
            const bw = e.w * k * s;
            const bh = e.h * k * s;
            const box = { position: 'absolute' as const, left: cx * s - bw / 2, top: cy * s - bh / 2, width: bw, height: bh };
            return m?.kind === 'image' ? (
              <Image
                key={o.id}
                source={mediaUri(m.id, look.cut)}
                style={[box, look.aspect != null && !look.cut && { borderRadius: 12 * s }]}
                resizeMode={look.aspect == null ? 'cover' : 'contain'}
              />
            ) : (
              <View key={o.id} style={[box, styles.videoBox]}><Text style={styles.videoText}>VIDEO</Text></View>
            );
          })}

          {/* Sottotitoli */}
          {sub && (() => {
            const e = els.find((x) => x.sel.kind === 'sub')!;
            const { cx, cy, k } = geo(e);
            const fs = subFs(ss) * k;
            const page = sub;
            return (
              <View style={[styles.anchor, { left: (cx - WRAP_W / 2) * s, width: WRAP_W * s, top: cy * s - w, height: 2 * w }]}>
                <Text
                  onLayout={measure('sub:sub', k)}
                  style={[
                    styles.outline,
                    { fontSize: fs * s, lineHeight: fs * 1.19 * s },
                    ss.color ? { color: ss.color, textShadowColor: outlineOf(ss.color) } : null,
                    !page.current && { opacity: 0.6 },
                  ]}
                >
                  {page.words.map((x, i) => (
                    <Text key={i} style={x === page.current ? { color: subHighlight(ss.color) } : undefined}>{x.word}{i < page.words.length - 1 ? ' ' : ''}</Text>
                  ))}
                </Text>
              </View>
            );
          })()}

          {/* Testi aggiuntivi */}
          {els.filter((e) => e.sel.kind === 'text').map((e) => {
            const x = spec.texts.find((y) => y.id === e.sel.id)!;
            const { cx, cy, k, tw } = geo(e);
            const fs = textFs(x) * k;
            // Larghezza in cui va a capo (come i margini dell'evento nel video finale) più il riquadro.
            const aw = (tw ?? (x.tw ?? WRAP_W) * k) + 2 * e.pad * k;
            return (
              <View key={x.id} style={[styles.anchor, { left: (cx - aw / 2) * s, width: aw * s, top: cy * s - w, height: 2 * w }]}>
                <View
                  onLayout={measure(`text:${x.id}`, k)}
                  style={x.bg ? { backgroundColor: x.bg, paddingHorizontal: BOX_PAD * k * s, paddingVertical: BOX_PAD * 0.6 * k * s, borderRadius: 4 * s } : null}
                >
                  <Text style={[
                    styles.outline,
                    { fontSize: fs * s, lineHeight: fs * 1.2 * s },
                    x.color ? { color: x.color } : null,
                    x.bg ? styles.noShadow : x.color ? { textShadowColor: outlineOf(x.color) } : null,
                  ]}>{x.text}</Text>
                </View>
              </View>
            );
          })}

          {/* Pulsanti social (li mette l'IA) */}
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

          {/* Linee guida: solo durante il trascinamento, quando l'elemento è agganciato */}
          {/* Mentre si sposta: le linee orizzontali disponibili, appena accennate */}
          {live?.grid && GRID_Y.map((y) => <View key={`g${y}`} style={[styles.gridH, { top: y * s - 0.5 }]} />)}
          {live?.gx != null && <View style={[styles.guideV, { left: live.gx * s - 0.5 }]} />}
          {live?.gy != null && <View style={[styles.guideH, { top: live.gy * s - 0.5 }]} />}

          {/* Selezione: contorno sottile e maniglie discrete (solo nell'anteprima, mai nel video) */}
          {selEl && (() => {
            const { cx, cy, k } = geo(selEl);
            const bw = selEl.w * k * s;
            const bh = selEl.h * k * s;
            const l = cx * s - bw / 2;
            const tp = cy * s - bh / 2;
            const sideH = Math.min(18, Math.max(10, bh * 0.4));
            return (
              <Animated.View style={[StyleSheet.absoluteFill, { opacity: selFade }]}>
                <View style={[styles.selShade, { left: l - 1, top: tp - 1, width: bw + 2, height: bh + 2 }]} />
                <View style={[styles.selBox, { left: l, top: tp, width: bw, height: bh }]} />
                {[[l, tp], [l + bw, tp], [l, tp + bh], [l + bw, tp + bh]].map(([hx, hy], i) => (
                  <View key={i} style={[styles.handle, { left: hx - HANDLE_DOT / 2, top: hy - HANDLE_DOT / 2 }]} />
                ))}
                {selEl.sel.kind === 'text' && [l, l + bw].map((hx, i) => (
                  <View key={`s${i}`} style={[styles.sideHandle, { left: hx - 2.5, top: cy * s - sideH / 2, height: sideH }]} />
                ))}
              </Animated.View>
            );
          })()}
        </View>
      )}
      {/* Livello dei gesti: vuoto, sopra a tutto */}
      <View style={StyleSheet.absoluteFill} {...pan.panHandlers} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderRadius: 22, overflow: 'hidden', backgroundColor: '#000',
    aspectRatio: 9 / 16, width: '68%', alignSelf: 'center', marginBottom: 16,
  },
  // Riquadro alto quanto due anteprime e centrato sul punto: il testo resta centrato in verticale.
  anchor: { position: 'absolute', alignItems: 'center', justifyContent: 'center' },
  outline: {
    color: '#fff', fontWeight: '900', textAlign: 'center',
    textShadowColor: 'rgba(16,16,20,0.95)', textShadowRadius: 6, textShadowOffset: { width: 0, height: 0 },
  },
  noShadow: { textShadowRadius: 0, textShadowColor: 'transparent' },
  sticker: {
    position: 'absolute', alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOpacity: 0.5, shadowRadius: 4, shadowOffset: { width: 3, height: 3 },
  },
  // Contorno bianco sottile con un'ombra scura appena fuori: si vede su qualsiasi sfondo.
  selBox: { position: 'absolute', borderWidth: 1, borderColor: 'rgba(255,255,255,0.95)', borderRadius: 2 },
  selShade: { position: 'absolute', borderWidth: 1, borderColor: 'rgba(0,0,0,0.35)', borderRadius: 3 },
  handle: {
    position: 'absolute', width: HANDLE_DOT, height: HANDLE_DOT, borderRadius: 3, backgroundColor: '#fff',
    borderWidth: 1.5, borderColor: colors.accent,
    shadowColor: '#000', shadowOpacity: 0.45, shadowRadius: 2, shadowOffset: { width: 0, height: 1 }, elevation: 2,
  },
  sideHandle: {
    position: 'absolute', width: 5, borderRadius: 3, backgroundColor: '#fff',
    shadowColor: '#000', shadowOpacity: 0.45, shadowRadius: 2, shadowOffset: { width: 0, height: 1 }, elevation: 2,
  },
  videoBox: { backgroundColor: 'rgba(255,45,45,0.3)', alignItems: 'center', justifyContent: 'center' },
  videoText: { color: '#fff', fontWeight: '800', fontSize: 12 },
  guideV: { position: 'absolute', top: 0, bottom: 0, width: 1, backgroundColor: colors.accent, opacity: 0.9 },
  guideH: { position: 'absolute', left: 0, right: 0, height: 1, backgroundColor: colors.accent, opacity: 0.9 },
  gridH: { position: 'absolute', left: 0, right: 0, height: 1, backgroundColor: colors.accent, opacity: 0.18 },
});
