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
