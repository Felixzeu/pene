import { hashtagLine } from '../lib/tags';
import { AppError, ERR } from '../lib/errors';
import { loadToken } from '../lib/tokens';
import { listPages, NO_PAGE_HINT } from './metaPages';
import type { PublishMeta, PublishResult } from './index';

// Instagram Graph API — pubblicazione Reels. Requisiti (gratuiti ma obbligatori):
//  - account Instagram Business/Creator collegato a una Pagina Facebook
//  - URL pubblico del video (il backend lo espone via Cloudflare Tunnel)
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

  // 1. Container del Reel (attende che Meta scarichi il video dall'URL pubblico).
  const container = await fetch(
    `https://graph.facebook.com/v21.0/${igUserId}/media?media_type=REELS&video_url=${encodeURIComponent(meta.videoUrl)}` +
    `&caption=${encodeURIComponent([meta.title, meta.description, hashtagLine(meta.hashtags)].filter(Boolean).join('\n'))}&access_token=${pageToken}`,
    { method: 'POST' },
  );
  const cData = (await container.json()) as { id?: string; error?: { message?: string } };
  if (!cData.id) throw new AppError(ERR.publishFailed('Instagram', cData.error?.message?.slice(0, 160) ?? 'errore container'), 502);

  // 2. Attendi che il container sia pronto (polling, max ~2 min).
  let status = 'IN_PROGRESS';
  for (let i = 0; i < 24 && status === 'IN_PROGRESS'; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    const st = await fetch(`https://graph.facebook.com/v21.0/${cData.id}?fields=status_code&access_token=${pageToken}`);
    const stData = (await st.json()) as { status_code?: string };
    status = stData.status_code ?? 'IN_PROGRESS';
  }
  if (status !== 'FINISHED') throw new AppError(ERR.publishFailed('Instagram', `container non pronto (${status})`), 502);

  // 3. Pubblica.
  const publish = await fetch(
    `https://graph.facebook.com/v21.0/${igUserId}/media?creation_id=${cData.id}&access_token=${pageToken}`,
    { method: 'POST' },
  );
  const pData = (await publish.json()) as { id?: string; error?: { message?: string } };
  if (!pData.id) throw new AppError(ERR.publishFailed('Instagram', pData.error?.message?.slice(0, 160) ?? 'errore pubblicazione'), 502);
  return { url: `https://instagram.com/reel/${pData.id}`, message: 'Pubblicato' };
};
