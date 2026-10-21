import React, { useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Mic, RefreshCw } from 'lucide-react-native';
import { Btn, Field, Header, Input, Screen, TextArea } from '../components/ui';
import { colors, radius } from '../theme';
import { generateScript } from '../services/api';
import { upsertProject } from '../services/history';
import type { Project } from '../types';

export default function ScriptScreen({ project, onBack, onRecord, update }: {
  project: Project;
  onBack: () => void;
  onRecord: (p: Project) => void;
  update: (p: Project) => void;
}) {
  const [draft, setDraft] = useState(project);
  const [regenerating, setRegenerating] = useState(false);
  const sr = draft.scriptResult;

  if (!sr) return null;

  const mutate = (p: Partial<Project>) => {
    const next = { ...draft, ...p };
    setDraft(next);
    update(next);
    upsertProject(next);
  };

  const regenerate = async () => {
    setRegenerating(true);
    try {
      const fresh = await generateScript(draft);
      mutate({ scriptResult: fresh });
    } catch (e) {
      Alert.alert('Rigenerazione non riuscita', e instanceof Error ? e.message : 'Riprova.');
    } finally {
      setRegenerating(false);
    }
  };

  // Statistiche utili per capire se lo script regge la durata scelta.
  const words = sr.script.trim().split(/\s+/).filter(Boolean).length;
  const readingSec = Math.round((words / 150) * 60); // ~150 parole al minuto

  return (
    <Screen>
      <Header title="Il tuo script" subtitle="Leggilo ad alta voce: deve suonare naturale" onBack={onBack} />
      <ScrollView contentContainerStyle={{ padding: 20 }} keyboardShouldPersistTaps="handled">
        <Field label="Titolo proposto">
          <Input value={sr.title} onChangeText={(t) => mutate({ scriptResult: { ...sr, title: t } })} />
        </Field>

        <View style={styles.statsRow}>
          <View style={styles.stat}>
            <Text style={styles.statNum}>{words}</Text>
            <Text style={styles.statLabel}>parole</Text>
          </View>
          <View style={styles.stat}>
            <Text style={[styles.statNum, { color: Math.abs(readingSec - draft.duration) > 25 ? colors.warm : colors.ok }]}>
              ~{readingSec}s
            </Text>
            <Text style={styles.statLabel}>lettura / {draft.duration}s</Text>
          </View>
        </View>

        <Field label="Script" hint="Tocca per modificare: cancella le frasi che ti vengono difficili.">
          <TextArea
            value={sr.script}
            onChangeText={(s) => mutate({ scriptResult: { ...sr, script: s } })}
            style={{ minHeight: 260, fontSize: 16, lineHeight: 25 }}
          />
        </Field>

        <Field label="Hashtag">
          <Input
            value={sr.hashtags.join(' ')}
            onChangeText={(t) => mutate({ scriptResult: { ...sr, hashtags: t.split(/\s+/).filter(Boolean) } })}
            autoCapitalize="none"
          />
        </Field>

        <View style={{ flexDirection: 'row', gap: 10 }}>
          <Btn label="Rigenera" variant="ghost" icon={<RefreshCw size={17} color={colors.text} />} onPress={regenerate} loading={regenerating} style={{ flex: 1 }} />
          <Btn label="Registra" icon={<Mic size={18} color="#fff" />} onPress={() => onRecord(draft)} style={{ flex: 1.4 }} />
        </View>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  statsRow: { flexDirection: 'row', gap: 10, marginBottom: 18 },
  stat: {
    flex: 1, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.md, padding: 12, alignItems: 'center',
  },
  statNum: { color: colors.text, fontSize: 20, fontWeight: '800' },
  statLabel: { color: colors.textDim, fontSize: 11.5, marginTop: 2 },
});
