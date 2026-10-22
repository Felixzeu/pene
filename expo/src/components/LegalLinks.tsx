import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { colors, fonts } from '../theme';
import { LEGAL } from '../config';
import { t } from '../i18n';

// Informative leggibili dall'app: privacy, termini e come cancellare i dati.
export default function LegalLinks({ center }: { center?: boolean }) {
  const open = (url: string) => { WebBrowser.openBrowserAsync(url).catch(() => {}); };
  const items: [string, string][] = [
    [t('Privacy'), LEGAL.privacy],
    [t('Termini d\'uso'), LEGAL.terms],
    [t('Cancellazione dati'), LEGAL.deletion],
  ];
  return (
    <View style={[styles.row, center && { justifyContent: 'center' }]}>
      {items.map(([label, url], i) => (
        <Text key={url} style={styles.text}>
          {i > 0 ? '  ·  ' : ''}
          <Text style={styles.link} onPress={() => open(url)} suppressHighlighting>{label}</Text>
        </Text>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 10 },
  text: { color: colors.textDim, fontSize: 12.5 },
  link: { color: colors.text, fontFamily: fonts.semibold, textDecorationLine: 'underline' },
});
