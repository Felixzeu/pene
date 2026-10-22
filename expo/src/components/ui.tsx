import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  ViewStyle,
  StyleProp,
  TextStyle,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { colors, fonts, gradient, radius } from '../theme';

// Piccolo design system condiviso (stile Neon): superfici scure viola, bordi sottili,
// pulsante principale in gradiente rosa→viola con alone, titoli in Space Grotesk.

export function Screen({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return (
    <SafeAreaView style={[styles.safe, style]} edges={['top', 'bottom']}>
      {children}
    </SafeAreaView>
  );
}

export function Header({ title, subtitle, onBack }: {
  title: string; subtitle?: string; onBack?: () => void;
}) {
  return (
    <View style={styles.header}>
      {onBack && (
        <Pressable onPress={onBack} hitSlop={12} style={styles.backBtn}>
          <Text style={styles.backText}>‹</Text>
        </Pressable>
      )}
      <View style={{ flex: 1 }}>
        <Text style={styles.title}>{title}</Text>
        {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      </View>
    </View>
  );
}

type BtnVariant = 'primary' | 'ghost' | 'danger' | 'warm';
export function Btn({ label, onPress, variant = 'primary', loading, disabled, icon, style }: {
  label: string; onPress: () => void; variant?: BtnVariant; loading?: boolean;
  disabled?: boolean; icon?: React.ReactNode; style?: StyleProp<ViewStyle>;
}) {
  const v = variants[variant];
  const content = (
    <>
      {loading ? <ActivityIndicator color={v.label.color as string} /> : icon}
      <Text style={[styles.btnLabel, v.label]}>{label}</Text>
    </>
  );
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.btn, v.btn,
        variant === 'primary' && styles.glow,
        (disabled || loading) && { opacity: 0.45 },
        pressed && { transform: [{ scale: 0.97 }] },
        style,
      ]}
    >
      {variant === 'primary' ? (
        <LinearGradient colors={gradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.btnFill}>
          {content}
        </LinearGradient>
      ) : content}
    </Pressable>
  );
}

const variants: Record<BtnVariant, { btn: ViewStyle; label: TextStyle }> = {
  primary: { btn: { paddingHorizontal: 0 }, label: { color: colors.onAccent } },
  warm: { btn: { backgroundColor: colors.warm }, label: { color: colors.onWarm } },
  ghost: { btn: { backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border }, label: { color: colors.text } },
  danger: { btn: { backgroundColor: 'transparent', borderWidth: 1.5, borderColor: colors.err }, label: { color: colors.err } },
};

export function Chip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.chip,
        selected && { backgroundColor: colors.accentSoft, borderColor: colors.accent },
      ]}
    >
      <Text style={[styles.chipText, selected && { color: colors.accent, fontFamily: fonts.semibold }]}>{label}</Text>
    </Pressable>
  );
}

export function ChipRow({ options, value, onChange }: {
  options: readonly string[]; value: string; onChange: (v: string) => void;
}) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
      {options.map((o) => (
        <Chip key={o} label={o} selected={value === o} onPress={() => onChange(o)} />
      ))}
    </ScrollView>
  );
}

export function Field({ label, hint, children, style }: {
  label: string; hint?: string; children: React.ReactNode; style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[styles.field, style]}>
      <Text style={styles.fieldLabel}>{label}</Text>
      {children}
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
    </View>
  );
}

export function TextArea(props: React.ComponentProps<typeof TextInput>) {
  return (
    <TextInput
      {...props}
      multiline
      textAlignVertical="top"
      style={[styles.input, styles.textArea, props.style]}
      placeholderTextColor={colors.textDim}
    />
  );
}

export function Input(props: React.ComponentProps<typeof TextInput>) {
  return (
    <TextInput
      {...props}
      style={[styles.input, props.style]}
      placeholderTextColor={colors.textDim}
    />
  );
}

export function ProgressBar({ pct, tint = colors.accent }: { pct: number; tint?: string }) {
  return (
    <View style={styles.track}>
      <View style={[styles.fill, { width: `${Math.min(100, Math.max(0, pct))}%`, backgroundColor: tint }]} />
    </View>
  );
}

export function Badge({ text, tone = 'dim' }: { text: string; tone?: 'dim' | 'ok' | 'err' | 'accent' | 'warm' }) {
  const bg = { dim: colors.surfaceAlt, ok: 'rgba(61,220,132,0.15)', err: 'rgba(255,107,107,0.15)', accent: colors.accentSoft, warm: 'rgba(255,180,67,0.15)' }[tone];
  const fg = { dim: colors.textDim, ok: colors.ok, err: colors.err, accent: colors.accent, warm: colors.warm }[tone];
  return (
    <View style={[styles.badge, { backgroundColor: bg }]}>
      <Text style={{ color: fg, fontSize: 11, fontWeight: '700' }}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingTop: 18, paddingBottom: 10 },
  backBtn: { width: 40, height: 40, borderRadius: 14, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  backText: { color: colors.text, fontSize: 26, lineHeight: 30, marginTop: -3 },
  title: { color: colors.text, fontSize: 26, fontFamily: fonts.display, letterSpacing: -0.8 },
  subtitle: { color: colors.textDim, fontSize: 13, marginTop: 2 },
  btn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    height: 54, borderRadius: radius.md, paddingHorizontal: 22,
  },
  btnLabel: { fontSize: 16, fontFamily: fonts.display },
  btnFill: {
    flex: 1, alignSelf: 'stretch', flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, paddingHorizontal: 22, borderRadius: radius.md,
  },
  glow: { shadowColor: colors.accent2, shadowOpacity: 0.45, shadowRadius: 18, shadowOffset: { width: 0, height: 8 }, elevation: 8 },
  chip: { paddingHorizontal: 16, height: 38, borderRadius: 19, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, justifyContent: 'center' },
  chipText: { color: colors.textDim, fontSize: 13.5 },
  chipRow: { gap: 8, paddingVertical: 2 },
  field: { marginBottom: 18 },
  fieldLabel: { color: colors.text, fontSize: 13.5, fontFamily: fonts.semibold, marginBottom: 8, letterSpacing: 0.2 },
  hint: { color: colors.textDim, fontSize: 12, marginTop: 6, lineHeight: 17 },
  input: {
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.lg, color: colors.text, paddingHorizontal: 14, fontSize: 15,
  },
  textArea: { minHeight: 110, paddingTop: 12, lineHeight: 21 },
  track: { height: 5, borderRadius: 3, backgroundColor: colors.surfaceAlt, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 3 },
  badge: { paddingHorizontal: 9, paddingVertical: 4, borderRadius: 999, alignSelf: 'flex-start' },
});
