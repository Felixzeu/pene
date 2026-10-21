import { Router } from 'express';
import { promises as fs } from 'fs';
import path from 'path';
import { z } from 'zod';
import { config, paths } from '../lib/config-bridge';
import { getJob } from '../lib/queue';
import { publishTo } from '../publishers';
import { AppError, ERR } from '../lib/errors';

const schema = z.object({
  jobId: z.string().min(1),
  providers: z.array(z.enum(['youtube', 'instagram', 'facebook', 'tiktok'])).min(1),
  title: z.string().min(1).max(100),
  description: z.string().max(2200).default(''),
  hashtags: z.array(z.string().max(40)).max(15).default([]),
});

export const publishRouter = Router();

// POST /api/publish — pubblica sui social scelti, uno per volta.
// Ogni social è indipendente: se uno fallisce gli altri proseguono.
publishRouter.post('/', async (req, res, next) => {
  try {
    const body = schema.parse(req.body);
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

    // Il link temporaneo può essere rimosso dopo la pubblicazione (finale + anteprima live).
    fs.rm(job.finalPath, { force: true }).catch(() => { /* già rimosso */ });
    fs.rm(path.join(paths.videos, `${job.jobId}-preview.mp4`), { force: true }).catch(() => { /* già rimosso */ });

    res.json({ results });
  } catch (e) {
    next(e);
  }
});
