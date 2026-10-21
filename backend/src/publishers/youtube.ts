import { AppError, ERR } from '../lib/errors';
import { loadToken } from '../lib/tokens';
import type { PublishMeta, PublishResult } from './index';

// YouTube Data API v3 (piano gratuito: 10.000 unità/giorno; un upload ≈ 1600 unità).
// OAuth2: il token è stato salvato durante /api/auth/youtube/callback.

export const youtubePublish = async (meta: PublishMeta): Promise<PublishResult> => {
  const { accessToken } = await loadToken('youtube');

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
          title: meta.title.slice(0, 100),
          description: `${meta.description}\n\n${meta.hashtags.map((h) => `#${h}`).join(' ')}`,
          categoryId: '22',
        },
        status: { privacyStatus: 'public', selfDeclaredMadeForKids: false },
      }),
    },
  );
  if (!init.ok) throw new AppError(ERR.publishFailed('YouTube', `errore ${init.status}`), 502);
  const uploadUrl = init.headers.get('location');
  if (!uploadUrl) throw new AppError(ERR.publishFailed('YouTube', 'URL di upload mancante'), 502);

  // 2. Carica il file (da disco, evita di tenerlo tutto in memoria).
  const { createReadStream, statSync } = await import('fs');
  const size = statSync(meta.filePath).size;
  const upload = await fetch(uploadUrl, {
    method: 'PUT',
    headers: {
      'Content-Type': 'video/mp4',
      'Content-Length': String(size),
    },
    // @ts-expect-error undici accetta stream Node come body
    body: createReadStream(meta.filePath),
    duplex: 'half',
  });
  if (!upload.ok) {
    const t = await upload.text().catch(() => '');
    throw new AppError(ERR.publishFailed('YouTube', t.slice(0, 200) || `errore ${upload.status}`), 502);
  }
  const data = (await upload.json()) as { id?: string };
  const videoId = data.id;
  return { url: videoId ? `https://youtube.com/shorts/${videoId}` : undefined };
};
