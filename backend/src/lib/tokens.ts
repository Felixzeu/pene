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
