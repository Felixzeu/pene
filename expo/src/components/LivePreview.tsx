import React, { useEffect, useState } from 'react';
import { Image, LayoutChangeEvent, StyleSheet, Text, View } from 'react-native';
import { VideoView, type VideoPlayer } from 'expo-video';
import { colors } from '../theme';
import type { EditSpec, MediaItem, StickerKind, Word } from '../types';

// Anteprima live del montaggio: il video tagliato (senza nulla incollato) con sopra
// testi, sottotitoli, sticker e immagini disegnati dall'app nei tempi giusti.
// Così si vede subito ogni modifica senza aspettare l'export: è un'approssimazione
// fedele del video finale (stesse posizioni, scalate da 1080×1920).

const STICKER: Record<StickerKind, { label: string; bg: string }> = {
  follow: { label: '+ SEGUI', bg: '#FE2255' },
  like: { label: '♥ MI PIACE', bg: '#FE2255' },
  subscribe: { label: 'ISCRIVITI', bg: '#FF0000' },
  comment: { label: 'COMMENTA', bg: '#A15CFF' },
  share: { label: 'CONDIVIDI', bg: '#A15CFF' },
  link: { label: 'LINK IN BIO', bg: '#FF5CC8' },
};
const TEXT_SIZE = { small: 56, medium: 72, large: 96 } as const;
const STICKER_Y = { top: 330, center: 960, bottom: 1540 } as const;

/** Gruppi di max 4 parole come nel video finale. */
function pageAt(words: Word[], t: number): { words: Word[]; current: Word } | null {
  const pages: Word[][] = [];
  for (const w of words) {
    const page = pages[pages.length - 1];
    const prev = page?.[page.length - 1];
    if (!page || page.length >= 4 || (prev && (w.start - prev.end > 0.6 || /[.!?…]$/.test(prev.word)))) pages.push([w]);
    else page.push(w);
  }
  for (const page of pages) {
    for (let i = 0; i < page.length; i++) {
      const end = i < page.length - 1 ? page[i + 1].start : page[i].end + 0.15;
      if (t >= page[i].start && t < end) return { words: page, current: page[i] };
    }
  }
  return null;
}

export default function LivePreview({ player, spec, words, media, duration, mediaUri }: {
  player: VideoPlayer;
  spec: EditSpec;
  words: Word[];
  media: MediaItem[];
  duration: number;
  mediaUri: (id: string) => string;
}) {
  const [w, setW] = useState(0);
  const [t, setT] = useState(0); // tempo sul video FINALE (dopo il taglio iniziale)
  const end = Math.max(spec.trimStart + 0.5, duration - spec.trimEnd);

  // Segue il video e rispetta il taglio: riparte da trimStart quando arriva alla fine tagliata.
  useEffect(() => {
    const id = setInterval(() => {
      const cur = player.currentTime ?? 0;
      if (cur < spec.trimStart - 0.05 || cur > end) {
        player.currentTime = spec.trimStart;
        setT(0);
      } else {
        setT(cur - spec.trimStart);
      }
    }, 80);
    return () => clearInterval(id);
  }, [player, spec.trimStart, end]);

  const s = w / 1080; // scala da 1080 px
  const shifted = words.map((x) => ({ ...x, start: x.start - spec.trimStart, end: x.end - spec.trimStart }));
  const sub = spec.subtitles ? pageAt(shifted, t) : null;
  const on = (a: { start: number; end: number }) => t >= a.start && t < Math.max(a.end, a.start + 0.2);

  return (
    <View style={styles.wrap} onLayout={(e: LayoutChangeEvent) => setW(e.nativeEvent.layout.width)}>
      <VideoView player={player} style={StyleSheet.absoluteFill} contentFit="contain" nativeControls={false} />
      {w > 0 && (
        <View style={StyleSheet.absoluteFill} pointerEvents="none">
          {spec.overlays.filter(on).map((o) => {
            const m = media.find((x) => x.id === o.mediaId);
            const pipW = 460 * s;
            const pos = o.mode === 'full' ? { position: 'absolute' as const, top: 0, left: 0, right: 0, bottom: 0 } : {
              position: 'absolute' as const, width: pipW, height: pipW,
              ...({
                'top-left': { left: 50 * s, top: 220 * s },
                'top-right': { right: 50 * s, top: 220 * s },
                center: { left: (w - pipW) / 2, top: (w * 16 / 9 - pipW) / 2 },
                'bottom-left': { left: 50 * s, bottom: 640 * s },
                'bottom-right': { right: 50 * s, bottom: 640 * s },
              }[o.position ?? 'top-right']),
            };
            return m?.kind === 'image' ? (
              <Image key={o.id} source={{ uri: mediaUri(m.id) }} style={[pos, o.mode === 'pip' && { borderRadius: 12 * s }]} resizeMode={o.mode === 'full' ? 'cover' : 'contain'} />
            ) : (
              <View key={o.id} style={[pos, styles.videoBox]}><Text style={styles.videoText}>VIDEO</Text></View>
            );
          })}

          {sub && (
            <View style={[styles.lineBox, { bottom: 560 * s }]}>
              <Text style={[styles.outline, { fontSize: 74 * s, lineHeight: 88 * s }]}>
                {sub.words.map((x, i) => (
                  <Text key={i} style={x === sub.current ? { color: '#FFD42B' } : undefined}>{x.word}{i < sub.words.length - 1 ? ' ' : ''}</Text>
                ))}
              </Text>
            </View>
          )}

          {spec.texts.filter(on).filter((x) => x.text.trim()).map((x) => (
            <View
              key={x.id}
              style={[
                styles.lineBox,
                x.position === 'top' ? { top: 260 * s } : x.position === 'bottom' ? { bottom: 320 * s } : { top: 0, bottom: 0, justifyContent: 'center' },
              ]}
            >
              <Text style={[styles.outline, { fontSize: TEXT_SIZE[x.size] * s, lineHeight: TEXT_SIZE[x.size] * 1.2 * s }]}>{x.text}</Text>
            </View>
          ))}

          {(spec.stickers ?? []).filter(on).map((x) => {
            const def = STICKER[x.kind];
            const label = (x.label || def.label).toUpperCase();
            const bw = Math.max(360, Math.min(900, 70 + label.length * 42)) * s;
            const bh = 130 * s;
            return (
              <View key={x.id} style={[styles.sticker, { width: bw, height: bh, borderRadius: bh / 2, backgroundColor: def.bg, left: (w - bw) / 2, top: STICKER_Y[x.position] * s - bh / 2 }]}>
                <Text style={{ color: '#fff', fontWeight: '900', fontSize: 62 * s }}>{label}</Text>
              </View>
            );
          })}
        </View>
      )}
      <View style={styles.badge}><Text style={styles.badgeText}>ANTEPRIMA</Text></View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderRadius: 22, overflow: 'hidden', backgroundColor: '#000',
    aspectRatio: 9 / 16, width: '68%', alignSelf: 'center', marginBottom: 16,
  },
  lineBox: { position: 'absolute', left: 0, right: 0, alignItems: 'center', paddingHorizontal: '6%' },
  outline: {
    color: '#fff', fontWeight: '900', textAlign: 'center',
    textShadowColor: 'rgba(16,16,20,0.95)', textShadowRadius: 6, textShadowOffset: { width: 0, height: 0 },
  },
  sticker: {
    position: 'absolute', alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOpacity: 0.5, shadowRadius: 4, shadowOffset: { width: 3, height: 3 },
  },
  videoBox: { backgroundColor: 'rgba(161,92,255,0.35)', alignItems: 'center', justifyContent: 'center' },
  videoText: { color: '#fff', fontWeight: '800', fontSize: 12 },
  badge: { position: 'absolute', top: 10, left: 10, backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  badgeText: { color: colors.accent, fontSize: 10, fontWeight: '800', letterSpacing: 1 },
});
