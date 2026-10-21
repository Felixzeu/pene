import { hashtagLine } from '../lib/tags';
import { statSync, promises as fsp } from 'fs';
import { AppError, ERR } from '../lib/errors';
import { freshAccessToken } from '../lib/tokens';
import type { PublishMeta, PublishResult } from './index';

// TikTok Content Posting API (gratuita). LIMITI delle app non ancora approvate (audit):
//  - Direct Post: solo video PRIVATI (SELF_ONLY) e solo se l'account TikTok è privato;
//  - in alternativa "Upload" (inbox): il video arriva nelle notifiche/bozze di TikTok
//    e lo pubblichi tu dall'app TikTok, senza vincoli sull'account.
// Qui si prova il Direct Post e, se TikTok lo rifiuta per questi limiti, si passa all'Upload.

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

export const tiktokPublish = async (meta: PublishMeta): Promise<PublishResult> => {
  const accessToken = await freshAccessToken('tiktok');
  const caption = [meta.title, meta.description, hashtagLine(meta.hashtags)].filter(Boolean).join('\n').slice(0, 2200);
  const size = statSync(meta.filePath).size;
  const { chunk, count } = chunking(size);
  const source_info = { source: 'FILE_UPLOAD', video_size: size, chunk_size: chunk, total_chunk_count: count };

  // 1. Le linee guida chiedono di leggere prima le opzioni del creator (privacy consentite ecc.).
  const creator = await post<{ data?: { privacy_level_options?: string[] }; error?: { code?: string } }>(
    '/post/publish/creator_info/query/', accessToken, {},
  );
  const options = creator.data?.privacy_level_options ?? [];
  const privacy = options.includes('SELF_ONLY') ? 'SELF_ONLY' : options[0] ?? 'SELF_ONLY';

  // 2. Direct Post.
  const direct = await post<TikTokInit>('/post/publish/video/init/', accessToken, {
    post_info: {
      title: caption,
      privacy_level: privacy, // privato: obbligatorio per app non approvate
      disable_comment: false,
      disable_duet: false,
      disable_stitch: false,
    },
    source_info,
  });
  if (direct.data?.upload_url && direct.data.publish_id) {
    await upload(direct.data.upload_url, meta.filePath, size);
    const st = await waitStatus(accessToken, direct.data.publish_id);
    if (st !== 'PUBLISH_COMPLETE') {
      throw new AppError(ERR.publishFailed('TikTok', `TikTok sta ancora elaborando il video (stato ${st}). Controlla tra qualche minuto nel profilo.`), 502);
    }
    return {
      url: 'https://www.tiktok.com/',
      message: 'Pubblicato su TikTok come video privato (visibile solo a te finché l app non è approvata).',
    };
  }
  console.error('[tiktok] direct post rifiutato:', JSON.stringify(direct.error ?? direct));

  // 3. Ripiego: Upload nella casella di TikTok, da completare nell'app TikTok.
  const inbox = await post<TikTokInit>('/post/publish/inbox/video/init/', accessToken, { source_info });
  if (inbox.data?.upload_url && inbox.data.publish_id) {
    await upload(inbox.data.upload_url, meta.filePath, size);
    const st = await waitStatus(accessToken, inbox.data.publish_id);
    if (st !== 'SEND_TO_USER_INBOX' && st !== 'PUBLISH_COMPLETE') {
      throw new AppError(ERR.publishFailed('TikTok', `TikTok non ha ancora confermato il video (stato ${st}). Riprova tra qualche minuto.`), 502);
    }
    return {
      url: 'https://www.tiktok.com/',
      message: 'Inviato a TikTok: apri l app TikTok, trovi il video nelle notifiche (Bozze/Inbox) e premi Pubblica. Didascalia da incollare: ' + caption.slice(0, 300),
    };
  }
  console.error('[tiktok] upload inbox rifiutato:', JSON.stringify(inbox.error ?? inbox));
  const e = direct.error;
  const hint = e?.code === 'unaudited_client_can_only_post_to_private_accounts'
    ? 'con un app non ancora approvata l account TikTok deve essere privato'
    : `${e?.code ?? ''} ${e?.message ?? 'errore init'}`.trim().slice(0, 160);
  throw new AppError(ERR.publishFailed('TikTok', hint), 502);
};
