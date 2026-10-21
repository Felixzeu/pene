import path from 'path';
import { existsSync, promises as fs } from 'fs';
import sharp from 'sharp';
import * as ort from 'onnxruntime-node';
import { AppError } from './errors';
import type { MediaItem } from './render';

// Scontorno automatico delle foto (toglie lo sfondo, tiene il soggetto), tutto in locale
// e gratis: modello U²-Net piccolo (u2netp, licenza Apache 2.0, 4,5 MB) eseguito con ONNX Runtime.

const MODEL = path.resolve(__dirname, '..', '..', 'assets', 'models', 'u2netp.onnx');
const SIZE = 320;
const MEAN = [0.485, 0.456, 0.406];
const STD = [0.229, 0.224, 0.225];

let session: Promise<ort.InferenceSession> | null = null;
function model() {
  if (!session) {
    if (!existsSync(MODEL)) throw new AppError('Modello per togliere lo sfondo mancante (backend/assets/models/u2netp.onnx).', 500);
    session = ort.InferenceSession.create(MODEL);
  }
  return session;
}

/** Scrive in `dest` un PNG col solo soggetto (sfondo trasparente), ritagliato attorno al soggetto. */
export async function removeBackground(src: string, dest: string): Promise<void> {
  const img = sharp(src).rotate(); // rispetta l'orientamento delle foto dell'iPhone
  const { data: rgb, info } = await img.clone().resize({ width: 1080, height: 1920, fit: 'inside', withoutEnlargement: true })
    .removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const W = info.width;
  const H = info.height;

  // Ingresso del modello: 320×320, normalizzato, NCHW.
  const small = await sharp(rgb, { raw: { width: W, height: H, channels: 3 } }).resize(SIZE, SIZE, { fit: 'fill' }).raw().toBuffer();
  const input = new Float32Array(3 * SIZE * SIZE);
  for (let i = 0; i < SIZE * SIZE; i++) {
    for (let c = 0; c < 3; c++) input[c * SIZE * SIZE + i] = (small[i * 3 + c] / 255 - MEAN[c]) / STD[c];
  }
  const s = await model();
  const out = await s.run({ [s.inputNames[0]]: new ort.Tensor('float32', input, [1, 3, SIZE, SIZE]) });
  const pred = out[s.outputNames[0]].data as Float32Array;

  // Maschera 0..255 (normalizzata min-max) riportata alla dimensione della foto.
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of pred) { if (v < lo) lo = v; if (v > hi) hi = v; }
  const mask8 = Buffer.alloc(SIZE * SIZE);
  for (let i = 0; i < mask8.length; i++) mask8[i] = Math.round(((pred[i] - lo) / (hi - lo || 1)) * 255);
  const mask = await sharp(mask8, { raw: { width: SIZE, height: SIZE, channels: 1 } }).resize(W, H, { fit: 'fill' }).blur(0.6).extractChannel(0).raw().toBuffer();

  // Riquadro del soggetto: niente bordi trasparenti inutili.
  let x0 = W, y0 = H, x1 = 0, y1 = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (mask[y * W + x] > 40) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  if (x1 <= x0 || y1 <= y0) throw new AppError('Non ho trovato un soggetto da scontornare in questa foto.', 422);
  const pad = Math.round(Math.max(W, H) * 0.02);
  x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad);
  x1 = Math.min(W - 1, x1 + pad); y1 = Math.min(H - 1, y1 + pad);

  await fs.mkdir(path.dirname(dest), { recursive: true });
  // Due passaggi: sharp applica extract prima di joinChannel, che sfaserebbe colori e maschera.
  const rgba = await sharp(rgb, { raw: { width: W, height: H, channels: 3 } })
    .joinChannel(mask, { raw: { width: W, height: H, channels: 1 } })
    .raw()
    .toBuffer();
  await sharp(rgba, { raw: { width: W, height: H, channels: 4 } })
    .extract({ left: x0, top: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 })
    .png()
    .toFile(dest);
}

/** Altezza / larghezza di una foto, già ruotata come la si vede. */
export async function imageAspect(file: string): Promise<number | undefined> {
  try {
    const m = await sharp(file).metadata();
    if (!m.width || !m.height) return undefined;
    const rotated = (m.orientation ?? 1) >= 5;
    return rotated ? m.width / m.height : m.height / m.width;
  } catch {
    return undefined;
  }
}

/**
 * Per una foto appena aggiunta: calcola le proporzioni e prepara la versione scontornata.
 * Se lo scontorno non riesce la foto resta usabile così com'è.
 */
export async function prepareImage(item: MediaItem): Promise<MediaItem> {
  if (item.kind !== 'image') return item;
  const out: MediaItem = { ...item, aspect: await imageAspect(item.path) };
  const dest = item.path.replace(/\.[^.\\/]+$/, '') + '-cutout.png';
  try {
    const t = Date.now();
    await removeBackground(item.path, dest);
    out.cutoutPath = dest;
    out.cutoutAspect = await imageAspect(dest);
    console.log(`[cutout] ${item.id} scontornata in ${Date.now() - t} ms`);
  } catch (e) {
    console.warn(`[cutout] ${item.id}: ${(e as Error).message}`);
  }
  return out;
}
