import { hashtagLine } from '../lib/tags';
import { AppError, ERR } from '../lib/errors';
import { loadToken } from '../lib/tokens';
import { listPages, NO_PAGE_HINT } from './metaPages';
import type { PublishMeta, PublishResult } from './index';

// Instagram Graph API — pubblicazione Reels. Requisiti (gratuiti ma obbligatori):
//  - account Instagram Business/Creator collegato a una Pagina Facebook
//  - URL pubblico del video (il backend lo espone via Cloudflare Tunnel)
const GRAPH = 'https://graph.facebook.com/v21.0';

// Reels: crea un media container (media_type=REELS) e poi pubblicalo.

async function getIgAccount(): Promise<{ igUserId: string; pageToken: string }> {
  const { accessToken } = await loadToken('instagram');
  const pages = await listPages(accessToken, 'Instagram');
  if (pages.length === 0) throw new AppError(ERR.publishFailed('Instagram', NO_PAGE_HINT), 400);
  // La Pagina giusta è quella con un account Instagram professionale collegato.
  const page = pages.find((p) => p.instagram_business_account?.id);
  if (!page?.instagram_business_account) {
    throw new AppError(ERR.publishFailed('Instagram', `la Pagina ${pages[0].name ?? ''} non ha un account Instagram professionale collegato (Instagram > Modifica profilo > Pagina).`), 400);
  }
  return { igUserId: page.instagram_business_account.id, pageToken: page.access_token };
}

export const instagramPublish = async (meta: PublishMeta): Promise<PublishResult> => {
  const { igUserId, pageToken } = await getIgAccount();

  const caption = [meta.title, meta.description, hashtagLine(meta.hashtags)].filter(Boolean).join('\n').slice(0, 2200);
  const form = (fields: Record<string, string>) => ({
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ ...fields, access_token: pageToken }).toString(),
  });

  // 1. Container del Reel: Meta scarica il video dall'URL pubblico (tunnel).
  console.log(`[Instagram] container REELS, video_url=${meta.videoUrl}`);
  const container = await fetch(`${GRAPH}/${igUserId}/media`, form({
    media_type: 'REELS',
    video_url: meta.videoUrl,
    caption,
    share_to_feed: 'true',
  }));
  const cData = (await container.json()) as { id?: string; error?: { message?: string } };
  if (!cData.id) {
    console.error('[Instagram] container rifiutato:', JSON.stringify(cData));
    throw new AppError(ERR.publishFailed('Instagram', cData.error?.message?.slice(0, 160) ?? 'errore container'), 502);
  }

  // 2. Attendi che il container sia pronto (polling, max ~3 min).
  let status = 'IN_PROGRESS';
  let detail = '';
  for (let i = 0; i < 36 && status === 'IN_PROGRESS'; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    const st = await fetch(`${GRAPH}/${cData.id}?fields=status_code,status&access_token=${pageToken}`);
    const stData = (await st.json()) as { status_code?: string; status?: string };
    status = stData.status_code ?? 'IN_PROGRESS';
    detail = stData.status ?? '';
  }
  console.log(`[Instagram] container ${cData.id}: ${status} ${detail}`);
  if (status !== 'FINISHED') {
    const why = status === 'ERROR'
      ? `Instagram non è riuscito a scaricare o leggere il video (${detail || 'controlla che il tunnel sia acceso'}).`
      : `container non pronto (${status})`;
    throw new AppError(ERR.publishFailed('Instagram', why), 502);
  }

  // 3. Pubblica (endpoint media_publish, non media).
  const publish = await fetch(`${GRAPH}/${igUserId}/media_publish`, form({ creation_id: cData.id }));
  const pData = (await publish.json()) as { id?: string; error?: { message?: string } };
  if (!pData.id) {
    console.error('[Instagram] media_publish rifiutato:', JSON.stringify(pData));
    throw new AppError(ERR.publishFailed('Instagram', pData.error?.message?.slice(0, 160) ?? 'errore pubblicazione'), 502);
  }
  const link = await fetch(`${GRAPH}/${pData.id}?fields=permalink&access_token=${pageToken}`)
    .then((r) => r.json() as Promise<{ permalink?: string }>).catch(() => ({} as { permalink?: string }));
  return { url: link.permalink ?? 'https://www.instagram.com/', message: 'Pubblicato su Instagram' };
};
