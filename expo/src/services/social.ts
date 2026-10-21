import * as WebBrowser from 'expo-web-browser';
import * as ExpoLinking from 'expo-linking';
import type { ProviderId } from '../config';
import { authUrl } from './api';

/**
 * Collega un social dentro l'app: finestra di login di sistema che si chiude da sola
 * quando il backend rimanda a viral (exp:// in Expo Go) con l'esito.
 * Restituisce null se l'utente ha chiuso la finestra.
 */
export async function linkSocial(id: ProviderId): Promise<{ ok: boolean; message: string } | null> {
  const ret = ExpoLinking.createURL('auth');
  const res = await WebBrowser.openAuthSessionAsync(await authUrl(id, ret), ret);
  if (res.type !== 'success') return null;
  const q = ExpoLinking.parse(res.url).queryParams ?? {};
  return { ok: q.status === 'ok', message: String(q.message ?? '') };
}
