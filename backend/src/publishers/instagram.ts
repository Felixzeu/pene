import { AppError, ERR } from '../lib/errors';
import { loadToken } from '../lib/tokens';
import type { PublishMeta, PublishResult } from './index';

// Instagram Graph API — pubblicazione Reels. Requisiti (gratuiti ma obbligatori):
//  - account Instagram Business/Creator collegato a una Pagina Facebook
//  - URL pubblico del video (il backend lo espone via Cloudflare Tunnel)
// Reels: crea un media container (media_type=REELS) e poi pubblicalo.

async function getPageAccessToken(): Promise<{ pageId: string; pageToken: string }> {
  const { accessToken } = await loadToken('instagram');
  const res = await fetch(`https://graph.facebook.com/v21.0/me/accounts?access_token=${accessToken}`);
  const data = (await res.json()) as { data?: { id: string; access_token: string }[] };
  const page = data.data?.[0];
  if (!page) throw new AppError(ERR.publishFailed('Instagram', 'nessuna Pagina Facebook collegata'), 400);
  return { pageId: page.id, pageToken: page.access_token };
}

async function getIgUserId(pageToken: string, pageId: string): Promise<string> {
  const res = await fetch(`https://graph.facebook.com/v21.0/${pageId}?fields=instagram_business_account&access_token=${pageToken}`);
  const data = (await res.json()) as { instagram_business_account?: { id: string } };
  if (!data.instagram_business_account) {
    throw new AppError(ERR.publishFailed('Instagram', 'account Business non collegato alla Pagina'), 400);
  }
  return data.instagram_business_account.id;
}

export const instagramPublish = async (meta: PublishMeta): Promise<PublishResult> => {
  const { pageId, pageToken } = await getPageAccessToken();
  const igUserId = await getIgUserId(pageToken, pageId);

  // 1. Container del Reel (attende che Meta scarichi il video dall'URL pubblico).
  const container = await fetch(
    `https://graph.facebook.com/v21.0/${igUserId}/media?media_type=REELS&video_url=${encodeURIComponent(meta.videoUrl)}` +
    `&caption=${encodeURIComponent(`${meta.title}\n${meta.description}\n${meta.hashtags.map((h) => `#${h}`).join(' ')}`)}&access_token=${pageToken}`,
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
