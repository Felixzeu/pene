import React, { useRef, useState } from 'react';
import { Animated, Image, PanResponder, Pressable, StyleSheet, Text, View } from 'react-native';
import { Clapperboard, Pencil, Trash2 } from 'lucide-react-native';
import { colors, fonts } from '../theme';
import { API_URL } from '../config';
import { fmt } from './Timeline';
import type { Project } from '../types';
import { locale, t } from '../i18n';

// Riga di un video (Home e "I miei video"): anteprima, titolo, data, durata e stato.
// Si scorre col dito: verso sinistra elimina (con conferma), verso destra apre la modifica.

const STAGE_LABEL: Record<string, string> = {
  script: 'Script pronto',
  record: 'Da registrare',
  review: 'Da rivedere',
  edit: 'In montaggio',
  publish: 'Pronto da pubblicare',
};

export function stageOf(p: Project): string {
  if (p.published?.length) return 'Pubblicato';
  if (p.finalVideoUrl) return STAGE_LABEL.publish;
  if (p.jobId) return STAGE_LABEL.edit;
  if (p.rawVideoUri) return STAGE_LABEL.review;
  if (p.scriptResult) return STAGE_LABEL.record;
  return STAGE_LABEL.script;
}

const SWIPE = 90; // px oltre i quali lo scorrimento fa partire l'azione

function SwipeRow({ onPress, onDelete, onEdit, onSwipe, children }: {
  onPress: () => void;
  onDelete?: (reset: () => void) => void;
  onEdit?: () => void;
  onSwipe: (active: boolean) => void;
  children: React.ReactNode;
}) {
  const x = useRef(new Animated.Value(0)).current;
  const cb = useRef({ onDelete, onEdit, onSwipe });
  cb.current = { onDelete, onEdit, onSwipe };
  const back = () => Animated.spring(x, { toValue: 0, useNativeDriver: true, bounciness: 6 }).start();
  const pan = useRef(PanResponder.create({
    // Solo gesti chiaramente orizzontali: lo scorrimento verticale resta alla lista.
    onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dx) > 12 && Math.abs(g.dx) > Math.abs(g.dy) * 1.5,
    onPanResponderGrant: () => cb.current.onSwipe(true),
    onPanResponderMove: (_e, g) => x.setValue(
      // Senza l'azione da quel lato la riga si muove appena.
      (g.dx < 0 && !cb.current.onDelete) || (g.dx > 0 && !cb.current.onEdit) ? g.dx * 0.15 : g.dx,
    ),
    onPanResponderRelease: (_e, g) => {
      cb.current.onSwipe(false);
      if (g.dx < -SWIPE && cb.current.onDelete) {
        Animated.timing(x, { toValue: -140, duration: 120, useNativeDriver: true }).start();
        cb.current.onDelete(back);
      } else if (g.dx > SWIPE && cb.current.onEdit) {
        back();
        cb.current.onEdit();
      } else back();
    },
    onPanResponderTerminate: () => { cb.current.onSwipe(false); back(); },
  })).current;

  const editOpacity = x.interpolate({ inputRange: [0, 40, SWIPE], outputRange: [0, 0.6, 1], extrapolate: 'clamp' });
  const delOpacity = x.interpolate({ inputRange: [-SWIPE, -40, 0], outputRange: [1, 0.6, 0], extrapolate: 'clamp' });
  return (
    <View style={styles.swipeWrap}>
      {onEdit && (
        <Animated.View style={[styles.behind, styles.behindEdit, { opacity: editOpacity }]}>
          <Pencil size={18} color={colors.onAccent} />
          <Text style={styles.behindText}>{t('Modifica')}</Text>
        </Animated.View>
      )}
      {onDelete && (
        <Animated.View style={[styles.behind, styles.behindDel, { opacity: delOpacity }]}>
          <Text style={styles.behindText}>{t('Elimina')}</Text>
          <Trash2 size={18} color={colors.onAccent} />
        </Animated.View>
      )}
      <Animated.View style={{ transform: [{ translateX: x }] }} {...pan.panHandlers}>
        <Pressable style={({ pressed }) => [styles.card, pressed && { opacity: 0.85 }]} onPress={onPress}>{children}</Pressable>
      </Animated.View>
    </View>
  );
}

/** Anteprima del video montato (la crea il backend a ogni export); finché non c'è, un'icona. */
function Thumb({ jobId }: { jobId?: string }) {
  const [failed, setFailed] = useState(false);
  return (
    <View style={styles.thumb}>
      {jobId && !failed ? (
        <Image source={{ uri: `${API_URL}/thumbs/${encodeURIComponent(jobId)}.jpg` }} style={StyleSheet.absoluteFill} onError={() => setFailed(true)} />
      ) : (
        <Clapperboard size={18} color={colors.textDim} />
      )}
    </View>
  );
}

export default function VideoRow({ project: p, duration, expired, onPress, onDelete, onEdit, onSwipe }: {
  project: Project;
  duration?: number | null;
  expired?: boolean;
  onPress: () => void;
  onDelete?: (reset: () => void) => void;
  onEdit?: () => void;
  onSwipe: (active: boolean) => void;
}) {
  const live = p.published?.some((o) => o.status === 'published');
  const ready = !!p.finalVideoUrl && !expired;
  const meta = [new Date(p.createdAt).toLocaleDateString(locale()), duration ? fmt(duration) : null].filter(Boolean).join(' · ');
  return (
    <SwipeRow onPress={onPress} onDelete={onDelete} onEdit={onEdit} onSwipe={onSwipe}>
      <Thumb jobId={p.finalVideoUrl ? p.jobId : undefined} />
      <View style={{ flex: 1 }}>
        <Text style={styles.cardTitle} numberOfLines={1}>{p.scriptResult?.title || p.topic}</Text>
        <Text style={styles.cardMeta}>{meta}</Text>
      </View>
      <View style={[styles.pill, { backgroundColor: live ? colors.ok : ready ? colors.warm : colors.surfaceAlt }]}>
        <Text style={[styles.pillText, { color: live || ready ? colors.onWarm : colors.textDim }]}>
          {live ? 'live' : expired ? t('scaduto') : ready ? t('pronto') : t(stageOf(p)).toLowerCase()}
        </Text>
      </View>
    </SwipeRow>
  );
}

const styles = StyleSheet.create({
  swipeWrap: { marginBottom: 10 },
  behind: {
    position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, borderRadius: 18,
    flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 20,
  },
  behindEdit: { backgroundColor: colors.accent2, justifyContent: 'flex-start' },
  behindDel: { backgroundColor: colors.err, justifyContent: 'flex-end' },
  behindText: { color: colors.onAccent, fontFamily: fonts.display, fontSize: 14 },
  card: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: colors.surface, borderRadius: 18, borderWidth: 1, borderColor: colors.border,
    padding: 12,
  },
  thumb: {
    width: 44, height: 72, borderRadius: 10, backgroundColor: colors.surfaceAlt, overflow: 'hidden',
    alignItems: 'center', justifyContent: 'center',
  },
  cardTitle: { color: colors.text, fontFamily: fonts.semibold, fontSize: 15 },
  cardMeta: { color: colors.textDim, fontSize: 12, marginTop: 3 },
  pill: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 },
  pillText: { fontSize: 11.5, fontFamily: fonts.display },
});
