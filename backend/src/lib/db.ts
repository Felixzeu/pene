import { config } from '../config';
import { AppError } from './errors';

// Accesso al database Supabase (Postgres) dal backend, con la chiave secret.
// Le tabelle sono in backend/supabase/schema.sql. Senza account/chiave il database è spento.

export const dbEnabled = () => Boolean(config.supabase.url && config.supabase.serviceKey);

function headers(extra: Record<string, string> = {}): Record<string, string> {
  const k = config.supabase.serviceKey;
  // Le nuove chiavi "sb_secret_..." vanno solo in apikey; le vecchie (JWT) anche in Authorization.
  return { apikey: k, ...(k.startsWith('sb_') ? {} : { Authorization: `Bearer ${k}` }), 'Content-Type': 'application/json', ...extra };
}

async function call<T>(path: string, init: RequestInit): Promise<T> {
  const r = await fetch(`${config.supabase.url}/rest/v1${path}`, { ...init, headers: headers(init.headers as Record<string, string>) });
  const text = await r.text();
  const body = text ? JSON.parse(text) : null;
  if (!r.ok) {
    const msg = (body as { message?: string })?.message ?? `errore ${r.status}`;
    if (/relation .* does not exist|Could not find the function|schema cache/i.test(msg)) {
      throw new AppError('Database non ancora preparato: incolla backend/supabase/schema.sql nel SQL Editor di Supabase.', 500);
    }
    throw new AppError(msg, r.status >= 500 ? 502 : 400);
  }
  return body as T;
}

export const rpc = <T>(fn: string, args: Record<string, unknown>) =>
  call<T>(`/rpc/${fn}`, { method: 'POST', body: JSON.stringify(args) });

export const select = <T>(table: string, query: string) =>
  call<T[]>(`/${table}?${query}`, { method: 'GET' });

export const upsert = (table: string, row: Record<string, unknown>) =>
  call<unknown>(`/${table}`, { method: 'POST', body: JSON.stringify(row), headers: { Prefer: 'resolution=merge-duplicates,return=minimal' } });

export const update = (table: string, query: string, patch: Record<string, unknown>) =>
  call<unknown>(`/${table}?${query}`, { method: 'PATCH', body: JSON.stringify(patch), headers: { Prefer: 'return=minimal' } });
