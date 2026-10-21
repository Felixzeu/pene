import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Project } from '../types';

const BASE = 'creatorprompt.history.v1';
let KEY = BASE;

/**
 * Ogni account ha la sua cronologia sul telefono. Al primo login, i progetti fatti
 * prima degli account passano a quell'account (così non si perde niente).
 */
export async function setHistoryUser(userId: string | null): Promise<void> {
  KEY = userId ? `${BASE}.${userId}` : BASE;
  if (!userId) return;
  try {
    const [mine, old] = await Promise.all([AsyncStorage.getItem(KEY), AsyncStorage.getItem(BASE)]);
    if (!mine && old) {
      await AsyncStorage.setItem(KEY, old);
      await AsyncStorage.removeItem(BASE);
    }
  } catch { /* non bloccare il login */ }
}

/** Cancella la cronologia dell'account attuale (eliminazione account). */
export async function clearHistory(): Promise<void> {
  await AsyncStorage.removeItem(KEY).catch(() => {});
}

/** Cronologia locale dei progetti, salvata in AsyncStorage (gratuito, offline). */
export async function loadHistory(): Promise<Project[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    const list = raw ? (JSON.parse(raw) as Project[]) : [];
    return list.sort((a, b) => b.createdAt - a.createdAt);
  } catch {
    return [];
  }
}

export async function upsertProject(project: Project): Promise<void> {
  const list = await loadHistory();
  const i = list.findIndex((p) => p.id === project.id);
  if (i >= 0) list[i] = project;
  else list.push(project);
  await AsyncStorage.setItem(KEY, JSON.stringify(list.slice(0, 100)));
}

export async function removeProject(id: string): Promise<void> {
  const list = await loadHistory();
  await AsyncStorage.setItem(KEY, JSON.stringify(list.filter((p) => p.id !== id)));
}

export const newId = () =>
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
