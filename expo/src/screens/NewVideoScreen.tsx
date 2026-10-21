import React, { useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Clock, Globe, Lightbulb, MonitorSmartphone, Smile, Sparkles } from 'lucide-react-native';
import { Btn, ChipRow, Header, Screen } from '../components/ui';
import ScriptLoading from '../components/ScriptLoading';
import { colors, fonts } from '../theme';
import { generateScript } from '../services/api';
import type { Project, ScriptResult, TargetDuration } from '../types';

const TONES = ['Energico', 'Professionale', 'Divertente', 'Ispiratore', 'Educativo'];
const DURATIONS = [
  { value: '30', label: '30 s', hint: 'veloce' },
  { value: '60', label: '60 s', hint: 'consigliato' },
  { value: '90', label: '90 s', hint: 'racconto' },
];
const PLATFORMS = ['Reels', 'TikTok', 'YouTube Shorts', 'Tutti'];
const LANGUAGES = [
  { value: 'Italiano', label: '🇮🇹 Italiano' },
  { value: 'English', label: '🇬🇧 English' },
  { value: 'Español', label: '🇪🇸 Español' },
  { value: 'Français', label: '🇫🇷 Français' },
];
const IDEAS = [
  '3 errori che fanno tutti quando iniziano a investire',
  'Il posto più bello della mia città che nessuno conosce',
  'Come risparmio 200 € al mese senza accorgermene',
];

/** Blocco della pagina: icona + titolo, contenuto sotto. */
function Section({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHead}>
        {icon}
        <Text style={styles.sectionTitle}>{title}</Text>
      </View>
      {children}
    </View>
  );
}

export default function NewVideoScreen({ onBack, onScript, save }: {
  onBack: () => void;
  onScript: (p: Project) => void;
  save: (p: Project) => void;
}) {
  const [topic, setTopic] = useState('');
  const [tone, setTone] = useState(TONES[0] as string);
  const [duration, setDuration] = useState('60');
  const [platform, setPlatform] = useState(PLATFORMS[0] as string);
  const [language, setLanguage] = useState(LANGUAGES[0].value);
  const [loading, setLoading] = useState(false);
  const ready = topic.trim().length >= 5;

  const submit = async () => {
    if (!ready) {
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

  if (loading) return <ScriptLoading />;

  return (
    <Screen>
      <Header title="Nuovo video" subtitle="Scrivi l'idea, al resto pensa l'IA" onBack={onBack} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 24 }} keyboardShouldPersistTaps="handled">
          {/* Idea */}
          <View style={[styles.ideaCard, topic.length > 0 && { borderColor: colors.accent }]}>
            <Text style={styles.ideaLabel}>Di cosa parla il video?</Text>
            <TextInput
              value={topic}
              onChangeText={setTopic}
              placeholder="Es. 3 errori che fanno tutti quando iniziano a investire"
              placeholderTextColor={colors.textDim}
              maxLength={500}
              multiline
              textAlignVertical="top"
              style={styles.ideaInput}
            />
            <Text style={styles.counter}>{topic.length}/500</Text>
          </View>
          {topic.length === 0 && (
            <View style={styles.ideas}>
              <View style={styles.ideasHead}>
                <Lightbulb size={14} color={colors.warm} />
                <Text style={styles.ideasTitle}>Serve ispirazione? Tocca un'idea</Text>
              </View>
              {IDEAS.map((i) => (
                <Pressable key={i} onPress={() => setTopic(i)} style={({ pressed }) => [styles.idea, pressed && { opacity: 0.7 }]}>
                  <Text style={styles.ideaText}>{i}</Text>
                </Pressable>
              ))}
            </View>
          )}

          {/* Durata */}
          <Section icon={<Clock size={16} color={colors.accent} />} title="Durata">
            <View style={styles.segment}>
              {DURATIONS.map((d) => {
                const on = d.value === duration;
                return (
                  <Pressable key={d.value} onPress={() => setDuration(d.value)} style={[styles.segItem, on && styles.segOn]}>
                    <Text style={[styles.segLabel, on && { color: colors.onAccent }]}>{d.label}</Text>
                    <Text style={[styles.segHint, on && { color: colors.onAccent }]}>{d.hint}</Text>
                  </Pressable>
                );
              })}
            </View>
          </Section>

          {/* Piattaforma */}
          <Section icon={<MonitorSmartphone size={16} color={colors.accent} />} title="Dove lo pubblichi">
            <View style={styles.grid}>
              {PLATFORMS.map((p) => {
                const on = p === platform;
                return (
                  <Pressable key={p} onPress={() => setPlatform(p)} style={[styles.tile, on && styles.tileOn]}>
                    <Text style={[styles.tileText, on && { color: colors.accent }]}>{p}</Text>
                  </Pressable>
                );
              })}
            </View>
          </Section>

          {/* Tono */}
          <Section icon={<Smile size={16} color={colors.accent} />} title="Tono">
            <ChipRow options={TONES} value={tone} onChange={setTone} />
          </Section>

          {/* Lingua */}
          <Section icon={<Globe size={16} color={colors.accent} />} title="Lingua">
            <ChipRow
              options={LANGUAGES.map((l) => l.label)}
              value={LANGUAGES.find((l) => l.value === language)?.label ?? ''}
              onChange={(v) => setLanguage(LANGUAGES.find((l) => l.label === v)?.value ?? 'Italiano')}
            />
            <Text style={styles.hint}>Vale per lo script e per i sottotitoli.</Text>
          </Section>
        </ScrollView>

        {/* Barra fissa in basso */}
        <View style={styles.bottomBar}>
          <Text style={styles.summary} numberOfLines={1}>{duration} s · {platform} · {tone}</Text>
          <Btn
            label="Genera lo script"
            icon={<Sparkles size={18} color={colors.onAccent} />}
            onPress={submit}
            disabled={!ready}
          />
          <Text style={styles.privacy}>Script scritto con Gemini (piano gratuito): evita dati sensibili.</Text>
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  ideaCard: {
    backgroundColor: colors.surface, borderRadius: 22, borderWidth: 1, borderColor: colors.border,
    padding: 16, gap: 8,
  },
  ideaLabel: { color: colors.text, fontFamily: fonts.display, fontSize: 19, letterSpacing: -0.4 },
  ideaInput: { color: colors.text, fontSize: 16, lineHeight: 22, minHeight: 92, padding: 0 },
  counter: { color: colors.textDim, fontSize: 11, alignSelf: 'flex-end' },
  ideas: { marginTop: 12, gap: 8 },
  ideasHead: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 2 },
  ideasTitle: { color: colors.textDim, fontSize: 12.5, fontFamily: fonts.medium },
  idea: {
    borderRadius: 14, borderWidth: 1, borderColor: colors.border, borderStyle: 'dashed',
    paddingHorizontal: 12, paddingVertical: 10,
  },
  ideaText: { color: colors.text, fontSize: 13.5 },
  section: { marginTop: 24 },
  sectionHead: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  sectionTitle: { color: colors.text, fontFamily: fonts.semibold, fontSize: 15 },
  segment: {
    flexDirection: 'row', backgroundColor: colors.surface, borderRadius: 16, borderWidth: 1, borderColor: colors.border, padding: 4, gap: 4,
  },
  segItem: { flex: 1, borderRadius: 12, paddingVertical: 10, alignItems: 'center' },
  segOn: { backgroundColor: colors.accent },
  segLabel: { color: colors.text, fontFamily: fonts.display, fontSize: 16 },
  segHint: { color: colors.textDim, fontSize: 11, marginTop: 1 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tile: {
    width: '48.5%', height: 52, borderRadius: 14, borderWidth: 1, borderColor: colors.border,
    backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center',
  },
  tileOn: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  tileText: { color: colors.text, fontFamily: fonts.semibold, fontSize: 14 },
  hint: { color: colors.textDim, fontSize: 12, marginTop: 8 },
  bottomBar: {
    paddingHorizontal: 20, paddingTop: 12, paddingBottom: 8, gap: 8,
    borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.bg,
  },
  summary: { color: colors.textDim, fontSize: 12.5, textAlign: 'center', fontFamily: fonts.medium },
  privacy: { color: colors.textDim, fontSize: 11, textAlign: 'center', opacity: 0.8 },
});
