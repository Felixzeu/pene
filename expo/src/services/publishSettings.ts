import AsyncStorage from '@react-native-async-storage/async-storage';
import type { PublishSettings } from '../types';

const KEY = 'viral.publishSettings.v1';

// YouTube privato di default: i progetti Google non verificati non possono pubblicare in pubblico.
export const DEFAULT_SETTINGS: PublishSettings = {
  youtube: { privacy: 'private', madeForKids: false, notifySubscribers: true, category: '22' },
  instagram: { shareToFeed: true },
  facebook: { state: 'PUBLISHED' },
  tiktok: { disableComment: false, disableDuet: false, disableStitch: false },
};

export async function loadPublishSettings(): Promise<PublishSettings> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    const saved = raw ? (JSON.parse(raw) as Partial<PublishSettings>) : {};
    return {
      youtube: { ...DEFAULT_SETTINGS.youtube, ...saved.youtube },
      instagram: { ...DEFAULT_SETTINGS.instagram, ...saved.instagram },
      facebook: { ...DEFAULT_SETTINGS.facebook, ...saved.facebook },
      tiktok: { ...DEFAULT_SETTINGS.tiktok, ...saved.tiktok },
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export async function savePublishSettings(s: PublishSettings): Promise<void> {
  try { await AsyncStorage.setItem(KEY, JSON.stringify(s)); } catch { /* non critico */ }
}
