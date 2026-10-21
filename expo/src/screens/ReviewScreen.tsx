import React, { useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { VideoView, useVideoPlayer } from 'expo-video';
import { Film, RotateCcw } from 'lucide-react-native';
import { Btn, Header, ProgressBar, Screen } from '../components/ui';
import { colors } from '../theme';
import { uploadForEdit } from '../services/api';
import { upsertProject } from '../services/history';
import type { Project } from '../types';

// Revisione del video grezzo: riguarda, rifai la registrazione o avvia il montaggio.
export default function ReviewScreen({ project, onBack, onEdit }: {
  project: Project;
  onBack: () => void;
  onEdit: (p: Project) => void;
}) {
  const [uploadPct, setUploadPct] = useState<number | null>(null);
  const uri = project.rawVideoUri;

  // Hook sempre chiamati, prima di ogni return condizionale.
  const player = useVideoPlayer(uri ? { uri } : null, (p) => {
    p.loop = true;
    p.muted = false;
  });

  if (!uri) return null;

  const mount = async () => {
    setUploadPct(0);
    try {
      const { jobId } = await uploadForEdit(uri, project, setUploadPct);
      const next = { ...project, jobId };
      await upsertProject(next);
      onEdit(next);
    } catch (e) {
      setUploadPct(null);
      Alert.alert('Upload non riuscito', e instanceof Error ? e.message : 'Riprova.', [
        { text: 'OK' },
        { text: 'Riprova', onPress: mount },
      ]);
    }
  };

  return (
    <Screen>
      <Header title="Rivedi il video" subtitle="Controlla che tutto sia a fuoco e si senta bene" onBack={onBack} />
      <ScrollView contentContainerStyle={{ padding: 20 }}>
        <View style={styles.playerWrap}>
          <VideoView player={player} style={styles.player} contentFit="contain" />
        </View>

        {uploadPct === null ? (
          <View style={{ flexDirection: 'row', gap: 10, marginTop: 20 }}>
            <Btn label="Rifai" variant="ghost" icon={<RotateCcw size={17} color={colors.text} />} onPress={onBack} style={{ flex: 1 }} />
            <Btn label="Monta il video" icon={<Film size={18} color="#fff" />} onPress={mount} style={{ flex: 1.6 }} />
          </View>
        ) : (
          <View style={{ marginTop: 26 }}>
            <Text style={styles.uploadLabel}>Caricamento del video… {uploadPct}%</Text>
            <ProgressBar pct={uploadPct} />
            <Text style={styles.uploadHint}>
              I file grandi richiedono qualche minuto in base alla tua rete. Tieni l'app aperta.
            </Text>
          </View>
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  playerWrap: {
    borderRadius: 22, overflow: 'hidden', backgroundColor: '#000',
    aspectRatio: 9 / 16, maxHeight: 540, alignSelf: 'center', width: '100%',
  },
  player: { flex: 1 },
  uploadLabel: { color: colors.text, fontWeight: '700', marginBottom: 10 },
  uploadHint: { color: colors.textDim, fontSize: 12.5, lineHeight: 18, marginTop: 12 },
});
