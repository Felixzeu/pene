import { config } from '../config';
import { dbEnabled, rpc, select } from './db';
import { AppError } from './errors';
import { currentUser, type User } from './user';

// Coin: ogni azione costa qualche coin, scalato dal portafoglio dell'utente su Supabase.
// Gli amministratori e l'uso senza account ("local") non pagano nulla.

export type CoinAction = 'script' | 'rewrite' | 'edit' | 'ai' | 'render' | 'publish';

const LABEL: Record<CoinAction, string> = {
  script: 'Script con l\'IA',
  rewrite: 'Modifica dello script',
  edit: 'Montaggio video',
  ai: 'Modifica con l\'IA',
  render: 'Nuovo export',
  publish: 'Pubblicazione',
};

const pays = (u: User) => dbEnabled() && u.id !== 'local' && !u.admin;

/** Saldo dell'utente (crea il portafoglio con il bonus di benvenuto al primo accesso). */
async function ensureWallet(u: User): Promise<number> {
  return rpc<number>('ensure_wallet', { uid: u.id, bonus: config.coins.welcome });
}

/** Scala il costo dell'azione; restituisce quanti coin sono stati scalati (0 se gratis). */
export async function charge(action: CoinAction, detail?: string): Promise<number> {
  const u = currentUser();
  const cost = config.coins[action];
  if (!pays(u) || cost <= 0) return 0;
  await ensureWallet(u);
  try {
    await rpc<number>('spend_coins', { uid: u.id, amount: cost, why: detail ? `${LABEL[action]} (${detail})` : LABEL[action] });
  } catch (e) {
    if (e instanceof AppError && e.message.includes('coin_insufficienti')) {
      throw new AppError(`Coin finiti: ${LABEL[action].toLowerCase()} costa ${cost} coin. Ricarica dalla schermata Account.`, 402);
    }
    throw e;
  }
  return cost;
}

/** Restituisce i coin di un'azione non riuscita. */
export async function refund(userId: string, amount: number, action: CoinAction): Promise<void> {
  if (amount <= 0 || !dbEnabled()) return;
  await rpc<number>('add_coins', { uid: userId, amount, why: `Rimborso: ${LABEL[action].toLowerCase()} non riuscito` })
    .catch((e) => console.error('[coins] rimborso non riuscito:', e));
}

/** Scala i coin, esegue `fn` e li restituisce se `fn` fallisce. */
export async function withCoins<T>(action: CoinAction, fn: () => Promise<T>): Promise<T> {
  const paid = await charge(action);
  try {
    return await fn();
  } catch (e) {
    await refund(currentUser().id, paid, action);
    throw e;
  }
}

/** Saldo, ultimi movimenti e listino per l'app. */
export async function wallet() {
  const u = currentUser();
  const { welcome: _w, ...costs } = config.coins;
  if (!pays(u)) return { coins: null, unlimited: true, costs, history: [] };
  const coins = await ensureWallet(u);
  const history = await select<{ delta: number; reason: string; created_at: string }>(
    'coin_ledger', `user_id=eq.${u.id}&select=delta,reason,created_at&order=created_at.desc&limit=30`);
  return { coins, unlimited: false, costs, history };
}
