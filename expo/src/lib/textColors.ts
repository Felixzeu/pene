// Colori per testi e sottotitoli. Come colorTags / subHighlight in backend/src/lib/render.ts.

export const TEXT_COLORS = [
  { name: 'Bianco', hex: '#FFFFFF' },
  { name: 'Nero', hex: '#000000' },
  { name: 'Rosso', hex: '#FF2D2D' },
  { name: 'Arancione', hex: '#FF8A00' },
  { name: 'Giallo', hex: '#FFD42B' },
  { name: 'Verde', hex: '#2ECC71' },
  { name: 'Azzurro', hex: '#38BDF8' },
  { name: 'Blu', hex: '#2563EB' },
  { name: 'Viola', hex: '#A15CFF' },
  { name: 'Rosa', hex: '#FF5CC8' },
] as const;

/** Colori scuri: bordo bianco invece che nero, così il testo si legge su qualsiasi sfondo. */
export const isDark = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 0.35;
};

/** Parola pronunciata nei sottotitoli: gialla, o bianca se i sottotitoli sono già gialli. */
export const subHighlight = (color?: string) => (color && color.toUpperCase() === '#FFD42B' ? '#FFFFFF' : '#FFD42B');

/** Bordo (ombra) del testo nell'anteprima, come l'outline del video finale. */
export const outlineOf = (hex?: string) => (hex && isDark(hex) ? 'rgba(255,255,255,0.95)' : 'rgba(16,16,20,0.95)');
