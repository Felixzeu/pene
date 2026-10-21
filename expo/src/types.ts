import type { ProviderId } from './config';

export type Tone = 'Energico' | 'Professionale' | 'Divertente' | 'Ispiratore' | 'Educativo';
export type TargetDuration = 30 | 60 | 90;
export type Platform = 'reels' | 'tiktok' | 'shorts' | 'facebook';

export interface ScriptResult {
  script: string;
  title: string;
  hashtags: string[];
}

export interface ScriptParams {
  topic: string;
  tone: string;
  duration: TargetDuration;
  platform: string;
  language: string;
}

export type JobStage = 'queued' | 'transcribing' | 'editing' | 'ready' | 'error';

export interface Word {
  word: string;
  start: number; // secondi sul timeline del video tagliato
  end: number;
}

export interface Job {
  jobId: string;
  stage: JobStage;
  progress: number; // 0..1
  message?: string;
  finalVideoUrl?: string;
  previewUrl?: string; // video tagliato senza sottotitoli incollati, per l'anteprima live
  words?: Word[];      // timeline delle parole per i sottotitoli in tempo reale
  title?: string;
  hashtags?: string[];
}

export type SocialStatus = 'idle' | 'publishing' | 'published' | 'error';

export interface PublishOutcome {
  provider: ProviderId;
  status: SocialStatus;
  url?: string;
  message?: string;
}

export type ProjectStage =
  | 'script'
  | 'record'
  | 'review'
  | 'edit'
  | 'publish';

export interface Project {
  id: string;
  topic: string;
  tone: string;
  duration: TargetDuration;
  platform: string;
  language: string;
  scriptResult?: ScriptResult;
  rawVideoUri?: string;
  jobId?: string;
  finalVideoUrl?: string;
  published?: PublishOutcome[];
  createdAt: number;
}

export interface HistoryEntry extends Project {}
