import { hashtagLine } from '../lib/tags';
import { AppError, ERR } from '../lib/errors';
import { freshAccessToken } from '../lib/tokens';
import type { PublishMeta, PublishResult } from './index';

// YouTube Data API v3 (piano gratuito: 10.000 unità/giorno; un upload ≈ 1600 unità).
// OAuth2: il token è stato salvato durante /api/auth/youtube/callback.

export const youtubePublish = async (meta: PublishMeta): Promise<PublishResult> => {
  const accessToken = await freshAccessToken('youtube');

  // 1. Apri una sessione di upload "resumable".
  const init = await fetch(
    'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'X-Upload-Content-Type': 'video/mp4',
      },
      body: JSON.stringify({
        snippet: {
          title: `${meta.title.slice(0, 93)} #viral`, // #viral sempre, anche nel titolo
          description: [meta.description, `${hashtagLine(meta.hashtags)} #shorts`].filter(Boolean).join('\n\n'),
          categoryId: '22',
        },
        // I progetti Google non verificati possono caricare solo video privati: default privato.
        status: { privacyStatus: process.env.YOUTUBE_PRIVACY ?? 'private', selfDeclaredMadeForKids: false },
      }),
    },
  );
  if (!init.ok) {
    const t = await init.text().catch(() => '');
    console.error(`[YouTube] avvio upload rifiutato (${init.status}):`, t.slice(0, 500));
    const reason = /quotaExceeded/.test(t) ? 'quota giornaliera di YouTube esaurita, riprova domani'
      : /youtubeSignupRequired/.test(t) ? 'il tuo account Google non ha ancora un canale YouTube: crealo su youtube.com'
      : init.status === 401 || init.status === 403 ? 'permessi mancanti: premi Collega su YouTube e autorizza di nuovo'
      : `errore ${init.status}`;
    throw new AppError(ERR.publishFailed('YouTube', reason), 502);
  }
  const uploadUrl = init.headers.get('location');
  if (!uploadUrl) throw new AppError(ERR.publishFailed('YouTube', 'URL di upload mancante'), 502);

  // 2. Carica il file (come Buffer: con gli stream Node il corpo può partire vuoto).
  const { promises: fsp } = await import('fs');
  const file = await fsp.readFile(meta.filePath);
  const upload = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': 'video/mp4' },
    body: file,
  });
  console.log(`[YouTube] upload: HTTP ${upload.status}`);
  if (!upload.ok) {
    const t = await upload.text().catch(() => '');
    throw new AppError(ERR.publishFailed('YouTube', t.slice(0, 200) || `errore ${upload.status}`), 502);
  }
  const data = (await upload.json()) as { id?: string };
  const videoId = data.id;
  return {
    url: videoId ? `https://youtube.com/shorts/${videoId}` : undefined,
    message: (process.env.YOUTUBE_PRIVACY ?? 'private') === 'private' ? 'Caricato su YouTube come privato: rendilo pubblico da YouTube Studio.' : 'Pubblicato su YouTube',
  };
};
