import React, { useRef, useState } from 'react';
import { Alert, Animated, FlatList, PanResponder, Pressable, StyleSheet, Text, View } from 'react-native';
import { Clapperboard, MessageSquareWarning, Pencil, Plus, Trash2, UserRound, Video } from 'lucide-react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Screen } from '../components/ui';
import { colors, fonts, gradient } from '../theme';
import { linkedProviders } from '../services/api';
import { loadHistory, removeProject } from '../services/history';
import type { Project } from '../types';

const STAGE_LABEL: Record<string, string> = {
  script: 'Script pronto',
  record: 'Da registrare',
  review: 'Da rivedere',
  edit: 'In montaggio',
  publish: 'Pronto da pubblicare',
};

function stageOf(p: Project): string {
  if (p.published?.length) return 'Pubblicato';
  if (p.finalVideoUrl) return STAGE_LABEL.publish;
  if (p.jobId) return STAGE_LABEL.edit;
  if (p.rawVideoUri) return STAGE_LABEL.review;
  if (p.scriptResult) return STAGE_LABEL.record;
  return STAGE_LABEL.script;
}

const SWIPE = 90; // px oltre i quali lo scorrimento fa partire l'azione

/**
 * Riga dei recenti che si scorre col dito: verso sinistra elimina (con conferma),
 * verso destra apre la modifica. Un tocco normale riprende il progetto.
 */
function SwipeRow({ onPress, onDelete, onEdit, onSwipe, children }: {
  onPress: () => void;
  onDelete: (reset: () => void) => void;
  onEdit: () => void;
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
    onPanResponderMove: (_e, g) => x.setValue(g.dx),
    onPanResponderRelease: (_e, g) => {
      cb.current.onSwipe(false);
      if (g.dx < -SWIPE) {
        Animated.timing(x, { toValue: -140, duration: 120, useNativeDriver: true }).start();
        cb.current.onDelete(back);
      } else if (g.dx > SWIPE) {
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
      <Animated.View style={[styles.behind, styles.behindEdit, { opacity: editOpacity }]}>
        <Pencil size={18} color={colors.onAccent} />
        <Text style={styles.behindText}>Modifica</Text>
      </Animated.View>
      <Animated.View style={[styles.behind, styles.behindDel, { opacity: delOpacity }]}>
        <Text style={styles.behindText}>Elimina</Text>
        <Trash2 size={18} color={colors.onAccent} />
      </Animated.View>
      <Animated.View style={{ transform: [{ translateX: x }] }} {...pan.panHandlers}>
        <Pressable style={styles.card} onPress={onPress}>{children}</Pressable>
      </Animated.View>
    </View>
  );
}

export default function HomeScreen({ onNew, onResume, onModify, onReport, onAccount }: {
  onNew: () => void;
  onResume: (p: Project) => void;
  onModify: (p: Project) => void;
  onReport: () => void;
  onAccount?: () => void;
}) {
  const [history, setHistory] = useState<Project[]>([]);
  const [swiping, setSwiping] = useState(false);
  const [reload, setReload] = useState(0);
  const [linked, setLinked] = useState(0);

  React.useEffect(() => { loadHistory().then(setHistory); }, [reload]);
  React.useEffect(() => {
    linkedProviders().then((l) => setLinked(Object.values(l).filter(Boolean).length)).catch(() => {});
  }, []);

  const weekAgo = Date.now() - 7 * 24 * 3600 * 1000;
  const thisWeek = history.filter((p) => p.createdAt > weekAgo).length;

  const confirmDelete = (p: Project, reset: () => void) =>
    Alert.alert('Elimina progetto', `Vuoi eliminare "${p.scriptResult?.title || p.topic}"?`, [
      { text: 'Annulla', style: 'cancel', onPress: reset },
      {
        text: 'Elimina', style: 'destructive',
        onPress: async () => { await removeProject(p.id); setReload((n) => n + 1); },
      },
    ]);

  const header = (
    <View>
      <View style={styles.top}>
        <Text style={styles.logo}>viral<Text style={{ color: colors.accent2 }}>.</Text></Text>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Pressable onPress={onReport} style={styles.iconBtn} accessibilityLabel="Modmail e bug report" hitSlop={6}>
            <MessageSquareWarning size={19} color={colors.text} />
          </Pressable>
          {onAccount && (
            <Pressable onPress={onAccount} style={styles.iconBtn} accessibilityLabel="Account" hitSlop={6}>
              <UserRound size={19} color={colors.text} />
            </Pressable>
          )}
        </View>
      </View>
      <Text style={styles.heroTitle}>Fai il prossimo{'\n'}video <Text style={{ color: colors.accent2 }}>virale</Text>.</Text>

      <Pressable onPress={onNew} style={({ pressed }) => [styles.newWrap, pressed && { transform: [{ scale: 0.98 }] }]}>
        <LinearGradient colors={gradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.newCard}>
          <Plus size={28} color={colors.onAccent} />
          <View>
            <Text style={styles.newTitle}>Nuovo video</Text>
            <Text style={styles.newSub}>Dall'idea al post in pochi minuti</Text>
          </View>
        </LinearGradient>
      </Pressable>

      <View style={styles.stats}>
        <View style={styles.stat}>
          <Text style={styles.statLabel}>Questa settimana</Text>
          <Text style={styles.statNum}>{thisWeek} video</Text>
        </View>
        <View style={styles.stat}>
          <Text style={styles.statLabel}>Social collegati</Text>
          <Text style={styles.statNum}>{linked} / 4</Text>
        </View>
      </View>

      <View style={styles.sectionRow}>
        <Text style={styles.sectionTitle}>Recenti</Text>
        {history.length > 0 && <Text style={styles.sectionHint}>← elimina · modifica →</Text>}
      </View>
    </View>
  );

  return (
    <Screen>
      <FlatList
        data={history}
        keyExtractor={(p) => p.id}
        ListHeaderComponent={header}
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 30 }}
        scrollEnabled={!swiping}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Video size={34} color={colors.textDim} />
            <Text style={styles.emptyTitle}>Nessun video ancora</Text>
            <Text style={styles.emptyText}>
              Crea il tuo primo progetto: scegli argomento e tono, e lascia che l'app scriva lo script.
            </Text>
          </View>
        }
        renderItem={({ item }) => {
          const live = item.published?.some((o) => o.status === 'published');
          return (
            <SwipeRow
              onPress={() => onResume(item)}
              onDelete={(reset) => confirmDelete(item, reset)}
              onEdit={() => onModify(item)}
              onSwipe={setSwiping}
            >
              <View style={styles.thumb}><Clapperboard size={18} color={colors.textDim} /></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.cardTitle} numberOfLines={1}>
                  {item.scriptResult?.title || item.topic}
                </Text>
                <Text style={styles.cardMeta}>
                  {item.platform} · {new Date(item.createdAt).toLocaleDateString('it-IT')}
                </Text>
              </View>
              <View style={[styles.pill, { backgroundColor: live ? colors.ok : item.finalVideoUrl ? colors.warm : colors.surfaceAlt }]}>
                <Text style={[styles.pillText, { color: live || item.finalVideoUrl ? colors.onAccent : colors.textDim }]}>
                  {live ? 'live' : item.finalVideoUrl ? 'pronto' : stageOf(item).toLowerCase()}
                </Text>
              </View>
            </SwipeRow>
          );
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 18 },
  logo: { color: colors.accent, fontFamily: fonts.display, fontSize: 28, letterSpacing: -1 },
  iconBtn: {
    width: 44, height: 44, borderRadius: 14, borderWidth: 1, borderColor: colors.border,
    backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center',
  },
  heroTitle: { color: colors.text, fontFamily: fonts.display, fontSize: 34, letterSpacing: -1.2, lineHeight: 38, marginTop: 26, marginBottom: 22 },
  newWrap: { borderRadius: 24, shadowColor: colors.accent2, shadowOpacity: 0.45, shadowRadius: 24, shadowOffset: { width: 0, height: 10 }, elevation: 10 },
  newCard: { height: 124, borderRadius: 24, padding: 18, justifyContent: 'space-between' },
  newTitle: { color: colors.onAccent, fontFamily: fonts.display, fontSize: 21 },
  newSub: { color: colors.onAccent, fontFamily: fonts.medium, fontSize: 13, marginTop: 2 },
  stats: { flexDirection: 'row', gap: 10, marginTop: 16 },
  stat: { flex: 1, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 18, padding: 14, gap: 4 },
  statLabel: { color: colors.textDim, fontSize: 12 },
  statNum: { color: colors.text, fontFamily: fonts.display, fontSize: 23 },
  sectionRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginTop: 26, marginBottom: 10 },
  sectionTitle: { color: colors.textDim, fontFamily: fonts.semibold, fontSize: 13 },
  sectionHint: { color: colors.textDim, fontSize: 11.5, opacity: 0.7 },
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
  thumb: { width: 44, height: 56, borderRadius: 12, backgroundColor: colors.surfaceAlt, alignItems: 'center', justifyContent: 'center' },
  cardTitle: { color: colors.text, fontFamily: fonts.semibold, fontSize: 15 },
  cardMeta: { color: colors.textDim, fontSize: 12, marginTop: 3, textTransform: 'capitalize' },
  pill: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 },
  pillText: { fontSize: 11.5, fontFamily: fonts.display },
  empty: { alignItems: 'center', paddingVertical: 50, gap: 10, paddingHorizontal: 30 },
  emptyTitle: { color: colors.text, fontFamily: fonts.semibold, fontSize: 17 },
  emptyText: { color: colors.textDim, fontSize: 13.5, textAlign: 'center', lineHeight: 20 },
});
