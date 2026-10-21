import { AppError, ERR } from '../lib/errors';
import { loadToken } from '../lib/tokens';
import type { PublishMeta, PublishResult } from './index';

// TikTok Content Posting API (gratuita). LIMITE IMPORTANTE:
// le app non ancora approvate da TikTok possono pubblicare solo video PRIVATI
// (SELF_ONLY). Dopo l'approvazione dell'app, basta cambiare draft: false.

const API = 'https://open.tiktokapis.com/v2';

export const tiktokPublish = async (meta: PublishMeta): Promise<PublishResult> => {
  const { accessToken } = await loadToken('tiktok');
  const caption = `${meta.title} ${meta.hashtags.map((h) => `#${h}`).join(' ')}`.slice(0, 2200);

  // 1. Richiedi un URL di upload diretto (direct post, PRIVATO finché l'app non è approvata).
  const init = await fetch(`${API}/post/publish/video/init/`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json; charset=UTF-8',
    },
    body: JSON.stringify({
      post_info: {
        title: caption,
        privacy_level: 'SELF_ONLY', // privato: obbligatorio per app non approvate
        disable_comment: false,
        disable_duet: false,
        disable_stitch: false,
      },
      source_info: {
        source: 'FILE_UPLOAD',
        video_size: (await import('fs')).statSync(meta.filePath).size,
        chunk_size: (await import('fs')).statSync(meta.filePath).size,
        total_chunk_count: 1,
      },
    }),
  });
  const initData = (await init.json()) as {
    data?: { publish_id?: string; upload_url?: string };
    error?: { message?: string; code?: string };
  };
  if (!initData.data?.upload_url || !initData.data?.publish_id) {
    throw new AppError(ERR.publishFailed('TikTok', initData.error?.message?.slice(0, 160) ?? 'errore init'), 502);
  }

  // 2. Carica il file nel chunk richiesto.
  const { createReadStream, statSync } = await import('fs');
  const size = statSync(meta.filePath).size;
  const upload = await fetch(initData.data.upload_url, {
    method: 'PUT',
    headers: {
      'Content-Type': 'video/mp4',
      'Content-Length': String(size),
      'Content-Range': `bytes 0-${size - 1}/${size}`,
    },
    // @ts-expect-error undici accetta stream Node come body
    body: createReadStream(meta.filePath),
    duplex: 'half',
  });
  if (!upload.ok) {
    throw new AppError(ERR.publishFailed('TikTok', `upload ${upload.status}`), 502);
  }

  // 3. Il post parte dal carosello di TikTok: in SELF_ONLY il video è privato
  //    finché l'utente non lo approva (vedi limite nel README).
  return {
    url: 'https://www.tiktok.com/upload',
    message: 'Caricato su TikTok: video privato finché l app non è approvata da TikTok',
  };
};
