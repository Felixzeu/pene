import React, { useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Mail } from 'lucide-react-native';
import { Btn, Input, Screen } from '../components/ui';
import { colors, fonts } from '../theme';
import { resetPassword, signIn, signInWith, signUp } from '../services/auth';
import { t, tServer } from '../i18n';

// Registrazione e accesso: email e password, oppure Google / Apple in un tocco.
export default function AuthScreen() {
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState<null | 'email' | 'google' | 'apple'>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const validEmail = /^\S+@\S+\.\S+$/.test(email.trim());

  const run = async (kind: 'email' | 'google' | 'apple', fn: () => Promise<void>) => {
    setError(null);
    setInfo(null);
    setBusy(kind);
    try { await fn(); } catch (e) { setError(e instanceof Error ? tServer(e.message) : t('Riprova.')); } finally { setBusy(null); }
  };

  const submit = () => run('email', async () => {
    if (mode === 'login') return signIn(email, password);
    const mustConfirm = await signUp(email, password);
    if (mustConfirm) {
      setInfo(t('Ti abbiamo mandato un\'email a {email}: apri il link per confermare, poi accedi qui.', { email: email.trim() }));
      setMode('login');
    }
  });

  const forgot = () => {
    if (!validEmail) { setError(t('Scrivi prima la tua email, poi tocca "Password dimenticata".')); return; }
    run('email', async () => {
      await resetPassword(email);
      Alert.alert(t('Email inviata'), t('Apri il link nell\'email per scegliere una nuova password.'));
    });
  };

  return (
    <Screen>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.wrap} keyboardShouldPersistTaps="handled">
          <Text style={styles.logo}>viral<Text style={{ color: colors.accent }}>.</Text></Text>
          <Text style={styles.title}>{mode === 'login' ? t('Bentornato.') : t('Crea il tuo account.')}</Text>
          <Text style={styles.sub}>
            {mode === 'login' ? t('Accedi per ritrovare i tuoi video e i social collegati.') : t('Gratis. Ti servono solo email e password.')}
          </Text>

          {Platform.OS === 'ios' && (
            <Btn
              label={t('Continua con Apple')}
              variant="ghost"
              icon={<Text style={styles.brand}></Text>}
              onPress={() => run('apple', () => signInWith('apple'))}
              loading={busy === 'apple'}
              disabled={!!busy}
              style={styles.social}
            />
          )}
          <Btn
            label={t('Continua con Google')}
            variant="ghost"
            icon={<Text style={[styles.brand, { color: '#4285F4' }]}>G</Text>}
            onPress={() => run('google', () => signInWith('google'))}
            loading={busy === 'google'}
            disabled={!!busy}
            style={styles.social}
          />

          <View style={styles.orRow}>
            <View style={styles.line} /><Text style={styles.or}>{t('oppure con l\'email')}</Text><View style={styles.line} />
          </View>

          <Input
            value={email}
            onChangeText={setEmail}
            placeholder={t('Email')}
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            textContentType="emailAddress"
            style={styles.input}
          />
          <Input
            value={password}
            onChangeText={setPassword}
            placeholder={mode === 'signup' ? t('Password (almeno 6 caratteri)') : 'Password'}
            secureTextEntry
            autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
            textContentType={mode === 'signup' ? 'newPassword' : 'password'}
            style={styles.input}
          />
          {mode === 'login' && (
            <Pressable onPress={forgot} hitSlop={8} style={{ alignSelf: 'flex-end', marginBottom: 6 }}>
              <Text style={styles.link}>{t('Password dimenticata?')}</Text>
            </Pressable>
          )}

          {error && <Text style={styles.error}>{error}</Text>}
          {info && <Text style={styles.info}>{info}</Text>}

          <Btn
            label={mode === 'login' ? t('Accedi') : t('Crea account')}
            icon={<Mail size={18} color={colors.onAccent} />}
            onPress={submit}
            loading={busy === 'email'}
            disabled={!!busy || !validEmail || password.length < 6}
            style={{ marginTop: 8 }}
          />

          <Pressable onPress={() => { setMode(mode === 'login' ? 'signup' : 'login'); setError(null); }} style={styles.switch} hitSlop={8}>
            <Text style={styles.switchText}>
              {mode === 'login' ? t('Non hai un account?') : t('Hai già un account?')}{' '}
              <Text style={styles.link}>{mode === 'login' ? t('Registrati') : t('Accedi')}</Text>
            </Text>
          </Pressable>

          <Text style={styles.legal}>
            {t('Continuando accetti i Termini d\'uso e l\'Informativa privacy di viral.')}
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: 24, paddingTop: 40, flexGrow: 1 },
  logo: { color: colors.accent, fontFamily: fonts.display, fontSize: 30, letterSpacing: -1 },
  title: { color: colors.text, fontFamily: fonts.display, fontSize: 32, letterSpacing: -1, marginTop: 28 },
  sub: { color: colors.textDim, fontSize: 14.5, lineHeight: 21, marginTop: 6, marginBottom: 26 },
  social: { marginBottom: 10 },
  brand: { color: colors.text, fontSize: 18, fontWeight: '800' },
  orRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginVertical: 18 },
  line: { flex: 1, height: 1, backgroundColor: colors.border },
  or: { color: colors.textDim, fontSize: 12.5 },
  input: { height: 52, marginBottom: 10 },
  link: { color: colors.accent, fontFamily: fonts.semibold, fontSize: 13.5 },
  error: { color: colors.err, fontSize: 13.5, marginVertical: 6, lineHeight: 19 },
  info: { color: colors.ok, fontSize: 13.5, marginVertical: 6, lineHeight: 19 },
  switch: { alignSelf: 'center', marginTop: 20 },
  switchText: { color: colors.textDim, fontSize: 14 },
  legal: { color: colors.textDim, fontSize: 11.5, textAlign: 'center', marginTop: 'auto', paddingTop: 30, opacity: 0.8 },
});
