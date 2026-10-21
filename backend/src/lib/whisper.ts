import { spawn } from 'child_process';
import { readFileSync } from 'fs';
import { config } from '../config';
import { AppError, ERR } from './errors';

// Trascrizione locale con whisper.cpp: nessun servizio a pagamento, nessun dato inviato online.
// Il binario produce JSON con segmenti; da qui deriviamo i timestamp per parola.

export interface Word { word: string; start: number; end: number }
export interface Segment { text: string; start: number; end: number }
export interface Transcription { segments: Segment[]; words: Word[] }

export function transcribe(audioPath: string, language: string): Promise<Transcription> {
  return new Promise((resolve, reject) => {
    const outBase = audioPath.replace(/\.[^.]+$/, '');
    const proc = spawn(config.whisperBin, [
      '-m', config.whisperModel,
      '-f', audioPath,
      '-l', language.slice(0, 2).toLowerCase(),
      '-oj', '-of', outBase,      // output JSON
      '-ml', '1',                 // max_tokens per segmento: segmenti brevi = timestamp più precisi
      '-sow',                     // split on word: include i timestamp per parola
    ]);
    let stderr = '';
    proc.stderr.on('data', (d) => { stderr += String(d); });
    proc.on('error', () => reject(new AppError(ERR.whisperMissing, 500)));
    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new AppError(`Trascrizione non riuscita: ${stderr.slice(-300)}`, 500));
        return;
      }
      try {
        // Lettura da disco (non require: il percorso è relativo e require lo cercherebbe in node_modules).
        const json = JSON.parse(readFileSync(`${outBase}.json`, 'utf8')) as {
          transcription?: { segments?: { text: string; offsets?: { from: number; to: number }; timestamps?: { from: string; to: string } }[] };
        };
        const segs = json.transcription?.segments ?? [];
        const segments: Segment[] = [];
        const words: Word[] = [];
        for (const s of segs) {
          const start = (s.offsets?.from ?? 0) / 1000;
          const end = (s.offsets?.to ?? 0) / 1000;
          const text = (s.text ?? '').trim();
          if (!text) continue;
          segments.push({ text, start, end });
          // Ripartisce le parole sul segmento in modo proporzionale alla lunghezza.
          const tokens = text.split(/\s+/);
          const total = tokens.reduce((a, t) => a + t.length, 0) || 1;
          let t0 = start;
          for (const w of tokens) {
            const dur = (end - start) * (w.length / total);
            words.push({ word: w, start: t0, end: t0 + dur });
            t0 += dur;
          }
        }
        resolve({ segments, words });
      } catch (e) {
        reject(new AppError('Impossibile leggere il risultato della trascrizione.', 500));
      }
    });
  });
}
