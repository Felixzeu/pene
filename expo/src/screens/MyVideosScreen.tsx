import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, StyleSheet, Text, View } from 'react-native';
import { Video } from 'lucide-react-native';
import { Btn, Header, Screen } from '../components/ui';
import VideoRow from '../components/VideoRow';
import { colors, fonts } from '../theme';
import { listServerVideos, type ServerVideo } from '../services/api';
import { loadHistory, removeProject } from '../services/history';
import type { Project } from '../types';
import { t } from '../i18n';

export type MyVideo = { project: Project; duration: number | null; expired: boolean; local: boolean };

/**
 * Tutti i video dell'account, dal più recente: i progetti salvati sul telefono (per utente)
 * più quelli che l'archivio sul server conosce ma il telefono no (es. dopo una reinstallazione).
 */
export function useMyVideos(reload: number): { videos: MyVideo[]; loading: boolean } {
  const [state, setState] = useState<{ videos: MyVideo[]; loading: boolean }>({ videos: [], loading: true });
  useEffect(() => {
    let alive = true;
    (async () => {
      const [history, server] = await Promise.all([
        loadHistory(),
        listServerVideos().catch(() => [] as ServerVideo[]),
      ]);
      const byJob = new Map(server.map((v) => [v.id, v]));
      const out: MyVideo[] = history.map((p) => {
        const v = p.jobId ? byJob.get(p.jobId) : undefined;
        return { project: p, duration: v?.duration ?? null, expired: !!v?.expired, local: true };
      });
      const known = new Set(history.flatMap((p) => [p.id, p.jobId]).filter(Boolean));
      for (const v of server) {
        if (known.has(v.id) || (v.project_id && known.has(v.project_id))) continue;
        out.push({
          project: {
            id: v.project_id ?? v.id, topic: v.title ?? t('Video senza titolo'), tone: '', duration: 30, platform: '',
            language: '', jobId: v.id, finalVideoUrl: `/media/${encodeURIComponent(v.id)}.mp4`,
            createdAt: v.created_at ? Date.parse(v.created_at) : 0,
          },
          duration: v.duration ?? null, expired: v.expired, local: false,
        });
      }
      out.sort((a, b) => b.project.createdAt - a.project.createdAt);
      if (alive) setState({ videos: out, loading: false });
    })();
    return () => { alive = false; };
  }, [reload]);
  return state;
}

// "I miei video": tutti i video creati con questo account, non solo quelli recenti.
export default function MyVideosScreen({ onBack, onNew, onResume, onModify }: {
  onBack: () => void;
  onNew: () => void;
  onResume: (p: Project) => void;
  onModify: (p: Project) => void;
}) {
  const [reload, setReload] = useState(0);
  const [swiping, setSwiping] = useState(false);
  const { videos, loading } = useMyVideos(reload);

  const open = (v: MyVideo) => {
    if (!v.local && v.expired) {
      Alert.alert(t('Video scaduto'), t('Il file resta sul server per 24 ore dopo il montaggio: questo non è più disponibile.'));
      return;
    }
    onResume(v.project);
  };

  const confirmDelete = (p: Project, reset: () => void) =>
    Alert.alert(t('Elimina progetto'), t('Vuoi eliminare "{name}"?', { name: p.scriptResult?.title || p.topic }), [
      { text: t('Annulla'), style: 'cancel', onPress: reset },
      { text: t('Elimina'), style: 'destructive', onPress: async () => { await removeProject(p.id); setReload((n) => n + 1); } },
    ]);

  return (
    <Screen>
      <Header
        title={t('I miei video')}
        subtitle={loading ? undefined : t('{n} video, dal più recente', { n: videos.length })}
        onBack={onBack}
      />
      {loading ? (
        <ActivityIndicator color={colors.accent} style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          data={videos}
          keyExtractor={(v) => `${v.project.id}:${v.project.jobId ?? ''}`}
          contentContainerStyle={{ padding: 20, paddingBottom: 30, flexGrow: 1 }}
          scrollEnabled={!swiping}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Video size={34} color={colors.textDim} />
              <Text style={styles.emptyTitle}>{t('Nessun video ancora')}</Text>
              <Text style={styles.emptyText}>{t('Qui trovi tutti i video che crei con ViralAPP. Inizia dal primo!')}</Text>
              <Btn label={t('Nuovo video')} onPress={onNew} style={{ marginTop: 8, alignSelf: 'stretch' }} />
            </View>
          }
          renderItem={({ item }) => (
            <VideoRow
              project={item.project}
              duration={item.duration}
              expired={item.expired}
              onPress={() => open(item)}
              onDelete={item.local ? (reset) => confirmDelete(item.project, reset) : undefined}
              onEdit={item.local ? () => onModify(item.project) : undefined}
              onSwipe={setSwiping}
            />
          )}
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 50, gap: 10, paddingHorizontal: 20 },
  emptyTitle: { color: colors.text, fontFamily: fonts.semibold, fontSize: 17 },
  emptyText: { color: colors.textDim, fontSize: 13.5, textAlign: 'center', lineHeight: 20 },
});
