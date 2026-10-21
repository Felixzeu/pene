import { EventEmitter } from 'events';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs';
import path from 'path';
import type { Word } from './whisper';
import type { EditSpec, MediaItem } from './render';

// Coda dei lavori con concorrenza 1: il montaggio video è pesante sulla CPU
// (soprattutto sui piani di hosting gratuiti), quindi un job alla volta.

export type JobStage = 'queued' | 'transcribing' | 'editing' | 'ready' | 'error';

export interface Job {
  jobId: string;
  projectId: string;
  stage: JobStage;
  progress: number; // 0..1
  message?: string;
  warning?: string;      // avviso da mostrare a montaggio finito (es. video senza audio)
  finalVideoUrl?: string;
  previewUrl?: string;   // video già tagliato (senza sottotitoli incollati) per l'anteprima live
  words?: Word[];        // timeline delle parole rimappata sul video tagliato
  title?: string;
  hashtags?: string[];
  language: string;
  rawPath: string;
  finalPath?: string;
  sourcePath?: string;   // video tagliato e ripulito da cui si rifà l'export finale
  duration?: number;     // durata di sourcePath in secondi
  spec?: EditSpec;       // modifiche applicate all'export finale
  media?: MediaItem[];   // immagini/video caricati dall'utente
  version: number;       // aumenta a ogni export, per non far usare all'app il video in cache
  createdAt: number;
}

type Task = (job: Job, report: (stage: JobStage, progress: number, message?: string) => void) => Promise<void>;

const emitter = new EventEmitter();

const jobs = new Map<string, Job>();
const queue: Array<{ job: Job; task?: Task }> = [];
let running = false;

// I lavori vengono salvati su disco: dopo un riavvio del backend i video montati
// restano modificabili e pubblicabili (finché i file non vengono puliti, 24 ore).
const JOBS_FILE = path.join('data', 'jobs.json');
const MAX_AGE = 24 * 3600 * 1000;
let saveTimer: NodeJS.Timeout | undefined;

/** Salva tutti i lavori su disco (con un piccolo ritardo per raggruppare le modifiche). */
export function saveJobs(): void {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = undefined;
    try {
      mkdirSync(path.dirname(JOBS_FILE), { recursive: true });
      const list = [...jobs.values()].filter((j) => Date.now() - j.createdAt < MAX_AGE);
      writeFileSync(`${JOBS_FILE}.tmp`, JSON.stringify(list));
      renameSync(`${JOBS_FILE}.tmp`, JOBS_FILE);
    } catch (e) {
      console.error('[jobs] salvataggio non riuscito:', e);
    }
  }, 300);
}

function loadJobs(): void {
  let list: Job[] = [];
  try { list = JSON.parse(readFileSync(JOBS_FILE, 'utf8')) as Job[]; } catch { return; }
  let restored = 0;
  for (const job of list) {
    if (Date.now() - job.createdAt > MAX_AGE) continue;
    if (job.stage === 'ready' || job.stage === 'error') {
      if (job.stage === 'ready' && job.finalPath && !existsSync(job.finalPath)) continue; // file già pulito
    } else if (job.finalPath && existsSync(job.finalPath)) {
      // Un nuovo export era in corso: resta valido quello precedente.
      job.stage = 'ready'; job.progress = 1; job.message = undefined;
    } else if (existsSync(job.rawPath)) {
      // Montaggio interrotto dal riavvio: si riparte da capo.
      job.stage = 'queued'; job.progress = 0;
      queue.push({ job });
    } else {
      job.stage = 'error';
      job.message = 'Montaggio interrotto dal riavvio del server: carica di nuovo il video.';
    }
    jobs.set(job.jobId, job);
    restored++;
  }
  if (restored) console.log(`[jobs] ${restored} lavori ripristinati da ${JOBS_FILE}`);
}
loadJobs();

export function createJob(params: Pick<Job, 'projectId' | 'language' | 'rawPath' | 'title' | 'hashtags'>): Job {
  const job: Job = {
    jobId: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    stage: 'queued',
    progress: 0,
    ...params,
    version: 0,
    createdAt: Date.now(),
  };
  jobs.set(job.jobId, job);
  queue.push({ job });
  saveJobs();
  pump();
  return job;
}

/** Rimette in coda un job già montato con un lavoro diverso (es. nuovo export con le modifiche). */
export function requeue(job: Job, task: Task): void {
  job.stage = 'queued';
  job.progress = 0;
  job.message = undefined;
  queue.push({ job, task });
  pump();
}

export function getJob(jobId: string): Job | undefined {
  return jobs.get(jobId);
}

function report(job: Job) {
  return (stage: JobStage, progress: number, message?: string) => {
    if (job.stage !== stage) saveJobs();
    job.stage = stage;
    job.progress = progress;
    job.message = message;
    emitter.emit(`job:${job.jobId}`, job);
  };
}

async function pump() {
  if (running) return;
  const entry = queue.shift();
  if (!entry) return;
  const next = entry.job;
  running = true;
  const rep = report(next);
  try {
    await (entry.task ?? runTask)(next, rep);
    next.stage = 'ready';
    next.progress = 1;
    next.version += 1;
    next.finalVideoUrl = `/media/${encodeURIComponent(next.jobId)}.mp4?v=${next.version}`;
    next.finalPath = `${process.cwd()}/public/videos/${next.jobId}.mp4`;
  } catch (e) {
    next.stage = 'error';
    next.message = e instanceof Error ? e.message : 'Montaggio non riuscito.';
  } finally {
    running = false;
    saveJobs();
    pump();
  }
}

// Registrata da lib/ffmpeg per non creare dipendenze circolari.
let taskImpl: Task = async () => { throw new Error('Pipeline di montaggio non registrata'); };
export function registerTask(impl: Task) { taskImpl = impl; pump(); }
async function runTask(job: Job, rep: ReturnType<typeof report>) { return taskImpl(job, rep); }
