import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useFonts, SpaceGrotesk_500Medium, SpaceGrotesk_600SemiBold, SpaceGrotesk_700Bold } from '@expo-google-fonts/space-grotesk';
import HomeScreen from './src/screens/HomeScreen';
import NewVideoScreen from './src/screens/NewVideoScreen';
import ScriptScreen from './src/screens/ScriptScreen';
import RecordScreen from './src/screens/RecordScreen';
import ReviewScreen from './src/screens/ReviewScreen';
import EditScreen from './src/screens/EditScreen';
import PublishScreen from './src/screens/PublishScreen';
import ModifyScreen from './src/screens/ModifyScreen';
import ReportScreen from './src/screens/ReportScreen';
import AuthScreen from './src/screens/AuthScreen';
import AccountScreen from './src/screens/AccountScreen';
import { setHistoryUser, upsertProject } from './src/services/history';
import { accountsEnabled, getSession, onSessionChange } from './src/services/auth';
import type { Project } from './src/types';
import { colors } from './src/theme';

type Route =
  | { name: 'home' }
  | { name: 'new' }
  | { name: 'script'; project: Project }
  | { name: 'record'; project: Project }
  | { name: 'review'; project: Project }
  | { name: 'edit'; project: Project }
  | { name: 'publish'; project: Project }
  | { name: 'modify'; project: Project }
  | { name: 'report' }
  | { name: 'account' };

// Stack navigator minimale con transizione di entrata: le schermate sono un
// flusso lineare (idea → script → registrazione → montaggio → pubblicazione),
// quindi niente tab: un solo gesto avanti, uno indietro.
export default function App() {
  const [stack, setStack] = useState<Route[]>([{ name: 'home' }]);
  const fade = useRef(new Animated.Value(1)).current;
  const current = stack[stack.length - 1];
  // Font dei titoli (stile Neon); finché non sono caricati si vede solo lo sfondo.
  const [fontsReady] = useFonts({ SpaceGrotesk_500Medium, SpaceGrotesk_600SemiBold, SpaceGrotesk_700Bold });

  const push = useCallback((r: Route) => {
    fade.setValue(0);
    Animated.timing(fade, { toValue: 1, duration: 220, useNativeDriver: true }).start();
    setStack((s) => [...s, r]);
  }, [fade]);

  const pop = useCallback(() => setStack((s) => (s.length > 1 ? s.slice(0, -1) : s)), []);
  const toHome = useCallback(() => setStack([{ name: 'home' }]), []);

  const save = useCallback(async (p: Project) => { await upsertProject(p); }, []);

  // Login: senza account Supabase configurati si entra direttamente (modalità solo-tu).
  const [user, setUser] = useState<{ id: string; email: string | null } | null | undefined>(accountsEnabled ? undefined : null);
  useEffect(() => {
    if (!accountsEnabled) return;
    const apply = async (s: Awaited<ReturnType<typeof getSession>>) => {
      const u = s?.user ? { id: s.user.id, email: s.user.email ?? null } : null;
      await setHistoryUser(u?.id ?? null);
      setUser((prev) => {
        if (prev?.id !== u?.id) setStack([{ name: 'home' }]); // cambio account: si riparte dalla Home
        return u;
      });
    };
    getSession().then(apply);
    return onSessionChange((s) => { apply(s); });
  }, []);

  if (!fontsReady || user === undefined) return <View style={styles.root} />;
  if (accountsEnabled && !user) {
    return (
      <SafeAreaProvider>
        <StatusBar style="light" />
        <View style={styles.root}><AuthScreen /></View>
      </SafeAreaProvider>
    );
  }

  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <Animated.View style={[styles.root, { opacity: fade }]}>
        {current.name === 'home' && (
          <HomeScreen
            onNew={() => push({ name: 'new' })}
            onReport={() => push({ name: 'report' })}
            onAccount={accountsEnabled ? () => push({ name: 'account' }) : undefined}
            onResume={(p) => {
              // Riprende il progetto dal punto in cui si era fermato.
              if (p.published?.length || p.finalVideoUrl) push({ name: 'publish', project: p });
              else if (p.jobId) push({ name: 'edit', project: p });
              else if (p.rawVideoUri) push({ name: 'review', project: p });
              else if (p.scriptResult) push({ name: 'script', project: p });
              else push({ name: 'new' });
            }}
            onModify={(p) => {
              // Scorri a destra: apre direttamente la modifica (video montato) o lo script.
              if (p.jobId && p.finalVideoUrl) setStack((s) => [...s, { name: 'publish', project: p }, { name: 'modify', project: p }]);
              else if (p.jobId) push({ name: 'edit', project: p });
              else if (p.scriptResult) push({ name: 'script', project: p });
              else push({ name: 'new' });
            }}
          />
        )}

        {current.name === 'report' && <ReportScreen onBack={pop} />}
        {current.name === 'account' && <AccountScreen email={user?.email ?? null} onBack={pop} />}

        {current.name === 'new' && (
          <NewVideoScreen
            onBack={pop}
            save={save}
            onScript={(p) => push({ name: 'script', project: p })}
          />
        )}

        {current.name === 'script' && (
          <ScriptScreen
            project={current.project}
            onBack={toHome}
            update={(p) => setStack((s) => {
              const copy = [...s];
              const top = copy[copy.length - 1];
              if (top.name !== 'home') copy[copy.length - 1] = { ...top, project: p } as Route;
              return copy;
            })}
            onRecord={(p) => push({ name: 'record', project: p })}
          />
        )}

        {current.name === 'record' && (
          <RecordScreen
            project={current.project}
            onClose={pop}
            onDone={(uri) => {
              const p = { ...current.project, rawVideoUri: uri };
              upsertProject(p);
              push({ name: 'review', project: p });
            }}
          />
        )}

        {current.name === 'review' && (
          <ReviewScreen
            project={current.project}
            onBack={() => push({ name: 'record', project: current.project })}
            onEdit={(p) => {
              setStack((s) => [...s.slice(0, -1), { name: 'edit', project: p }]);
            }}
          />
        )}

        {current.name === 'edit' && (
          <EditScreen
            project={current.project}
            onBack={pop}
            onHome={toHome}
            onReady={(p) => {
              setStack((s) => [...s.slice(0, -1), { name: 'publish', project: p }]);
            }}
            onModify={(p) => {
              setStack((s) => [...s.slice(0, -1), { name: 'publish', project: p }, { name: 'modify', project: p }]);
            }}
          />
        )}

        {current.name === 'modify' && (
          <ModifyScreen
            project={current.project}
            onBack={pop}
            onDone={(p) => {
              // Torna a Pubblica con il video aggiornato.
              setStack((s) => {
                const rest = s.slice(0, -1);
                const top = rest[rest.length - 1];
                if (top?.name === 'publish') return [...rest.slice(0, -1), { name: 'publish', project: { ...top.project, finalVideoUrl: p.finalVideoUrl } }];
                return [...rest, { name: 'publish', project: p }];
              });
            }}
          />
        )}

        {current.name === 'publish' && (
          <PublishScreen
            project={current.project}
            onBack={pop}
            onHome={toHome}
            onModify={(p) => push({ name: 'modify', project: p })}
            update={(p) => setStack((s) => {
              const copy = [...s];
              copy[copy.length - 1] = { ...copy[copy.length - 1], project: p } as Route;
              return copy;
            })}
          />
        )}
      </Animated.View>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
});
