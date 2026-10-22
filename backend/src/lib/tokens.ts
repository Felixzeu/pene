import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';
import { config, paths } from '../config';
import { currentUser } from './user';
import { AppError, ERR } from './errors';

// Token OAuth cifrati a riposo (AES-256-GCM) su disco. Mai nell'app, mai in chiaro.
// Ogni utente ha i suoi social: il file è { users: { <idUtente>: { <social>: token } } }.

type Enc = { encrypted: string; iv: string; tag: string };
interface TokenStore { [provider: string]: Enc }
interface TokenFile { users: Record<string, TokenStore> }

async function readFile(): Promise<TokenFile> {
  try {
    const raw = JSON.parse(await fs.readFile(paths.tokens, 'utf8')) as Partial<TokenFile> & TokenStore;
    if (raw.users) return { users: raw.users as Record<string, TokenStore> };
    // Vecchio formato (un solo utente): diventa l'utente "local".
    return { users: { local: raw as TokenStore } };
  } catch {
    return { users: {} };
  }
}

async function writeFile(f: TokenFile): Promise<void> {
  await fs.mkdir(path.dirname(paths.tokens), { recursive: true });
  await fs.writeFile(paths.tokens, JSON.stringify(f, null, 2), { mode: 0o600 });
}

async function read(): Promise<TokenStore> {
  return (await readFile()).users[currentUser().id] ?? {};
}

async function write(store: TokenStore): Promise<void> {
  const f = await readFile();
  f.users[currentUser().id] = store;
  await writeFile(f);
}

/** Cancella tutti i social collegati dell'utente attuale (eliminazione account), revocando l'accesso. */
export async function removeAllTokens(): Promise<void> {
  const store = await read();
  for (const provider of Object.keys(store)) await revokeRemote(provider, store);
  const f = await readFile();
  delete f.users[currentUser().id];
  await writeFile(f);
}

/**
 * Revoca l'accesso anche dal lato del social, così l'autorizzazione sparisce pure dalle
 * impostazioni dell'utente su Google/Meta/TikTok. Non blocca mai lo scollegamento se fallisce.
 * Instagram e Facebook usano la stessa app Meta: si revoca solo quando non ne resta collegato nessuno.
 */
async function revokeRemote(provider: string, store: TokenStore): Promise<void> {
  try {
    const t = await loadToken(provider);
    const o = config.oauth;
    const form = (body: Record<string, string>) => ({
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(body),
      signal: AbortSignal.timeout(8000),
    });
    if (provider === 'youtube') {
      await fetch('https://oauth2.googleapis.com/revoke', form({ token: t.refreshToken ?? t.accessToken }));
    } else if (provider === 'tiktok') {
      await fetch('https://open.tiktokapis.com/v2/oauth/revoke/', form({
        client_key: o.tiktok.clientKey, client_secret: o.tiktok.clientSecret, token: t.accessToken,
      }));
    } else if (provider === 'instagram' || provider === 'facebook') {
      const other = provider === 'instagram' ? 'facebook' : 'instagram';
      if (store[other]) return;
      await fetch(`https://graph.facebook.com/v21.0/me/permissions?access_token=${encodeURIComponent(t.accessToken)}`, {
        method: 'DELETE', signal: AbortSignal.timeout(8000),
      });
    }
  } catch (e) {
    console.error(`[tokens] revoca ${provider} non riuscita:`, e instanceof Error ? e.message : e);
  }
}

function key(): Buffer {
  if (!config.encryptionKey) {
    throw new Error('TOKEN_ENCRYPTION_KEY non impostata: genera una chiave con `openssl rand -hex 32` e inseriscila nel .env.');
  }
  return scryptSync(config.encryptionKey, 'creatorprompt-salt', 32);
}

export async function saveToken(provider: string, accessToken: string, refreshToken?: string): Promise<void> {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const payload = JSON.stringify({ accessToken, refreshToken });
  const encrypted = Buffer.concat([cipher.update(payload, 'utf8'), cipher.final()]);
  const store = await read();
  store[provider] = { encrypted: encrypted.toString('base64'), iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64') };
  await write(store);
}

export async function loadToken(provider: string): Promise<{ accessToken: string; refreshToken?: string }> {
  const store = await read();
  const t = store[provider];
  if (!t) throw new Error('not_linked');
  const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(t.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(t.tag, 'base64'));
  const payload = Buffer.concat([decipher.update(Buffer.from(t.encrypted, 'base64')), decipher.final()]).toString('utf8');
  return JSON.parse(payload);
}

/** Scollega un social: revoca l'accesso sul social e cancella il token. */
export async function removeToken(provider: string, revoke = true): Promise<void> {
  const store = await read();
  if (!store[provider]) return;
  if (revoke) await revokeRemote(provider, store);
  delete store[provider];
  await write(store);
}

export const isLinked = async (provider: string): Promise<boolean> => {
  const store = await read();
  return Boolean(store[provider]);
};

/**
 * Token di accesso valido: YouTube (1 ora) e TikTok (24 ore) scadono presto,
 * quindi prima di pubblicare lo rinnoviamo con il refresh token salvato.
 */
export async function freshAccessToken(provider: 'youtube' | 'tiktok'): Promise<string> {
  const t = await loadToken(provider);
  if (!t.refreshToken) return t.accessToken;
  const o = config.oauth;
  const r = provider === 'youtube'
    ? await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: o.youtube.clientId,
        client_secret: o.youtube.clientSecret,
        refresh_token: t.refreshToken,
        grant_type: 'refresh_token',
      }),
    })
    : await fetch('https://open.tiktokapis.com/v2/oauth/token/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_key: o.tiktok.clientKey,
        client_secret: o.tiktok.clientSecret,
        refresh_token: t.refreshToken,
        grant_type: 'refresh_token',
      }),
    });
  const d = (await r.json().catch(() => ({}))) as {
    access_token?: string; refresh_token?: string; data?: { access_token?: string; refresh_token?: string };
  };
  const access = d.access_token ?? d.data?.access_token;
  const err = (d as { error?: unknown }).error;
  if (!access && (err === 'invalid_grant' || (d as { data?: { error?: string } }).data?.error === 'invalid_grant')) {
    // L'utente ha tolto il permesso dalle impostazioni del social (o è scaduto): risulta scollegato.
    await removeToken(provider, false);
    throw new AppError(ERR.accessRevoked(provider === 'youtube' ? 'YouTube' : 'TikTok'), 401);
  }
  if (!access) return t.accessToken; // rinnovo fallito per altri motivi: proviamo con quello che c'è
  await saveToken(provider, access, d.refresh_token ?? d.data?.refresh_token ?? t.refreshToken);
  return access;
}
