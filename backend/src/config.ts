import dotenv from 'dotenv';
dotenv.config();

export const config = {
  port: Number(process.env.PORT ?? 3000),
  publicUrl: process.env.PUBLIC_URL ?? `http://localhost:${process.env.PORT ?? 3000}`,
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
  oauth: {
    youtube: {
      clientId: process.env.YOUTUBE_CLIENT_ID ?? '',
      clientSecret: process.env.YOUTUBE_CLIENT_SECRET ?? '',
      redirect: `${process.env.PUBLIC_URL ?? ''}/api/auth/youtube/callback`,
      scope: 'https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.force-ssl',
    },
    instagram: {
      clientId: process.env.META_APP_ID ?? '',
      clientSecret: process.env.META_APP_SECRET ?? '',
      redirect: `${process.env.PUBLIC_URL ?? ''}/api/auth/instagram/callback`,
      scope: 'instagram_basic,instagram_content_publish,pages_show_list',
    },
    facebook: {
      clientId: process.env.META_APP_ID ?? '',
      clientSecret: process.env.META_APP_SECRET ?? '',
      redirect: `${process.env.PUBLIC_URL ?? ''}/api/auth/facebook/callback`,
      scope: 'pages_manage_posts,pages_read_engagement',
    },
    tiktok: {
      clientKey: process.env.TIKTOK_CLIENT_KEY ?? '',
      clientSecret: process.env.TIKTOK_CLIENT_SECRET ?? '',
      redirect: `${process.env.PUBLIC_URL ?? ''}/api/auth/tiktok/callback`,
      scope: 'user.info.basic,video.upload,video.publish',
    },
  },
};

export const paths = {
  tmp: 'tmp',
  videos: 'public/videos',
  tokens: 'data/tokens.json',
};
