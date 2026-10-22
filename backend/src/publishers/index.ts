import { AppError, ERR } from '../lib/errors';
import { loadToken } from '../lib/tokens';
import { youtubePublish } from './youtube';
import { instagramPublish } from './instagram';
import { facebookPublish } from './facebook';
import { tiktokPublish } from './tiktok';

// Ogni social è un modulo indipendente con la stessa interfaccia:
// se uno fallisce, gli altri pubblicano comunque.

export interface PublishMeta {
  title: string;
  description: string;
  hashtags: string[];
  videoUrl: string;      // URL pubblico temporaneo del video montato
  filePath: string;      // percorso locale del file (per API che accettano upload diretto)
  language: string;
  settings: PublishSettings;
}

/** Impostazioni scelte nell'app per ogni social (tutte facoltative). */
export interface PublishSettings {
  youtube?: { privacy?: 'public' | 'unlisted' | 'private'; madeForKids?: boolean; notifySubscribers?: boolean; category?: string };
  instagram?: { shareToFeed?: boolean };
  facebook?: { state?: 'PUBLISHED' | 'DRAFT' };
  tiktok?: { disableComment?: boolean; disableDuet?: boolean; disableStitch?: boolean };
}

export interface PublishResult { url?: string; message?: string }

export type Publisher = (meta: PublishMeta) => Promise<PublishResult>;

const publishers: Record<string, Publisher> = {
  youtube: youtubePublish,
  instagram: instagramPublish,
  facebook: facebookPublish,
  tiktok: tiktokPublish,
};

export async function publishTo(provider: string, meta: PublishMeta): Promise<PublishResult> {
  const impl = publishers[provider];
  if (!impl) throw new AppError(ERR.badProvider, 400);
  await loadToken(provider).catch(() => { throw new AppError(ERR.notLinked, 401); });
  return impl(meta);
}
