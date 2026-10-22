import React, { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { FolderOpen, Mic, RefreshCw, Sparkles, Undo2 } from 'lucide-react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { Btn, Field, Header, Input, Screen, TextArea } from '../components/ui';
import ScriptLoading from '../components/ScriptLoading';
import { colors, radius } from '../theme';
import { generateScript, rewriteScript } from '../services/api';
import { upsertProject } from '../services/history';
import type { Project } from '../types';

export default function ScriptScreen({ project, onBack, onRecord, onUpload, update }: {
  project: Project;
  onBack: () => void;
  onRecord: (p: Project) => void;
  onUpload: (p: Project, uri: string) => void;
  update: (p: Project) => void;
}) {
  const [draft, setDraft] = useState(project);
  const [regenerating, setRegenerating] = useState(false);
  const [rewriting, setRewriting] = useState<string | null>(null);
  const [ask, setAsk] = useState('');
  const [history, setHistory] = useState<NonNullable<Project['scriptResult']>[]>([]);
  const sr = draft.scriptResult;

  if (!sr) return null;
  if (regenerating) return <ScriptLoading />;

  const mutate = (p: Partial<Project>) => {
    const next = { ...draft, ...p };
    setDraft(next);
    update(next);
    upsertProject(next);
  };

  // Invece di registrare si può usare un video già pronto.
  const fromGallery = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Permesso negato', 'Consenti l\'accesso alle foto dalle Impostazioni per scegliere un video.');
      return;
    }
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['videos'],
      quality: 1,
      preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
    });
    if (!res.canceled && res.assets[0]) onUpload(draft, res.assets[0].uri);
  };
  const fromFiles = async () => {
    const res = await DocumentPicker.getDocumentAsync({ type: 'video/*', copyToCacheDirectory: true });
    if (!res.canceled && res.assets[0]) onUpload(draft, res.assets[0].uri);
  };
  const upload = () => Alert.alert('Carica un video', 'Da dove lo prendi?', [
    { text: 'Galleria', onPress: fromGallery },
    { text: 'File', onPress: fromFiles },
    { text: 'Annulla', style: 'cancel' },
  ]);

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

  // Modifiche rapide con l'IA restando su questa schermata; "Annulla" torna alla versione prima.
  const rewrite = async (instruction: string, label: string) => {
    if (rewriting) return;
    setRewriting(label);
    try {
      const fresh = await rewriteScript({ ...draft, script: sr.script, title: sr.title, instruction });
      setHistory((h) => [...h.slice(-9), sr]);
      mutate({ scriptResult: fresh });
      if (label === 'ask') setAsk('');
    } catch (e) {
      Alert.alert('Modifica non riuscita', e instanceof Error ? e.message : 'Riprova.');
    } finally {
      setRewriting(null);
    }
  };
  const undo = () => {
    const prev = history[history.length - 1];
    if (!prev) return;
    setHistory((h) => h.slice(0, -1));
    mutate({ scriptResult: prev });
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

        <Text style={styles.section}>Modifica con l'IA</Text>
        <View style={styles.chips}>
          {QUICK.map((q) => (
            <Pressable
              key={q.label}
              onPress={() => rewrite(q.instruction, q.label)}
              disabled={!!rewriting}
              style={({ pressed }) => [styles.chip, pressed && { opacity: 0.6 }, rewriting && rewriting !== q.label && { opacity: 0.4 }]}
            >
              {rewriting === q.label ? <ActivityIndicator size="small" color={colors.accent} /> : null}
              <Text style={styles.chipText}>{q.label}</Text>
            </Pressable>
          ))}
          {history.length > 0 && (
            <Pressable onPress={undo} disabled={!!rewriting} style={[styles.chip, { borderColor: colors.warm }]}>
              <Undo2 size={14} color={colors.warm} />
              <Text style={[styles.chipText, { color: colors.warm }]}>Annulla</Text>
            </Pressable>
          )}
        </View>
        <View style={styles.askRow}>
          <Input
            value={ask}
            onChangeText={setAsk}
            placeholder="Es. aggiungi una battuta sul caffè"
            style={{ flex: 1, height: 48 }}
            returnKeyType="send"
            onSubmitEditing={() => ask.trim().length > 1 && rewrite(ask.trim(), 'ask')}
          />
          <Pressable
            onPress={() => ask.trim().length > 1 && rewrite(ask.trim(), 'ask')}
            disabled={!!rewriting || ask.trim().length < 2}
            style={[styles.askBtn, (ask.trim().length < 2 || !!rewriting) && { opacity: 0.4 }]}
          >
            {rewriting === 'ask' ? <ActivityIndicator size="small" color="#0B0716" /> : <Sparkles size={18} color="#0B0716" />}
          </Pressable>
        </View>

        <Field label="Hashtag">
          <Input
            value={sr.hashtags.join(' ')}
            onChangeText={(t) => mutate({ scriptResult: { ...sr, hashtags: t.split(/\s+/).filter(Boolean) } })}
            autoCapitalize="none"
          />
        </Field>

        <Btn label="Registra" icon={<Mic size={18} color="#0B0716" />} onPress={() => onRecord(draft)} />
        <View style={{ flexDirection: 'row', gap: 10, marginTop: 10 }}>
          <Btn label="Carica video" variant="ghost" icon={<FolderOpen size={17} color={colors.text} />} onPress={upload} style={{ flex: 1 }} />
          <Btn label="Rigenera" variant="ghost" icon={<RefreshCw size={17} color={colors.text} />} onPress={regenerate} loading={regenerating} style={{ flex: 1 }} />
        </View>
      </ScrollView>
    </Screen>
  );
}

const QUICK = [
  { label: 'Più corto', instruction: 'Rendilo più corto di circa un terzo, tenendo i punti più forti.' },
  { label: 'Più lungo', instruction: 'Allungalo di circa un terzo con un esempio concreto in più.' },
  { label: 'Hook più forte', instruction: 'Riscrivi solo le prime due frasi con un hook molto più forte e sorprendente.' },
  { label: 'Più divertente', instruction: 'Rendilo più ironico e divertente, senza perdere il contenuto.' },
  { label: 'Più semplice', instruction: 'Usa parole più semplici e frasi più corte, facili da dire a voce.' },
  { label: 'Più energico', instruction: 'Rendilo più energico e diretto, con ritmo veloce.' },
  { label: 'CTA migliore', instruction: 'Riscrivi solo la call to action finale per spingere a seguire e commentare.' },
];

const styles = StyleSheet.create({
  section: { color: colors.text, fontSize: 13.5, fontWeight: '700', marginBottom: 8, letterSpacing: 0.2 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 10 },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 8,
    borderRadius: 999, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface,
  },
  chipText: { color: colors.text, fontSize: 13, fontWeight: '600' },
  askRow: { flexDirection: 'row', gap: 8, alignItems: 'center', marginBottom: 20 },
  askBtn: {
    width: 48, height: 48, borderRadius: radius.md, backgroundColor: colors.accent,
    alignItems: 'center', justifyContent: 'center',
  },
  statsRow: { flexDirection: 'row', gap: 10, marginBottom: 18 },
  stat: {
    flex: 1, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.md, padding: 12, alignItems: 'center',
  },
  statNum: { color: colors.text, fontSize: 20, fontWeight: '800' },
  statLabel: { color: colors.textDim, fontSize: 11.5, marginTop: 2 },
});
