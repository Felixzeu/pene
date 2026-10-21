import { AsyncLocalStorage } from 'async_hooks';
import type express from 'express';
import { config } from '../config';
import { AppError } from './errors';

// Chi sta usando l'app. Con Supabase attivo ogni richiesta porta il token di login
// (Authorization: Bearer ...) e qui lo verifichiamo; il risultato resta disponibile
// a tutto il codice chiamato da quella richiesta (token dei social, job, pubblicazioni).
// Senza Supabase c'è un solo utente, "local", come prima degli account.

export interface User { id: string; email?: string; admin?: boolean }

const LOCAL: User = { id: 'local', admin: true }; // senza account c'è solo il proprietario
const store = new AsyncLocalStorage<User>();
const cache = new Map<string, { user: User; until: number }>();

export const accountsEnabled = () => Boolean(config.supabase.url && config.supabase.anonKey);

/** L'utente della richiesta in corso ("local" se gli account non sono attivi). */
export function currentUser(): User {
  return store.getStore() ?? LOCAL;
}

/** L'utente solo se siamo dentro una richiesta (undefined nei lavori in background). */
export const requestUser = (): User | undefined => store.getStore();

/** Esegue `fn` come se a chiamare fosse `userId` (es. nei callback OAuth aperti dal browser). */
export function runAs<T>(user: User, fn: () => T): T {
  return store.run(user, fn);
}

/** Verifica un access token di Supabase e restituisce l'utente. */
export async function verifyToken(token: string): Promise<User> {
  const hit = cache.get(token);
  if (hit && hit.until > Date.now()) return hit.user;
  const r = await fetch(`${config.supabase.url}/auth/v1/user`, {
    headers: { apikey: config.supabase.anonKey, Authorization: `Bearer ${token}` },
  }).catch(() => null);
  if (!r) throw new AppError('Non riesco a verificare il login (Supabase non raggiungibile): riprova.', 503);
  if (!r.ok) throw new AppError('Sessione scaduta: esci e accedi di nuovo.', 401);
  const d = (await r.json()) as { id?: string; email?: string; email_confirmed_at?: string | null };
  if (!d.id) throw new AppError('Sessione non valida: accedi di nuovo.', 401);
  // Admin solo con email confermata: nessuno può "prendersi" la tua email senza verificarla.
  const email = d.email?.toLowerCase();
  const admin = Boolean(email && d.email_confirmed_at && config.adminEmails.includes(email));
  const user = { id: d.id, email: d.email, admin };
  if (cache.size > 5000) cache.clear();
  cache.set(token, { user, until: Date.now() + 5 * 60_000 });
  return user;
}

/** True se la richiesta viene da un amministratore (usato per saltare i limiti). */
export async function isAdminRequest(req: express.Request): Promise<boolean> {
  if (!accountsEnabled()) return false;
  const h = req.headers.authorization ?? '';
  if (!h.startsWith('Bearer ')) return false;
  try { return Boolean((await verifyToken(h.slice(7).trim())).admin); } catch { return false; }
}

/** Middleware: senza login valido risponde 401 (solo se gli account sono attivi). */
export const requireUser: express.RequestHandler = (req, _res, next) => {
  if (!accountsEnabled()) { runAs(LOCAL, next); return; }
  const h = req.headers.authorization ?? '';
  const token = h.startsWith('Bearer ') ? h.slice(7).trim() : '';
  if (!token) { next(new AppError('Accedi per usare viral.', 401)); return; }
  verifyToken(token)
    .then((user) => runAs(user, next))
    .catch(next);
};

/** Cancella l'utente da Supabase (serve la service role key, solo nel backend). */
export async function deleteSupabaseUser(id: string): Promise<void> {
  if (!config.supabase.serviceKey) {
    throw new AppError('Per eliminare gli account manca SUPABASE_SERVICE_ROLE_KEY nel file backend/.env.', 500);
  }
  const r = await fetch(`${config.supabase.url}/auth/v1/admin/users/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    // Le nuove chiavi "sb_secret_..." vanno solo in apikey; le vecchie service_role (JWT) anche in Authorization.
    headers: config.supabase.serviceKey.startsWith('sb_')
      ? { apikey: config.supabase.serviceKey }
      : { apikey: config.supabase.serviceKey, Authorization: `Bearer ${config.supabase.serviceKey}` },
  });
  if (!r.ok && r.status !== 404) throw new AppError(`Supabase non ha eliminato l'account (errore ${r.status}).`, 502);
  for (const [k, v] of cache) if (v.user.id === id) cache.delete(k);
}
