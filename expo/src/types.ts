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

// Modifiche all'export finale. Tempi in secondi sul video finale (dopo il taglio di inizio).
export interface TextItem {
  id: string;
  text: string;
  start: number;
  end: number;
  position: 'top' | 'center' | 'bottom';
  size: 'small' | 'medium' | 'large';
  x?: number; // centro scelto trascinando, px su 1080×1920 (al posto di position)
  y?: number;
  color?: string; // "#RRGGBB", bianco se manca
  bg?: string; // riquadro dietro il testo, "#RRGGBB" (nessuno se manca)
  fs?: number; // grandezza scelta con le maniglie, px su 1080×1920 (al posto di size)
}

export interface OverlayItem {
  id: string;
  mediaId: string;
  start: number;
  end: number;
  mode: 'full' | 'pip';
  position?: 'top-left' | 'top-right' | 'center' | 'bottom-left' | 'bottom-right';
  search?: string; // immagine cercata online dall'IA
  cutout?: boolean; // foto: usa la versione senza sfondo (default sì, se disponibile)
  x?: number; // centro e larghezza scelti a mano, px su 1080×1920
  y?: number;
  w?: number;
}

export type StickerKind = 'follow' | 'like' | 'subscribe' | 'comment' | 'share' | 'link';
export interface StickerItem {
  id: string;
  kind: StickerKind;
  label?: string;
  start: number;
  end: number;
  position: 'top' | 'center' | 'bottom';
}

export interface EditSpec {
  trimStart: number;
  trimEnd: number;
  subtitles: boolean;
  /** Aspetto dei sottotitoli: x/y = centro e fs = grandezza scelti nell'anteprima (px su 1080×1920). */
  subStyle?: { size: 'small' | 'medium' | 'large'; color?: string; x?: number; y?: number; fs?: number };
  texts: TextItem[];
  overlays: OverlayItem[];
  stickers: StickerItem[];
}

export interface MediaItem {
  id: string;
  kind: 'image' | 'video';
  name: string;
  duration?: number;
  aspect?: number; // altezza / larghezza
  cutout?: boolean; // il backend ha preparato la versione scontornata
  cutoutAspect?: number;
}

export interface Job {
  jobId: string;
  stage: JobStage;
  progress: number; // 0..1
  message?: string;
  warning?: string;   // es. video registrato senza audio
  finalVideoUrl?: string;
  previewUrl?: string; // video tagliato senza sottotitoli incollati, per l'anteprima live
  words?: Word[];      // timeline delle parole per i sottotitoli in tempo reale
  title?: string;
  hashtags?: string[];
  spec?: EditSpec;
  duration?: number;   // durata del video tagliato, prima del taglio di inizio/fine
  media?: MediaItem[];
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

/** Impostazioni di pubblicazione per social, ricordate tra un video e l'altro. */
export interface PublishSettings {
  youtube: { privacy: 'public' | 'unlisted' | 'private'; madeForKids: boolean; notifySubscribers: boolean; category: string };
  instagram: { shareToFeed: boolean };
  facebook: { state: 'PUBLISHED' | 'DRAFT' };
  tiktok: { disableComment: boolean; disableDuet: boolean; disableStitch: boolean };
}
