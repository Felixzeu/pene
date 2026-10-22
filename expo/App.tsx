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
import SocialsScreen from './src/screens/SocialsScreen';
import MyVideosScreen from './src/screens/MyVideosScreen';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { setHistoryUser, upsertProject } from './src/services/history';
import { accountsEnabled, getSession, onSessionChange } from './src/services/auth';
import type { Project } from './src/types';
import { colors } from './src/theme';
import { useLanguage } from './src/services/language';

const ONBOARDED = 'viral.onboarded.'; // + id utente: "Collega i tuoi social" già vista

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
  | { name: 'account' }
  | { name: 'socials' }
  | { name: 'myvideos' };

// Stack navigator minimale con transizione di entrata: le schermate sono un
// flusso lineare (idea → script → registrazione → montaggio → pubblicazione),
// quindi niente tab: un solo gesto avanti, uno indietro.
export default function App() {
  const [stack, setStack] = useState<Route[]>([{ name: 'home' }]);
  const fade = useRef(new Animated.Value(1)).current;
  const current = stack[stack.length - 1];
  // Font dei titoli (stile Neon); finché non sono caricati si vede solo lo sfondo.
  const [fontsReady] = useFonts({ SpaceGrotesk_500Medium, SpaceGrotesk_600SemiBold, SpaceGrotesk_700Bold });
  // Cambiando lingua tutta l'app si ridisegna subito con i testi tradotti (vedi src/i18n).
  useLanguage();

  const push = useCallback((r: Route) => {
    fade.setValue(0);
    Animated.timing(fade, { toValue: 1, duration: 220, useNativeDriver: true }).start();
    setStack((s) => [...s, r]);
  }, [fade]);

  const pop = useCallback(() => setStack((s) => (s.length > 1 ? s.slice(0, -1) : s)), []);
  const toHome = useCallback(() => setStack([{ name: 'home' }]), []);

  const save = useCallback(async (p: Project) => { await upsertProject(p); }, []);

  // Riprende il progetto dal punto in cui si era fermato.
  const resume = (p: Project) => {
    if (p.published?.length || p.finalVideoUrl) push({ name: 'publish', project: p });
    else if (p.jobId) push({ name: 'edit', project: p });
    else if (p.rawVideoUri) push({ name: 'review', project: p });
    else if (p.scriptResult) push({ name: 'script', project: p });
    else push({ name: 'new' });
  };
  // Scorri a destra: apre direttamente la modifica (video montato) o lo script.
  const modify = (p: Project) => {
    if (p.jobId && p.finalVideoUrl) setStack((s) => [...s, { name: 'publish', project: p }, { name: 'modify', project: p }]);
    else if (p.jobId) push({ name: 'edit', project: p });
    else if (p.scriptResult) push({ name: 'script', project: p });
    else push({ name: 'new' });
  };

  // Login: senza account Supabase configurati si entra direttamente (modalità solo-tu).
  const [user, setUser] = useState<{ id: string; email: string | null } | null | undefined>(accountsEnabled ? undefined : null);
  // Account appena creato: prima della Home la schermata "Collega i tuoi social" (una volta sola).
  const [onboarding, setOnboarding] = useState(false);
  useEffect(() => {
    if (!accountsEnabled) return;
    const apply = async (s: Awaited<ReturnType<typeof getSession>>) => {
      const u = s?.user ? { id: s.user.id, email: s.user.email ?? null } : null;
      await setHistoryUser(u?.id ?? null);
      if (u && s?.user) {
        const seen = await AsyncStorage.getItem(ONBOARDED + u.id).catch(() => '1');
        // Solo per gli account nuovi (creati da meno di 7 giorni, es. dopo la conferma dell'email):
        // chi era già registrato non la vede.
        const fresh = Date.now() - Date.parse(s.user.created_at ?? '') < 7 * 24 * 3600 * 1000;
        setOnboarding(!seen && fresh);
      } else {
        setOnboarding(false);
      }
      setUser((prev) => {
        if (prev?.id !== u?.id) setStack([{ name: 'home' }]); // cambio account: si riparte dalla Home
        return u;
      });
    };
    getSession().then(apply);
    return onSessionChange((s) => { apply(s); });
  }, []);

  const finishOnboarding = () => {
    if (user) AsyncStorage.setItem(ONBOARDED + user.id, '1').catch(() => {});
    setOnboarding(false);
  };

  if (!fontsReady || user === undefined) return <View style={styles.root} />;
  if (accountsEnabled && !user) {
    return (
      <SafeAreaProvider>
        <StatusBar style="light" />
        <View style={styles.root}><AuthScreen /></View>
      </SafeAreaProvider>
    );
  }

  if (onboarding) {
    return (
      <SafeAreaProvider>
        <StatusBar style="light" />
        <View style={styles.root}><SocialsScreen onDone={finishOnboarding} /></View>
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
            onSocials={() => push({ name: 'socials' })}
            onMyVideos={() => push({ name: 'myvideos' })}
            onResume={resume}
            onModify={modify}
          />
        )}

        {current.name === 'myvideos' && (
          <MyVideosScreen onBack={pop} onNew={() => push({ name: 'new' })} onResume={resume} onModify={modify} />
        )}

        {current.name === 'report' && <ReportScreen onBack={pop} />}
        {current.name === 'account' && <AccountScreen email={user?.email ?? null} onBack={pop} onSocials={() => push({ name: 'socials' })} />}
        {current.name === 'socials' && <SocialsScreen onBack={pop} />}

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
            onUpload={(p, uri) => {
              // Video caricato dalla galleria o dai file: salta la registrazione.
              const next = { ...p, rawVideoUri: uri };
              upsertProject(next);
              push({ name: 'review', project: next });
            }}
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
            // Video caricato: "Rifai" torna allo script per sceglierne un altro; registrato: si rifà la ripresa.
            onBack={() => (stack[stack.length - 2]?.name === 'script' ? pop() : push({ name: 'record', project: current.project }))}
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
