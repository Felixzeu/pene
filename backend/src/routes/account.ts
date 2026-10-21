import { Router } from 'express';
import { accountsEnabled, currentUser, deleteSupabaseUser } from '../lib/user';
import { removeAllTokens } from '../lib/tokens';
import { removeUserJobs } from '../lib/queue';
import { wallet } from '../lib/coins';
import { listVideos } from '../lib/videos';

// Account dell'utente: chi sono e "Elimina account" (obbligatorio per l'App Store).
export const accountRouter = Router();

// GET /api/account — l'utente collegato.
accountRouter.get('/', (_req, res) => {
  const u = currentUser();
  res.json({ id: u.id, email: u.email ?? null, admin: Boolean(u.admin), accounts: accountsEnabled() });
});

// DELETE /api/account — cancella social collegati, video e l'account Supabase.
accountRouter.delete('/', async (_req, res, next) => {
  try {
    const u = currentUser();
    const jobs = await removeUserJobs();
    await removeAllTokens();
    if (accountsEnabled()) await deleteSupabaseUser(u.id);
    console.log(`[account] eliminato ${u.id} (${jobs} video)`);
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

// GET /api/account/coins — saldo, listino e ultimi movimenti.
accountRouter.get('/coins', async (_req, res, next) => {
  try { res.json(await wallet()); } catch (e) { next(e); }
});

// GET /api/account/videos — tutti i video, anche quelli scaduti (file cancellato dopo 24 ore).
accountRouter.get('/videos', async (_req, res, next) => {
  try { res.json({ videos: await listVideos() }); } catch (e) { next(e); }
});
