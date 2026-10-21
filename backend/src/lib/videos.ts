import { dbEnabled, select, update, upsert } from './db';
import { currentUser } from './user';
import type { Job } from './queue';

// Archivio dei video su Supabase: il file sul server sparisce dopo 24 ore,
// ma il video resta nell'elenco (titolo, durata, dove è stato pubblicato) come "scaduto".

const FILE_TTL = 24 * 3600 * 1000;
const tracked = (userId?: string) => dbEnabled() && !!userId && userId !== 'local';
const log = (e: unknown) => console.error('[videos]', e instanceof Error ? e.message : e);

/** Salva (o aggiorna) il video quando il montaggio è pronto. */
export function recordVideo(job: Job): void {
  if (!tracked(job.userId)) return;
  upsert('videos', {
    id: job.jobId,
    user_id: job.userId,
    project_id: job.projectId,
    title: job.title ?? null,
    duration: job.duration ?? null,
    expired: false,
    expires_at: new Date(Date.now() + FILE_TTL).toISOString(),
  }).catch(log);
}

/** Aggiunge le pubblicazioni riuscite al video. */
export async function markPublished(jobId: string, done: Array<{ provider: string; url?: string }>): Promise<void> {
  const u = currentUser();
  if (!tracked(u.id) || !done.length) return;
  try {
    const [row] = await select<{ published: unknown[] }>('videos', `id=eq.${encodeURIComponent(jobId)}&user_id=eq.${u.id}&select=published`);
    if (!row) return;
    const at = new Date().toISOString();
    await update('videos', `id=eq.${encodeURIComponent(jobId)}&user_id=eq.${u.id}`, {
      status: 'published',
      published: [...(row.published ?? []), ...done.map((d) => ({ provider: d.provider, url: d.url ?? null, at }))],
    });
  } catch (e) { log(e); }
}

/** Segna come scaduti i video il cui file è stato cancellato dal server. */
export function expireOld(): void {
  if (!dbEnabled()) return;
  const now = new Date().toISOString();
  update('videos', `expired=eq.false&expires_at=lt.${now}`, { expired: true, expired_at: now }).catch(log);
}

/** I video dell'utente, dal più recente. */
export async function listVideos() {
  const u = currentUser();
  if (!tracked(u.id)) return [];
  return select<Record<string, unknown>>('videos',
    `user_id=eq.${u.id}&select=id,project_id,title,duration,status,published,expired,created_at,expires_at,expired_at&order=created_at.desc&limit=200`);
}
