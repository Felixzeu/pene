import express, { Router } from 'express';
import multer from 'multer';
import path from 'path';
import { promises as fs } from 'fs';
import { z } from 'zod';
import { paths } from '../config';

// Modmail & bug report: i messaggi dall'app finiscono in data/reports/ e,
// se c'è REPORT_WEBHOOK_URL (un webhook Discord), arrivano anche lì come modmail.

const upload = multer({ dest: paths.tmp, limits: { fileSize: 15 * 1024 * 1024 } });

const schema = z.object({
  kind: z.enum(['bug', 'idea', 'message']),
  text: z.string().min(3).max(4000),
  contact: z.string().max(200).optional(),
  device: z.string().max(200).optional(),
  appVersion: z.string().max(40).optional(),
});

const LABEL = { bug: '🐞 Bug', idea: '💡 Idea', message: '✉️ Modmail' } as const;

export const reportRouter = Router();

reportRouter.post('/', upload.single('screenshot') as unknown as express.RequestHandler, async (req, res, next) => {
  try {
    const body = schema.parse(req.body);
    const id = `${new Date().toISOString().replace(/[:.]/g, '-')}-${Math.random().toString(36).slice(2, 6)}`;
    const dir = path.join('data', 'reports');
    await fs.mkdir(dir, { recursive: true });
    let shot: string | undefined;
    if (req.file) {
      shot = path.join(dir, `${id}${path.extname(req.file.originalname || '.jpg') || '.jpg'}`);
      await fs.rename(req.file.path, shot);
    }
    await fs.writeFile(path.join(dir, `${id}.json`), JSON.stringify({ id, ...body, screenshot: shot, at: new Date().toISOString() }, null, 2));
    console.log(`[report] ${LABEL[body.kind]} ${id}: ${body.text.slice(0, 80)}`);

    const hook = process.env.REPORT_WEBHOOK_URL;
    if (hook) {
      const content = `**${LABEL[body.kind]}** da viral\n${body.text}\n` +
        (body.contact ? `Contatto: ${body.contact}\n` : '') +
        `Dispositivo: ${body.device ?? '?'} · app ${body.appVersion ?? '?'}`;
      const form = new FormData();
      form.append('payload_json', JSON.stringify({ content: content.slice(0, 1900), allowed_mentions: { parse: [] } }));
      if (shot) form.append('files[0]', new Blob([await fs.readFile(shot)]), path.basename(shot));
      await fetch(hook, { method: 'POST', body: form }).then((r) => {
        if (!r.ok) console.error(`[report] webhook ${r.status}`);
      }).catch((e) => console.error('[report] webhook non raggiungibile:', e));
    }
    res.json({ ok: true, id });
  } catch (e) {
    next(e);
  }
});
