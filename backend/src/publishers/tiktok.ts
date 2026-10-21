import { statSync, createReadStream } from 'fs';
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

async function upload(url: string, filePath: string, size: number): Promise<void> {
  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      'Content-Type': 'video/mp4',
      'Content-Length': String(size),
      'Content-Range': `bytes 0-${size - 1}/${size}`,
    },
    // @ts-expect-error undici accetta stream Node come body
    body: createReadStream(filePath),
    duplex: 'half',
  });
  if (!res.ok) throw new AppError(ERR.publishFailed('TikTok', `upload ${res.status}`), 502);
}

export const tiktokPublish = async (meta: PublishMeta): Promise<PublishResult> => {
  const accessToken = await freshAccessToken('tiktok');
  const caption = `${meta.title} ${meta.hashtags.map((h) => `#${h}`).join(' ')}`.slice(0, 2200);
  const size = statSync(meta.filePath).size;
  const source_info = { source: 'FILE_UPLOAD', video_size: size, chunk_size: size, total_chunk_count: 1 };

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
