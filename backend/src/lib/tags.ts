// Titoli e hashtag puliti per tutti i social. L'app si chiama viral:
// #viral è sempre il primo hashtag, qualunque cosa scriva l'IA o l'utente.

const MAX_TAGS = 15;

/** Un hashtag valido: niente #, spazi, punteggiatura o emoji; minuscolo; max 30 caratteri. */
function cleanTag(raw: string): string {
  return raw
    .normalize('NFKC')
    .replace(/^#+/, '')
    .replace(/[^\p{L}\p{N}_]/gu, '')
    .toLowerCase()
    .slice(0, 30);
}

/** Accetta array o testo ("#a #b, c") e restituisce hashtag puliti, senza doppioni, con viral in testa. */
export function normalizeHashtags(input: string[] | string | undefined): string[] {
  const parts = Array.isArray(input) ? input.flatMap((h) => String(h).split(/[\s,#]+/)) : (input ?? '').split(/[\s,#]+/);
  const seen = new Set<string>(['viral']);
  const out = ['viral'];
  for (const p of parts) {
    const t = cleanTag(p);
    if (t.length < 2 || /^\d+$/.test(t) || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
    if (out.length >= MAX_TAGS) break;
  }
  return out;
}

/** Titolo senza hashtag, virgolette o spazi doppi, max 70 caratteri tagliato su una parola. */
export function cleanTitle(raw: string | undefined, max = 70): string {
  let t = (raw ?? '')
    .replace(/#[\p{L}\p{N}_]+/gu, '')
    .replace(/^["'«“\s]+|["'»”\s]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (t.length > max) {
    const cut = t.slice(0, max + 1);
    t = (cut.lastIndexOf(' ') > max * 0.6 ? cut.slice(0, cut.lastIndexOf(' ')) : cut.slice(0, max)).replace(/[\s,;:.-]+$/, '');
  }
  return t;
}

/** "#viral #a #b": la riga di hashtag da mettere nelle didascalie. */
export const hashtagLine = (tags: string[]) => normalizeHashtags(tags).map((h) => `#${h}`).join(' ');
