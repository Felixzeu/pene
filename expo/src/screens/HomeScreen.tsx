import React, { useState } from 'react';
import { Alert, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { Coins, MessageSquareWarning, Plus, UserRound, Video } from 'lucide-react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Screen } from '../components/ui';
import { colors, fonts, gradient } from '../theme';
import { getWallet, linkedProviders } from '../services/api';
import { removeProject } from '../services/history';
import VideoRow from '../components/VideoRow';
import { useMyVideos } from './MyVideosScreen';
import { LANGUAGES, languageInfo, setLanguage, useLanguage } from '../services/language';
import type { Project } from '../types';
import { t } from '../i18n';

export default function HomeScreen({ onNew, onResume, onModify, onReport, onAccount, onSocials, onMyVideos }: {
  onNew: () => void;
  onResume: (p: Project) => void;
  onModify: (p: Project) => void;
  onReport: () => void;
  onAccount?: () => void;
  onSocials: () => void;
  onMyVideos: () => void;
}) {
  const [swiping, setSwiping] = useState(false);
  const [reload, setReload] = useState(0);
  const [linked, setLinked] = useState(0);
  const [coins, setCoins] = useState<number | null | undefined>(undefined);
  // Tutti i video dell'account (telefono + archivio sul server); nella Home i più recenti.
  const { videos } = useMyVideos(reload);
  const recent = videos.filter((v) => v.local).slice(0, 5);

  React.useEffect(() => {
    linkedProviders().then((l) => setLinked(Object.values(l).filter(Boolean).length)).catch(() => {});
    getWallet().then((w) => setCoins(w.coins)).catch(() => {});
  }, [reload]);

  // Lingua dell'app: vale per script e sottotitoli di tutti i nuovi video.
  const language = useLanguage();
  const pickLanguage = () => Alert.alert(
    t('Lingua dell\'app'),
    t('Testi dell\'app, script e sottotitoli dei nuovi video saranno in questa lingua. I progetti già creati non cambiano.'),
    [
      ...LANGUAGES.map((l) => ({ text: `${l.flag} ${l.label}${l.value === language ? ' ✓' : ''}`, onPress: () => setLanguage(l.value) })),
      { text: t('Annulla'), style: 'cancel' as const },
    ],
  );

  const confirmDelete = (p: Project, reset: () => void) =>
    Alert.alert(t('Elimina progetto'), t('Vuoi eliminare "{name}"?', { name: p.scriptResult?.title || p.topic }), [
      { text: t('Annulla'), style: 'cancel', onPress: reset },
      {
        text: t('Elimina'), style: 'destructive',
        onPress: async () => { await removeProject(p.id); setReload((n) => n + 1); },
      },
    ]);

  const header = (
    <View>
      <View style={styles.top}>
        <Text style={styles.logo}>viral<Text style={{ color: colors.accent }}>.</Text></Text>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Pressable onPress={pickLanguage} style={styles.coins} accessibilityLabel={`${t('Lingua')}: ${language}`} hitSlop={6}>
            <Text style={{ fontSize: 15 }}>{languageInfo(language).flag}</Text>
          </Pressable>
          {coins !== undefined && (
            <Pressable onPress={onAccount} style={styles.coins} accessibilityLabel={t('I tuoi coin')} hitSlop={6}>
              <Coins size={16} color={colors.warm} />
              <Text style={styles.coinsText}>{coins === null ? '∞' : coins}</Text>
            </Pressable>
          )}
          <Pressable onPress={onReport} style={styles.iconBtn} accessibilityLabel={t('Modmail e bug report')} hitSlop={6}>
            <MessageSquareWarning size={19} color={colors.text} />
          </Pressable>
          {onAccount && (
            <Pressable onPress={onAccount} style={styles.iconBtn} accessibilityLabel={t('Account')} hitSlop={6}>
              <UserRound size={19} color={colors.text} />
            </Pressable>
          )}
        </View>
      </View>
      <Text style={styles.heroTitle}>{t('Fai il prossimo')}{'\n'}{t('video')} <Text style={{ color: colors.accent }}>{t('virale')}</Text>.</Text>

      <Pressable onPress={onNew} style={({ pressed }) => [styles.newWrap, pressed && { transform: [{ scale: 0.98 }] }]}>
        <LinearGradient colors={gradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.newCard}>
          <Plus size={28} color={colors.onAccent} />
          <View>
            <Text style={styles.newTitle}>{t('Nuovo video')}</Text>
            <Text style={styles.newSub}>{t('Dall\'idea al post in pochi minuti')}</Text>
          </View>
        </LinearGradient>
      </Pressable>

      <View style={styles.stats}>
        <Pressable style={({ pressed }) => [styles.stat, pressed && { opacity: 0.7 }]} onPress={onMyVideos}>
          <Text style={styles.statLabel}>{t('I miei video ›')}</Text>
          <Text style={styles.statNum}>{t('{n} video', { n: videos.length })}</Text>
        </Pressable>
        <Pressable style={({ pressed }) => [styles.stat, pressed && { opacity: 0.7 }]} onPress={onSocials}>
          <Text style={styles.statLabel}>{t('Social collegati ›')}</Text>
          <Text style={styles.statNum}>{linked} / 4</Text>
        </Pressable>
      </View>

      <View style={styles.sectionRow}>
        <Text style={styles.sectionTitle}>{t('Recenti')}</Text>
        {videos.length > recent.length ? (
          <Pressable onPress={onMyVideos} hitSlop={8}><Text style={styles.seeAll}>{t('Vedi tutti')}</Text></Pressable>
        ) : recent.length > 0 && <Text style={styles.sectionHint}>{t('← elimina · modifica →')}</Text>}
      </View>
    </View>
  );

  return (
    <Screen>
      <FlatList
        data={recent}
        keyExtractor={(v) => v.project.id}
        ListHeaderComponent={header}
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 30 }}
        scrollEnabled={!swiping}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Video size={34} color={colors.textDim} />
            <Text style={styles.emptyTitle}>{t('Nessun video ancora')}</Text>
            <Text style={styles.emptyText}>
              {t('Crea il tuo primo progetto: scegli argomento e tono, e lascia che l\'app scriva lo script.')}
            </Text>
          </View>
        }
        renderItem={({ item }) => (
          <VideoRow
            project={item.project}
            duration={item.duration}
            expired={item.expired}
            onPress={() => onResume(item.project)}
            onDelete={(reset) => confirmDelete(item.project, reset)}
            onEdit={() => onModify(item.project)}
            onSwipe={setSwiping}
          />
        )}
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
  coins: {
    height: 44, borderRadius: 14, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface,
    flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12,
  },
  coinsText: { color: colors.text, fontFamily: fonts.display, fontSize: 15 },
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
  seeAll: { color: colors.accent, fontFamily: fonts.semibold, fontSize: 13 },
  empty: { alignItems: 'center', paddingVertical: 50, gap: 10, paddingHorizontal: 30 },
  emptyTitle: { color: colors.text, fontFamily: fonts.semibold, fontSize: 17 },
  emptyText: { color: colors.textDim, fontSize: 13.5, textAlign: 'center', lineHeight: 20 },
});
