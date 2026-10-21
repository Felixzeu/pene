import * as WebBrowser from 'expo-web-browser';
import * as ExpoLinking from 'expo-linking';
import type { ProviderId } from '../config';
import { authUrl, saveGoogleYouTube } from './api';
import { googleYouTubeTokens, hasGoogle } from './auth';

/**
 * Collega un social dentro l'app: finestra di login di sistema che si chiude da sola
 * quando il backend rimanda a viral (exp:// in Expo Go) con l'esito.
 * Restituisce null se l'utente ha chiuso la finestra.
 */
export async function linkSocial(id: ProviderId): Promise<{ ok: boolean; message: string } | null> {
  // Chi è entrato con Google collega YouTube con lo stesso account, in un passaggio.
  if (id === 'youtube' && (await hasGoogle())) {
    const t = await googleYouTubeTokens();
    return t ? saveGoogleYouTube(t) : null;
  }
  const ret = ExpoLinking.createURL('auth');
  const res = await WebBrowser.openAuthSessionAsync(await authUrl(id, ret), ret);
  if (res.type !== 'success') return null;
  const q = ExpoLinking.parse(res.url).queryParams ?? {};
  return { ok: q.status === 'ok', message: String(q.message ?? '') };
}
