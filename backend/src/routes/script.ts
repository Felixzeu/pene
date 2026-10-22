import { Router } from 'express';
import { z } from 'zod';
import { generateScript, rewriteScript } from '../lib/llm';
import { withCoins } from '../lib/coins';

const schema = z.object({
  topic: z.string().min(5).max(500),
  tone: z.string().min(2).max(40),
  duration: z.union([z.literal(30), z.literal(60), z.literal(90)]),
  platform: z.string().min(2).max(40),
  language: z.string().min(2).max(30),
});

export const scriptRouter = Router();

scriptRouter.post('/', async (req, res, next) => {
  try {
    const params = schema.parse(req.body);
    const out = await withCoins('script', () => generateScript(params));
    res.json(out);
  } catch (e) {
    next(e);
  }
});

const rewriteSchema = z.object({
  script: z.string().min(1).max(6000),
  title: z.string().max(200).default(''),
  instruction: z.string().min(2).max(500),
  tone: z.string().min(2).max(40),
  duration: z.number().int().min(5).max(600),
  platform: z.string().min(2).max(40),
  language: z.string().min(2).max(30),
});

// POST /api/script/rewrite — modifica lo script già scritto senza ripartire da zero.
scriptRouter.post('/rewrite', async (req, res, next) => {
  try {
    const params = rewriteSchema.parse(req.body);
    res.json(await withCoins('rewrite', () => rewriteScript(params)));
  } catch (e) {
    next(e);
  }
});
