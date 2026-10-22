// Configurazione del client: mai chiavi API dentro l'app, tutto passa dal backend.
export const API_URL =
  process.env.EXPO_PUBLIC_BACKEND_URL ?? 'http://192.168.1.10:3000';

export const PROVIDERS = [
  { id: 'youtube', label: 'YouTube' },
  { id: 'instagram', label: 'Instagram' },
  { id: 'facebook', label: 'Facebook' },
  { id: 'tiktok', label: 'TikTok' },
] as const;

export type ProviderId = (typeof PROVIDERS)[number]['id'];

// Sito con le informative (Cloudflare Pages, cartella site/ del repo): aperte dall'app con il browser interno.
export const SITE_URL = process.env.EXPO_PUBLIC_SITE_URL ?? 'https://viral.predage.tech';
export const LEGAL = {
  privacy: `${SITE_URL}/privacy.html`,
  terms: `${SITE_URL}/terms.html`,
  deletion: `${SITE_URL}/data-deletion.html`,
} as const;

// Email pubbliche di contatto e assistenza (diverse dagli indirizzi tecnici e degli account sviluppatore).
export const CONTACT_EMAILS = ['devvfelix@gmail.com', 'porceddduuu@gmail.com'] as const;
export const SUPPORT_URL = `${SITE_URL}/support.html`;
