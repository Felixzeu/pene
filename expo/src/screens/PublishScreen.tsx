import React, { useState } from 'react';
import { Alert, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { VideoView, useVideoPlayer } from 'expo-video';
import { AlertTriangle, CheckCircle2, Download, ExternalLink, Link2, RotateCcw, Send, Wand2 } from 'lucide-react-native';
import { Badge, Btn, Field, Header, Input, Screen, TextArea } from '../components/ui';
import { colors, radius } from '../theme';
import { PROVIDERS, type ProviderId } from '../config';
import { authUrl, mediaUrl, publishVideo } from '../services/api';
import { saveVideoToPhotos } from '../services/download';
import { upsertProject } from '../services/history';
import type { Project, PublishOutcome } from '../types';

// Pubblicazione sui social: ogni social è indipendente. Si collega l'account
// una volta (OAuth nel browser), si scelgono i social e si pubblica; se uno
// fallisce gli altri restano pubblicati e si può premere "Riprova" solo su quello.
export default function PublishScreen({ project, onBack, onHome, onModify, update }: {
  project: Project;
  onBack: () => void;
  onHome: () => void;
  onModify: (p: Project) => void;
  update: (p: Project) => void;
}) {
  const [title, setTitle] = useState(project.scriptResult?.title ?? '');
  const [description, setDescription] = useState('');
  const [hashtags, setHashtags] = useState((project.scriptResult?.hashtags ?? []).join(' '));
  const [selected, setSelected] = useState<ProviderId[]>(['youtube']);
  const [busy, setBusy] = useState<ProviderId[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const outcomes = project.published ?? [];

  const videoUrl = mediaUrl(project.finalVideoUrl);
  const player = useVideoPlayer(videoUrl ? { uri: videoUrl } : null, (p) => { p.loop = true; });

  const outcomeOf = (id: ProviderId) => outcomes.find((o) => o.provider === id);
  const toggle = (id: ProviderId) =>
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  const publish = async (providers: ProviderId[]) => {
    if (!project.jobId || providers.length === 0) return;
    if (!title.trim()) { setError('Scrivi un titolo prima di pubblicare.'); return; }
    setError(null);
    setBusy(providers);
    try {
      const { results } = await publishVideo({
        jobId: project.jobId,
        providers,
        title: title.trim().slice(0, 100),
        description: description.trim(),
        hashtags: hashtags.split(/[\s,]+/).map((h) => h.replace(/^#/, '')).filter(Boolean).slice(0, 15),
      });
      // Unisce i nuovi esiti a quelli precedenti (un "Riprova" sostituisce solo il suo social).
      const merged: PublishOutcome[] = [
        ...outcomes.filter((o) => !providers.includes(o.provider)),
        ...results,
      ];
      const next = { ...project, published: merged };
      await upsertProject(next);
      update(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Pubblicazione non riuscita.');
    } finally {
      setBusy([]);
    }
  };

  const download = async () => {
    if (!videoUrl) return;
    setSaving(true);
    try {
      await saveVideoToPhotos(videoUrl);
      Alert.alert('Video salvato', 'Lo trovi nell app Foto.');
    } catch (e) {
      Alert.alert('Salvataggio non riuscito', e instanceof Error ? e.message : 'Riprova.');
    } finally {
      setSaving(false);
    }
  };

  const pending = selected.filter((id) => outcomeOf(id)?.status !== 'published');

  return (
    <Screen>
      <Header title="Pubblica" subtitle="Scegli i social e pubblica il video montato" onBack={onBack} />
      <ScrollView contentContainerStyle={{ padding: 20 }}>
        {videoUrl ? (
          <View style={styles.playerWrap}>
            <VideoView player={player} style={styles.player} contentFit="contain" />
          </View>
        ) : null}
        {videoUrl ? (
          <View style={{ flexDirection: 'row', gap: 10, marginBottom: 22 }}>
            <Btn
              label="Modifica"
              variant="ghost"
              icon={<Wand2 size={17} color={colors.text} />}
              onPress={() => onModify(project)}
              style={{ flex: 1 }}
            />
            <Btn
              label="Salva"
              variant="ghost"
              icon={<Download size={17} color={colors.text} />}
              onPress={download}
              loading={saving}
              style={{ flex: 1 }}
            />
          </View>
        ) : null}

        <Field label="Titolo">
          <Input value={title} onChangeText={setTitle} maxLength={100} placeholder="Il titolo del video" style={{ height: 50 }} />
        </Field>
        <Field label="Descrizione" hint="Facoltativa. Gli hashtag vengono aggiunti in automatico.">
          <TextArea value={description} onChangeText={setDescription} maxLength={2200} placeholder="Racconta il video in due righe" />
        </Field>
        <Field label="Hashtag" hint="Separati da spazio, senza #.">
          <Input value={hashtags} onChangeText={setHashtags} autoCapitalize="none" style={{ height: 50 }} />
        </Field>

        <Text style={styles.section}>Social</Text>
        <View style={styles.card}>
          {PROVIDERS.map((p, i) => {
            const o = outcomeOf(p.id);
            const on = selected.includes(p.id);
            const isBusy = busy.includes(p.id);
            return (
              <View key={p.id} style={[styles.row, i === PROVIDERS.length - 1 && { borderBottomWidth: 0 }]}>
                <Pressable onPress={() => toggle(p.id)} hitSlop={8} style={styles.rowMain}>
                  <View style={[styles.check, on && { backgroundColor: colors.accent, borderColor: colors.accent }]}>
                    {on && <CheckCircle2 size={14} color="#fff" />}
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.provider}>{p.label}</Text>
                    {o?.message ? <Text style={[styles.msg, o.status === 'error' && { color: colors.err }]}>{o.message}</Text> : null}
                  </View>
                </Pressable>
                {isBusy ? (
                  <Badge text="in corso" tone="accent" />
                ) : o?.status === 'published' ? (
                  o.url ? (
                    <Pressable onPress={() => Linking.openURL(o.url as string)} hitSlop={8} style={styles.inline}>
                      <Badge text="pubblicato" tone="ok" />
                      <ExternalLink size={15} color={colors.textDim} />
                    </Pressable>
                  ) : <Badge text="pubblicato" tone="ok" />
                ) : o?.status === 'error' ? (
                  <Pressable onPress={() => publish([p.id])} hitSlop={8} style={styles.inline}>
                    <RotateCcw size={15} color={colors.warm} />
                    <Text style={styles.retry}>Riprova</Text>
                  </Pressable>
                ) : (
                  <Pressable onPress={() => Linking.openURL(authUrl(p.id))} hitSlop={8} style={styles.inline}>
                    <Link2 size={15} color={colors.textDim} />
                    <Text style={styles.link}>Collega</Text>
                  </Pressable>
                )}
              </View>
            );
          })}
        </View>
        <Text style={styles.hint}>
          Prima volta? Tocca "Collega", autorizza nel browser e torna qui. TikTok pubblica in privato finché la tua app non è approvata.
        </Text>

        {error && (
          <View style={styles.errorBox}>
            <AlertTriangle size={18} color={colors.err} />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        <View style={{ flexDirection: 'row', gap: 10, marginTop: 24 }}>
          <Btn label="Home" variant="ghost" onPress={onHome} style={{ flex: 1 }} />
          <Btn
            label={pending.length ? `Pubblica (${pending.length})` : 'Pubblicato'}
            icon={<Send size={17} color="#fff" />}
            onPress={() => publish(pending)}
            loading={busy.length > 0}
            disabled={pending.length === 0 || !project.jobId}
            style={{ flex: 1.6 }}
          />
        </View>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  playerWrap: {
    borderRadius: 22, overflow: 'hidden', backgroundColor: '#000',
    aspectRatio: 9 / 16, maxHeight: 360, alignSelf: 'center', width: '60%', marginBottom: 14,
  },
  player: { flex: 1 },
  section: { color: colors.text, fontSize: 13.5, fontWeight: '700', marginBottom: 8, letterSpacing: 0.2 },
  card: {
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.lg, paddingHorizontal: 16,
  },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  rowMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12 },
  check: {
    width: 24, height: 24, borderRadius: 12, borderWidth: 1.5, borderColor: colors.border,
    alignItems: 'center', justifyContent: 'center',
  },
  provider: { color: colors.text, fontSize: 15, fontWeight: '600' },
  msg: { color: colors.textDim, fontSize: 12, marginTop: 3, lineHeight: 16 },
  inline: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  link: { color: colors.textDim, fontSize: 13.5, fontWeight: '600' },
  retry: { color: colors.warm, fontSize: 13.5, fontWeight: '700' },
  hint: { color: colors.textDim, fontSize: 12, marginTop: 8, lineHeight: 17 },
  errorBox: {
    flexDirection: 'row', gap: 10, alignItems: 'center', marginTop: 16,
    backgroundColor: 'rgba(255,107,107,0.1)', borderRadius: radius.md, padding: 14,
  },
  errorText: { color: colors.err, flex: 1, fontSize: 13.5, lineHeight: 19 },
});
