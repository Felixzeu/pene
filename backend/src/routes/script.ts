import { Router } from 'express';
import { z } from 'zod';
import { generateScript } from '../lib/llm';

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
    const out = await generateScript(params);
    res.json(out);
  } catch (e) {
    next(e);
  }
});
