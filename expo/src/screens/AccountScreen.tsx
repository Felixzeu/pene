import React, { useEffect, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Coins, Crown, Link2, LogOut, Trash2, UserRound } from 'lucide-react-native';
import { Btn, Header, Screen } from '../components/ui';
import { colors, fonts } from '../theme';
import { signOut } from '../services/auth';
import { deleteAccount, getAccount, getWallet, type Wallet } from '../services/api';
import { clearHistory } from '../services/history';

// Il tuo account: esci, oppure elimina tutto (richiesto dall'App Store).
export default function AccountScreen({ email, onBack, onSocials }: { email: string | null; onBack: () => void; onSocials: () => void }) {
  const [busy, setBusy] = useState(false);
  const [admin, setAdmin] = useState(false);
  const [wallet, setWallet] = useState<Wallet | null>(null);
  useEffect(() => {
    getAccount().then((a) => setAdmin(a.admin)).catch(() => {});
    getWallet().then(setWallet).catch(() => {});
  }, []);

  // Gli acquisti veri arriveranno con gli acquisti in-app di Apple (serve la build dell'app, non Expo Go).
  const topUp = () => Alert.alert('Ricarica coin', 'L\'acquisto dei coin arriva presto.');

  const remove = () =>
    Alert.alert(
      'Eliminare l\'account?',
      'Cancelliamo il tuo account, i video sul server e i social collegati. Non si può annullare.',
      [
        { text: 'Annulla', style: 'cancel' },
        {
          text: 'Elimina per sempre', style: 'destructive',
          onPress: async () => {
            setBusy(true);
            try {
              await deleteAccount();
              await clearHistory();
              await signOut();
            } catch (e) {
              Alert.alert('Eliminazione non riuscita', e instanceof Error ? e.message : 'Riprova.');
            } finally {
              setBusy(false);
            }
          },
        },
      ],
    );

  return (
    <Screen>
      <Header title="Account" onBack={onBack} />
      <ScrollView contentContainerStyle={{ padding: 20, gap: 12 }}>
        <View style={styles.card}>
          <View style={styles.avatar}><UserRound size={22} color={colors.onAccent} /></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.label}>Accesso fatto come</Text>
            <Text style={styles.email} numberOfLines={1}>{email ?? 'account senza email'}</Text>
          </View>
          {admin && (
            <View style={styles.admin}><Crown size={13} color={colors.onAccent} /><Text style={styles.adminText}>Admin</Text></View>
          )}
        </View>
        {wallet && (
          <View style={styles.wallet}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <Coins size={22} color={colors.warm} />
              <View style={{ flex: 1 }}>
                <Text style={styles.label}>I tuoi coin</Text>
                <Text style={styles.coins}>{wallet.unlimited ? 'Illimitati' : wallet.coins}</Text>
              </View>
              {!wallet.unlimited && <Btn label="Ricarica" onPress={topUp} style={{ paddingHorizontal: 16 }} />}
            </View>
            <Text style={styles.costs}>
              Script {wallet.costs.script} · Montaggio {wallet.costs.edit} · Modifica IA {wallet.costs.ai} · Export {wallet.costs.render} · Pubblicazione {wallet.costs.publish} per social
            </Text>
            {wallet.history.slice(0, 6).map((h, i) => (
              <View key={i} style={styles.row}>
                <Text style={styles.rowText} numberOfLines={1}>{h.reason}</Text>
                <Text style={[styles.rowDelta, { color: h.delta > 0 ? colors.ok : colors.textDim }]}>{h.delta > 0 ? `+${h.delta}` : h.delta}</Text>
              </View>
            ))}
          </View>
        )}
        <Btn label="Social collegati" variant="ghost" icon={<Link2 size={17} color={colors.text} />} onPress={onSocials} disabled={busy} />
        <Btn label="Esci" variant="ghost" icon={<LogOut size={17} color={colors.text} />} onPress={() => signOut()} disabled={busy} />
        <Btn label="Elimina account" variant="danger" icon={<Trash2 size={17} color={colors.err} />} onPress={remove} loading={busy} />
        <Text style={styles.note}>
          Eliminando l'account cancelli anche i video sul server e i collegamenti ai social. I video già pubblicati sui social restano lì.
        </Text>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16, borderRadius: 18,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, marginBottom: 8,
  },
  avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  label: { color: colors.textDim, fontSize: 12 },
  email: { color: colors.text, fontFamily: fonts.semibold, fontSize: 16, marginTop: 2 },
  admin: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: colors.warm, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 4 },
  adminText: { color: colors.onAccent, fontFamily: fonts.display, fontSize: 11.5 },
  wallet: { padding: 16, borderRadius: 18, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, gap: 10, marginBottom: 8 },
  coins: { color: colors.text, fontFamily: fonts.display, fontSize: 26, marginTop: 2 },
  costs: { color: colors.textDim, fontSize: 12, lineHeight: 17 },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: 10 },
  rowText: { color: colors.text, fontSize: 13, flex: 1 },
  rowDelta: { fontFamily: fonts.semibold, fontSize: 13 },
  note: { color: colors.textDim, fontSize: 12.5, lineHeight: 18, marginTop: 6 },
});
