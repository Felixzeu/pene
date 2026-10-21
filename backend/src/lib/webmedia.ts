import path from 'path';
import { promises as fs } from 'fs';
import { paths } from '../config';
import { AppError } from './errors';
import type { Job } from './queue';
import type { MediaItem } from './render';

// Immagini prese da internet quando l'utente chiede qualcosa che non ha caricato
// ("metti una foto della Torre Eiffel"). Fonti gratuite e senza chiave:
// Openverse (immagini con licenza libera) e, in alternativa, Wikimedia Commons.

const UA = 'viral-app/1.0 (video editor; contact via app)';
const MAX_BYTES = 15 * 1024 * 1024;

async function openverse(query: string): Promise<string[]> {
  const r = await fetch(
    `https://api.openverse.org/v1/images/?q=${encodeURIComponent(query)}&page_size=8&license_type=commercial&mature=false`,
    { headers: { 'User-Agent': UA } },
  );
  if (!r.ok) throw new Error(`openverse ${r.status}`);
  const d = (await r.json()) as { results?: { url?: string; filetype?: string }[] };
  return (d.results ?? [])
    .filter((x) => x.url && (!x.filetype || ['jpg', 'jpeg', 'png', 'webp'].includes(x.filetype)))
    .map((x) => x.url as string);
}

async function commons(query: string): Promise<string[]> {
  const r = await fetch(
    'https://commons.wikimedia.org/w/api.php?action=query&format=json&generator=search&gsrnamespace=6&gsrlimit=8' +
      `&gsrsearch=${encodeURIComponent(`${query} filetype:bitmap`)}&prop=imageinfo&iiprop=url|mime&iiurlwidth=1080`,
    { headers: { 'User-Agent': UA } },
  );
  if (!r.ok) throw new Error(`commons ${r.status}`);
  const d = (await r.json()) as { query?: { pages?: Record<string, { imageinfo?: { thumburl?: string; url?: string; mime?: string }[] }> } };
  return Object.values(d.query?.pages ?? {})
    .map((p) => p.imageinfo?.[0])
    .filter((i) => i && /image\/(jpeg|png|webp)/.test(i.mime ?? ''))
    .map((i) => (i?.thumburl ?? i?.url) as string)
    .filter(Boolean);
}

/** Cerca un'immagine online e la aggiunge ai media del lavoro. */
export async function fetchWebImage(job: Job, query: string): Promise<MediaItem> {
  let urls: string[] = [];
  for (const source of [openverse, commons]) {
    try {
      urls = await source(query);
      if (urls.length) break;
    } catch (e) {
      console.warn(`[web] ricerca "${query}" fallita su ${source.name}:`, e instanceof Error ? e.message : e);
    }
  }
  for (const url of urls.slice(0, 4)) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': UA }, redirect: 'follow' });
      const type = r.headers.get('content-type') ?? '';
      if (!r.ok || !/^image\/(jpeg|png|webp)/.test(type)) continue;
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.length > MAX_BYTES || buf.length < 2000) continue;
      const ext = type.includes('png') ? '.png' : type.includes('webp') ? '.webp' : '.jpg';
      const dir = path.join(paths.media, job.jobId);
      await fs.mkdir(dir, { recursive: true });
      const id = `w${(job.media?.length ?? 0) + 1}`;
      const dest = path.join(dir, `${id}${ext}`);
      await fs.writeFile(dest, buf);
      const item: MediaItem = { id, kind: 'image', name: `${query} (da internet)`.slice(0, 80), path: dest };
      job.media = [...(job.media ?? []), item];
      console.log(`[web] "${query}" → ${url}`);
      return item;
    } catch { /* prova il risultato successivo */ }
  }
  throw new AppError(`Non ho trovato online un'immagine adatta per "${query}": caricala dalla galleria.`, 422);
}
