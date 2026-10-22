import { hashtagLine } from '../lib/tags';
import { AppError, ERR } from '../lib/errors';
import { loadToken } from '../lib/tokens';
import { listPages, NO_PAGE_HINT } from './metaPages';
import type { PublishMeta, PublishResult } from './index';

// Facebook Pages API — video Reel sulla Pagina (gratuito, quota generosa).
// Flusso Reels in 3 fasi: start → trasferimento del file → publish.

const GRAPH = 'https://graph.facebook.com/v21.0';

export const facebookPublish = async (meta: PublishMeta): Promise<PublishResult> => {
  const { accessToken } = await loadToken('facebook');

  // Trova la prima Pagina gestita.
  const page = (await listPages(accessToken, 'Facebook'))[0];
  if (!page) throw new AppError(ERR.publishFailed('Facebook', NO_PAGE_HINT), 400);

  const caption = [meta.title, meta.description, hashtagLine(meta.hashtags)].filter(Boolean).join('\n');

  // 1. Avvia la sessione di upload Reels.
  const start = await fetch(`${GRAPH}/${page.id}/video_reels?upload_phase=START&access_token=${page.access_token}`, { method: 'POST' });
  const startData = (await start.json()) as { video_id?: string; upload_url?: string; error?: { message?: string } };
  if (!startData.video_id || !startData.upload_url) {
    console.error('[Facebook] avvio upload rifiutato:', JSON.stringify(startData));
    throw new AppError(ERR.publishFailed('Facebook', startData.error?.message?.slice(0, 160) ?? 'errore avvio'), 502);
  }

  // 2. Trasferisci il file (come Buffer: con gli stream Node il corpo può partire vuoto).
  const { promises: fsp } = await import('fs');
  const data = await fsp.readFile(meta.filePath);
  const size = data.length;
  const transfer = await fetch(startData.upload_url, {
    method: 'POST',
    headers: {
      Authorization: `OAuth ${page.access_token}`,
      offset: '0',
      file_size: String(size),
      'Content-Type': 'application/octet-stream',
    },
    body: data,
  });
  console.log(`[Facebook] upload Reel ${startData.video_id} sulla Pagina ${page.name ?? page.id}: HTTP ${transfer.status}`);
  if (!transfer.ok) {
    const t = await transfer.text().catch(() => '');
    throw new AppError(ERR.publishFailed('Facebook', t.slice(0, 160) || `errore trasferimento ${transfer.status}`), 502);
  }

  // 3. Pubblica il Reel.
  const publish = await fetch(
    `${GRAPH}/${page.id}/video_reels?upload_phase=FINISH&video_id=${startData.video_id}` +
    `&video_state=${meta.settings.facebook?.state ?? 'PUBLISHED'}&description=${encodeURIComponent(caption)}&access_token=${page.access_token}`,
    { method: 'POST' },
  );
  const publishData = (await publish.json()) as { success?: boolean; error?: { message?: string } };
  if (!publishData.success) {
    console.error('[Facebook] pubblicazione rifiutata:', JSON.stringify(publishData));
    throw new AppError(ERR.publishFailed('Facebook', publishData.error?.message?.slice(0, 160) ?? 'errore pubblicazione'), 502);
  }
  return meta.settings.facebook?.state === 'DRAFT'
    ? { url: 'https://business.facebook.com/latest/content_calendar', message: 'Salvato come bozza nella Pagina: lo pubblichi da Meta Business Suite.' }
    : { url: `https://www.facebook.com/reel/${startData.video_id}`, message: 'Pubblicato sulla Pagina Facebook (può volerci qualche minuto per vederlo).' };
};
