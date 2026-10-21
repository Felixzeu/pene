import dotenv from 'dotenv';
dotenv.config();

// Senza slash finale: gli URL di callback devono combaciare esattamente con quelli registrati.
const PUBLIC_URL = (process.env.PUBLIC_URL ?? '').trim().replace(/\/+$/, '');

export const config = {
  port: Number(process.env.PORT ?? 3000),
  publicUrl: PUBLIC_URL || `http://localhost:${process.env.PORT ?? 3000}`,
  llmProvider: (process.env.LLM_PROVIDER ?? 'gemini') as 'gemini' | 'ollama',
  geminiKey: process.env.GEMINI_API_KEY ?? '',
  geminiModel: process.env.GEMINI_MODEL ?? 'gemini-2.0-flash',
  ollamaBaseUrl: process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434',
  ollamaModel: process.env.OLLAMA_MODEL ?? 'llama3.1',
  whisperBin: process.env.WHISPER_BIN ?? 'whisper-cli',
  whisperModel: process.env.WHISPER_MODEL ?? '/models/ggml-base.bin',
  silenceThresholdDb: process.env.SILENCE_THRESHOLD_DB ?? '-38dB',
  silenceMinMs: process.env.SILENCE_MIN_MS ?? '700',
  encryptionKey: process.env.TOKEN_ENCRYPTION_KEY ?? '',
  // Account utenti (Supabase). Senza SUPABASE_URL l'app resta "monoutente" come prima.
  supabase: {
    url: (process.env.SUPABASE_URL ?? '').trim().replace(/\/+$/, ''),
    anonKey: process.env.SUPABASE_ANON_KEY ?? '',
    serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? '', // solo per "Elimina account"
  },
  oauth: {
    youtube: {
      clientId: process.env.YOUTUBE_CLIENT_ID ?? '',
      clientSecret: process.env.YOUTUBE_CLIENT_SECRET ?? '',
      redirect: `${PUBLIC_URL}/api/auth/youtube/callback`,
      scope: 'https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.force-ssl',
    },
    instagram: {
      clientId: process.env.META_APP_ID ?? '',
      clientSecret: process.env.META_APP_SECRET ?? '',
      redirect: `${PUBLIC_URL}/api/auth/instagram/callback`,
      scope: 'instagram_basic,instagram_content_publish,pages_show_list,pages_read_engagement,business_management',
    },
    facebook: {
      clientId: process.env.META_APP_ID ?? '',
      clientSecret: process.env.META_APP_SECRET ?? '',
      redirect: `${PUBLIC_URL}/api/auth/facebook/callback`,
      scope: 'pages_show_list,pages_manage_posts,pages_read_engagement,business_management',
    },
    tiktok: {
      clientKey: process.env.TIKTOK_CLIENT_KEY ?? '',
      clientSecret: process.env.TIKTOK_CLIENT_SECRET ?? '',
      redirect: `${PUBLIC_URL}/api/auth/tiktok/callback`,
      // Solo gli scope abilitati nell'app TikTok: uno non abilitato blocca il login.
      scope: process.env.TIKTOK_SCOPES ?? 'user.info.basic,video.upload,video.publish',
    },
  },
};

export const paths = {
  tmp: 'tmp',
  videos: 'public/videos',
  tokens: 'data/tokens.json',
  media: 'data/media',
};
