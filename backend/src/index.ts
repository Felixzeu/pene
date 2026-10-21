import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { MulterError } from 'multer';
import { ZodError } from 'zod';
import path from 'path';
import { promises as fs } from 'fs';
import { config, paths } from './config';
import { scriptRouter } from './routes/script';
import { editRouter } from './routes/edit';
import { publishRouter } from './routes/publish';
import { authRouter } from './routes/auth';
import { reportRouter } from './routes/report';
import { accountRouter } from './routes/account';
import { accountsEnabled, isAdminRequest, requireUser } from './lib/user';
import { AppError, ERR } from './lib/errors';
import { expireOld } from './lib/videos';
import './lib/ffmpeg'; // registra la pipeline di montaggio sulla coda

const app = express();
// Dietro Cloudflare Tunnel: l'IP reale arriva in X-Forwarded-For (serve al rate limit).
app.set('trust proxy', 1);
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
  // Gli amministratori non hanno limiti; lo stato del montaggio (letto ogni 3 secondi) non conta.
  skip: (req) => (req.method === 'GET' && /^\/edit\/[^/]+$/.test(req.path)) || isAdminRequest(req),
}));

// Il video montato è servito con link temporaneo (scaricabile dai social
// che lo richiedono: Instagram, Facebook).
app.use('/media', express.static(path.resolve(paths.videos), {
  maxAge: '1h',
  setHeaders: (res) => { res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin'); },
}));

app.get('/api/health', (_req, res) => res.json({ ok: true, provider: config.llmProvider, accounts: accountsEnabled() }));

// Tutto richiede il login (se gli account Supabase sono attivi), tranne i login dei social
// che si aprono nel browser: quelli usano un biglietto monouso (vedi routes/auth.ts).
app.use('/api/script', requireUser, scriptRouter);
app.use('/api/edit', requireUser, editRouter);
app.use('/api/publish', requireUser, publishRouter);
app.use('/api/auth', authRouter);
app.use('/api/report', requireUser, reportRouter);
app.use('/api/account', requireUser, accountRouter);

// Error handler centrale: messaggi sempre in italiano, log su stderr.
app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (err instanceof ZodError) {
    console.error(`[api] 400: ${err.issues.map((i) => i.path.join('.')).join(', ')}`);
    res.status(400).json({ error: 'Dati non validi: controlla i campi e riprova.' });
    return;
  }
  if (err instanceof MulterError && err.code === 'LIMIT_FILE_SIZE') {
    res.status(413).json({ error: ERR.videoTooLarge });
    return;
  }
  if (err instanceof AppError) {
    console.error(`[api] ${err.status}: ${err.message}`);
    res.status(err.status).json({ error: err.message });
    return;
  }
  console.error('[api] errore inatteso:', err);
  res.status(500).json({ error: 'Errore inatteso del server: riprova tra poco.' });
});

// Pulizia automatica: file temporanei dopo 2 ore, video montati dopo 24 ore.
async function cleanOlderThan(dir: string, maxAgeMs: number) {
  try {
    const files = await fs.readdir(dir);
    const now = Date.now();
    for (const f of files) {
      const full = path.join(dir, f);
      const st = await fs.stat(full);
      if (now - st.mtimeMs > maxAgeMs) await fs.rm(full, { recursive: true });
    }
  } catch { /* la cartella non esiste ancora */ }
}
setInterval(() => {
  cleanOlderThan(paths.tmp, 2 * 3600 * 1000);
  cleanOlderThan(paths.videos, 24 * 3600 * 1000);
  cleanOlderThan(paths.media, 24 * 3600 * 1000);
  expireOld(); // nell'archivio su Supabase i video restano, segnati come scaduti
}, 30 * 60 * 1000).unref();

fs.mkdir(paths.tmp, { recursive: true }).then(() => {
  app.listen(config.port, () => {
    console.log(`CreatorPrompt backend su http://localhost:${config.port} (LLM: ${config.llmProvider})`);
  });
});
