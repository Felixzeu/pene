import { spawn } from 'child_process';
import { readFileSync } from 'fs';
import { config } from '../config';
import { AppError, ERR } from './errors';

// Trascrizione locale con whisper.cpp: nessun servizio a pagamento, nessun dato inviato online.
// Il binario produce JSON con segmenti; da qui deriviamo i timestamp per parola.

export interface Word { word: string; start: number; end: number }
export interface Segment { text: string; start: number; end: number }
export interface Transcription { segments: Segment[]; words: Word[] }

// Modello DTW di whisper.cpp dal nome del file (ggml-base.bin → base): allinea
// ogni parola all'audio molto meglio dei timestamp standard.
function dtwPreset(model: string): string | undefined {
  if (process.env.WHISPER_DTW === 'off') return undefined;
  if (process.env.WHISPER_DTW) return process.env.WHISPER_DTW;
  const m = model.toLowerCase().match(/ggml-(tiny|base|small|medium|large-v3-turbo|large-v3|large-v2|large-v1)(\.en)?/);
  if (!m) return undefined;
  return `${m[1].replace(/-v/, '.v').replace('.v3-turbo', '.v3.turbo')}${m[2] ?? ''}`;
}

function runWhisper(args: string[]): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve, reject) => {
    const proc = spawn(config.whisperBin, args);
    let stderr = '';
    proc.stderr.on('data', (d) => { stderr += String(d); });
    proc.on('error', () => reject(new AppError(ERR.whisperMissing, 500)));
    proc.on('close', (code) => resolve({ code: code ?? 1, stderr }));
  });
}

type RawToken = { text: string; offsets?: { from: number; to: number }; t_dtw?: number };
type RawSegment = { text: string; offsets?: { from: number; to: number }; tokens?: RawToken[] };

/** Parole con i tempi dei token (DTW se c'è); i token che iniziano con uno spazio aprono una parola nuova. */
export function wordsFromTokens(segs: RawSegment[]): Word[] {
  const words: Word[] = [];
  for (const s of segs) {
    for (const t of s.tokens ?? []) {
      if (/^\[_|^\[[A-Z_ ]+\]$|^<\|/.test(t.text)) continue; // token speciali ([_BEG_], [_TT_..])
      const from = t.t_dtw !== undefined && t.t_dtw >= 0 ? t.t_dtw * 10 : t.offsets?.from ?? 0;
      const to = Math.max(from + 40, t.offsets?.to ?? from + 200);
      const last = words[words.length - 1];
      if (/^\s/.test(t.text) || !last) {
        const w = t.text.trim();
        if (w) words.push({ word: w, start: from / 1000, end: to / 1000 });
      } else {
        last.word += t.text;
        last.end = Math.max(last.end, to / 1000);
      }
    }
  }
  // Pulisce marcatori non parlati e rende i tempi monotoni (ogni parola finisce dove inizia la successiva, se vicina).
  const clean = words
    .map((w) => ({ ...w, word: w.word.replace(/\[[^\]]*\]|\([^)]*\)/g, '').trim() }))
    .filter((w) => w.word);
  for (let i = 0; i < clean.length; i++) {
    const next = clean[i + 1];
    if (i > 0 && clean[i].start < clean[i - 1].start) clean[i].start = clean[i - 1].start + 0.02;
    if (next) clean[i].end = Math.min(Math.max(clean[i].end, clean[i].start + 0.08), Math.max(next.start, clean[i].start + 0.08));
  }
  return clean;
}

export async function transcribe(audioPath: string, language: string): Promise<Transcription> {
  const outBase = audioPath.replace(/\.[^.]+$/, '');
  const base = [
    '-m', config.whisperModel,
    '-f', audioPath,
    '-l', language.slice(0, 2).toLowerCase(),
    '-ojf', '-of', outBase, // JSON completo: include i token con i loro tempi
  ];
  const dtw = dtwPreset(config.whisperModel);
  let r = await runWhisper(dtw ? [...base, '--dtw', dtw] : base);
  if (r.code !== 0 && dtw) {
    console.warn(`[whisper] --dtw ${dtw} non supportato, riprovo senza`);
    r = await runWhisper(base);
  }
  if (r.code !== 0) throw new AppError(`Trascrizione non riuscita: ${r.stderr.slice(-300)}`, 500);
  try {
    // Lettura da disco (non require: il percorso è relativo e require lo cercherebbe in node_modules).
    const json = JSON.parse(readFileSync(`${outBase}.json`, 'utf8')) as {
      transcription?: RawSegment[] | { segments?: RawSegment[] };
    };
    const segs = Array.isArray(json.transcription) ? json.transcription : json.transcription?.segments ?? [];
    const segments: Segment[] = segs
      .map((s) => ({
        text: (s.text ?? '').replace(/\[[^\]]*\]|\([^)]*\)/g, '').trim(),
        start: (s.offsets?.from ?? 0) / 1000,
        end: (s.offsets?.to ?? 0) / 1000,
      }))
      .filter((s) => s.text);
    let words = wordsFromTokens(segs);
    if (words.length === 0) words = proportionalWords(segments); // vecchie versioni senza token
    const offset = Number(process.env.SUB_OFFSET_MS ?? 0) / 1000;
    if (offset) words = words.map((w) => ({ ...w, start: Math.max(0, w.start + offset), end: Math.max(0, w.end + offset) }));
    console.log(`[whisper] ${words.length} parole${dtw ? ` (allineamento DTW ${dtw})` : ''}`);
    return { segments, words };
  } catch (e) {
    if (e instanceof AppError) throw e;
    throw new AppError('Impossibile leggere il risultato della trascrizione.', 500);
  }
}

// Ripiego: parole distribuite sul segmento in proporzione alla lunghezza.
function proportionalWords(segments: Segment[]): Word[] {
  const words: Word[] = [];
  for (const s of segments) {
    const tokens = s.text.split(/\s+/);
    const total = tokens.reduce((a, t) => a + t.length, 0) || 1;
    let t0 = s.start;
    for (const w of tokens) {
      const dur = (s.end - s.start) * (w.length / total);
      words.push({ word: w, start: t0, end: t0 + dur });
      t0 += dur;
    }
  }
  return words;
}
