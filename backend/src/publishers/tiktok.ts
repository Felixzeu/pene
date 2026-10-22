import { hashtagLine } from '../lib/tags';
import { statSync, promises as fsp } from 'fs';
import { AppError, ERR } from '../lib/errors';
import { freshAccessToken } from '../lib/tokens';
import type { PublishMeta, PublishResult } from './index';

// TikTok Content Posting API (gratuita), Direct Post: il video viene pubblicato subito
// come PRIVATO (SELF_ONLY). Finché l'app non è approvata da TikTok (audit) funziona
// solo se anche l'account TikTok è privato.

const API = 'https://open.tiktokapis.com/v2';

type TikTokInit = {
  data?: { publish_id?: string; upload_url?: string };
  error?: { code?: string; message?: string; log_id?: string };
};

async function post<T>(path: string, token: string, body: unknown): Promise<T> {
  const r = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json; charset=UTF-8' },
    body: JSON.stringify(body),
  });
  return (await r.json().catch(() => ({}))) as T;
}

// Regole TikTok: un solo pezzo se il file è <= 64 MB, altrimenti pezzi da 10 MB
// (l'ultimo assorbe il resto). Il corpo è un Buffer: con gli stream Node il PUT
// può partire vuoto e TikTok scarta il video senza dirlo.
function chunking(size: number) {
  const chunk = size <= 64_000_000 ? size : 10_000_000;
  return { chunk, count: Math.max(1, Math.floor(size / chunk)) };
}

async function upload(url: string, filePath: string, size: number): Promise<void> {
  const data = await fsp.readFile(filePath);
  const { chunk, count } = chunking(size);
  for (let i = 0; i < count; i++) {
    const from = i * chunk;
    const to = i === count - 1 ? size - 1 : from + chunk - 1;
    const res = await fetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'video/mp4', 'Content-Range': `bytes ${from}-${to}/${size}` },
      body: data.subarray(from, to + 1),
    });
    console.log(`[tiktok] upload pezzo ${i + 1}/${count}: HTTP ${res.status}`);
    if (!res.ok && res.status !== 206) {
      const txt = await res.text().catch(() => '');
      throw new AppError(ERR.publishFailed('TikTok', `upload ${res.status} ${txt.slice(0, 120)}`), 502);
    }
  }
}

type Status = { data?: { status?: string; fail_reason?: string }; error?: { code?: string; message?: string } };

/** Aspetta che TikTok confermi davvero il video (fino a ~90 s). */
async function waitStatus(token: string, publishId: string): Promise<string> {
  let last = '';
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    const s = await post<Status>('/post/publish/status/fetch/', token, { publish_id: publishId });
    const st = s.data?.status ?? s.error?.code ?? 'sconosciuto';
    if (st !== last) console.log(`[tiktok] stato ${publishId}: ${st}${s.data?.fail_reason ? ` (${s.data.fail_reason})` : ''}`);
    last = st;
    if (st === 'FAILED') {
      throw new AppError(ERR.publishFailed('TikTok', `TikTok ha scartato il video: ${s.data?.fail_reason ?? 'motivo non indicato'}`), 502);
    }
    if (st === 'SEND_TO_USER_INBOX' || st === 'PUBLISH_COMPLETE') return st;
  }
  return last;
}

/** Chi pubblica su TikTok: le linee guida chiedono di mostrarlo prima della pubblicazione. */
export async function tiktokCreator(): Promise<{ nickname: string | null; avatar: string | null; canPost: boolean; maxSeconds: number | null }> {
  const token = await freshAccessToken('tiktok');
  const r = await post<{
    data?: { creator_nickname?: string; creator_avatar_url?: string; max_video_post_duration_sec?: number };
    error?: { code?: string; message?: string };
  }>('/post/publish/creator_info/query/', token, {});
  const code = r.error?.code;
  return {
    nickname: r.data?.creator_nickname ?? null,
    avatar: r.data?.creator_avatar_url ?? null,
    // spam_risk_too_many_posts, reached_active_user_cap...: TikTok in questo momento non accetta post da questo account.
    canPost: !code || code === 'ok',
    maxSeconds: r.data?.max_video_post_duration_sec ?? null,
  };
}

export const tiktokPublish = async (meta: PublishMeta): Promise<PublishResult> => {
  const accessToken = await freshAccessToken('tiktok');
  const caption = [meta.title, meta.description, hashtagLine(meta.hashtags)].filter(Boolean).join('\n').slice(0, 2200);
  const size = statSync(meta.filePath).size;
  const { chunk, count } = chunking(size);
  const source_info = { source: 'FILE_UPLOAD', video_size: size, chunk_size: chunk, total_chunk_count: count };

  // 1. Le linee guida chiedono di leggere prima le opzioni del creator.
  const creator = await post<{ data?: { privacy_level_options?: string[] }; error?: { code?: string; message?: string } }>(
    '/post/publish/creator_info/query/', accessToken, {},
  );
  if (creator.error?.code && creator.error.code !== 'ok') {
    console.error('[tiktok] creator_info:', JSON.stringify(creator.error));
    throw new AppError(ERR.publishFailed('TikTok', tiktokHint(creator.error.code, creator.error.message)), 502);
  }

  // 2. Direct Post, sempre PRIVATO (solo tu): si pubblica subito appena premi Pubblica.
  const direct = await post<TikTokInit>('/post/publish/video/init/', accessToken, {
    post_info: {
      title: caption,
      privacy_level: 'SELF_ONLY',
      disable_comment: meta.settings.tiktok?.disableComment ?? false,
      disable_duet: meta.settings.tiktok?.disableDuet ?? false,
      disable_stitch: meta.settings.tiktok?.disableStitch ?? false,
    },
    source_info,
  });
  if (!direct.data?.upload_url || !direct.data.publish_id) {
    console.error('[tiktok] direct post rifiutato:', JSON.stringify(direct.error ?? direct));
    throw new AppError(ERR.publishFailed('TikTok', tiktokHint(direct.error?.code, direct.error?.message)), 502);
  }
  await upload(direct.data.upload_url, meta.filePath, size);
  const st = await waitStatus(accessToken, direct.data.publish_id);
  if (st !== 'PUBLISH_COMPLETE') {
    throw new AppError(ERR.publishFailed('TikTok', `TikTok sta ancora elaborando il video (stato ${st}). Controlla tra qualche minuto nel tuo profilo.`), 502);
  }
  return {
    url: 'https://www.tiktok.com/',
    message: 'Pubblicato su TikTok come video privato: lo trovi nel tuo profilo (visibile solo a te).',
  };
};

/** Spiegazione in italiano dei rifiuti più comuni di TikTok. */
function tiktokHint(code?: string, message?: string): string {
  switch (code) {
    case 'unaudited_client_can_only_post_to_private_accounts':
      return 'metti l account TikTok su privato per pubblicare direttamente (TikTok > Profilo > menu > Impostazioni e privacy > Privacy > Account privato), poi premi Riprova.';
    case 'scope_not_authorized':
    case 'access_token_invalid':
      return 'il collegamento a TikTok non ha i permessi per pubblicare: premi Collega su TikTok e autorizza di nuovo.';
    case 'spam_risk_too_many_posts':
    case 'spam_risk_user_banned_from_posting':
      return 'TikTok ha bloccato temporaneamente le pubblicazioni da questo account: riprova più tardi.';
    case 'privacy_level_option_mismatch':
      return 'TikTok non permette video privati su questo account.';
    case 'rate_limit_exceeded':
      return 'troppe richieste a TikTok: aspetta un minuto e riprova.';
    default:
      return `${code ?? ''} ${message ?? 'errore sconosciuto'}`.trim().slice(0, 160);
  }
}
