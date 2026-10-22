import React from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { Mail } from 'lucide-react-native';
import { colors, fonts } from '../theme';
import { CONTACT_EMAILS } from '../config';
import { t } from '../i18n';

// Contatti e assistenza: un tocco apre l'app di posta con l'indirizzo già scritto.
export default function ContactLinks() {
  const write = (email: string) => {
    Linking.openURL(`mailto:${email}?subject=${encodeURIComponent('ViralAPP')}`).catch(() => {});
  };
  return (
    <View style={styles.box}>
      <Text style={styles.title}>{t('Contatti e assistenza')}</Text>
      <Text style={styles.hint}>{t('Per domande, problemi o richieste sui tuoi dati scrivici:')}</Text>
      {CONTACT_EMAILS.map((e) => (
        <Pressable key={e} onPress={() => write(e)} style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]} hitSlop={4}>
          <Mail size={16} color={colors.accent} />
          <Text style={styles.email}>{e}</Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { padding: 16, borderRadius: 18, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, gap: 8, marginTop: 8 },
  title: { color: colors.text, fontFamily: fonts.semibold, fontSize: 15 },
  hint: { color: colors.textDim, fontSize: 12.5, lineHeight: 18 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 },
  email: { color: colors.accent, fontFamily: fonts.semibold, fontSize: 14, textDecorationLine: 'underline' },
});
