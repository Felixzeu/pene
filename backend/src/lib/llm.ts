import { config } from '../config';
import { cleanTitle, normalizeHashtags } from './tags';
import { AppError, ERR } from './errors';
import { specSchema, type EditSpec } from './render';

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
- Il titolo è max 70 caratteri, nella lingua di output, accattivante, senza hashtag, senza emoji e senza virgolette.
- Gli hashtag sono 5-8, pertinenti all'argomento, nella lingua di output (più 1-2 in inglese se molto usati), minuscoli, senza "#", senza spazi né punteggiatura. Non includere "viral" né "viralapp": #viralAPP viene aggiunto in automatico.
- Se non puoi scrivere lo script per l'argomento richiesto, rispondi SOLO con {"error": "motivo breve"}.`;

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
  return parseOutput(await llmJson(SYSTEM, buildPrompt(p), 0.9));
}

/** Riscrive uno script esistente seguendo un'istruzione (più corto, hook più forte, ...). */
export async function rewriteScript(p: {
  script: string; title: string; instruction: string; tone: string; duration: number; platform: string; language: string;
}): Promise<ScriptOutput> {
  const user = `Script attuale:
"""${p.script}"""
Titolo attuale: ${p.title}
Tono: ${p.tone}
Piattaforma: ${p.platform}
Durata target: ${p.duration} secondi
Lingua di output: ${p.language}

Modifica richiesta: ${p.instruction}
Riscrivi lo script applicando SOLO questa modifica e mantenendo il resto il più possibile uguale. Aggiorna titolo e hashtag solo se serve.`;
  return parseOutput(await llmJson(SYSTEM, user, 0.7));
}

/** Chiamata al provider scelto (Gemini o Ollama) che deve rispondere in JSON. */
function llmJson(system: string, user: string, temperature: number): Promise<string> {
  return config.llmProvider === 'ollama'
    ? withRetry(() => ollamaChat(system, user), 'ollama')
    : geminiWithFallback(system, user, temperature);
}

// Gemini gratuito va spesso in sovraccarico (503) o a quota (429): si riprova
// sullo stesso modello e poi si passa ai modelli flash successivi.
function geminiModels(): string[] {
  const extra = (process.env.GEMINI_FALLBACK_MODELS ?? 'gemini-flash-latest,gemini-2.5-flash,gemini-flash-lite-latest,gemini-2.5-flash-lite')
    .split(',').map((m) => m.trim()).filter(Boolean);
  return [...new Set([config.geminiModel, ...extra])];
}

async function geminiWithFallback(system: string, user: string, temperature: number): Promise<string> {
  let last: unknown;
  // Al massimo ~75 secondi in tutto: l'app aspetta 2 minuti, meglio un errore chiaro che un timeout.
  const deadline = Date.now() + 75_000;
  for (const model of geminiModels()) {
    for (let attempt = 0; attempt < 2; attempt++) {
      if (Date.now() > deadline) break;
      try {
        return await geminiCall(model, system, user, temperature);
      } catch (e) {
        last = e;
        const status = e instanceof AppError ? e.status : 0;
        console.warn(`[gemini] ${model} tentativo ${attempt + 1}: ${e instanceof Error ? e.message : e}`);
        if (status === 404) break; // modello non disponibile: passa al successivo
        if (status !== 429 && status < 500) throw e; // rifiuti e risposte non valide non si riprovano
        if (attempt === 0) await sleep(1500 + Math.random() * 1000);
      }
    }
  }
  const status = last instanceof AppError ? last.status : 0;
  throw status === 429 ? last : new AppError('Gemini è sovraccarico in questo momento: riprova tra un minuto.', 503);
}

async function geminiCall(model: string, system: string, user: string, temperature: number): Promise<string> {
  if (!config.geminiKey) throw new AppError(ERR.geminiKey, 500);
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${config.geminiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text: user }] }],
        generationConfig: { temperature, responseMimeType: 'application/json' },
      }),
      signal: AbortSignal.timeout(40_000), // una singola risposta non deve bloccare tutto
    },
  ).catch((e) => {
    if (e?.name === 'TimeoutError') throw new AppError('Gemini non ha risposto in tempo.', 503);
    throw new AppError('Gemini non raggiungibile: controlla la connessione del backend.', 502);
  });

  if (res.status === 429) throw new AppError(ERR.quotaGemini, 429);
  if (res.status === 404) throw new AppError(`Modello Gemini ${model} non disponibile.`, 404);
  if (!res.ok) throw new AppError(`Gemini ha risposto con errore ${res.status}.`, res.status >= 500 ? 503 : 502);

  const data = (await res.json()) as {
    promptFeedback?: { blockReason?: string };
    candidates?: { finishReason?: string; content?: { parts?: { text?: string }[] } }[];
  };
  // Argomento bloccato dai filtri di sicurezza di Gemini.
  const finish = data.candidates?.[0]?.finishReason;
  if (data.promptFeedback?.blockReason || finish === 'SAFETY' || finish === 'PROHIBITED_CONTENT') {
    throw new AppError(ERR.scriptRefused, 422);
  }
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new AppError('Gemini non ha prodotto una risposta: riprova.', 502);
  return text;
}

async function ollamaChat(system: string, user: string): Promise<string> {
  try {
    const res = await fetch(`${config.ollamaBaseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: config.ollamaModel,
        stream: false,
        format: 'json',
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      }),
    });
    if (!res.ok) throw new AppError(`Ollama ha risposto con errore ${res.status}.`, 502);
    const data = (await res.json()) as { message?: { content?: string } };
    if (!data.message?.content) throw new AppError('Ollama non ha prodotto una risposta.', 502);
    return data.message.content;
  } catch (e) {
    if (e instanceof AppError) throw e;
    throw new AppError(ERR.ollamaDown, 502);
  }
}

// Frasi tipiche con cui un modello rifiuta invece di scrivere lo script.
const REFUSAL = /^(mi dispiace|non posso|non sono in grado|purtroppo non|i('| a)m sorry|sorry|i can(no|')t|i am unable|lo siento|no puedo|désolé|je ne peux)/i;

function parseOutput(raw: string): ScriptOutput {
  let text = raw.trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/); // alcuni modelli aggiungono il code fence
  if (fence) text = fence[1] as string;
  let obj: { script?: string; title?: string; hashtags?: unknown; error?: string };
  try {
    obj = JSON.parse(text);
  } catch {
    // Niente JSON: di solito è un rifiuto o una risposta fuori formato, non uno script.
    throw new AppError(REFUSAL.test(text) ? ERR.scriptRefused : ERR.scriptInvalid, 422);
  }
  if (obj.error) throw new AppError(ERR.scriptRefused, 422);
  if (!obj.script?.trim() || !obj.title) throw new AppError(ERR.scriptInvalid, 422);
  if (REFUSAL.test(obj.script.trim())) throw new AppError(ERR.scriptRefused, 422);
  return {
    script: obj.script,
    title: cleanTitle(obj.title),
    hashtags: normalizeHashtags(Array.isArray(obj.hashtags) ? obj.hashtags.map(String) : typeof obj.hashtags === 'string' ? obj.hashtags : []),
  };
}

// ── Modifiche al montaggio descritte a parole ─────────────────────────────
// L'IA riceve la spec attuale, le parole con i tempi e i media caricati, e
// restituisce la spec completa aggiornata. Il backend la valida prima di usarla.

const EDIT_SYSTEM = `Sei l'assistente di montaggio di un'app per video verticali (TikTok, Reels, Shorts).
Ricevi lo stato attuale del montaggio (JSON "spec"), la trascrizione con i tempi e i media disponibili.
Applica le modifiche chieste dall'utente e rispondi SEMPRE con JSON valido:
{"spec": <spec completa aggiornata>, "summary": "cosa hai cambiato, in una frase", "notes": "cosa NON hai potuto fare e perché (solo se serve)"}
"summary", "notes", "error" e i testi nuovi a schermo sono nella lingua indicata nel messaggio dell'utente.
Formato della spec:
{"trimStart": secondi da togliere all'inizio, "trimEnd": secondi da togliere alla fine,
 "subtitles": true|false,
 "subStyle": {"size": "small"|"medium"|"large", "color": "#RRGGBB", "x": px, "y": px (centro), "fs": grandezza in px (30-170)},
 "texts": [{"id": string, "text": string, "start": s, "end": s, "position": "top"|"center"|"bottom", "size": "small"|"medium"|"large",
            "color": "#RRGGBB", "bg": "#RRGGBB" (riquadro dietro il testo), "x": px, "y": px (centro), "fs": grandezza in px (28-220)}],
 "overlays": [{"id": string, "mediaId": id di un media disponibile, "start": s, "end": s, "mode": "full"|"pip",
               "position": "top-left"|"top-right"|"center"|"bottom-left"|"bottom-right",
               "cutout": true|false, "w": larghezza in px (120-1080, facoltativo), "x": px, "y": px (centro, facoltativi)}],
 "stickers": [{"id": string, "kind": "follow"|"like"|"subscribe"|"comment"|"share"|"link", "label": testo facoltativo, "start": s, "end": s, "position": "top"|"center"|"bottom"}]}
Strumenti:
- Sottotitoli ("subStyle"): "fs" è la grandezza (default 74; più grandi = 90-110, più piccoli = 55-65), "x"/"y" il centro
  (default x 540, y 1267, cioè centrati poco sotto la metà). "color" cambia il colore (es. rosso #FF2D2D, giallo #FFD42B,
  nero #000000, bianco #FFFFFF). Nel summary ricorda che si possono anche toccare e trascinare nell'anteprima.
- Testi nuovi: di default testo nero "#000000" su riquadro bianco "bg": "#FFFFFF", "fs" 64, "x" 540 e "y" tra 300 e 700
  (in alto, lontano dai sottotitoli). Per togliere il riquadro ometti "bg".
- "stickers": non aggiungerne di nuovi (lascia invariati quelli che ci sono).
- Se l'utente chiede un'immagine che NON è tra i media (es. "una foto della Torre Eiffel", "il logo di Instagram"),
  aggiungi un overlay con "search": "parole di ricerca brevi in inglese" al posto di "mediaId": il backend la scarica da internet.
Regole di posizionamento (fai scelte da montatore esperto):
- Tutti i tempi sono in secondi sul video FINALE, cioè dopo aver tolto trimStart. "Al secondo X" = X secondi dall'inizio del video finale.
- Se l'utente non indica i tempi, scegli il momento migliore leggendo la trascrizione: metti un'immagine quando viene nominata la cosa,
  uno sticker "follow" dopo l'hook o alla call to action, un testo sulla frase che riassume.
- Durata: testi 2-3 s, immagini 2-4 s, sticker 2.5 s, salvo indicazioni.
- Con i sottotitoli attivi non mettere testi vicino ai sottotitoli (y tra 1150 e 1400).
- Foto orizzontali o loghi: "pip" (riquadro) in "top-right"; foto che devono riempire lo schermo: "full". Non coprire il viso troppo a lungo.
- I media con "cutout": true hanno già il soggetto ritagliato (senza sfondo): usali con "cutout": true, "mode": "pip",
  "w" tra 450 e 700 e un angolo che non copra il viso (di solito "bottom-left" o "bottom-right"). Metti "cutout": false
  solo se l'utente vuole la foto intera con lo sfondo. Le coordinate su schermo sono 1080×1920 px.
- "x"/"y"/"w"/"fs" sono posizione e grandezza scelte a mano dall'utente: non cambiarle se non te lo chiede.
  Per spostare un elemento cambia "x"/"y" (centro, schermo 1080×1920: angolo in alto a destra ≈ x 800 y 450).
- Non sovrapporre nello stesso istante due elementi nella stessa posizione.
- Mantieni invariati gli elementi che l'utente non nomina; usa id nuovi e brevi per quelli nuovi.
- Se una PARTE della richiesta non si può fare (es. cambiare il font, effetti, musica),
  fai comunque tutto il resto e spiega in "notes" cosa non hai potuto fare.
- Solo se NIENTE della richiesta è realizzabile rispondi {"error": "spiegazione breve"}.`;

export async function generateEditSpec(p: {
  instruction: string;
  spec: EditSpec;
  words: { word: string; start: number; end: number }[];
  duration: number;
  media: { id: string; kind: string; name: string; duration?: number; cutout?: boolean; aspect?: number; cutoutAspect?: number }[];
  /** Scarica da internet un'immagine per un overlay con "search" e ne restituisce l'id. */
  fetchImage?: (query: string) => Promise<{ id: string; kind: string; name: string }>;
  /** Lingua dell'app: per summary, note e testi nuovi. */
  language?: string;
}): Promise<{ spec: EditSpec; summary: string; notes?: string }> {
  const shift = p.spec.trimStart;
  const finalLen = Math.max(0, p.duration - p.spec.trimStart - p.spec.trimEnd);
  const transcript = p.words
    .map((w) => ({ w: w.word, t: Math.round((w.start - shift) * 10) / 10 }))
    .filter((w) => w.t >= 0 && w.t <= finalLen)
    .map((w) => `${w.t}s ${w.w}`)
    .join('\n');
  const user = `Richiesta dell'utente: ${p.instruction}
Lingua per summary, notes e testi nuovi: ${p.language ?? 'Italiano'}

Durata del video prima del taglio: ${p.duration.toFixed(1)} s (video finale attuale: ${finalLen.toFixed(1)} s)
Spec attuale: ${JSON.stringify(p.spec)}
Media disponibili: ${JSON.stringify(p.media)}
Trascrizione (secondi sul video finale attuale):
${transcript.slice(0, 6000)}`;

  const raw = await llmJson(EDIT_SYSTEM, user, 0.2);
  let text = raw.trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) text = fence[1] as string;
  let obj: { spec?: unknown; summary?: string; notes?: string; error?: string };
  try {
    obj = JSON.parse(text);
  } catch {
    throw new AppError(ERR.editNotUnderstood, 422);
  }
  if (obj.error) throw new AppError(`L IA non può fare questa modifica: ${String(obj.error).slice(0, 200)}`, 422);
  // Immagini da cercare online: si scaricano e diventano media veri.
  const rawSpec = (obj.spec ?? {}) as { overlays?: { mediaId?: string; search?: string }[] };
  for (const o of rawSpec.overlays ?? []) {
    if (o.search && !p.media.some((m) => m.id === o.mediaId)) {
      if (!p.fetchImage) throw new AppError('Ricerca di immagini online non disponibile.', 422);
      const m = await p.fetchImage(String(o.search).slice(0, 100));
      p.media.push(m);
      o.mediaId = m.id;
    }
  }
  const parsed = specSchema.safeParse(obj.spec);
  if (!parsed.success) throw new AppError(ERR.editNotUnderstood, 422);
  // Scarta media inesistenti inventati dal modello.
  const ids = new Set(p.media.map((m) => m.id));
  // Testi nuovi: riquadro bianco con testo nero, se l'IA non ha scelto altro.
  const known = new Set(p.spec.texts.map((t) => t.id));
  const rawTexts = ((obj.spec ?? {}) as { texts?: { id?: string; bg?: unknown; color?: unknown }[] }).texts ?? [];
  const texts = parsed.data.texts.map((t) => {
    if (known.has(t.id)) return t;
    const raw = rawTexts.find((x) => x.id === t.id);
    return raw && raw.bg === undefined && raw.color === undefined ? { ...t, bg: '#FFFFFF', color: '#000000' } : t;
  });
  const spec = { ...parsed.data, texts, overlays: parsed.data.overlays.filter((o) => ids.has(o.mediaId)) };
  const notes = typeof obj.notes === 'string' && obj.notes.trim() ? obj.notes.trim().slice(0, 300) : undefined;
  return { spec, summary: (obj.summary ?? 'Modifica applicata.').slice(0, 300), notes };
}
