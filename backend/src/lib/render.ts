import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import path from 'path';
import { z } from 'zod';
import { paths } from '../config';
import { AppError, ERR } from './errors';
import type { Job } from './queue';
import type { Word } from './whisper';
import { layoutStickers, overlayBox } from './stickerLayout';

// Export finale configurabile: parte dal video già tagliato e ripulito
// (lo stesso dell'anteprima) e applica le modifiche scelte nell'app o dall'IA:
// taglio di inizio/fine, sottotitoli sì/no, testi a schermo, immagini e video sovrapposti.
// Tutti i tempi sono in secondi sul video FINALE, cioè dopo il taglio di inizio.

export const textSchema = z.object({
  id: z.string().min(1).max(40),
  text: z.string().min(1).max(200),
  start: z.number().min(0),
  end: z.number().min(0),
  position: z.enum(['top', 'center', 'bottom']).default('top'),
  size: z.enum(['small', 'medium', 'large']).default('medium'),
});

export const overlaySchema = z.object({
  id: z.string().min(1).max(40),
  mediaId: z.string().min(1).max(60),
  start: z.number().min(0),
  end: z.number().min(0),
  mode: z.enum(['full', 'pip']).default('full'),
  // Solo per "pip": angolo del riquadro (lontano da viso e sottotitoli).
  position: z.enum(['top-left', 'top-right', 'center', 'bottom-left', 'bottom-right']).default('top-right'),
  search: z.string().max(120).optional(), // cosa è stato cercato online (solo informativo)
  // Foto: usa la versione scontornata (soggetto senza sfondo) se disponibile.
  cutout: z.boolean().default(true),
  // Posizione scelta a mano trascinando nell'anteprima: centro e larghezza in px su 1080×1920.
  x: z.number().min(-540).max(1620).optional(),
  y: z.number().min(-960).max(2880).optional(),
  w: z.number().min(120).max(1080).optional(),
});

// Elementi grafici pronti (niente file da caricare): pulsanti animati stile social.
export const STICKERS = {
  follow: { label: '+ SEGUI', bg: '&H5522FE&' },      // rosso TikTok #FE2255 (ASS è BGR)
  like: { label: '♥ MI PIACE', bg: '&H5522FE&' },
  subscribe: { label: 'ISCRIVITI', bg: '&H0000FF&' },  // rosso YouTube
  comment: { label: 'COMMENTA', bg: '&HFF5CA1&' },     // viola
  share: { label: 'CONDIVIDI', bg: '&HFF5CA1&' },
  link: { label: 'LINK IN BIO', bg: '&HC85CFF&' },     // rosa
} as const;

export const stickerSchema = z.object({
  id: z.string().min(1).max(40),
  kind: z.enum(Object.keys(STICKERS) as [keyof typeof STICKERS, ...(keyof typeof STICKERS)[]]),
  label: z.string().max(30).optional(), // testo personalizzato al posto di quello standard
  start: z.number().min(0),
  end: z.number().min(0),
  position: z.enum(['top', 'center', 'bottom']).default('center'),
});

export const specSchema = z.object({
  trimStart: z.number().min(0).default(0),
  trimEnd: z.number().min(0).default(0),
  subtitles: z.boolean().default(true),
  // Aspetto dei sottotitoli: grandezza e altezza sullo schermo (sempre dentro la safe area).
  subStyle: z.object({
    size: z.enum(['small', 'medium', 'large']).default('medium'),
    position: z.enum(['low', 'middle', 'high']).default('low'),
  }).default({ size: 'medium', position: 'low' }),
  texts: z.array(textSchema).max(30).default([]),
  overlays: z.array(overlaySchema).max(20).default([]),
  stickers: z.array(stickerSchema).max(20).default([]),
});

export type EditSpec = z.infer<typeof specSchema>;
export const defaultSpec = (): EditSpec => ({ trimStart: 0, trimEnd: 0, subtitles: true, subStyle: { size: 'medium', position: 'low' }, texts: [], overlays: [], stickers: [] });

/**
 * Safe area di TikTok/Reels/Shorts su 1080×1920: in basso ci sono descrizione e nome (~ultimi 480 px),
 * a destra la colonna di like/commenti/condividi (~170 px), in alto le schede (~200 px).
 * Sottotitoli e testi restano dentro questi margini.
 */
export const SAFE = { left: 90, right: 180, top: 260, bottom: 560 } as const;
export const SUB_SIZE = { small: 58, medium: 74, large: 92 } as const;
/** Sottotitoli: allineamento ASS e margine verticale per ogni altezza. */
export const SUB_POS = { low: { align: 2, marginV: SAFE.bottom }, middle: { align: 5, marginV: 0 }, high: { align: 8, marginV: 420 } } as const;

export interface MediaItem {
  id: string; kind: 'image' | 'video'; name: string; path: string; duration?: number;
  aspect?: number;        // altezza / larghezza
  cutoutPath?: string;    // PNG col solo soggetto (sfondo trasparente)
  cutoutAspect?: number;
}

/** Il file da usare per un overlay e le sue proporzioni (null = copre tutto lo schermo). */
export function overlaySource(o: { mode: 'full' | 'pip'; cutout?: boolean }, m: MediaItem): { file: string; aspect: number | null } {
  const cut = m.kind === 'image' && o.cutout !== false && !!m.cutoutPath;
  const file = cut ? m.cutoutPath! : m.path;
  if (o.mode === 'full' && !cut) return { file, aspect: null };
  return { file, aspect: (cut ? m.cutoutAspect : m.aspect) ?? 1 };
}

/** Per layoutStickers: proporzioni di ogni overlay in base al media. */
export const aspectResolver = (media: MediaItem[] = []) => (o: { mode: 'full' | 'pip'; mediaId?: string; cutout?: boolean }) => {
  const m = media.find((x) => x.id === o.mediaId);
  return m ? overlaySource(o, m).aspect : o.mode === 'pip' ? 1 : null;
};

function ff(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    // stdin chiuso: FFmpeg non resta mai in attesa di input. Limite di 15 minuti:
    // un FFmpeg bloccato non deve fermare la coda per sempre.
    const p = spawn('ffmpeg', ['-hide_banner', '-nostdin', '-y', ...args], { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    const timer = setTimeout(() => { stderr += '\n[timeout 15 minuti]'; p.kill('SIGKILL'); }, 15 * 60_000);
    p.stderr!.on('data', (d) => { stderr = (stderr + String(d)).slice(-20000); });
    p.on('error', () => { clearTimeout(timer); reject(new AppError(ERR.ffmpegMissing, 500)); });
    p.on('close', () => clearTimeout(timer));
    p.on('close', (code) => (code === 0 ? resolve(stderr) : reject(new AppError(`FFmpeg ha restituito un errore (${code}): ${stderr.slice(-300)}`, 500))));
  });
}

/** True se il file contiene almeno una traccia audio. */
export function hasAudioStream(file: string): Promise<boolean> {
  return new Promise((resolve) => {
    const p = spawn('ffmpeg', ['-hide_banner', '-i', file]);
    let stderr = '';
    p.stderr.on('data', (d) => { stderr += String(d); });
    p.on('error', () => resolve(true));
    p.on('close', () => resolve(/Stream #\d+:\d+.*: Audio:/.test(stderr)));
  });
}

/** Durata in secondi letta dall'intestazione del file (senza decodificarlo). */
export function probeDuration(file: string): Promise<number | undefined> {
  return new Promise((resolve) => {
    const p = spawn('ffmpeg', ['-hide_banner', '-i', file]);
    let stderr = '';
    p.stderr.on('data', (d) => { stderr += String(d); });
    p.on('error', () => resolve(undefined));
    p.on('close', () => {
      const m = stderr.match(/Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/);
      resolve(m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : undefined);
    });
  });
}

function fmtTime(sec: number): string {
  const t = Math.max(0, sec);
  const cs = Math.floor((t % 1) * 100);
  const s = Math.floor(t) % 60;
  const m = Math.floor(t / 60) % 60;
  const h = Math.floor(t / 3600);
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

// Le graffe sono comandi in ASS: le togliamo dal testo dell'utente.
const assText = (s: string) => s.replace(/[{}]/g, '').replace(/\r?\n/g, '\\N');

const SIZE = { small: 56, medium: 72, large: 96 } as const;

/** Sottotitoli karaoke + testi dell'utente in un unico file .ass (libass, niente font da configurare). */
export function buildAss(words: Word[], spec: EditSpec, media: MediaItem[] = []): string {
  const ss = spec.subStyle ?? { size: 'medium', position: 'low' };
  const sp = SUB_POS[ss.position];
  const head = `[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
WrapStyle: 0

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Social,Inter-Black,${SUB_SIZE[ss.size]},&H00FFFFFF,&H00FFFFFF,&H00101014,&H80000000,-1,0,0,0,100,100,0,0,1,6,2,${sp.align},${SAFE.left},${SAFE.right},${sp.marginV},1
Style: TextTop,Inter-Black,72,&H00FFFFFF,&H00FFFFFF,&H00101014,&H80000000,-1,0,0,0,100,100,0,0,1,6,2,8,${SAFE.left},${SAFE.right},${SAFE.top},1
Style: TextCenter,Inter-Black,72,&H00FFFFFF,&H00FFFFFF,&H00101014,&H80000000,-1,0,0,0,100,100,0,0,1,6,2,5,${SAFE.left},${SAFE.right},0,1
Style: TextBottom,Inter-Black,72,&H00FFFFFF,&H00FFFFFF,&H00101014,&H80000000,-1,0,0,0,100,100,0,0,1,6,2,2,${SAFE.left},${SAFE.right},${SAFE.bottom},1
Style: Sticker,Inter-Black,62,&H00FFFFFF,&H00FFFFFF,&H00000000,&H64000000,-1,0,0,0,100,100,1,0,1,0,0,5,0,0,0,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text`;
  const lines: string[] = [];
  if (spec.subtitles) {
    // Stile TikTok: gruppi di max 4 parole che restano fermi a schermo, con la parola
    // pronunciata evidenziata in ambra. Il gruppo cambia a fine frase o dopo una pausa.
    const pages: Word[][] = [];
    for (const w of words) {
      const page = pages[pages.length - 1];
      const prev = page?.[page.length - 1];
      if (!page || page.length >= 4 || (prev && (w.start - prev.end > 0.6 || /[.!?…]$/.test(prev.word)))) pages.push([w]);
      else page.push(w);
    }
    for (const page of pages) {
      for (let i = 0; i < page.length; i++) {
        const w = page[i];
        // Resta acceso fino alla parola dopo (niente sfarfallio tra una parola e l'altra).
        const end = i < page.length - 1 ? page[i + 1].start : w.end + 0.15;
        const text = page
          .map((x) => (x === w ? `{\\c&H2BD4FF&}${assText(x.word)}{\\c&HFFFFFF&}` : assText(x.word)))
          .join(' ');
        lines.push(`Dialogue: 0,${fmtTime(w.start)},${fmtTime(Math.max(end, w.start + 0.05))},Social,,0,0,0,,${text}`);
      }
    }
  }
  for (const t of spec.texts) {
    const style = { top: 'TextTop', center: 'TextCenter', bottom: 'TextBottom' }[t.position];
    lines.push(`Dialogue: 1,${fmtTime(t.start)},${fmtTime(t.end)},${style},,0,0,0,,{\\fs${SIZE[t.size]}}${assText(t.text)}`);
  }
  // Pulsanti: rettangolo arrotondato disegnato in ASS + testo, con entrata "pop" e una pulsazione.
  const Y = layoutStickers(spec, aspectResolver(media)); // niente sovrapposizioni tra pulsanti, testi e sottotitoli
  for (const st of spec.stickers ?? []) {
    const def = STICKERS[st.kind];
    const label = assText((st.label || def.label).toUpperCase());
    const w = Math.max(360, Math.min(900, 70 + label.length * 42));
    const h = 130;
    const r = h / 2;
    const box = `m ${r} 0 l ${w - r} 0 b ${w} 0 ${w} ${h} ${w - r} ${h} l ${r} ${h} b 0 ${h} 0 0 ${r} 0`;
    const y = Y[st.id];
    const anim = '\\fscx0\\fscy0\\t(0,180,\\fscx112\\fscy112)\\t(180,300,\\fscx100\\fscy100)\\t(900,1100,\\fscx106\\fscy106)\\t(1100,1300,\\fscx100\\fscy100)';
    const t0 = fmtTime(st.start);
    const t1 = fmtTime(Math.max(st.end, st.start + 0.5));
    lines.push(`Dialogue: 2,${t0},${t1},Sticker,,0,0,0,,{\\an5\\pos(540,${y})\\bord0\\shad6\\4c&H000000&\\1c${def.bg}${anim}\\p1}${box}{\\p0}`);
    lines.push(`Dialogue: 3,${t0},${t1},Sticker,,0,0,0,,{\\an5\\pos(540,${y})\\bord0\\shad0\\1c&HFFFFFF&${anim}}${label}`);
  }
  return `${head}\n${lines.join('\n')}\n`;
}

/** Rende il video finale di un job applicando la spec. Scrive su un file temporaneo e poi lo sostituisce. */
export async function renderFinal(job: Job, spec: EditSpec): Promise<void> {
  if (!job.sourcePath) throw new AppError(ERR.jobNotFound, 404);
  const duration = job.duration ?? (await probeDuration(job.sourcePath)) ?? 0;
  const t0 = Math.min(spec.trimStart, Math.max(0, duration - 1));
  const t1 = spec.trimEnd > 0 ? Math.max(t0 + 1, duration - spec.trimEnd) : duration;
  const outLen = t1 - t0;

  // Parole spostate sulla timeline finale (dopo il taglio di inizio).
  const words = (job.words ?? [])
    .map((w) => ({ ...w, start: w.start - t0, end: w.end - t0 }))
    .filter((w) => w.end > 0 && w.start < outLen);

  const work = path.join(paths.tmp, job.jobId);
  await fs.mkdir(work, { recursive: true });
  const assPath = path.join(work, 'final.ass');
  await fs.writeFile(assPath, buildAss(words, spec, job.media), 'utf8');

  const inputs: string[] = ['-i', job.sourcePath];
  const chain: string[] = [
    `[0:v]trim=start=${t0.toFixed(3)}:end=${t1.toFixed(3)},setpts=PTS-STARTPTS,` +
      'scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30[v0]',
    `[0:a]atrim=start=${t0.toFixed(3)}:end=${t1.toFixed(3)},asetpts=PTS-STARTPTS[aout]`,
  ];
  let last = 'v0';
  let n = 0;
  for (const o of spec.overlays) {
    const media = job.media?.find((m) => m.id === o.mediaId);
    if (!media) continue;
    const start = Math.max(0, Math.min(o.start, outLen));
    const end = Math.min(Math.max(o.end, start + 0.2), outLen);
    if (end <= start) continue;
    n++;
    const src = overlaySource(o, media);
    if (media.kind === 'image') inputs.push('-loop', '1', '-i', src.file);
    else inputs.push('-i', src.file);
    let fit = 'scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920';
    let pos = '0:0';
    if (src.aspect != null) {
      // Riquadro o foto scontornata: scalata intera (niente ritagli), alla posizione calcolata.
      const b = overlayBox(o, src.aspect);
      fit = media.kind === 'video' && !media.aspect ? `scale=${b.w}:-2` : `scale=${b.w}:${b.h}`;
      pos = `${b.left}:${b.top}`;
    }
    const prep = media.kind === 'video'
      ? `trim=duration=${(end - start).toFixed(3)},setpts=PTS-STARTPTS+${start.toFixed(3)}/TB,`
      : '';
    chain.push(`[${n}:v]${prep}${fit},setsar=1,format=rgba[o${n}]`);
    const tail = media.kind === 'image' ? ':shortest=1' : ':eof_action=pass';
    chain.push(`[${last}][o${n}]overlay=${pos}:enable='between(t,${start.toFixed(3)},${end.toFixed(3)})'${tail}[v${n}]`);
    last = `v${n}`;
  }
  const assArg = assPath.replace(/\\/g, '/').replace(/'/g, "\\'");
  chain.push(`[${last}]ass='${assArg}',format=yuv420p[vout]`);

  const finalPath = path.join(paths.videos, `${job.jobId}.mp4`);
  const tmpOut = path.join(work, 'final-render.mp4');
  await ff([
    ...inputs,
    '-filter_complex', chain.join(';'),
    '-map', '[vout]', '-map', '[aout]',
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '20',
    '-c:a', 'aac', '-b:a', '160k',
    '-movflags', '+faststart',
    tmpOut,
  ]);
  await fs.mkdir(paths.videos, { recursive: true });
  await fs.copyFile(tmpOut, finalPath);
  await fs.rm(tmpOut, { force: true });
  job.finalPath = finalPath;
  job.spec = spec;
}
