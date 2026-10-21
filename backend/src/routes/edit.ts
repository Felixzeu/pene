import express, { Router } from 'express';
import multer from 'multer';
import path from 'path';
import { promises as fs } from 'fs';
import { z } from 'zod';
import { paths } from '../config';
import { createJob, getJob, requeue, saveJobs } from '../lib/queue';
import { probeDuration, renderFinal, specSchema, type MediaItem } from '../lib/render';
import { generateEditSpec } from '../lib/llm';
import { AppError, ERR } from '../lib/errors';
import { fetchWebImage } from '../lib/webmedia';
import { prepareImage } from '../lib/cutout';
import { currentUser } from '../lib/user';
import { charge, withCoins } from '../lib/coins';

// 200 MB per tutti, 2 GB per gli amministratori.
const uploader = (field: string) => {
  const normal = multer({ dest: paths.tmp, limits: { fileSize: 200 * 1024 * 1024 } }).single(field) as unknown as express.RequestHandler;
  const admin = multer({ dest: paths.tmp, limits: { fileSize: 2048 * 1024 * 1024 } }).single(field) as unknown as express.RequestHandler;
  return ((req, res, next) => (currentUser().admin ? admin : normal)(req, res, next)) as express.RequestHandler;
};

const metaSchema = z.object({
  projectId: z.string().min(1).max(80),
  language: z.string().min(2).max(30).default('Italiano'),
  title: z.string().max(200).optional(),
  hashtags: z.string().optional(), // JSON stringificato
});

export const editRouter = Router();

// POST /api/edit — riceve il video grezzo e mette in coda il montaggio.
editRouter.post('/', uploader('video'), async (req, res, next) => {
  try {
    if (!req.file) throw new AppError(ERR.noFile, 400);
    const meta = metaSchema.parse(req.body);
    const paid = await charge('edit').catch(async (e) => { await fs.rm(req.file!.path, { force: true }); throw e; });

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
    }, paid ? { amount: paid, action: 'edit' } : undefined);
    res.json({ jobId: job.jobId });
  } catch (e) {
    next(e);
  }
});

// GET /api/edit/:jobId — stato del job per il polling dell'app.
editRouter.get('/:jobId', (req, res) => {
  const job = getJob(req.params.jobId ?? '');
  if (!job) {
    console.warn(`[edit] stato di ${req.params.jobId}: lavoro non trovato per l'utente ${currentUser().id}`);
    res.status(404).json({ error: ERR.jobNotFound });
    return;
  }
  res.json({
    jobId: job.jobId,
    stage: job.stage,
    progress: job.progress,
    message: job.message,
    warning: job.warning,
    finalVideoUrl: job.finalVideoUrl ? `${job.finalVideoUrl}` : undefined,
    previewUrl: job.previewUrl ? `${job.previewUrl}` : undefined,
    words: job.stage === 'ready' || job.previewUrl ? job.words : undefined,
    title: job.title,
    hashtags: job.hashtags,
    spec: job.spec,
    duration: job.duration,
    media: job.media?.map(mediaInfo),
  });
});

// ── Modifiche dopo il primo montaggio ────────────────────────────────────


function readyJob(jobId: string | undefined) {
  const job = getJob(jobId ?? '');
  if (!job?.sourcePath) throw new AppError(ERR.jobNotFound, 404);
  if (job.stage !== 'ready' && job.stage !== 'error') throw new AppError('Il video è ancora in lavorazione: aspetta che finisca.', 409);
  return job;
}

/** Quello che l'app sa di un media (niente percorsi del server). */
const mediaInfo = ({ id, kind, name, duration, aspect, cutoutPath, cutoutAspect }: MediaItem) =>
  ({ id, kind, name, duration, aspect, cutout: !!cutoutPath, cutoutAspect });

// POST /api/edit/:jobId/media — carica una foto o un video da inserire nel montaggio.
editRouter.post('/:jobId/media', uploader('file'), async (req, res, next) => {
  try {
    const job = getJob(req.params.jobId ?? '');
    if (!job?.sourcePath) throw new AppError(ERR.jobNotFound, 404);
    if (!req.file) throw new AppError(ERR.noFile, 400);
    const mime = req.file.mimetype ?? '';
    const ext = (path.extname(req.file.originalname || '') || (mime.startsWith('video') ? '.mov' : '.jpg')).toLowerCase();
    const kind = mime.startsWith('video') || ['.mov', '.mp4', '.m4v'].includes(ext) ? 'video'
      : mime.startsWith('image') || ['.jpg', '.jpeg', '.png', '.heic', '.webp'].includes(ext) ? 'image'
        : null;
    if (!kind) { await fs.rm(req.file.path, { force: true }); throw new AppError(ERR.mediaUnsupported, 415); }

    const dir = path.join(paths.media, job.jobId);
    await fs.mkdir(dir, { recursive: true });
    const id = `m${(job.media?.length ?? 0) + 1}`;
    const dest = path.join(dir, `${id}${ext}`);
    await fs.rename(req.file.path, dest);
    // Le foto vengono anche scontornate (soggetto senza sfondo) per incollarle sul video.
    const item = await prepareImage({ id, kind, name: (req.file.originalname || id).slice(0, 80), path: dest, duration: kind === 'video' ? await probeDuration(dest) : undefined });
    job.media = [...(job.media ?? []), item];
    saveJobs();
    res.json(mediaInfo(item));
  } catch (e) {
    next(e);
  }
});

// GET /api/edit/:jobId/media/:mediaId — il file di un media, per l'anteprima live nell'app.
editRouter.get('/:jobId/media/:mediaId', (req, res, next) => {
  const job = getJob(req.params.jobId ?? '');
  const m = job?.media?.find((x) => x.id === req.params.mediaId);
  if (!m) { next(new AppError('Media non trovato.', 404)); return; }
  const file = req.query.cutout === '1' && m.cutoutPath ? m.cutoutPath : m.path;
  res.sendFile(path.resolve(file), { maxAge: '1h' });
});

// POST /api/edit/:jobId/ai — l'IA traduce una richiesta a parole in una spec di montaggio.
editRouter.post('/:jobId/ai', async (req, res, next) => {
  try {
    const job = readyJob(req.params.jobId);
    const body = z.object({ instruction: z.string().min(3).max(1000), spec: specSchema }).parse(req.body);
    const out = await withCoins('ai', () => generateEditSpec({
      instruction: body.instruction,
      spec: body.spec,
      words: job.words ?? [],
      duration: job.duration ?? 0,
      media: (job.media ?? []).map(mediaInfo),
      fetchImage: (q) => fetchWebImage(job, q),
    }));
    saveJobs();
    res.json({ ...out, media: (job.media ?? []).map(mediaInfo) });
  } catch (e) {
    next(e);
  }
});

// POST /api/edit/:jobId/render — rifà l'export finale con le modifiche (in coda, un job alla volta).
editRouter.post('/:jobId/render', async (req, res, next) => {
  try {
    const job = readyJob(req.params.jobId);
    const spec = specSchema.parse(req.body?.spec);
    const paid = await charge('render');
    requeue(job, async (j, report) => {
      report('editing', 0.3, 'Applico le modifiche…');
      await renderFinal(j, spec);
      report('editing', 0.98, 'Fatto');
    }, paid ? { amount: paid, action: 'render' } : undefined);
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});
