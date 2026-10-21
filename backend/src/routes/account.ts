import { Router } from 'express';
import { accountsEnabled, currentUser, deleteSupabaseUser } from '../lib/user';
import { removeAllTokens } from '../lib/tokens';
import { removeUserJobs } from '../lib/queue';

// Account dell'utente: chi sono e "Elimina account" (obbligatorio per l'App Store).
export const accountRouter = Router();

// GET /api/account — l'utente collegato.
accountRouter.get('/', (_req, res) => {
  const u = currentUser();
  res.json({ id: u.id, email: u.email ?? null, accounts: accountsEnabled() });
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
