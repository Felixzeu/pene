import React, { useEffect, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { Crown, LogOut, Trash2, UserRound } from 'lucide-react-native';
import { Btn, Header, Screen } from '../components/ui';
import { colors, fonts } from '../theme';
import { signOut } from '../services/auth';
import { deleteAccount, getAccount } from '../services/api';
import { clearHistory } from '../services/history';

// Il tuo account: esci, oppure elimina tutto (richiesto dall'App Store).
export default function AccountScreen({ email, onBack }: { email: string | null; onBack: () => void }) {
  const [busy, setBusy] = useState(false);
  const [admin, setAdmin] = useState(false);
  useEffect(() => { getAccount().then((a) => setAdmin(a.admin)).catch(() => {}); }, []);

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
      <View style={{ padding: 20, gap: 12 }}>
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
        <Btn label="Esci" variant="ghost" icon={<LogOut size={17} color={colors.text} />} onPress={() => signOut()} disabled={busy} />
        <Btn label="Elimina account" variant="danger" icon={<Trash2 size={17} color={colors.err} />} onPress={remove} loading={busy} />
        <Text style={styles.note}>
          Eliminando l'account cancelli anche i video sul server e i collegamenti ai social. I video già pubblicati sui social restano lì.
        </Text>
      </View>
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
  note: { color: colors.textDim, fontSize: 12.5, lineHeight: 18, marginTop: 6 },
});
