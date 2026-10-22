// Posizionamento automatico dei pulsanti animati: se nello stesso momento due pulsanti
// (o un pulsante e un testo, i sottotitoli o un riquadro) finirebbero uno sopra l'altro,
// il pulsante scivola verso l'alto o il basso fino al primo spazio libero.
// Stessa logica nell'app (expo/src/lib/stickerLayout.ts): anteprima e video finale coincidono.
// Coordinate in px su 1080×1920.

/** Centro predefinito dei sottotitoli: in mezzo in orizzontale, al 66% dell'altezza (sopra l'interfaccia dei social). */
export const SUB_X = 540;
export const SUB_Y = Math.round(1920 * 0.66);

export interface LayoutSpec {
  subtitles: boolean;
  subStyle?: { y?: number };
  texts: { start: number; end: number; position: 'top' | 'center' | 'bottom'; size: 'small' | 'medium' | 'large'; y?: number }[];
  overlays: LayoutOverlay[];
  stickers: { id: string; start: number; end: number; position: 'top' | 'center' | 'bottom' }[];
}

export interface LayoutOverlay {
  start: number; end: number; mode: 'full' | 'pip'; position?: string; mediaId?: string;
  x?: number; y?: number; w?: number; cutout?: boolean;
}

export const STICKER_H = 130;
export const PIP_W = 460;

/**
 * Riquadro (px su 1080×1920) di una foto/video incollato in "pip": larghezza `w` (default 460),
 * altezza dalle proporzioni del media; centro in x,y se l'utente l'ha spostato a mano,
 * altrimenti l'angolo scelto. `aspect` = altezza / larghezza.
 */
export function overlayBox(o: LayoutOverlay, aspect = 1): { left: number; top: number; w: number; h: number } {
  // Foto scontornata "a schermo intero": il soggetto grande al centro, senza ritagli.
  const def = o.mode === 'full' ? Math.min(1000, 1500 / (aspect || 1)) : PIP_W;
  const w = Math.round(Math.max(120, Math.min(1080, o.w ?? def)));
  if (o.mode === 'full' && o.x == null) o = { ...o, position: 'center' };
  const h = Math.round(w * (aspect > 0 ? aspect : 1));
  if (o.x != null && o.y != null) return { left: Math.round(o.x - w / 2), top: Math.round(o.y - h / 2), w, h };
  switch (o.position ?? 'top-right') {
    case 'top-left': return { left: 50, top: 220, w, h };
    case 'center': return { left: Math.round((1080 - w) / 2), top: Math.round((1920 - h) / 2), w, h };
    case 'bottom-left': return { left: 50, top: 1920 - 640 - h, w, h };
    case 'bottom-right': return { left: 1080 - 50 - w, top: 1920 - 640 - h, w, h };
    default: return { left: 1080 - 50 - w, top: 220, w, h };
  }
}
const GAP = 24;
const PREFERRED = { top: 330, center: 960, bottom: 1540 } as const;
const TEXT_H = { small: 70, medium: 90, large: 120 } as const;

type Band = { from: number; to: number; start: number; end: number };
const overlapT = (a: { start: number; end: number }, b: { start: number; end: number }) => a.start < b.end && b.start < a.end;

/** Centro verticale (y) di ogni pulsante, per id. */
/** `aspectOf` dà altezza/larghezza del media mostrato, o null se copre tutto lo schermo. */
export function layoutStickers(spec: LayoutSpec, aspectOf: (o: LayoutOverlay) => number | null = (o) => (o.mode === 'pip' ? 1 : null)): Record<string, number> {
  const fixed: Band[] = [];
  const subY = spec.subStyle?.y ?? SUB_Y;
  if (spec.subtitles) fixed.push({ from: subY - 90, to: subY + 90, start: 0, end: Infinity });
  for (const t of spec.texts) {
    const h = TEXT_H[t.size];
    const [from, to] = t.y != null ? [t.y - h / 2, t.y + h / 2]
      : t.position === 'top' ? [260, 260 + h] : t.position === 'bottom' ? [1600 - h, 1600] : [960 - h / 2, 960 + h / 2];
    fixed.push({ from, to, start: t.start, end: t.end });
  }
  for (const o of spec.overlays) {
    const aspect = aspectOf(o);
    if (aspect == null) continue; // a schermo intero copre comunque tutto
    const b = overlayBox(o, aspect);
    fixed.push({ from: b.top, to: b.top + b.h, start: o.start, end: o.end });
  }

  const out: Record<string, number> = {};
  const placed: Band[] = [];
  const ordered = [...spec.stickers].sort((a, b) => a.start - b.start || a.id.localeCompare(b.id));
  for (const s of ordered) {
    const win = { start: s.start, end: Math.max(s.end, s.start + 0.5) };
    const busy = [...fixed, ...placed].filter((b) => overlapT(b, win));
    const free = (y: number) => busy.every((b) => y + STICKER_H / 2 + GAP <= b.from || y - STICKER_H / 2 - GAP >= b.to);
    const want = PREFERRED[s.position];
    let y = want;
    // Cerca il posto libero più vicino a quello scelto, alternando sopra e sotto.
    for (let d = 0; d <= 1500; d += 10) {
      if (want - d >= 200 && free(want - d)) { y = want - d; break; }
      if (want + d <= 1720 && free(want + d)) { y = want + d; break; }
    }
    out[s.id] = y;
    placed.push({ from: y - STICKER_H / 2, to: y + STICKER_H / 2, ...win });
  }
  return out;
}
