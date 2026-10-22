import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Image, StyleSheet, Text, View } from 'react-native';
import { Screen } from './ui';
import { colors, fonts } from '../theme';

// Cosa sta facendo, in base a quanto è avanzata la barra.
const STEPS: [number, string][] = [
  [0, 'Leggo la tua idea…'],
  [15, 'Cerco l\'hook giusto…'],
  [35, 'Scrivo i punti chiave…'],
  [60, 'Preparo la call to action…'],
  [78, 'Scelgo titolo e hashtag…'],
  [90, 'Ultimi ritocchi, quasi fatto…'],
];

// Schermata di attesa mentre l'IA scrive lo script. La durata reale non è nota:
// la barra avanza veloce all'inizio e rallenta verso il 95%, poi si completa a risposta arrivata.
export default function ScriptLoading() {
  const progress = useRef(new Animated.Value(0)).current;
  const [pct, setPct] = useState(0);

  useEffect(() => {
    const id = progress.addListener(({ value }) => setPct(Math.floor(value * 100)));
    Animated.timing(progress, {
      toValue: 0.95, duration: 40000, easing: Easing.out(Easing.cubic), useNativeDriver: false,
    }).start();
    return () => progress.removeListener(id);
  }, [progress]);

  const width = progress.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] });
  const step = [...STEPS].reverse().find(([from]) => pct >= from)?.[1] ?? STEPS[0][1];

  return (
    <Screen>
      <View style={styles.center}>
        <Image source={require('../../assets/icon.png')} style={styles.logo} />
        <Text style={styles.title}>Sto scrivendo lo script</Text>
        <View style={styles.track}>
          <Animated.View style={[styles.fill, { width }]} />
        </View>
        <View style={styles.row}>
          <Text style={styles.step} numberOfLines={1}>{step}</Text>
          <Text style={styles.pct}>{pct}%</Text>
        </View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 36 },
  logo: { width: 84, height: 84, borderRadius: 22, marginBottom: 22 },
  title: { color: colors.text, fontSize: 22, fontWeight: '800', letterSpacing: -0.3, marginBottom: 24 },
  track: { height: 8, width: '100%', borderRadius: 4, backgroundColor: colors.surfaceAlt, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 4, backgroundColor: colors.accent },
  row: { width: '100%', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 10, gap: 12 },
  step: { flex: 1, color: colors.textDim, fontSize: 14 },
  pct: { color: colors.accent, fontSize: 15, fontFamily: fonts.semibold },
});
