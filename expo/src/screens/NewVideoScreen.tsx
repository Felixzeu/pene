import React, { useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Sparkles } from 'lucide-react-native';
import { Btn, ChipRow, Field, Header, Screen, TextArea } from '../components/ui';
import { colors } from '../theme';
import { generateScript } from '../services/api';
import type { Project, ScriptResult, TargetDuration } from '../types';

const TONES = ['Energico', 'Professionale', 'Divertente', 'Ispiratore', 'Educativo'];
const DURATIONS = ['30', '60', '90'];
const PLATFORMS = ['Reels', 'TikTok', 'YouTube Shorts', 'Tutti'];
const LANGUAGES = ['Italiano', 'English', 'Español', 'Français'];

export default function NewVideoScreen({ onBack, onScript, save }: {
  onBack: () => void;
  onScript: (p: Project) => void;
  save: (p: Project) => void;
}) {
  const [topic, setTopic] = useState('');
  const [tone, setTone] = useState(TONES[0] as string);
  const [duration, setDuration] = useState('60');
  const [platform, setPlatform] = useState(PLATFORMS[0] as string);
  const [language, setLanguage] = useState(LANGUAGES[0] as string);
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    if (topic.trim().length < 5) {
      Alert.alert('Argomento troppo corto', 'Scrivi almeno una frase su cosa vuoi raccontare.');
      return;
    }
    setLoading(true);
    try {
      const scriptResult: ScriptResult = await generateScript({
        topic: topic.trim(), tone,
        duration: Number(duration) as TargetDuration,
        platform, language,
      });
      const project: Project = {
        id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        topic: topic.trim(), tone,
        duration: Number(duration) as TargetDuration,
        platform, language, scriptResult, createdAt: Date.now(),
      };
      await save(project);
      onScript(project);
    } catch (e) {
      Alert.alert(
        'Generazione non riuscita',
        e instanceof Error ? e.message : 'Riprova tra poco.',
        [{ text: 'OK' }, { text: 'Riprova', onPress: submit }],
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <Screen>
      <Header title="Nuovo video" subtitle="Raccontaci cosa vuoi pubblicare" onBack={onBack} />
      <ScrollView contentContainerStyle={{ padding: 20 }} keyboardShouldPersistTaps="handled">
        <Field label="Argomento" hint="Esempio: «3 errori che fanno quando si inizia a investire»">
          <TextArea
            value={topic}
            onChangeText={setTopic}
            placeholder="Di cosa parli nel video?"
            maxLength={500}
          />
        </Field>
        <Field label="Tono">
          <ChipRow options={TONES} value={tone} onChange={setTone} />
        </Field>
        <Field label="Durata">
          <ChipRow options={DURATIONS} value={duration} onChange={setDuration} />
        </Field>
        <Field label="Piattaforma">
          <ChipRow options={PLATFORMS} value={platform} onChange={setPlatform} />
        </Field>
        <Field label="Lingua" hint="Usata per lo script e per la trascrizione dei sottotitoli">
          <ChipRow options={LANGUAGES} value={language} onChange={setLanguage} />
        </Field>
        <Btn
          label="Genera script"
          icon={<Sparkles size={18} color="#fff" />}
          onPress={submit}
          loading={loading}
          style={{ marginTop: 8 }}
        />
        <Text style={styles.privacy}>
          Lo script è generato da un modello gratuito. Sul piano gratuito di Gemini i contenuti
          possono essere usati da Google per migliorare i suoi servizi: evita dati sensibili.
        </Text>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  privacy: { color: colors.textDim, fontSize: 12, lineHeight: 18, textAlign: 'center', marginTop: 18, paddingHorizontal: 10 },
});
