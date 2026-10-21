import { API_URL, type ProviderId } from '../config';
import type { Job, Project, PublishOutcome, ScriptParams, ScriptResult } from '../types';

// Client API verso il backend. Tutti gli errori arrivano già in italiano dal server;
// qui li normalizziamo e gestiamo retry/timeout dei casi di rete.

export class ApiError extends Error {}

async function request<T>(path: string, init?: RequestInit, timeoutMs = 60000): Promise<T> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${API_URL}${path}`, { ...init, signal: ctrl.signal });
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

export const getJob = (jobId: string) =>
  request<Job>(`/api/edit/${encodeURIComponent(jobId)}`, {}, 15000);

export interface PublishRequest {
  jobId: string;
  providers: ProviderId[];
  title: string;
  description: string;
  hashtags: string[];
}

export const publishVideo = (body: PublishRequest) =>
  request<{ results: PublishOutcome[] }>('/api/publish', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }, 300000);

/** URL da aprire nel browser per collegare un social (OAuth2). */
export const authUrl = (provider: ProviderId) => `${API_URL}/api/auth/${provider}`;
