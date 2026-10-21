import express, { Router } from 'express';
import multer from 'multer';
import path from 'path';
import { promises as fs } from 'fs';
import { z } from 'zod';
import { paths } from '../config';
import { createJob, getJob } from '../lib/queue';
import { AppError, ERR } from '../lib/errors';

const upload = multer({
  dest: paths.tmp,
  limits: { fileSize: 200 * 1024 * 1024 }, // 200 MB
});

const metaSchema = z.object({
  projectId: z.string().min(1).max(80),
  language: z.string().min(2).max(30).default('Italiano'),
  title: z.string().max(200).optional(),
  hashtags: z.string().optional(), // JSON stringificato
});

export const editRouter = Router();

// POST /api/edit — riceve il video grezzo e mette in coda il montaggio.
editRouter.post('/', upload.single('video') as unknown as express.RequestHandler, async (req, res, next) => {
  try {
    if (!req.file) throw new AppError(ERR.noFile, 400);
    const meta = metaSchema.parse(req.body);

    // Sposta il file temporaneo con un nome stabile.
    const rawPath = path.join(paths.tmp, `${Date.now().toString(36)}-raw.mp4`);
    await fs.rename(req.file.path, rawPath);

    let hashtags: string[] = [];
    try { hashtags = JSON.parse(meta.hashtags ?? '[]'); } catch { /* opzionale */ }

    const job = createJob({
      projectId: meta.projectId,
      language: meta.language,
      rawPath,
      title: meta.title,
      hashtags,
    });
    res.json({ jobId: job.jobId });
  } catch (e) {
    next(e);
  }
});

// GET /api/edit/:jobId — stato del job per il polling dell'app.
editRouter.get('/:jobId', (req, res) => {
  const job = getJob(req.params.jobId ?? '');
  if (!job) { res.status(404).json({ error: ERR.jobNotFound }); return; }
  res.json({
    jobId: job.jobId,
    stage: job.stage,
    progress: job.progress,
    message: job.message,
    finalVideoUrl: job.finalVideoUrl ? `${job.finalVideoUrl}` : undefined,
    previewUrl: job.previewUrl ? `${job.previewUrl}` : undefined,
    words: job.stage === 'ready' || job.previewUrl ? job.words : undefined,
    title: job.title,
    hashtags: job.hashtags,
  });
});
