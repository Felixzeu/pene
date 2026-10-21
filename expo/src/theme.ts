// Tema scuro "creator studio": carbone profondo, rosso segnale (REC) e ambra caldo.
export const colors = {
  bg: '#0B0A0E',
  surface: '#15131B',
  surfaceAlt: '#1E1B26',
  border: '#2A2733',
  text: '#F5F3EE',
  textDim: '#9B97A6',
  accent: '#FF3B5C',
  accentSoft: 'rgba(255,59,92,0.14)',
  warm: '#FFB443',
  ok: '#3DDC84',
  err: '#FF6B6B',
} as const;

export const radius = { sm: 10, md: 16, lg: 22, full: 999 } as const;

export const spacing = (n: number) => n * 4;
