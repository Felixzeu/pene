import { API_URL, type ProviderId } from '../config';
import { authHeaders } from './auth';
import type { EditSpec, Job, MediaItem, Project, PublishOutcome, PublishSettings, ScriptParams, ScriptResult } from '../types';

// Client API verso il backend. Tutti gli errori arrivano già in italiano dal server;
// qui li normalizziamo e gestiamo retry/timeout dei casi di rete.

export class ApiError extends Error {}

async function request<T>(path: string, init?: RequestInit, timeoutMs = 60000): Promise<T> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${API_URL}${path}`, {
      ...init,
      headers: { ...(init?.headers as Record<string, string> | undefined), ...authHeaders() },
      signal: ctrl.signal,
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new ApiError((body as { error?: string }).error ?? `Errore del server (${res.status})`);
    }
    return body as T;
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw new ApiError('Rete non raggiungibile: controlla la connessione e che il backend sia avviato.');
  } finally {
    clearTimeout(t);
  }
}

/** Modifica lo script esistente con un'istruzione (es. "più corto"). */
export const rewriteScript = (body: ScriptParams & { script: string; title: string; instruction: string }) =>
  request<ScriptResult>('/api/script/rewrite', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }, 120000);

/** Genera lo script con retry automatico su errori 429 (quota) e 5xx. */
export async function generateScript(params: ScriptParams): Promise<ScriptResult> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await request<ScriptResult>('/api/script', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      }, 120000);
    } catch (e) {
      lastErr = e;
      const msg = e instanceof Error ? e.message : '';
      // Solo per errori recuperabili (quota/rate limit o server): backoff esponenziale.
      if (/quota|429|richiest|server \(5/.test(msg)) {
        await new Promise((r) => setTimeout(r, 2000 * 2 ** attempt));
        continue;
      }
      throw e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new ApiError('Errore sconosciuto');
}

/** Carica il video grezzo e avvia il job di montaggio, con progress reale dell'upload. */
export function uploadForEdit(
  videoUri: string,
  meta: Pick<Project, 'id' | 'language' | 'duration' | 'scriptResult'>,
  onProgress: (pct: number) => void,
): Promise<{ jobId: string }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const form = new FormData();
    form.append('video', { uri: videoUri, name: 'raw.mp4', type: 'video/mp4' } as unknown as Blob);
    form.append('projectId', meta.id);
    form.append('language', meta.language);
    if (meta.scriptResult) {
      form.append('title', meta.scriptResult.title);
      form.append('hashtags', JSON.stringify(meta.scriptResult.hashtags));
    }
    xhr.open('POST', `${API_URL}/api/edit`);
    for (const [k, v] of Object.entries(authHeaders())) xhr.setRequestHeader(k, v);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      try {
        const body = JSON.parse(xhr.responseText || '{}');
        if (xhr.status >= 200 && xhr.status < 300) resolve(body);
        else reject(new Error(body.error ?? `Errore del server (${xhr.status})`));
      } catch {
        reject(new Error('Risposta non valida dal server'));
      }
    };
    xhr.onerror = () => reject(new Error('Upload interrotto: controlla la connessione al backend.'));
    xhr.send(form);
  });
}

// Il backend restituisce percorsi relativi (/media/...): il player sul telefono
// ha bisogno dell'URL completo del backend.
export const mediaUrl = (u?: string) => (u && u.startsWith('/') ? `${API_URL}${u}` : u);

export const getJob = async (jobId: string) => {
  const j = await request<Job>(`/api/edit/${encodeURIComponent(jobId)}`, {}, 15000);
  return { ...j, finalVideoUrl: mediaUrl(j.finalVideoUrl), previewUrl: mediaUrl(j.previewUrl) };
};

/** Carica una foto o un video della galleria da inserire nel montaggio. */
export function uploadMedia(
  jobId: string,
  file: { uri: string; name: string; type: string },
  onProgress: (pct: number) => void,
): Promise<MediaItem> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const form = new FormData();
    form.append('file', file as unknown as Blob);
    xhr.open('POST', `${API_URL}/api/edit/${encodeURIComponent(jobId)}/media`);
    for (const [k, v] of Object.entries(authHeaders())) xhr.setRequestHeader(k, v);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      try {
        const body = JSON.parse(xhr.responseText || '{}');
        if (xhr.status >= 200 && xhr.status < 300) resolve(body);
        else reject(new Error(body.error ?? `Errore del server (${xhr.status})`));
      } catch {
        reject(new Error('Risposta non valida dal server'));
      }
    };
    xhr.onerror = () => reject(new Error('Upload interrotto: controlla la connessione al backend.'));
    xhr.send(form);
  });
}

/** L'IA trasforma una richiesta a parole in modifiche (non applicate finché non si fa renderEdit). */
/** Indirizzo di un media caricato, per l'anteprima live. */
/** Sorgente per <Image> di un media del montaggio (col login nell'header). */
export const jobMediaSource = (jobId: string, mediaId: string, cutout = false) => ({
  uri: `${API_URL}/api/edit/${encodeURIComponent(jobId)}/media/${encodeURIComponent(mediaId)}${cutout ? '?cutout=1' : ''}`,
  headers: authHeaders(),
});

export const aiEdit = (jobId: string, instruction: string, spec: EditSpec) =>
  request<{ spec: EditSpec; summary: string; notes?: string; media?: MediaItem[] }>(`/api/edit/${encodeURIComponent(jobId)}/ai`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ instruction, spec }),
  }, 120000);

/** Rifà l'export finale con le modifiche: poi si segue l'avanzamento con getJob. */
export const renderEdit = (jobId: string, spec: EditSpec) =>
  request<{ ok: boolean }>(`/api/edit/${encodeURIComponent(jobId)}/render`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ spec }),
  });

export interface PublishRequest {
  jobId: string;
  providers: ProviderId[];
  title: string;
  description: string;
  hashtags: string[];
  settings?: PublishSettings;
}

export const publishVideo = (body: PublishRequest) =>
  request<{ results: PublishOutcome[] }>('/api/publish', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }, 300000);

/** Quali social sono già collegati sul backend. */
export const linkedProviders = () =>
  request<Record<ProviderId, boolean>>('/api/auth/status', {}, 15000);

/** URL da aprire nel browser per collegare un social (OAuth2). */
/** Link per collegare un social: con gli account attivi include un biglietto monouso. */
/** Senza returnTo il link è da aprire su un altro dispositivo (es. il computer) e vale 10 minuti. */
export async function authUrl(provider: ProviderId, returnTo?: string): Promise<string> {
  const base = `${API_URL}/api/auth/${provider}?return=${encodeURIComponent(returnTo ?? '')}`;
  if (!authHeaders().Authorization) return base;
  const { ticket } = await request<{ ticket: string }>('/api/auth/ticket', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ computer: !returnTo }),
  }, 15000);
  return `${base}&ticket=${encodeURIComponent(ticket)}`;
}

/** Salva sul backend i token YouTube ottenuti con il login Google. */
export const saveGoogleYouTube = (t: { accessToken: string; refreshToken?: string }) =>
  request<{ ok: boolean; message: string }>('/api/auth/youtube/google', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(t),
  }, 20000);

export const getAccount = () => request<{ id: string; email: string | null; admin: boolean }>('/api/account', {}, 15000);

export interface Wallet {
  coins: number | null; // null = senza limiti (admin o senza account)
  unlimited: boolean;
  costs: Record<'script' | 'rewrite' | 'edit' | 'ai' | 'render' | 'publish', number>;
  history: { delta: number; reason: string; created_at: string }[];
}
export const getWallet = () => request<Wallet>('/api/account/coins', {}, 15000);

export interface ServerVideo { id: string; title: string | null; status: string; expired: boolean; expires_at: string | null }
export const listServerVideos = () => request<{ videos: ServerVideo[] }>('/api/account/videos', {}, 15000).then((r) => r.videos);

export const deleteAccount = () => request<{ ok: boolean }>('/api/account', { method: 'DELETE' }, 60000);

/** Scollega un social dal backend. */
export const unlinkProvider = (provider: ProviderId) =>
  request<{ ok: boolean }>(`/api/auth/${provider}`, { method: 'DELETE' }, 15000);

/** Modmail & bug report, con screenshot facoltativo. */
export async function sendReport(r: {
  kind: 'bug' | 'idea' | 'message'; text: string; contact?: string; device?: string; appVersion?: string;
  screenshot?: { uri: string; name: string; type: string };
}): Promise<void> {
  const form = new FormData();
  form.append('kind', r.kind);
  form.append('text', r.text);
  if (r.contact) form.append('contact', r.contact);
  if (r.device) form.append('device', r.device);
  if (r.appVersion) form.append('appVersion', r.appVersion);
  if (r.screenshot) form.append('screenshot', r.screenshot as unknown as Blob);
  await request<{ ok: boolean }>('/api/report', { method: 'POST', body: form }, 60000);
}
