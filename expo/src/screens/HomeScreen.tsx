import React, { useState } from 'react';
import { Alert, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { Clapperboard, Plus, Trash2, Video } from 'lucide-react-native';
import { Badge, Btn, Screen } from '../components/ui';
import { colors, radius } from '../theme';
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

export default function HomeScreen({ onNew, onResume }: {
  onNew: () => void;
  onResume: (p: Project) => void;
}) {
  const [history, setHistory] = useState<Project[]>([]);
  const [reload, setReload] = useState(0);

  React.useEffect(() => { loadHistory().then(setHistory); }, [reload]);

  const confirmDelete = (p: Project) =>
    Alert.alert('Elimina progetto', 'Vuoi rimuoverlo dalla cronologia?', [
      { text: 'Annulla', style: 'cancel' },
      {
        text: 'Elimina', style: 'destructive',
        onPress: async () => { await removeProject(p.id); setReload((n) => n + 1); },
      },
    ]);

  return (
    <Screen>
      <View style={styles.hero}>
        <View style={styles.heroBadge}>
          <Clapperboard size={14} color={colors.warm} />
          <Text style={styles.heroBadgeText}>STUDIO</Text>
        </View>
        <Text style={styles.heroTitle}>Dal idea al video{'\n'}pubblicato. Un flusso.</Text>
        <Text style={styles.heroSub}>
          Script, teleprompter, montaggio automatico e pubblicazione: tutto in un'unica app.
        </Text>
      </View>

      <Btn
        label="Nuovo video"
        icon={<Plus size={20} color="#fff" />}
        onPress={onNew}
        style={{ marginHorizontal: 20 }}
      />

      <Text style={styles.sectionTitle}>Cronologia</Text>

      <FlatList
        data={history}
        keyExtractor={(p) => p.id}
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 40 }}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Video size={34} color={colors.textDim} />
            <Text style={styles.emptyTitle}>Nessun video ancora</Text>
            <Text style={styles.emptyText}>
              Crea il tuo primo progetto: scegli argomento e tono, e lascia che l'app scriva lo script.
            </Text>
          </View>
        }
        renderItem={({ item }) => (
          <Pressable style={styles.card} onPress={() => onResume(item)}>
            <View style={{ flex: 1 }}>
              <Text style={styles.cardTitle} numberOfLines={2}>
                {item.scriptResult?.title || item.topic}
              </Text>
              <Text style={styles.cardMeta}>
                {item.platform} · {item.duration}s · {new Date(item.createdAt).toLocaleDateString('it-IT')}
              </Text>
              <View style={{ flexDirection: 'row', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                <Badge text={stageOf(item)} tone={item.finalVideoUrl ? 'ok' : 'accent'} />
                {item.published?.map((o) => (
                  <Badge key={o.provider} text={o.provider} tone={o.status === 'published' ? 'ok' : 'err'} />
                ))}
              </View>
            </View>
            <Pressable hitSlop={10} onPress={(e) => { e.stopPropagation(); confirmDelete(item); }}>
              <Trash2 size={18} color={colors.textDim} />
            </Pressable>
          </Pressable>
        )}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { paddingHorizontal: 20, paddingTop: 26, paddingBottom: 22 },
  heroBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 5,
    borderRadius: 999, backgroundColor: 'rgba(255,180,67,0.12)', marginBottom: 14,
  },
  heroBadgeText: { color: colors.warm, fontSize: 11, fontWeight: '800', letterSpacing: 1.5 },
  heroTitle: { color: colors.text, fontSize: 32, fontWeight: '900', letterSpacing: -1, lineHeight: 38 },
  heroSub: { color: colors.textDim, fontSize: 14.5, lineHeight: 21, marginTop: 10 },
  sectionTitle: {
    color: colors.textDim, fontSize: 12.5, fontWeight: '800', letterSpacing: 1.2,
    marginTop: 28, marginBottom: 12, paddingHorizontal: 20, textTransform: 'uppercase',
  },
  card: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border,
    padding: 16, marginBottom: 12,
  },
  cardTitle: { color: colors.text, fontSize: 16, fontWeight: '700', lineHeight: 21 },
  cardMeta: { color: colors.textDim, fontSize: 12.5, marginTop: 4, textTransform: 'capitalize' },
  empty: { alignItems: 'center', paddingVertical: 60, gap: 10, paddingHorizontal: 30 },
  emptyTitle: { color: colors.text, fontSize: 17, fontWeight: '700' },
  emptyText: { color: colors.textDim, fontSize: 13.5, textAlign: 'center', lineHeight: 20 },
});
