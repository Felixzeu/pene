import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import { Sparkles } from 'lucide-react-native';
import { Screen } from './ui';
import { colors } from '../theme';

const STEPS = ['Cerco l\'hook giusto…', 'Scrivo i punti chiave…', 'Preparo la call to action…', 'Scelgo titolo e hashtag…'];

// Schermata di attesa mentre l'IA scrive lo script. La durata reale non è nota:
// la barra avanza veloce all'inizio e rallenta verso il 90%, poi si completa a risposta arrivata.
export default function ScriptLoading() {
  const progress = useRef(new Animated.Value(0)).current;
  const [step, setStep] = useState(0);

  useEffect(() => {
    Animated.timing(progress, {
      toValue: 0.9, duration: 15000, easing: Easing.out(Easing.cubic), useNativeDriver: false,
    }).start();
    const id = setInterval(() => setStep((s) => (s + 1) % STEPS.length), 2500);
    return () => clearInterval(id);
  }, [progress]);

  const width = progress.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] });

  return (
    <Screen>
      <View style={styles.center}>
        <View style={styles.icon}>
          <Sparkles size={28} color={colors.accent} />
        </View>
        <Text style={styles.title}>Sto scrivendo lo script</Text>
        <Text style={styles.step}>{STEPS[step]}</Text>
        <View style={styles.track}>
          <Animated.View style={[styles.fill, { width }]} />
        </View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 36 },
  icon: {
    width: 64, height: 64, borderRadius: 32, backgroundColor: colors.accentSoft,
    alignItems: 'center', justifyContent: 'center', marginBottom: 22,
  },
  title: { color: colors.text, fontSize: 22, fontWeight: '800', letterSpacing: -0.3 },
  step: { color: colors.textDim, fontSize: 14, marginTop: 8, marginBottom: 26 },
  track: { height: 6, width: '100%', borderRadius: 3, backgroundColor: colors.surfaceAlt, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 3, backgroundColor: colors.accent },
});
