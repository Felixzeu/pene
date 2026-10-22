import { useSyncExternalStore } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Lingua dell'app scelta dalla Home: vale per lo script e per i sottotitoli dei nuovi video.
// I progetti già creati tengono la lingua con cui sono nati.

export const LANGUAGES = [
  { value: 'Italiano', label: 'Italiano', flag: '🇮🇹' },
  { value: 'English', label: 'English', flag: '🇬🇧' },
  { value: 'Español', label: 'Español', flag: '🇪🇸' },
  { value: 'Français', label: 'Français', flag: '🇫🇷' },
] as const;

const KEY = 'viral.language.v1';
let current: string = LANGUAGES[0].value;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

// Letta una volta all'avvio; finché non arriva vale l'italiano.
AsyncStorage.getItem(KEY)
  .then((v) => { if (v && LANGUAGES.some((l) => l.value === v)) { current = v; emit(); } })
  .catch(() => {});

export const getLanguage = () => current;

export function setLanguage(v: string): void {
  current = v;
  emit();
  AsyncStorage.setItem(KEY, v).catch(() => { /* non critico */ });
}

/** La lingua scelta, aggiornata quando cambia. */
export function useLanguage(): string {
  return useSyncExternalStore(
    (cb) => { listeners.add(cb); return () => { listeners.delete(cb); }; },
    () => current,
  );
}

export const languageInfo = (v: string) => LANGUAGES.find((l) => l.value === v) ?? LANGUAGES[0];
