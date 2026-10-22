import 'react-native-url-polyfill/auto';
import { AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as WebBrowser from 'expo-web-browser';
import * as ExpoLinking from 'expo-linking';
import { createClient, type Session } from '@supabase/supabase-js';

// Account utenti con Supabase: registrazione/login con email e password, Google o Apple.
// La sessione resta salvata sul telefono e si rinnova da sola. Senza le due variabili
// EXPO_PUBLIC_SUPABASE_* nel file expo/.env l'app funziona senza login (solo per te).

const URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const ANON = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

export const accountsEnabled = Boolean(URL && ANON);

export const supabase = accountsEnabled
  ? createClient(URL, ANON, {
    auth: { storage: AsyncStorage, autoRefreshToken: true, persistSession: true, detectSessionInUrl: false, flowType: 'pkce' },
  })
  : null;

// Rinnova il token solo con l'app aperta (consiglio di Supabase per React Native).
if (supabase) {
  AppState.addEventListener('change', (s) => {
    if (s === 'active') supabase.auth.startAutoRefresh();
    else supabase.auth.stopAutoRefresh();
  });
}

let token: string | null = null;
supabase?.auth.onAuthStateChange((_e, s) => { token = s?.access_token ?? null; });

/** Header da aggiungere a ogni chiamata al backend. */
export const authHeaders = (): Record<string, string> => (token ? { Authorization: `Bearer ${token}` } : {});

export async function getSession(): Promise<Session | null> {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  token = data.session?.access_token ?? null;
  return data.session;
}

export const onSessionChange = (cb: (s: Session | null) => void) => {
  if (!supabase) return () => {};
  const { data } = supabase.auth.onAuthStateChange((_e, s) => cb(s));
  return () => data.subscription.unsubscribe();
};

/** Traduce gli errori più comuni di Supabase. */
function it(msg: string): string {
  if (/invalid login credentials/i.test(msg)) return 'Email o password sbagliate.';
  if (/email not confirmed/i.test(msg)) return 'Conferma prima l\'email: apri il link che ti abbiamo mandato.';
  if (/already registered|already exists/i.test(msg)) return 'Esiste già un account con questa email: accedi.';
  if (/password should be at least/i.test(msg)) return 'La password deve avere almeno 6 caratteri.';
  if (/rate limit|too many/i.test(msg)) return 'Troppi tentativi: aspetta qualche minuto.';
  if (/provider is not enabled|unsupported provider/i.test(msg)) return 'Questo tipo di accesso non è ancora attivo su Supabase.';
  if (/invalid.*email/i.test(msg)) return 'Email non valida.';
  return msg;
}

function need() {
  if (!supabase) throw new Error('Account non configurati: mancano le chiavi Supabase in expo/.env.');
  return supabase;
}

export async function signIn(email: string, password: string) {
  const { error } = await need().auth.signInWithPassword({ email: email.trim(), password });
  if (error) throw new Error(it(error.message));
}

/** Registrazione. Restituisce true se serve confermare l'email prima di entrare. */
export async function signUp(email: string, password: string): Promise<boolean> {
  const { data, error } = await need().auth.signUp({
    email: email.trim(),
    password,
    options: { emailRedirectTo: ExpoLinking.createURL('login') },
  });
  if (error) throw new Error(it(error.message));
  return !data.session;
}

export async function resetPassword(email: string) {
  const { error } = await need().auth.resetPasswordForEmail(email.trim());
  if (error) throw new Error(it(error.message));
}

/** Google o Apple: login nella finestra di sistema, che poi torna all'app da sola. */
export async function signInWith(provider: 'google' | 'apple') {
  const sb = need();
  const redirectTo = ExpoLinking.createURL('login');
  const { data, error } = await sb.auth.signInWithOAuth({ provider, options: { redirectTo, skipBrowserRedirect: true } });
  if (error || !data?.url) throw new Error(it(error?.message ?? 'Accesso non disponibile.'));
  console.log(`[login] ${provider}: ritorno su ${redirectTo}`);
  const res = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
  console.log(`[login] risultato: ${res.type}${'url' in res ? ` ${res.url.replace(/code=[^&]+/, 'code=…')}` : ''}`);
  if (res.type !== 'success') return; // finestra chiusa: niente da fare
  const q = ExpoLinking.parse(res.url).queryParams ?? {};
  if (q.error_description || q.error) throw new Error(it(String(q.error_description ?? q.error)));
  if (typeof q.code !== 'string') throw new Error('Accesso non completato: riprova.');
  const { error: e2 } = await sb.auth.exchangeCodeForSession(q.code);
  if (e2) throw new Error(it(e2.message));
}

/** True se l'account è entrato (anche) con Google. */
export async function hasGoogle(): Promise<boolean> {
  const s = await getSession();
  const providers = (s?.user.app_metadata?.providers as string[] | undefined) ?? [s?.user.app_metadata?.provider];
  return providers.includes('google');
}

/**
 * YouTube con lo stesso account Google del login: rifà l'accesso Google chiedendo anche
 * il permesso di caricare video, e restituisce i token di Google da dare al backend.
 * Restituisce null se l'utente chiude la finestra.
 */
export async function googleYouTubeTokens(): Promise<{ accessToken: string; refreshToken?: string } | null> {
  const sb = need();
  const before = (await getSession())?.user.id;
  const redirectTo = ExpoLinking.createURL('login');
  const { data, error } = await sb.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo,
      skipBrowserRedirect: true,
      scopes: 'https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly',
      queryParams: { access_type: 'offline', prompt: 'consent' }, // serve per avere il refresh token
    },
  });
  if (error || !data?.url) throw new Error(it(error?.message ?? 'Accesso Google non disponibile.'));
  const res = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
  if (res.type !== 'success') return null;
  const q = ExpoLinking.parse(res.url).queryParams ?? {};
  if (q.error_description || q.error) throw new Error(it(String(q.error_description ?? q.error)));
  if (typeof q.code !== 'string') throw new Error('Accesso non completato: riprova.');
  const { data: d2, error: e2 } = await sb.auth.exchangeCodeForSession(q.code);
  if (e2) throw new Error(it(e2.message));
  if (before && d2.session?.user.id !== before) {
    throw new Error('Hai scelto un account Google diverso da quello con cui sei entrato: ora sei dentro con quello. Riprova scegliendo l\'account giusto.');
  }
  const accessToken = d2.session?.provider_token;
  if (!accessToken) throw new Error('Google non ha dato il permesso per YouTube: riprova e accetta tutte le voci.');
  return { accessToken, refreshToken: d2.session?.provider_refresh_token ?? undefined };
}

/** Quali accessi social sono attivi su Supabase (per mostrare solo i pulsanti che funzionano). */
export async function enabledProviders(): Promise<{ google: boolean; apple: boolean }> {
  try {
    const r = await fetch(`${URL}/auth/v1/settings`, { headers: { apikey: ANON } });
    const d = (await r.json()) as { external?: Record<string, boolean> };
    return { google: !!d.external?.google, apple: !!d.external?.apple };
  } catch {
    return { google: false, apple: false };
  }
}

export async function signOut() {
  await supabase?.auth.signOut();
  token = null;
}
