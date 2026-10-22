import React, { useEffect, useRef, useState } from 'react';
import { Alert, Animated, Easing, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { ArrowRight, Clock, Lightbulb, PenLine, Smile, Sparkles } from 'lucide-react-native';
import { Btn, ChipRow, Header, Screen } from '../components/ui';
import ScriptLoading from '../components/ScriptLoading';
import { colors, fonts } from '../theme';
import { generateScript } from '../services/api';
import { languageInfo, useLanguage } from '../services/language';
import type { Project, ScriptResult, TargetDuration } from '../types';

const TONES = ['Energico', 'Professionale', 'Divertente', 'Ispiratore', 'Educativo'];
const DURATIONS = [
  { value: '30', label: '30 s', hint: 'veloce' },
  { value: '60', label: '60 s', hint: 'consigliato' },
  { value: '90', label: '90 s', hint: 'racconto' },
];
// Il video si può pubblicare ovunque: niente scelta della piattaforma.
const PLATFORM = 'Tutti';
const IDEAS = [
  '3 errori che fanno tutti quando iniziano a investire',
  'Il posto più bello della mia città che nessuno conosce',
  'Come risparmio 200 € al mese senza accorgermene',
];

/** Selettore a segmenti: l'evidenziatore rosa scivola e sfuma tra un'opzione e l'altra. */
function DurationPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [w, setW] = useState(0);
  const idx = Math.max(0, DURATIONS.findIndex((d) => d.value === value));
  const pos = useRef(new Animated.Value(idx)).current;
  const fade = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    Animated.parallel([
      Animated.timing(pos, { toValue: idx, duration: 260, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.sequence([
        Animated.timing(fade, { toValue: 0.55, duration: 110, useNativeDriver: true }),
        Animated.timing(fade, { toValue: 1, duration: 170, useNativeDriver: true }),
      ]),
    ]).start();
  }, [idx, pos, fade]);
  const itemW = w > 0 ? (w - 8 - 4 * (DURATIONS.length - 1)) / DURATIONS.length : 0;
  return (
    <View style={styles.segment} onLayout={(e) => setW(e.nativeEvent.layout.width)}>
      {itemW > 0 && (
        <Animated.View
          pointerEvents="none"
          style={[styles.segPill, {
            width: itemW,
            opacity: fade,
            transform: [{ translateX: pos.interpolate({ inputRange: [0, DURATIONS.length - 1], outputRange: [0, (itemW + 4) * (DURATIONS.length - 1)] }) }],
          }]}
        />
      )}
      {DURATIONS.map((d, i) => {
        // Il testo passa da chiaro a scuro in dissolvenza insieme all'evidenziatore.
        const dark = pos.interpolate({ inputRange: [i - 1, i, i + 1], outputRange: [0, 1, 0], extrapolate: 'clamp' });
        const light = pos.interpolate({ inputRange: [i - 1, i, i + 1], outputRange: [1, 0, 1], extrapolate: 'clamp' });
        return (
          <Pressable key={d.value} onPress={() => onChange(d.value)} style={styles.segItem}>
            <Animated.View style={{ alignItems: 'center', opacity: light }}>
              <Text style={styles.segLabel}>{d.label}</Text>
              <Text style={styles.segHint}>{d.hint}</Text>
            </Animated.View>
            <Animated.View style={[StyleSheet.absoluteFill, styles.segCenter, { opacity: dark }]}>
              <Text style={[styles.segLabel, { color: colors.onAccent }]}>{d.label}</Text>
              <Text style={[styles.segHint, { color: colors.onAccent }]}>{d.hint}</Text>
            </Animated.View>
          </Pressable>
        );
      })}
    </View>
  );
}

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
  // La lingua si sceglie una volta sola nella Home.
  const language = useLanguage();
  const [mode, setMode] = useState<'ai' | 'manual'>('ai');
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(false);
  const manual = mode === 'manual';
  const ready = manual ? text.trim().length >= 10 : topic.trim().length >= 5;

  /** Testo scritto a mano: niente IA, si passa subito allo script. */
  const useOwnText = async () => {
    const script = text.trim();
    const first = script.split(/\n/)[0].trim();
    const title = first.length > 60 ? `${first.slice(0, 57).trim()}…` : first;
    const project: Project = {
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      topic: title, tone,
      duration: Number(duration) as TargetDuration,
      platform: PLATFORM, language,
      scriptResult: { script, title, hashtags: [] },
      createdAt: Date.now(),
    };
    await save(project);
    onScript(project);
  };

  const submit = async () => {
    if (manual) {
      if (!ready) Alert.alert('Testo troppo corto', 'Scrivi il testo che vuoi leggere durante la registrazione.');
      else await useOwnText();
      return;
    }
    if (!ready) {
      Alert.alert('Argomento troppo corto', 'Scrivi almeno una frase su cosa vuoi raccontare.');
      return;
    }
    setLoading(true);
    try {
      const scriptResult: ScriptResult = await generateScript({
        topic: topic.trim(), tone,
        duration: Number(duration) as TargetDuration,
        platform: PLATFORM, language,
      });
      const project: Project = {
        id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        topic: topic.trim(), tone,
        duration: Number(duration) as TargetDuration,
        platform: PLATFORM, language, scriptResult, createdAt: Date.now(),
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
          {/* Script con l'IA o testo proprio */}
          <View style={styles.modeRow}>
            {([['ai', 'Script con l\'IA', Sparkles], ['manual', 'Scrivo io il testo', PenLine]] as const).map(([v, label, Icon]) => {
              const on = mode === v;
              return (
                <Pressable key={v} onPress={() => setMode(v)} style={[styles.modeBtn, on && styles.modeOn]}>
                  <Icon size={16} color={on ? colors.accent : colors.textDim} />
                  <Text style={[styles.modeText, on && { color: colors.accent }]}>{label}</Text>
                </Pressable>
              );
            })}
          </View>

          {manual ? (
            <View style={[styles.ideaCard, text.length > 0 && { borderColor: colors.accent }]}>
              <Text style={styles.ideaLabel}>Il tuo testo</Text>
              <TextInput
                value={text}
                onChangeText={setText}
                placeholder="Scrivi qui quello che dirai nel video: lo vedrai scorrere mentre registri."
                placeholderTextColor={colors.textDim}
                maxLength={3000}
                multiline
                textAlignVertical="top"
                style={[styles.ideaInput, { minHeight: 180 }]}
              />
              <Text style={styles.counter}>{text.length}/3000</Text>
            </View>
          ) : (<>
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
            <DurationPicker value={duration} onChange={setDuration} />
          </Section>

          {/* Tono */}
          <Section icon={<Smile size={16} color={colors.accent} />} title="Tono">
            <ChipRow options={TONES} value={tone} onChange={setTone} />
          </Section>
          </>)}

        </ScrollView>

        {/* Barra fissa in basso */}
        <View style={styles.bottomBar}>
          <Text style={styles.summary} numberOfLines={1}>{manual ? '' : `${duration} s · ${tone} · `}{languageInfo(language).flag} {language}</Text>
          <Btn
            label={manual ? 'Continua' : 'Genera lo script'}
            icon={manual ? <ArrowRight size={18} color={colors.onAccent} /> : <Sparkles size={18} color={colors.onAccent} />}
            onPress={submit}
            disabled={!ready}
          />
          {!manual && <Text style={styles.privacy}>Script scritto con Gemini (piano gratuito): evita dati sensibili.</Text>}
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
  segPill: { position: 'absolute', top: 4, bottom: 4, left: 4, borderRadius: 12, backgroundColor: colors.accent },
  segCenter: { alignItems: 'center', justifyContent: 'center' },
  segLabel: { color: colors.text, fontFamily: fonts.display, fontSize: 16 },
  segHint: { color: colors.textDim, fontSize: 11, marginTop: 1 },
  modeRow: { flexDirection: 'row', gap: 8, marginBottom: 14 },
  modeBtn: {
    flex: 1, height: 48, borderRadius: 14, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
  },
  modeOn: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  modeText: { color: colors.textDim, fontFamily: fonts.semibold, fontSize: 13.5 },
  hint: { color: colors.textDim, fontSize: 12, marginTop: 8 },
  bottomBar: {
    paddingHorizontal: 20, paddingTop: 12, paddingBottom: 8, gap: 8,
    borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.bg,
  },
  summary: { color: colors.textDim, fontSize: 12.5, textAlign: 'center', fontFamily: fonts.medium },
  privacy: { color: colors.textDim, fontSize: 11, textAlign: 'center', opacity: 0.8 },
});
