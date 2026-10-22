import { getLanguage } from '../services/language';
import en from './en';
import es from './es';
import fr from './fr';

// Traduzioni dell'app. La chiave è il testo italiano: se manca una traduzione resta l'italiano.
// I segnaposto {nome} si riempiono con `vars`. L'app si ridisegna da sola quando cambia la lingua
// (App.tsx usa useLanguage), quindi ogni schermata deve chiamare t() mentre disegna,
// mai in costanti calcolate all'avvio.
const DICTS: Record<string, Record<string, string>> = { English: en, Español: es, Français: fr };

export function t(it: string, vars?: Record<string, string | number>): string {
  let out = DICTS[getLanguage()]?.[it] ?? it;
  if (vars) out = out.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
  return out;
}

/** Messaggi che arrivano dal server (avanzamento, errori): tradotti se sono tra quelli noti. */
export const tServer = (msg?: string | null) => (msg ? t(msg) : '');

/** Codice di lingua per date e numeri. */
export const locale = () => ({ English: 'en-GB', Español: 'es-ES', Français: 'fr-FR' } as Record<string, string>)[getLanguage()] ?? 'it-IT';
