import { cleanTitle, normalizeHashtags } from '../lib/tags';
import { Router } from 'express';
import { z } from 'zod';
import { config } from '../lib/config-bridge';
import { getJob } from '../lib/queue';
import { publishTo } from '../publishers';
import { AppError, ERR } from '../lib/errors';

const schema = z.object({
  jobId: z.string().min(1),
  providers: z.array(z.enum(['youtube', 'instagram', 'facebook', 'tiktok'])).min(1),
  title: z.string().min(1).max(100),
  description: z.string().max(2200).default(''),
  hashtags: z.array(z.string().max(40)).max(15).default([]),
  settings: z.object({
    youtube: z.object({
      privacy: z.enum(['public', 'unlisted', 'private']).optional(),
      madeForKids: z.boolean().optional(),
      notifySubscribers: z.boolean().optional(),
      category: z.string().regex(/^\d{1,3}$/).optional(),
    }).optional(),
    instagram: z.object({ shareToFeed: z.boolean().optional() }).optional(),
    facebook: z.object({ state: z.enum(['PUBLISHED', 'DRAFT']).optional() }).optional(),
    tiktok: z.object({
      disableComment: z.boolean().optional(),
      disableDuet: z.boolean().optional(),
      disableStitch: z.boolean().optional(),
    }).optional(),
  }).default({}),
});

export const publishRouter = Router();

// POST /api/publish — pubblica sui social scelti, uno per volta.
// Ogni social è indipendente: se uno fallisce gli altri proseguono.
publishRouter.post('/', async (req, res, next) => {
  try {
    const body = schema.parse(req.body);
    // L'app si chiama viral: #viral sempre presente, in testa e senza doppioni.
    body.hashtags = normalizeHashtags(body.hashtags);
    body.title = cleanTitle(body.title, 100) || 'Nuovo video';
    const job = getJob(body.jobId);
    if (!job?.finalPath) throw new AppError(ERR.jobNotFound, 404);

    // URL pubblico temporaneo: i social (Instagram/Facebook) scaricano il video da qui.
    const videoUrl = `${config.publicUrl}/media/${encodeURIComponent(job.jobId)}.mp4`;

    const results = await Promise.all(
      body.providers.map(async (provider) => {
        try {
          const out = await publishTo(provider, {
            title: body.title,
            description: body.description,
            hashtags: body.hashtags,
            videoUrl,
            filePath: job.finalPath as string,
            language: job.language,
            settings: body.settings,
          });
          return { provider, status: 'published' as const, url: out.url, message: out.message };
        } catch (e) {
          return {
            provider,
            status: 'error' as const,
            message: e instanceof Error ? e.message : 'Errore sconosciuto',
          };
        }
      }),
    );

    // Il video resta su disco per permettere "Riprova" o altri social:
    // la pulizia periodica in index.ts lo rimuove dopo 24 ore.

    res.json({ results });
  } catch (e) {
    next(e);
  }
});
