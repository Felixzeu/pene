// Tema "Neon": quasi nero con riflessi viola, rosa e viola come accenti (in gradiente
// sui pulsanti principali), titoli in Space Grotesk.
export const colors = {
  bg: '#07060D',
  surface: '#110F1D',
  surfaceAlt: '#1A1730',
  border: '#2A2540',
  text: '#F4F1FF',
  textDim: '#A59DC4',
  accent: '#FF5CC8',
  accent2: '#A15CFF',
  accentSoft: 'rgba(255,92,200,0.14)',
  warm: '#FFD66B',
  ok: '#7CFFCB',
  err: '#FF6B8B',
  onAccent: '#0B0716', // testo sopra rosa/viola/giallo
} as const;

/** Gradiente dei pulsanti principali e delle card in evidenza. */
export const gradient = [colors.accent, colors.accent2] as const;

export const fonts = {
  display: 'SpaceGrotesk_700Bold',
  semibold: 'SpaceGrotesk_600SemiBold',
  medium: 'SpaceGrotesk_500Medium',
} as const;

export const radius = { sm: 10, md: 16, lg: 22, full: 999 } as const;

export const spacing = (n: number) => n * 4;
