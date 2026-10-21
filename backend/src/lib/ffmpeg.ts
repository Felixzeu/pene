import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import path from 'path';
import { config, paths } from '../config';
import { AppError, ERR } from './errors';
import { registerTask } from './queue';
import type { Job } from './queue';
import { transcribe, type Word } from './whisper';

// Pipeline di montaggio, 100% open source e in locale:
//  1. audio → WAV per Whisper, trascrizione con timestamp per parola
//  2. taglio dei silenzi calcolati dai timestamp (sincronizzato con i sottotitoli)
//  3. pulizia audio: riduzione rumore (afftdn) + normalizzazione (loudnorm)
//  4. sottotitoli .ass stile social con parola evidenziata, incollati con burn-in
//  5. export MP4 H.264 1080x1920, 30 fps

function ff(...args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = spawn('ffmpeg', ['-hide_banner', '-y', ...args]);
    let stderr = '';
    p.stderr.on('data', (d) => { stderr += String(d); });
    p.on('error', () => reject(new AppError(ERR.ffmpegMissing, 500)));
    p.on('close', (code) => (code === 0 ? resolve(stderr) : reject(new AppError(`FFmpeg ha restituito un errore (${code}): ${stderr.slice(-300)}`, 500))));
  });
}

function fmtTime(sec: number): string {
  const cs = Math.floor((sec % 1) * 100);
  const s = Math.floor(sec) % 60;
  const m = Math.floor(sec / 60) % 60;
  const h = Math.floor(sec / 3600);
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
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
  let out = t;
  for (const r of ranges) {
    if (t >= r.to) out -= r.to - r.from;
    else break;
  }
  return Math.max(0, out);
}

/** Genera i sottotitoli .ass con la parola corrente evidenziata. */
function buildAss(words: Word[], ranges: Array<{ from: number; to: number }>): string {
  const head = `[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
WrapStyle: 2

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Social,Inter-Black,74,&H00FFFFFF,&H00FFFFFF,&H00101014,&H80000000,-1,0,0,0,100,100,0,0,1,6,2,2,60,60,560,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text`;
  const lines: string[] = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const start = fmtTime(remap(w.start, ranges));
    const end = fmtTime(remap(w.end, ranges));
    // Finestra di 6 parole centrata sulla parola corrente, evidenziata in ambra.
    const window = words.slice(Math.max(0, i - 2), i + 4);
    const text = window
      .map((x) => (x === w ? `{\\c&H2BD4FF&}${x.word}{\\c&HFFFFFF&}` : x.word))
      .join(' ');
    lines.push(`Dialogue: 0,${start},${end},Social,,0,0,0,,${text}`);
  }
  return `${head}\n${lines.join('\n')}\n`;
}

export async function editVideo(job: Job, report: (s: 'transcribing' | 'editing', p: number, m?: string) => void): Promise<void> {
  const work = path.join(paths.tmp, job.jobId);
  await fs.mkdir(work, { recursive: true });

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
  await ff('-i', cutOut, '-af', 'afftdn=nf=-25,loudnorm=I=-14:TP=-1.5:LRA=11', '-c:v', 'copy', cleanOut);

  // 3. Anteprima live: copiamo il video già tagliato e ripulito PRIMA di incollare
  // i sottotitoli. L'app lo riproduce e sovrappone i sottotitoli in tempo reale
  // usando la timeline delle parole rimappata sul video tagliato.
  await fs.mkdir(paths.videos, { recursive: true });
  const previewPath = path.join(paths.videos, `${job.jobId}-preview.mp4`);
  await fs.copyFile(cleanOut, previewPath);
  job.previewUrl = `/media/${encodeURIComponent(job.jobId)}-preview.mp4`;
  job.words = words.map((w) => ({ word: w.word, start: remap(w.start, ranges), end: remap(w.end, ranges) }));

  // 4. Sottotitoli con parola evidenziata, incollati nel video.
  report('editing', 0.8, 'Sottotitoli e export finale…');
  const assPath = path.join(work, 'subs.ass');
  await fs.writeFile(assPath, buildAss(words, ranges), 'utf8');

  const finalPath = path.join(paths.videos, `${job.jobId}.mp4`);
  await ff(
    '-i', cleanOut,
    '-vf', `scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2,ass='${assPath.replace(/\\/g, '/').replace(/'/g, "\\'")}'`,
    '-r', '30',
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '160k',
    '-movflags', '+faststart',
    finalPath,
  );

  job.finalPath = finalPath;
  report('editing', 0.98, 'Fatto');
}

// Collega la pipeline alla coda (un solo job alla volta).
registerTask(async (job, report) => {
  report('transcribing', 0.05);
  await editVideo(job, report);
});
