import { BRAND_TAG, hashtagLine } from '../lib/tags';
import { AppError, ERR } from '../lib/errors';
import { freshAccessToken } from '../lib/tokens';
import type { PublishMeta, PublishResult } from './index';

// YouTube Data API v3 (piano gratuito: 10.000 unità/giorno; un upload ≈ 1600 unità).
// OAuth2: il token è stato salvato durante /api/auth/youtube/callback.

export const youtubePublish = async (meta: PublishMeta): Promise<PublishResult> => {
  const accessToken = await freshAccessToken('youtube');
  const yt = meta.settings.youtube ?? {};
  // I progetti Google non verificati possono caricare solo video privati: di default privato.
  const privacy = yt.privacy ?? (process.env.YOUTUBE_PRIVACY as 'public' | 'unlisted' | 'private' | undefined) ?? 'private';

  // 0. L'account scelto al login deve avere un canale YouTube (senza canale Google risponde 404/401).
  const ch = await fetch('https://www.googleapis.com/youtube/v3/channels?part=id,snippet&mine=true', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const chData = (await ch.json().catch(() => ({}))) as { items?: { id: string; snippet?: { title?: string } }[]; error?: { message?: string } };
  console.log(`[YouTube] canale: HTTP ${ch.status}`, JSON.stringify(chData.error ?? chData.items?.map((c) => c.snippet?.title ?? c.id) ?? []));
  if (ch.ok && !chData.items?.length) {
    throw new AppError(ERR.publishFailed('YouTube', 'l account Google collegato non ha un canale YouTube. Se il canale è di un account Brand, ricollega YouTube e scegli il canale (non l account personale).'), 400);
  }

  // 1. Apri una sessione di upload "resumable".
  const init = await fetch(
    `https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status&notifySubscribers=${yt.notifySubscribers ?? true}`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'X-Upload-Content-Type': 'video/mp4',
      },
      body: JSON.stringify({
        snippet: {
          title: `${meta.title.slice(0, 89)} #${BRAND_TAG}`, // #viralAPP sempre, anche nel titolo
          description: [meta.description, `${hashtagLine(meta.hashtags)} #shorts`].filter(Boolean).join('\n\n'),
          categoryId: yt.category ?? '22',
        },
        status: { privacyStatus: privacy, selfDeclaredMadeForKids: yt.madeForKids ?? false },
      }),
    },
  );
  if (!init.ok) {
    const t = await init.text().catch(() => '');
    console.error(`[YouTube] avvio upload rifiutato (${init.status}):`, t.slice(0, 500));
    const reason = /quotaExceeded/.test(t) ? 'quota giornaliera di YouTube esaurita, riprova domani'
      : /youtubeSignupRequired/.test(t) ? 'il tuo account Google non ha ancora un canale YouTube: crealo su youtube.com'
      : init.status === 401 || init.status === 403 ? 'permessi mancanti: premi Collega su YouTube e autorizza di nuovo'
      : `errore ${init.status}: ${googleReason(t)}`;
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
    console.error(`[YouTube] upload rifiutato (${upload.status}):`, t.slice(0, 500));
    throw new AppError(ERR.publishFailed('YouTube', t.slice(0, 200) || `errore ${upload.status}`), 502);
  }
  const data = (await upload.json()) as { id?: string };
  const videoId = data.id;
  return {
    url: videoId ? `https://youtube.com/shorts/${videoId}` : undefined,
    message: privacy === 'private' ? 'Caricato su YouTube come privato: rendilo pubblico da YouTube Studio.'
      : privacy === 'unlisted' ? 'Caricato su YouTube come non in elenco (solo chi ha il link).' : 'Pubblicato su YouTube',
  };
};

/** Il messaggio leggibile dentro una risposta di errore di Google. */
function googleReason(body: string): string {
  try {
    const j = JSON.parse(body) as { error?: { message?: string; errors?: { reason?: string }[] } };
    return (j.error?.errors?.[0]?.reason ?? '') + (j.error?.message ? ` ${j.error.message}` : '');
  } catch {
    return body.slice(0, 120);
  }
}
