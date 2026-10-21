import { EventEmitter } from 'events';
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
    pump();
  }
}

// Registrata da lib/ffmpeg per non creare dipendenze circolari.
let taskImpl: Task = async () => { throw new Error('Pipeline di montaggio non registrata'); };
export function registerTask(impl: Task) { taskImpl = impl; }
async function runTask(job: Job, rep: ReturnType<typeof report>) { return taskImpl(job, rep); }
