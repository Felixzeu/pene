// Posizionamento automatico dei pulsanti animati: se nello stesso momento due pulsanti
// (o un pulsante e un testo, i sottotitoli o un riquadro) finirebbero uno sopra l'altro,
// il pulsante scivola verso l'alto o il basso fino al primo spazio libero.
// Copia di backend/src/lib/stickerLayout.ts: anteprima e video finale coincidono.
// Coordinate in px su 1080×1920.

export interface LayoutSpec {
  subtitles: boolean;
  texts: { start: number; end: number; position: 'top' | 'center' | 'bottom'; size: 'small' | 'medium' | 'large' }[];
  overlays: { start: number; end: number; mode: 'full' | 'pip'; position?: string }[];
  stickers: { id: string; start: number; end: number; position: 'top' | 'center' | 'bottom' }[];
}

export const STICKER_H = 130;
const GAP = 24;
const PREFERRED = { top: 330, center: 960, bottom: 1540 } as const;
const TEXT_H = { small: 70, medium: 90, large: 120 } as const;

type Band = { from: number; to: number; start: number; end: number };
const overlapT = (a: { start: number; end: number }, b: { start: number; end: number }) => a.start < b.end && b.start < a.end;

/** Centro verticale (y) di ogni pulsante, per id. */
export function layoutStickers(spec: LayoutSpec): Record<string, number> {
  const fixed: Band[] = [];
  if (spec.subtitles) fixed.push({ from: 1250, to: 1390, start: 0, end: Infinity });
  for (const t of spec.texts) {
    const h = TEXT_H[t.size];
    const [from, to] = t.position === 'top' ? [260, 260 + h] : t.position === 'bottom' ? [1600 - h, 1600] : [960 - h / 2, 960 + h / 2];
    fixed.push({ from, to, start: t.start, end: t.end });
  }
  for (const o of spec.overlays) {
    if (o.mode !== 'pip') continue; // a schermo intero copre comunque tutto
    const p = o.position ?? 'top-right';
    const [from, to] = p.startsWith('top') ? [220, 680] : p.startsWith('bottom') ? [820, 1280] : [730, 1190];
    fixed.push({ from, to, start: o.start, end: o.end });
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
