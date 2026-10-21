import { config } from '../config';
import { AppError, ERR } from './errors';

// Livello LLM: due provider gratuiti selezionabili con LLM_PROVIDER.
//  - gemini: API ufficiale Google, free tier (modelli Flash / Flash-Lite)
//  - ollama: 100% locale e offline sul tuo PC
// In entrambi i casi: retry con backoff esponenziale su 429/5xx.

export interface ScriptOutput { script: string; title: string; hashtags: string[] }

const SYSTEM = `Sei un ghostwriter per video verticali (Reels, TikTok, Shorts).
Regole:
- Rispondi SEMPRE con JSON valido: {"script": string, "title": string, "hashtags": string[]}
- Lo script contiene SOLO il testo parlato, niente didascalie o indicazioni di scena.
- Inizia con un hook forte nei primi 3 secondi (una domanda o un'affermazione netta).
- Frasi brevi, max 12 parole, facili da leggere ad alta voce.
- Struttura: hook, corpo (2-4 punti concreti), call to action finale.
- Durata target indicata in secondi: circa 150 parole al minuto.
- Il titolo è max 70 caratteri, senza hashtag. Gli hashtag sono 5-8, senza "#" e senza spazi.`;

function buildPrompt(p: { topic: string; tone: string; duration: number; platform: string; language: string }) {
  return `Argomento: ${p.topic}
Tono: ${p.tone}
Piattaforma: ${p.platform}
Durata target: ${p.duration} secondi
Lingua di output: ${p.language}`;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function withRetry<T>(fn: () => Promise<T>, what: string): Promise<T> {
  let last: unknown;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      const retryable = e instanceof AppError && (e.status === 429 || e.status >= 500);
      if (!retryable || attempt === 3) throw e;
      await sleep(1500 * 2 ** attempt); // backoff esponenziale
    }
  }
  throw last;
}

export async function generateScript(p: {
  topic: string; tone: string; duration: number; platform: string; language: string;
}): Promise<ScriptOutput> {
  const raw = config.llmProvider === 'ollama'
    ? await withRetry(() => ollamaChat(p), 'ollama')
    : await withRetry(() => geminiCall(p), 'gemini');
  return parseOutput(raw);
}

async function geminiCall(p: { topic: string; tone: string; duration: number; platform: string; language: string }): Promise<string> {
  if (!config.geminiKey) throw new AppError(ERR.geminiKey, 500);
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${config.geminiModel}:generateContent?key=${config.geminiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM }] },
        contents: [{ role: 'user', parts: [{ text: buildPrompt(p) }] }],
        generationConfig: { temperature: 0.9, responseMimeType: 'application/json' },
      }),
    },
  ).catch(() => { throw new AppError('Gemini non raggiungibile: controlla la connessione del backend.', 502); });

  if (res.status === 429) throw new AppError(ERR.quotaGemini, 429);
  if (!res.ok) throw new AppError(`Gemini ha risposto con errore ${res.status}.`, 502);

  const data = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new AppError('Gemini non ha prodotto uno script: riprova.', 502);
  return text;
}

async function ollamaChat(p: { topic: string; tone: string; duration: number; platform: string; language: string }): Promise<string> {
  try {
    const res = await fetch(`${config.ollamaBaseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: config.ollamaModel,
        stream: false,
        format: 'json',
        messages: [
          { role: 'system', content: SYSTEM },
          { role: 'user', content: buildPrompt(p) },
        ],
      }),
    });
    if (!res.ok) throw new AppError(`Ollama ha risposto con errore ${res.status}.`, 502);
    const data = (await res.json()) as { message?: { content?: string } };
    if (!data.message?.content) throw new AppError('Ollama non ha prodotto uno script.', 502);
    return data.message.content;
  } catch (e) {
    if (e instanceof AppError) throw e;
    throw new AppError(ERR.ollamaDown, 502);
  }
}

function parseOutput(raw: string): ScriptOutput {
  let text = raw.trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/); // alcuni modelli aggiungono il code fence
  if (fence) text = fence[1] as string;
  try {
    const obj = JSON.parse(text) as { script?: string; title?: string; hashtags?: unknown };
    if (!obj.script || !obj.title) throw new Error('missing fields');
    return {
      script: obj.script,
      title: obj.title,
      hashtags: Array.isArray(obj.hashtags) ? obj.hashtags.map(String).map((h) => h.replace(/^#/, '')) : [],
    };
  } catch {
    // Fallback: usa il testo così com'è come script.
    return { script: text, title: 'Il mio video', hashtags: [] };
  }
}
