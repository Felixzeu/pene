// Tema ViralAPP: rosso come colore del brand su sfondo quasi nero, titoli in Space Grotesk.
// Tutti i colori dell'app passano da qui: per cambiare palette basta modificare questi valori.
export const colors = {
  bg: '#121212',          // sfondo principale
  surface: '#1E1E1E',     // card e pannelli
  surfaceAlt: '#2A2A2A',  // campi, pulsanti secondari
  border: '#343434',
  text: '#FFFFFF',
  textDim: '#B3B3B3',
  accent: '#FF2D2D',      // rosso principale: pulsanti, selezioni, link, azioni importanti
  accent2: '#C1121F',     // rosso scuro: stati attivi, gradienti, dettagli
  accentSoft: 'rgba(255,45,45,0.14)',
  warm: '#FFD66B',
  ok: '#5BE49B',
  err: '#FF8A5C',         // arancio: distinto dal rosso del brand
  onAccent: '#FFFFFF',    // testo sopra il rosso
  onWarm: '#121212',      // testo sopra il giallo
} as const

/** Gradiente dei pulsanti principali e delle card in evidenza. */
export const gradient = [colors.accent, colors.accent2] as const;

export const fonts = {
  display: 'SpaceGrotesk_700Bold',
  semibold: 'SpaceGrotesk_600SemiBold',
  medium: 'SpaceGrotesk_500Medium',
} as const;

export const radius = { sm: 10, md: 16, lg: 22, full: 999 } as const;

export const spacing = (n: number) => n * 4;
