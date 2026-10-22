import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, AppState, Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { CheckCircle2, Link2, Unlink } from 'lucide-react-native';
import { Header, Screen } from '../components/ui';
import { colors, fonts } from '../theme';
import { PROVIDERS, type ProviderId } from '../config';
import { authUrl, linkedProviders, unlinkProvider } from '../services/api';
import { linkSocial } from '../services/social';
import { t, tServer } from '../i18n';

const COLORS: Record<ProviderId, string> = { youtube: '#FF0000', instagram: '#E1306C', facebook: '#1877F2', tiktok: '#25F4EE' };

// I social collegati al tuo account: collega o scollega ognuno con un tocco.
export default function SocialsScreen({ onBack }: { onBack: () => void }) {
  const [linked, setLinked] = useState<Partial<Record<ProviderId, boolean>> | null>(null);
  const [busy, setBusy] = useState<ProviderId | null>(null);
  const refresh = useCallback(() => { linkedProviders().then(setLinked).catch(() => setLinked({})); }, []);
  useEffect(() => {
    refresh();
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') refresh(); });
    return () => sub.remove();
  }, [refresh]);

  const connect = async (id: ProviderId) => {
    setBusy(id);
    try {
      const r = await linkSocial(id);
      if (r) Alert.alert(r.ok ? t('Collegato!') : t('Collegamento non riuscito'), tServer(r.message));
    } catch (e) {
      Alert.alert(t('Collegamento non riuscito'), e instanceof Error ? tServer(e.message) : t('Riprova.'));
    } finally {
      setBusy(null);
      refresh();
    }
  };

  // Se il login nel telefono non va (TikTok a volte blocca la pagina mobile), si completa dal computer.
  const connectFromComputer = async (id: ProviderId, label: string) => {
    try {
      const url = await authUrl(id);
      Alert.alert(
        t('Collega {name} dal computer', { name: label }),
        t('Ti mando un link: aprilo sul computer (stessa rete Wi-Fi) entro 10 minuti e completa il login. Poi torna qui.'),
        [{ text: t('Annulla'), style: 'cancel' }, { text: t('Condividi link'), onPress: () => Share.share({ message: url }) }],
      );
    } catch (e) {
      Alert.alert(t('Errore'), e instanceof Error ? tServer(e.message) : t('Riprova.'));
    }
  };

  const disconnect = (id: ProviderId, label: string) =>
    Alert.alert(t('Scollegare {name}?', { name: label }), t('ViralAPP non potrà più pubblicare su questo account finché non lo ricolleghi.'), [
      { text: t('Annulla'), style: 'cancel' },
      {
        text: t('Scollega'), style: 'destructive',
        onPress: async () => {
          setBusy(id);
          try { await unlinkProvider(id); } catch (e) { Alert.alert(t('Errore'), e instanceof Error ? tServer(e.message) : t('Riprova.')); }
          setBusy(null);
          refresh();
        },
      },
    ]);

  return (
    <Screen>
      <Header title={t('Social collegati')} subtitle={t('Dove viral può pubblicare i tuoi video')} onBack={onBack} />
      <ScrollView contentContainerStyle={{ padding: 20, gap: 10 }}>
        {PROVIDERS.map((p) => {
          const on = !!linked?.[p.id];
          return (
            <View key={p.id} style={styles.row}>
              <View style={[styles.dot, { backgroundColor: COLORS[p.id] }]} />
              <View style={{ flex: 1 }}>
                <Text style={styles.name}>{p.label}</Text>
                <Text style={[styles.state, on && { color: colors.ok }]}>
                  {linked === null ? t('controllo…') : on ? t('Collegato') : t('Non collegato')}
                </Text>
                {!on && linked !== null && (
                  <Pressable onPress={() => connectFromComputer(p.id, p.label)} hitSlop={6}>
                    <Text style={styles.alt}>{t('Collega dal computer')}</Text>
                  </Pressable>
                )}
              </View>
              {busy === p.id ? <ActivityIndicator color={colors.accent} /> : on ? (
                <Pressable onPress={() => disconnect(p.id, p.label)} style={[styles.btn, styles.btnOff]} hitSlop={6}>
                  <Unlink size={15} color={colors.err} />
                  <Text style={[styles.btnText, { color: colors.err }]}>{t('Scollega')}</Text>
                </Pressable>
              ) : (
                <Pressable onPress={() => connect(p.id)} style={[styles.btn, styles.btnOn]} hitSlop={6} disabled={linked === null}>
                  <Link2 size={15} color={colors.onAccent} />
                  <Text style={[styles.btnText, { color: colors.onAccent }]}>{t('Collega')}</Text>
                </Pressable>
              )}
            </View>
          );
        })}
        <View style={styles.note}>
          <CheckCircle2 size={15} color={colors.textDim} />
          <Text style={styles.noteText}>
            I collegamenti sono legati al tuo account viral: valgono su tutti i tuoi dispositivi. Scollegare non cancella i video già pubblicati.
          </Text>
        </View>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 18,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
  },
  dot: { width: 12, height: 12, borderRadius: 6 },
  name: { color: colors.text, fontFamily: fonts.semibold, fontSize: 16 },
  state: { color: colors.textDim, fontSize: 12.5, marginTop: 2 },
  btn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, height: 36, borderRadius: 999 },
  btnOn: { backgroundColor: colors.accent },
  btnOff: { borderWidth: 1, borderColor: colors.err },
  btnText: { fontFamily: fonts.semibold, fontSize: 13 },
  alt: { color: colors.accent, fontSize: 12, marginTop: 4, fontFamily: fonts.semibold },
  note: { flexDirection: 'row', gap: 8, marginTop: 10, paddingHorizontal: 4 },
  noteText: { flex: 1, color: colors.textDim, fontSize: 12.5, lineHeight: 18 },
});
