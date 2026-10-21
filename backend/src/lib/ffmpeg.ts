import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import path from 'path';
import { config, paths } from '../config';
import { AppError, ERR } from './errors';
import { registerTask } from './queue';
import type { Job } from './queue';
import { transcribe, type Word } from './whisper';
import { defaultSpec, hasAudioStream, probeDuration, renderFinal } from './render';

// Pipeline di montaggio, 100% open source e in locale:
//  1. audio → WAV per Whisper, trascrizione con timestamp per parola
//  2. taglio dei silenzi calcolati dai timestamp (sincronizzato con i sottotitoli)
//  3. pulizia audio: rimozione del rumore con rete neurale RNNoise (arnndn, come Krisp)
//     + riduzione residua (afftdn) + normalizzazione (loudnorm)
//  4. sottotitoli .ass stile social con parola evidenziata, incollati con burn-in
//  5. export MP4 H.264 1080x1920, 30 fps (lib/render.ts, riusato dalle modifiche)

function ff(...args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = spawn('ffmpeg', ['-hide_banner', '-y', ...args]);
    let stderr = '';
    p.stderr.on('data', (d) => { stderr += String(d); });
    p.on('error', () => reject(new AppError(ERR.ffmpegMissing, 500)));
    p.on('close', (code) => (code === 0 ? resolve(stderr) : reject(new AppError(`FFmpeg ha restituito un errore (${code}): ${stderr.slice(-300)}`, 500))));
  });
}

/**
 * Modello RNNoise "somnolent-hogwash" (voce parlata registrata con rumore di fondo),
 * da github.com/GregorR/rnnoise-models. Percorso relativo alla cartella di lavoro:
 * su Windows un percorso assoluto contiene "C:" e andrebbe escapato nel filtro.
 */
function rnnoiseModel(): string {
  const abs = path.join(__dirname, '..', '..', 'assets', 'rnnoise', 'sh.rnnn');
  return path.relative(process.cwd(), abs).replace(/\\/g, '/');
}

/** Calcola gli intervalli da mantenere, tagliando le pause oltre soglia. */
function keepRanges(words: Word[], minSilenceSec: number): Array<{ from: number; to: number }> {
  const ranges: Array<{ from: number; to: number }> = [];
  if (words.length === 0) return [{ from: 0, to: Number.MAX_SAFE_INTEGER }];
  let from = Math.max(0, words[0].start - 0.25);
  for (let i = 0; i < words.length - 1; i++) {
    const gap = words[i + 1].start - words[i].end;
    if (gap > minSilenceSec) {
      ranges.push({ from, to: Math.min(words[i].end + 0.12, words[i + 1].start) });
      from = words[i + 1].start - 0.05;
    }
  }
  ranges.push({ from, to: words[words.length - 1].end + 0.4 });
  return ranges;
}

/** Rimappa un tempo del video originale sul timeline tagliato. */
function remap(t: number, ranges: Array<{ from: number; to: number }>): number {
  // Somma la durata dei pezzi tenuti prima di t, più la parte del pezzo in cui cade t.
  let out = 0;
  for (const r of ranges) {
    if (t >= r.to) out += r.to - r.from;
    else {
      if (t > r.from) out += t - r.from;
      break;
    }
  }
  return out;
}

export async function editVideo(job: Job, report: (s: 'transcribing' | 'editing', p: number, m?: string) => void): Promise<void> {
  const work = path.join(paths.tmp, job.jobId);
  await fs.mkdir(work, { recursive: true });

  // Video senza traccia audio (es. microfono non attivo): niente trascrizione né taglio
  // dei silenzi, ma il video si può comunque montare con testi e media.
  const withAudio = await hasAudioStream(job.rawPath);
  console.log(`[edit] ${job.jobId}: video ricevuto ${withAudio ? 'CON' : 'SENZA'} traccia audio`);
  if (!withAudio) {
    report('editing', 0.4, 'Il video non ha audio: lo preparo senza sottotitoli…');
    const silentOut = path.join(work, 'clean.mp4');
    await ff(
      '-i', job.rawPath,
      '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo',
      '-map', '0:v:0', '-map', '1:a', '-shortest',
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-c:a', 'aac',
      silentOut,
    );
    job.warning = 'Il video registrato non ha audio, quindi non ci sono sottotitoli né tagli dei silenzi. Controlla in Impostazioni › Expo Go che il Microfono sia attivo e riprova la registrazione.';
    job.words = [];
    await finish(job, silentOut, report);
    return;
  }

  report('transcribing', 0.05, 'Estrazione dell audio…');
  const audio = path.join(work, 'audio.wav');
  await ff('-i', job.rawPath, '-vn', '-ac', '1', '-ar', '16000', audio);

  report('transcribing', 0.2, 'Trascrizione con Whisper…');
  const { words } = await transcribe(audio, job.language);
  if (words.length === 0) throw new AppError('Nessuna voce rilevata nel video: registra con il microfono più vicino.', 422);

  // 1. Taglio dei silenzi basato sui timestamp delle parole.
  report('editing', 0.5, 'Taglio dei silenzi…');
  const ranges = keepRanges(words, Number(config.silenceMinMs) / 1000);
  const select = ranges
    .map((r) => `between(t,${r.from.toFixed(3)},${r.to.toFixed(3)})`)
    .join('+');
  const cutOut = path.join(work, 'cut.mp4');
  await ff(
    '-i', job.rawPath,
    '-vf', `select='${select}',setpts=N/FRAME_RATE/TB`,
    '-af', `aselect='${select}',asetpts=N/SR/TB`,
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18',
    cutOut,
  );

  // 2. Pulizia audio + normalizzazione.
  report('editing', 0.65, 'Pulizia dell audio…');
  const cleanOut = path.join(work, 'clean.mp4');
  try {
    await ff('-i', cutOut, '-af', `aresample=48000,arnndn=m='${rnnoiseModel()}',afftdn=nf=-25,loudnorm=I=-14:TP=-1.5:LRA=11`, '-c:v', 'copy', cleanOut);
  } catch {
    // FFmpeg senza arnndn o modello mancante: solo il filtro classico.
    await ff('-i', cutOut, '-af', 'afftdn=nf=-25,loudnorm=I=-14:TP=-1.5:LRA=11', '-c:v', 'copy', cleanOut);
  }

  job.words = words.map((w) => ({ word: w.word, start: remap(w.start, ranges), end: remap(w.end, ranges) }));
  await finish(job, cleanOut, report);
}

async function finish(job: Job, cleanOut: string, report: (s: 'transcribing' | 'editing', p: number, m?: string) => void): Promise<void> {
  // 3. Anteprima live: copiamo il video già tagliato e ripulito PRIMA di incollare
  // i sottotitoli. L'app lo riproduce e sovrappone i sottotitoli in tempo reale
  // usando la timeline delle parole rimappata sul video tagliato.
  await fs.mkdir(paths.videos, { recursive: true });
  const previewPath = path.join(paths.videos, `${job.jobId}-preview.mp4`);
  await fs.copyFile(cleanOut, previewPath);
  job.previewUrl = `/media/${encodeURIComponent(job.jobId)}-preview.mp4`;

  // 4. Sottotitoli con parola evidenziata, incollati nel video (stesso export usato dalle modifiche).
  // La sorgente delle modifiche è l'anteprima: resta in public/videos per 24 ore, tmp solo 2.
  report('editing', 0.8, 'Sottotitoli e export finale…');
  job.sourcePath = previewPath;
  job.duration = await probeDuration(previewPath);
  await renderFinal(job, job.spec ?? defaultSpec());
  report('editing', 0.98, 'Fatto');
}

// Collega la pipeline alla coda (un solo job alla volta).
registerTask(async (job, report) => {
  report('transcribing', 0.05);
  await editVideo(job, report);
});
