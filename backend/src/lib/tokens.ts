import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';
import { config, paths } from '../config';

// Token OAuth cifrati a riposo (AES-256-GCM) su disco. Mai nell'app, mai in chiaro.

interface TokenStore { [provider: string]: { encrypted: string; iv: string; tag: string } }

async function read(): Promise<TokenStore> {
  try {
    return JSON.parse(await fs.readFile(paths.tokens, 'utf8')) as TokenStore;
  } catch {
    return {};
  }
}

async function write(store: TokenStore): Promise<void> {
  await fs.mkdir(path.dirname(paths.tokens), { recursive: true });
  await fs.writeFile(paths.tokens, JSON.stringify(store, null, 2), { mode: 0o600 });
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
  if (!access) return t.accessToken; // rinnovo fallito: proviamo con quello che c'è
  await saveToken(provider, access, d.refresh_token ?? d.data?.refresh_token ?? t.refreshToken);
  return access;
}
