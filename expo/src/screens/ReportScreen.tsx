import React, { useState } from 'react';
import { Alert, Image, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { ImagePlus, Send, X } from 'lucide-react-native';
import { Btn, ChipRow, Field, Header, Input, Screen, TextArea } from '../components/ui';
import { colors, radius } from '../theme';
import { sendReport } from '../services/api';
import { t, tServer } from '../i18n';
import ContactLinks from '../components/ContactLinks';

const KINDS = { 'Bug': 'bug', 'Idea': 'idea', 'Modmail': 'message' } as const;
type KindLabel = keyof typeof KINDS;

// Modmail & bug report: un messaggio diretto a chi sviluppa viral, con screenshot facoltativo.
export default function ReportScreen({ onBack }: { onBack: () => void }) {
  const [kind, setKind] = useState<KindLabel>('Bug');
  const [text, setText] = useState('');
  const [contact, setContact] = useState('');
  const [shot, setShot] = useState<ImagePicker.ImagePickerAsset | null>(null);
  const [sending, setSending] = useState(false);

  const pick = async () => {
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.7 });
    if (!res.canceled && res.assets[0]) setShot(res.assets[0]);
  };

  const send = async () => {
    if (text.trim().length < 3) { Alert.alert(t('Scrivi qualcosa'), t('Descrivi il problema o il messaggio.')); return; }
    setSending(true);
    try {
      await sendReport({
        kind: KINDS[kind],
        text: text.trim(),
        contact: contact.trim() || undefined,
        device: `${Platform.OS} ${Platform.Version}`,
        appVersion: '1.0.0',
        screenshot: shot ? { uri: shot.uri, name: shot.fileName ?? 'screenshot.jpg', type: shot.mimeType ?? 'image/jpeg' } : undefined,
      });
      Alert.alert(t('Inviato, grazie!'), t('Il tuo messaggio è arrivato.'));
      onBack();
    } catch (e) {
      Alert.alert(t('Invio non riuscito'), e instanceof Error ? tServer(e.message) : t('Riprova.'));
    } finally {
      setSending(false);
    }
  };

  return (
    <Screen>
      <Header title={t('Modmail & bug report')} subtitle={t('Segnala un problema o scrivici')} onBack={onBack} />
      <ScrollView contentContainerStyle={{ padding: 20 }} keyboardShouldPersistTaps="handled">
        <Field label={t('Tipo')}>
          <ChipRow options={Object.keys(KINDS).map((k) => t(k))} value={t(kind)} onChange={(v) => setKind((Object.keys(KINDS) as KindLabel[]).find((k) => t(k) === v) ?? 'Bug')} />
        </Field>
        <Field label={kind === 'Bug' ? t('Cosa è successo?') : t('Messaggio')} hint={kind === 'Bug' ? t('Cosa stavi facendo, cosa ti aspettavi e cosa è successo invece.') : undefined}>
          <TextArea value={text} onChangeText={setText} maxLength={4000} placeholder={t('Scrivi qui...')} style={{ minHeight: 160 }} />
        </Field>
        <Field label={t('Screenshot')} hint={t('Facoltativo, aiuta molto con i bug.')}>
          {shot ? (
            <View style={styles.shotWrap}>
              <Image source={{ uri: shot.uri }} style={styles.shot} />
              <Pressable onPress={() => setShot(null)} style={styles.shotX} hitSlop={8} accessibilityLabel={t('Togli screenshot')}>
                <X size={16} color="#fff" />
              </Pressable>
            </View>
          ) : (
            <Pressable onPress={pick} style={styles.pick}>
              <ImagePlus size={20} color={colors.textDim} />
              <Text style={styles.pickText}>{t('Aggiungi screenshot')}</Text>
            </Pressable>
          )}
        </Field>
        <Field label={t('Contatto')} hint={t('Facoltativo: email o Discord, se vuoi una risposta.')}>
          <Input value={contact} onChangeText={setContact} autoCapitalize="none" placeholder={t('tu@email.it')} style={{ height: 50 }} />
        </Field>
        <Btn label={t('Invia')} icon={<Send size={17} color={colors.onAccent} />} onPress={send} loading={sending} style={{ marginTop: 8 }} />
        <ContactLinks />
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  pick: {
    height: 64, borderRadius: radius.md, borderWidth: 1, borderStyle: 'dashed', borderColor: colors.border,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
  },
  pickText: { color: colors.textDim, fontSize: 14, fontWeight: '600' },
  shotWrap: { alignSelf: 'flex-start' },
  shot: { width: 120, height: 220, borderRadius: radius.md, backgroundColor: colors.surface },
  shotX: {
    position: 'absolute', top: 6, right: 6, width: 26, height: 26, borderRadius: 13,
    backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center',
  },
});
