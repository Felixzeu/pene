import { Router } from 'express';
import { randomBytes, createHash } from 'crypto';
import { config } from '../config';
import { saveToken } from '../lib/tokens';
import { AppError, ERR } from '../lib/errors';

// OAuth2 per i social. L'app apre la pagina di consenso nel browser;
// il token arriva qui in callback e viene salvato cifrato. Mai password.

type Provider = 'youtube' | 'instagram' | 'facebook' | 'tiktok';

// Stato anti-CSRF + PKCE per TikTok, in memoria (sessioni di 10 minuti).
const pending = new Map<string, { provider: Provider; verifier?: string; createdAt: number }>();
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of pending) if (now - v.createdAt > 600000) pending.delete(k);
}, 60000).unref();

export const authRouter = Router();

const BASE64URL = (b: Buffer) => b.toString('base64url');

const page = (msg: string) =>
  `<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="font-family:sans-serif;background:#0B0A0E;color:#F5F3EE;display:grid;place-items:center;height:100vh;margin:0;padding:24px;text-align:center"><h2>${msg}</h2></body></html>`;

authRouter.get('/:provider', (req, res) => {
  const provider = req.params.provider as Provider;
  const state = randomBytes(16).toString('hex');
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
    pending.set(state, { provider, createdAt: Date.now() });
    const url = 'https://accounts.google.com/o/oauth2/v2/auth' +
      `?client_id=${o.youtube.clientId}&redirect_uri=${encodeURIComponent(o.youtube.redirect)}` +
      '&response_type=code&access_type=offline&prompt=consent' +
      `&scope=${encodeURIComponent(o.youtube.scope)}&state=${state}`;
    res.redirect(url);
    return;
  }

  if (provider === 'instagram' || provider === 'facebook') {
    const cfg = provider === 'instagram' ? o.instagram : o.facebook;
    pending.set(state, { provider, createdAt: Date.now() });
    const url = 'https://www.facebook.com/v21.0/dialog/oauth' +
      `?client_id=${cfg.clientId}&redirect_uri=${encodeURIComponent(cfg.redirect)}` +
      `&scope=${encodeURIComponent(cfg.scope)}&state=${state}&response_type=code`;
    res.redirect(url);
    return;
  }

  if (provider === 'tiktok') {
    // PKCE obbligatorio per TikTok.
    const verifier = BASE64URL(randomBytes(32));
    const challenge = BASE64URL(createHash('sha256').update(verifier).digest());
    pending.set(state, { provider, verifier, createdAt: Date.now() });
    const url = 'https://www.tiktok.com/v2/auth/authorize/' +
      `?client_key=${o.tiktok.clientKey}&redirect_uri=${encodeURIComponent(o.tiktok.redirect)}` +
      `&scope=${encodeURIComponent(o.tiktok.scope)}&state=${state}` +
      '&response_type=code&code_challenge=' + challenge + '&code_challenge_method=S256';
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

  // TikTok con PKCE
  const r = await fetch(`${'https://open.tiktokapis.com/v2'}/oauth/token/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_key: o.tiktok.clientKey,
      client_secret: o.tiktok.clientSecret,
      redirect_uri: o.tiktok.redirect,
      grant_type: 'authorization_code',
      code_verifier: '', // riempito dal caller tramite pending
    }),
  });
  const d = (await r.json()) as { data?: { access_token?: string; refresh_token?: string } };
  if (!d.data?.access_token) throw new AppError('Autorizzazione TikTok non riuscita.', 400);
  await saveToken('tiktok', d.data.access_token, d.data.refresh_token);
}

// I callback usano lo state per recuperare il verifier PKCE e completare lo scambio.
authRouter.get('/:provider/callback', async (req, res, next) => {
  try {
    const provider = req.params.provider as Provider;
    const { code, state, error_description } = req.query as { code?: string; state?: string; error_description?: string };
    if (error_description || !code || !state) throw new AppError(`Autorizzazione annullata: ${error_description ?? 'nessun codice ricevuto'}`, 400);
    const sess = pending.get(state);
    if (!sess || sess.provider !== provider) throw new AppError('Sessione di autorizzazione scaduta: riprova.', 400);
    pending.delete(state);

    if (provider === 'tiktok' && sess.verifier) {
      // Scambio TikTok con verifier PKCE corretto.
      const o = config.oauth;
      const r = await fetch('https://open.tiktokapis.com/v2/oauth/token/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_key: o.tiktok.clientKey,
          client_secret: o.tiktok.clientSecret,
          redirect_uri: o.tiktok.redirect,
          grant_type: 'authorization_code',
          code_verifier: sess.verifier,
        }),
      });
      const d = (await r.json()) as { data?: { access_token?: string; refresh_token?: string } };
      if (!d.data?.access_token) throw new AppError('Autorizzazione TikTok non riuscita.', 400);
      await saveToken('tiktok', d.data.access_token, d.data.refresh_token);
    } else {
      await exchangeCode(provider, code);
    }

    res.send(page('Account collegato! Puoi tornare nell app.'));
  } catch (e) {
    next(e);
  }
});
