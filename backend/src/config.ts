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
  cutPauses: process.env.CUT_PAUSES === '1',
  encryptionKey: process.env.TOKEN_ENCRYPTION_KEY ?? '',
  // Account utenti (Supabase). Senza SUPABASE_URL l'app resta "monoutente" come prima.
  supabase: {
    url: (process.env.SUPABASE_URL ?? '').trim().replace(/\/+$/, ''),
    anonKey: process.env.SUPABASE_ANON_KEY ?? '',
    serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? '', // solo per "Elimina account"
  },
  // Amministratori (email separate da virgola): nessun limite, accesso a tutte le funzioni.
  // Coin: costo di ogni azione e bonus di benvenuto (modificabili dal file .env).
  coins: {
    welcome: Number(process.env.COINS_WELCOME ?? 20),
    script: Number(process.env.COIN_COST_SCRIPT ?? 1),
    rewrite: Number(process.env.COIN_COST_REWRITE ?? 1),
    edit: Number(process.env.COIN_COST_EDIT ?? 5),
    ai: Number(process.env.COIN_COST_AI ?? 1),
    render: Number(process.env.COIN_COST_RENDER ?? 2),
    publish: Number(process.env.COIN_COST_PUBLISH ?? 1),
  },
  adminEmails: (process.env.ADMIN_EMAILS ?? '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean),
  oauth: {
    youtube: {
      clientId: process.env.YOUTUBE_CLIENT_ID ?? '',
      clientSecret: process.env.YOUTUBE_CLIENT_SECRET ?? '',
      redirect: `${PUBLIC_URL}/api/auth/youtube/callback`,
      // Caricare video + leggere il proprio canale (per controllare che esista): niente permessi di gestione.
      scope: 'https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly',
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
      // Direct Post usa solo video.publish (video.upload servirebbe per le bozze, che non usiamo).
      scope: process.env.TIKTOK_SCOPES ?? 'user.info.basic,video.publish',
    },
  },
};

export const paths = {
  tmp: 'tmp',
  videos: 'public/videos',
  thumbs: 'public/thumbs', // anteprime dei video: restano anche dopo che il video scade
  tokens: 'data/tokens.json',
  media: 'data/media',
};
