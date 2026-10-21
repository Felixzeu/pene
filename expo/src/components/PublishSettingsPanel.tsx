import React from 'react';
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { colors, fonts, radius } from '../theme';
import type { ProviderId } from '../config';
import type { PublishSettings } from '../types';

// Impostazioni per un social, mostrate sotto la sua riga nella schermata Pubblica.

function Toggle({ label, hint, value, onChange }: { label: string; hint?: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <View style={styles.row}>
      <View style={{ flex: 1 }}>
        <Text style={styles.label}>{label}</Text>
        {hint ? <Text style={styles.hint}>{hint}</Text> : null}
      </View>
      <Switch value={value} onValueChange={onChange} trackColor={{ true: colors.accent2, false: colors.surfaceAlt }} thumbColor="#fff" />
    </View>
  );
}

function Segmented<T extends string>({ label, options, value, onChange }: {
  label: string; options: { value: T; label: string }[]; value: T; onChange: (v: T) => void;
}) {
  return (
    <View style={{ marginBottom: 12 }}>
      <Text style={[styles.label, { marginBottom: 8 }]}>{label}</Text>
      <View style={styles.seg}>
        {options.map((o) => (
          <Pressable key={o.value} onPress={() => onChange(o.value)} style={[styles.segItem, value === o.value && styles.segOn]}>
            <Text style={[styles.segText, value === o.value && { color: colors.onAccent }]}>{o.label}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const CATEGORIES = [
  { value: '22', label: 'Persone e blog' },
  { value: '24', label: 'Intrattenimento' },
  { value: '23', label: 'Comicità' },
  { value: '27', label: 'Istruzione' },
  { value: '19', label: 'Viaggi' },
  { value: '26', label: 'Stile e how-to' },
];

export default function PublishSettingsPanel({ provider, settings, onChange }: {
  provider: ProviderId; settings: PublishSettings; onChange: (s: PublishSettings) => void;
}) {
  const set = <K extends keyof PublishSettings>(k: K, patch: Partial<PublishSettings[K]>) =>
    onChange({ ...settings, [k]: { ...settings[k], ...patch } });

  return (
    <View style={styles.panel}>
      {provider === 'youtube' && (
        <>
          <Segmented
            label="Visibilità"
            value={settings.youtube.privacy}
            onChange={(privacy) => set('youtube', { privacy })}
            options={[{ value: 'public', label: 'Pubblico' }, { value: 'unlisted', label: 'Non in elenco' }, { value: 'private', label: 'Privato' }]}
          />
          {settings.youtube.privacy !== 'private' && (
            <Text style={[styles.hint, { marginBottom: 10, color: colors.warm }]}>
              Finché Google non verifica il tuo progetto, YouTube mette comunque il video in privato.
            </Text>
          )}
          <Segmented label="Categoria" value={settings.youtube.category} onChange={(category) => set('youtube', { category })} options={CATEGORIES} />
          <Toggle label="Avvisa gli iscritti" value={settings.youtube.notifySubscribers} onChange={(notifySubscribers) => set('youtube', { notifySubscribers })} />
          <Toggle label="Video per bambini" hint="Obbligatorio dirlo a YouTube: se attivo, niente commenti." value={settings.youtube.madeForKids} onChange={(madeForKids) => set('youtube', { madeForKids })} />
        </>
      )}
      {provider === 'instagram' && (
        <Toggle label="Mostra anche nel feed" hint="Se spento il Reel appare solo nella scheda Reels." value={settings.instagram.shareToFeed} onChange={(shareToFeed) => set('instagram', { shareToFeed })} />
      )}
      {provider === 'facebook' && (
        <Segmented
          label="Sulla Pagina"
          value={settings.facebook.state}
          onChange={(state) => set('facebook', { state })}
          options={[{ value: 'PUBLISHED', label: 'Pubblica subito' }, { value: 'DRAFT', label: 'Salva in bozza' }]}
        />
      )}
      {provider === 'tiktok' && (
        <>
          <Text style={[styles.hint, { marginBottom: 10 }]}>Su TikTok il video esce privato finché l'app non è approvata.</Text>
          <Toggle label="Disattiva commenti" value={settings.tiktok.disableComment} onChange={(disableComment) => set('tiktok', { disableComment })} />
          <Toggle label="Disattiva duetti" value={settings.tiktok.disableDuet} onChange={(disableDuet) => set('tiktok', { disableDuet })} />
          <Toggle label="Disattiva stitch" value={settings.tiktok.disableStitch} onChange={(disableStitch) => set('tiktok', { disableStitch })} />
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { paddingTop: 4, paddingBottom: 14, paddingLeft: 36 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6 },
  label: { color: colors.text, fontSize: 13.5, fontFamily: fonts.medium },
  hint: { color: colors.textDim, fontSize: 11.5, marginTop: 2, lineHeight: 16 },
  seg: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  segItem: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: radius.full, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceAlt },
  segOn: { backgroundColor: colors.accent2, borderColor: colors.accent2 },
  segText: { color: colors.textDim, fontSize: 12.5, fontFamily: fonts.semibold },
});
