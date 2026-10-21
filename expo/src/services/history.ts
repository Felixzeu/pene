import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Project } from '../types';

const KEY = 'creatorprompt.history.v1';

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
