import { listPages, NO_PAGE_HINT } from '../publishers/metaPages';
import { Router } from 'express';
import { randomBytes } from 'crypto';
import { config } from '../config';
import { isLinked, loadToken, removeToken, saveToken } from '../lib/tokens';
import { AppError, ERR } from '../lib/errors';

// OAuth2 per i social. L'app apre la pagina di consenso nel browser;
// il token arriva qui in callback e viene salvato cifrato. Mai password.

type Provider = 'youtube' | 'instagram' | 'facebook' | 'tiktok';

// Stato anti-CSRF in memoria (sessioni di 10 minuti).
const pending = new Map<string, { provider: Provider; verifier?: string; createdAt: number; returnTo?: string }>();
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of pending) if (now - v.createdAt > 600000) pending.delete(k);
}, 60000).unref();

export const authRouter = Router();


const page = (msg: string) =>
  `<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="font-family:sans-serif;background:#0B0A0E;color:#F5F3EE;display:grid;place-items:center;height:100vh;margin:0;padding:24px;text-align:center"><h2>${msg}</h2></body></html>`;

// GET /api/auth/status — quali social sono già collegati (anche se collegati da un altro dispositivo).
authRouter.get('/status', async (_req, res) => {
  const providers: Provider[] = ['youtube', 'instagram', 'facebook', 'tiktok'];
  const entries = await Promise.all(providers.map(async (p) => [p, await isLinked(p)] as const));
  res.json(Object.fromEntries(entries));
});

// Dall'app il login si apre in una finestra di sistema (ASWebAuthenticationSession):
// a fine login si torna all'app con un link exp:// o viral://, che chiude la finestra.
const RETURN_OK = /^(exp|exps|viral):\/\/[^\s]{1,300}$/;
function backToApp(res: import('express').Response, returnTo: string, provider: string, ok: boolean, message: string) {
  const sep = returnTo.includes('?') ? '&' : '?';
  res.redirect(`${returnTo}${sep}provider=${encodeURIComponent(provider)}&status=${ok ? 'ok' : 'error'}&message=${encodeURIComponent(message.slice(0, 300))}`);
}

authRouter.get('/:provider', (req, res) => {
  const provider = req.params.provider as Provider;
  const state = randomBytes(16).toString('hex');
  const ret = typeof req.query.return === 'string' && RETURN_OK.test(req.query.return) ? req.query.return : undefined;
  const o = config.oauth;

  // Chiavi mancanti: meglio un messaggio chiaro qui che un errore criptico del social.
  const keyName = { youtube: 'YOUTUBE_CLIENT_ID', instagram: 'META_APP_ID', facebook: 'META_APP_ID', tiktok: 'TIKTOK_CLIENT_KEY' }[provider];
  const keyValue = provider === 'tiktok' ? o.tiktok.clientKey : o[provider]?.clientId;
  if (keyName && !keyValue) {
    res.status(400).send(page(`Manca ${keyName} nel file backend/.env: inseriscila e riavvia il backend.`));
    return;
  }
  if (keyName && !config.publicUrl.startsWith('https://')) {
    res.status(400).send(page('PUBLIC_URL nel file backend/.env deve essere l URL https di Cloudflare Tunnel: impostalo e riavvia il backend.'));
    return;
  }

  if (provider === 'youtube') {
    pending.set(state, { provider, createdAt: Date.now(), returnTo: ret });
    const url = 'https://accounts.google.com/o/oauth2/v2/auth' +
      `?client_id=${o.youtube.clientId}&redirect_uri=${encodeURIComponent(o.youtube.redirect)}` +
      '&response_type=code&access_type=offline&prompt=consent' +
      `&scope=${encodeURIComponent(o.youtube.scope)}&state=${state}`;
    res.redirect(url);
    return;
  }

  if (provider === 'instagram' || provider === 'facebook') {
    const cfg = provider === 'instagram' ? o.instagram : o.facebook;
    pending.set(state, { provider, createdAt: Date.now(), returnTo: ret });
    const url = 'https://www.facebook.com/v21.0/dialog/oauth' +
      `?client_id=${cfg.clientId}&redirect_uri=${encodeURIComponent(cfg.redirect)}` +
      `&scope=${encodeURIComponent(cfg.scope)}&state=${state}&response_type=code` +
      '&auth_type=rerequest'; // richiede di nuovo i permessi e la scelta delle Pagine se erano stati saltati
    res.redirect(url);
    return;
  }

  if (provider === 'tiktok') {
    // App "Web" di TikTok: niente PKCE (è solo per app desktop/mobile, e con un
    // code_challenge non atteso TikTok mostra "Page not available"). Basta il client_secret.
    pending.set(state, { provider, createdAt: Date.now(), returnTo: ret });
    const url = 'https://www.tiktok.com/v2/auth/authorize/' +
      `?client_key=${encodeURIComponent(o.tiktok.clientKey)}&response_type=code` +
      `&scope=${encodeURIComponent(o.tiktok.scope)}` +
      `&redirect_uri=${encodeURIComponent(o.tiktok.redirect)}&state=${state}`;
    // Utile per confrontare il redirect_uri con quello registrato su developers.tiktok.com.
    console.log(`[auth] TikTok: redirect_uri=${o.tiktok.redirect} scope=${o.tiktok.scope}`);
    res.redirect(url);
    return;
  }

  res.status(400).send(ERR.badProvider);
});

// Funzione condivisa dai callback: scambia il code con il token.
export async function exchangeCode(provider: Provider, code: string): Promise<void> {
  const o = config.oauth;
  if (provider === 'youtube') {
    const r = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: o.youtube.clientId,
        client_secret: o.youtube.clientSecret,
        redirect_uri: o.youtube.redirect,
        grant_type: 'authorization_code',
      }),
    });
    const d = (await r.json()) as { access_token?: string; refresh_token?: string };
    if (!d.access_token) throw new AppError('Autorizzazione YouTube non riuscita.', 400);
    await saveToken('youtube', d.access_token, d.refresh_token);
    return;
  }

  if (provider === 'instagram' || provider === 'facebook') {
    const cfg = provider === 'instagram' ? o.instagram : o.facebook;
    const r = await fetch('https://graph.facebook.com/v21.0/oauth/access_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: cfg.clientId,
        client_secret: cfg.clientSecret,
        redirect_uri: cfg.redirect,
      }),
    });
    const d = (await r.json()) as { access_token?: string };
    if (!d.access_token) throw new AppError(`Autorizzazione ${provider} non riuscita.`, 400);
    // Token a lungo termine (60 giorni, rinnovabile gratuitamente).
    const lt = await fetch(`https://graph.facebook.com/v21.0/oauth/access_token?grant_type=fb_exchange_token&client_id=${cfg.clientId}&client_secret=${cfg.clientSecret}&fb_exchange_token=${d.access_token}`);
    const ltData = (await lt.json()) as { access_token?: string };
    await saveToken(provider, ltData.access_token ?? d.access_token);
    return;
  }

  // TikTok (app Web: client_secret, niente PKCE)
  const r = await fetch(`${'https://open.tiktokapis.com/v2'}/oauth/token/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_key: o.tiktok.clientKey,
      client_secret: o.tiktok.clientSecret,
      redirect_uri: o.tiktok.redirect,
      grant_type: 'authorization_code',
    }),
  });
  // L'API v2 risponde con i campi al primo livello: {access_token, refresh_token, open_id, ...};
  // in caso di errore: {error, error_description, log_id}.
  const d = (await r.json().catch(() => ({}))) as {
    access_token?: string; refresh_token?: string; error?: string; error_description?: string;
    data?: { access_token?: string; refresh_token?: string };
  };
  const access = d.access_token ?? d.data?.access_token;
  if (!access) {
    console.error('[auth] TikTok token:', r.status, JSON.stringify(d));
    throw new AppError(`Autorizzazione TikTok non riuscita: ${d.error_description ?? d.error ?? `errore ${r.status}`}`, 400);
  }
  await saveToken('tiktok', access, d.refresh_token ?? d.data?.refresh_token);
}

// I callback verificano lo state (anti-CSRF) e completano lo scambio del codice.
authRouter.get('/:provider/callback', async (req, res, next) => {
  let returnTo: string | undefined;
  try {
    const provider = req.params.provider as Provider;
    const { code, state, error_description } = req.query as { code?: string; state?: string; error_description?: string };
    returnTo = state ? pending.get(state)?.returnTo : undefined;
    if (error_description || !code || !state) throw new AppError(`Autorizzazione annullata: ${error_description ?? 'nessun codice ricevuto'}`, 400);
    const sess = pending.get(state);
    if (!sess || sess.provider !== provider) throw new AppError('Sessione di autorizzazione scaduta: riprova.', 400);
    pending.delete(state);
    returnTo = sess.returnTo;
    const reply = (ok: boolean, msg: string) => (returnTo ? backToApp(res, returnTo, provider, ok, msg) : res.send(page(msg)));

    await exchangeCode(provider, code);

    // Meta: controlla subito che la Pagina (e l'account Instagram) siano stati condivisi.
    if (provider === 'instagram' || provider === 'facebook') {
      const { accessToken } = await loadToken(provider);
      const pages = await listPages(accessToken, provider).catch(() => []);
      const ig = pages.find((p) => p.instagram_business_account?.id);
      if (pages.length === 0) { reply(false, `Accesso fatto, ma ${NO_PAGE_HINT}`); return; }
      if (provider === 'instagram' && !ig) {
        reply(false, `Accesso fatto, ma la Pagina ${pages[0].name ?? ''} non ha un account Instagram professionale collegato.`);
        return;
      }
      reply(true, `Account collegato! Pagina: ${(ig ?? pages[0]).name ?? 'ok'}.`);
      return;
    }

    reply(true, 'Account collegato!');
  } catch (e) {
    // Si apre nel browser: meglio una pagina leggibile che JSON.
    if (e instanceof AppError) {
      if (returnTo) { backToApp(res, returnTo, req.params.provider ?? '', false, e.message); return; }
      res.status(e.status).send(page(e.message));
      return;
    }
    next(e);
  }
});

// DELETE /api/auth/:provider — scollega il social.
authRouter.delete('/:provider', async (req, res, next) => {
  try {
    const provider = req.params.provider;
    if (!['youtube', 'instagram', 'facebook', 'tiktok'].includes(provider)) throw new AppError(ERR.badProvider, 400);
    await removeToken(provider);
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});
