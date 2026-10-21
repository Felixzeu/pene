import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import path from 'path';
import { promises as fs } from 'fs';
import { config, paths } from './config';
import { scriptRouter } from './routes/script';
import { editRouter } from './routes/edit';
import { publishRouter } from './routes/publish';
import { authRouter } from './routes/auth';
import { AppError } from './lib/errors';
import './lib/ffmpeg'; // registra la pipeline di montaggio sulla coda

const app = express();
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(cors());
app.use(express.json({ limit: '1mb' }));

// Rate limiting per proteggere CPU e chiavi (tutti piani gratuiti, nessun costo).
app.use('/api', rateLimit({
  windowMs: 60_000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Troppe richieste: aspetta un minuto e riprova.' },
}));

// Il video montato è servito con link temporaneo (scaricabile dai social
// che lo richiedono: Instagram, Facebook).
app.use('/media', express.static(path.resolve(paths.videos), {
  maxAge: '1h',
  setHeaders: (res) => { res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin'); },
}));

app.get('/api/health', (_req, res) => res.json({ ok: true, provider: config.llmProvider }));

app.use('/api/script', scriptRouter);
app.use('/api/edit', editRouter);
app.use('/api/publish', publishRouter);
app.use('/api/auth', authRouter);

// Error handler centrale: messaggi sempre in italiano, log su stderr.
app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (err instanceof AppError) {
    console.error(`[api] ${err.status}: ${err.message}`);
    res.status(err.status).json({ error: err.message });
    return;
  }
  console.error('[api] errore inatteso:', err);
  res.status(500).json({ error: 'Errore inatteso del server: riprova tra poco.' });
});

// Pulizia automatica dei file temporanei più vecchi di 2 ore.
setInterval(async () => {
  try {
    const files = await fs.readdir(paths.tmp);
    const now = Date.now();
    for (const f of files) {
      const full = path.join(paths.tmp, f);
      const st = await fs.stat(full);
      if (now - st.mtimeMs > 2 * 3600 * 1000) await fs.rm(full, { recursive: true });
    }
  } catch { /* tmp non esiste ancora */ }
}, 30 * 60 * 1000).unref();

fs.mkdir(paths.tmp, { recursive: true }).then(() => {
  app.listen(config.port, () => {
    console.log(`CreatorPrompt backend su http://localhost:${config.port} (LLM: ${config.llmProvider})`);
  });
});
