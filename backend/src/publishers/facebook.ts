import { AppError, ERR } from '../lib/errors';
import { loadToken } from '../lib/tokens';
import type { PublishMeta, PublishResult } from './index';

// Facebook Pages API — video Reel sulla Pagina (gratuito, quota generosa).
// Flusso Reels in 3 fasi: start → trasferimento del file → publish.

const GRAPH = 'https://graph.facebook.com/v21.0';

export const facebookPublish = async (meta: PublishMeta): Promise<PublishResult> => {
  const { accessToken } = await loadToken('facebook');

  // Trova la prima Pagina gestita.
  const pages = await fetch(`${GRAPH}/me/accounts?access_token=${accessToken}`);
  const pagesData = (await pages.json()) as { data?: { id: string; access_token: string }[] };
  const page = pagesData.data?.[0];
  if (!page) throw new AppError(ERR.publishFailed('Facebook', 'nessuna Pagina collegata'), 400);

  const caption = `${meta.title}\n${meta.description}\n${meta.hashtags.map((h) => `#${h}`).join(' ')}`;

  // 1. Avvia la sessione di upload Reels.
  const start = await fetch(`${GRAPH}/${page.id}/video_reels?upload_phase=START&access_token=${page.access_token}`, { method: 'POST' });
  const startData = (await start.json()) as { video_id?: string; upload_url?: string; error?: { message?: string } };
  if (!startData.video_id || !startData.upload_url) {
    throw new AppError(ERR.publishFailed('Facebook', startData.error?.message?.slice(0, 160) ?? 'errore avvio'), 502);
  }

  // 2. Trasferisci il file (dal disco, senza tenerlo in memoria).
  const { createReadStream, statSync } = await import('fs');
  const size = statSync(meta.filePath).size;
  const transfer = await fetch(startData.upload_url, {
    method: 'POST',
    headers: {
      Authorization: `OAuth ${page.access_token}`,
      offset: '0',
      file_size: String(size),
      'Content-Length': String(size),
      'Content-Type': 'application/octet-stream',
    },
    // @ts-expect-error undici accetta stream Node come body
    body: createReadStream(meta.filePath),
    duplex: 'half',
  });
  if (!transfer.ok) {
    const t = await transfer.text().catch(() => '');
    throw new AppError(ERR.publishFailed('Facebook', t.slice(0, 160) || `errore trasferimento ${transfer.status}`), 502);
  }

  // 3. Pubblica il Reel.
  const publish = await fetch(
    `${GRAPH}/${page.id}/video_reels?upload_phase=FINISH&video_id=${startData.video_id}` +
    `&video_state=PUBLISHED&description=${encodeURIComponent(caption)}&access_token=${page.access_token}`,
    { method: 'POST' },
  );
  const publishData = (await publish.json()) as { success?: boolean; error?: { message?: string } };
  if (!publishData.success) {
    throw new AppError(ERR.publishFailed('Facebook', publishData.error?.message?.slice(0, 160) ?? 'errore pubblicazione'), 502);
  }
  return { url: `https://facebook.com/${page.id}/videos/${startData.video_id}` };
};
