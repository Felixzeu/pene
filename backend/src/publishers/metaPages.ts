import { AppError, ERR } from '../lib/errors';

// Pagine Facebook gestite dall'utente. /me/accounts è vuoto se nel login non è
// stata spuntata la Pagina, oppure se la Pagina sta in un portfolio business:
// in quel caso si leggono le Pagine dei business (serve business_management).

const GRAPH = 'https://graph.facebook.com/v21.0';
const FIELDS = 'id,name,access_token,instagram_business_account';

export interface MetaPage { id: string; name?: string; access_token: string; instagram_business_account?: { id: string } }

async function get<T>(url: string): Promise<T & { error?: { message?: string; code?: number } }> {
  const r = await fetch(url);
  return (await r.json().catch(() => ({}))) as T & { error?: { message?: string; code?: number } };
}

export async function listPages(userToken: string, label: string): Promise<MetaPage[]> {
  const me = await get<{ data?: MetaPage[] }>(`${GRAPH}/me/accounts?fields=${FIELDS}&limit=100&access_token=${userToken}`);
  console.log(`[${label}] /me/accounts:`, JSON.stringify(me.error ?? (me.data ?? []).map((p) => ({ id: p.id, name: p.name, ig: p.instagram_business_account?.id }))));
  if (me.error) throw new AppError(ERR.publishFailed(label, `Meta: ${me.error.message?.slice(0, 140)}`), 502);
  const pages = [...(me.data ?? [])];

  if (pages.length === 0) {
    const biz = await get<{ data?: { id: string; name?: string }[] }>(`${GRAPH}/me/businesses?access_token=${userToken}`);
    console.log(`[${label}] /me/businesses:`, JSON.stringify(biz.error ?? biz.data ?? []));
    for (const b of biz.data ?? []) {
      for (const edge of ['owned_pages', 'client_pages']) {
        const r = await get<{ data?: MetaPage[] }>(`${GRAPH}/${b.id}/${edge}?fields=${FIELDS}&limit=100&access_token=${userToken}`);
        for (const p of r.data ?? []) if (p.access_token && !pages.some((x) => x.id === p.id)) pages.push(p);
      }
    }
  }
  return pages;
}

export const NO_PAGE_HINT =
  'Meta non ha dato accesso a nessuna Pagina. Premi Collega di nuovo e, quando Facebook chiede cosa condividere, spunta la Pagina e l account Instagram (oppure "Tutte").';
