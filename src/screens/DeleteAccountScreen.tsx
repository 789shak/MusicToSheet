import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { useState } from 'react';
import { useRouter } from 'expo-router';
import { Feather, Ionicons } from '@expo/vector-icons';
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';

// ─── Data ─────────────────────────────────────────────────────────────────────
const REASONS = [
  { id: 'no_need',     label: 'No longer need it' },
  { id: 'alternative', label: 'Found a better alternative' },
  { id: 'expensive',   label: 'Too expensive' },
  { id: 'privacy',     label: 'Privacy concerns' },
  { id: 'features',    label: 'Missing features' },
  { id: 'other',       label: 'Other' },
];

// ─── Radio Option (same style as RightsDeclarationScreen) ─────────────────────
function RadioOption({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity style={[radio.row, selected && radio.rowSelected]} onPress={onPress} activeOpacity={0.7}>
      <View style={[radio.circle, selected && radio.circleSelected]}>
        {selected && <View style={radio.dot} />}
      </View>
      <Text style={[radio.label, selected && radio.labelSelected]}>{label}</Text>
    </TouchableOpacity>
  );
}

const radio = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 13,
    paddingHorizontal: 16,
    backgroundColor: '#1C1C27',
    borderRadius: 12,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#2D2D3E',
    gap: 14,
  },
  rowSelected: {
    borderColor: '#0EA5E940',
    backgroundColor: '#0EA5E908',
  },
  circle: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: '#4B5563',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  circleSelected: {
    borderColor: '#0EA5E9',
    backgroundColor: '#0EA5E915',
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#0EA5E9',
  },
  label: {
    flex: 1,
    color: '#9CA3AF',
    fontSize: 14,
    lineHeight: 20,
  },
  labelSelected: {
    color: '#FFFFFF',
  },
});

// ─── Main Screen ──────────────────────────────────────────────────────────────
export default function DeleteAccountScreen() {
  const router = useRouter();
  const { user, signOut } = useAuth();
  const [selectedReason, setSelectedReason] = useState('');
  const [otherText, setOtherText] = useState('');
  const [loading, setLoading] = useState(false);

  const canProceed = selectedReason !== '' &&
    (selectedReason !== 'other' || otherText.trim().length > 0);

  function handleDeactivate() {
    Alert.alert(
      'Deactivate Account?',
      'Your account will be paused. If there is no activity for 60 days, your account and all data will be permanently deleted.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Deactivate',
          style: 'destructive',
          onPress: async () => {
            if (!user) return;
            setLoading(true);
            const { error } = await supabase
              .from('profiles')
              .update({ is_deactivated: true, deactivated_at: new Date().toISOString() })
              .eq('id', user.id);
            setLoading(false);
            if (error) {
              Alert.alert('Error', error.message);
            } else {
              await signOut();
              router.replace('/');
            }
          },
        },
      ]
    );
  }

  function handleDelete() {
    Alert.alert(
      'Are you absolutely sure?',
      'This action cannot be undone. Your profile, conversion history, saved items, and all associated data will be permanently removed.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete Forever',
          style: 'destructive',
          onPress: async () => {
            if (!user) return;
            setLoading(true);
            // Delete the profile row (cascades to related data via FK constraints)
            const { error } = await supabase
              .from('profiles')
              .delete()
              .eq('id', user.id);
            setLoading(false);
            if (error) {
              Alert.alert('Error', error.message);
              return;
            }
            // Sign out — full auth user deletion requires a server-side function
            // (Supabase admin.deleteUser) which should be called via an Edge Function
            await signOut();
            router.replace('/');
          },
        },
      ]
    );
  }

  return (
    <View style={styles.root}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()} hitSlop={8}>
          <Feather name="arrow-left" size={22} color="#FFFFFF" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Delete Account</Text>
        <View style={styles.backBtn} />
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* ── Heading ── */}
        <View style={styles.heroArea}>
          <Ionicons name="sad-outline" size={48} color="#4B5563" style={{ marginBottom: 14 }} />
          <Text style={styles.heading}>We're sorry to see you go</Text>
          <Text style={styles.subheading}>Please tell us why you're leaving</Text>
        </View>

        {/* ── Reason radio buttons ── */}
        {REASONS.map((r) => (
          <View key={r.id}>
            <RadioOption
              label={r.label}
              selected={selectedReason === r.id}
              onPress={() => { setSelectedReason(r.id); setOtherText(''); }}
            />
            {/* "Other" text input — only shown when selected */}
            {r.id === 'other' && selectedReason === 'other' && (
              <TextInput
                style={styles.otherInput}
                placeholder="Tell us more..."
                placeholderTextColor="#6B7280"
                value={otherText}
                onChangeText={setOtherText}
                multiline
                numberOfLines={3}
                textAlignVertical="top"
                autoFocus
              />
            )}
          </View>
        ))}

        <View style={styles.divider} />

        {/* ── Deactivate button ── */}
        <TouchableOpacity
          style={[styles.btnDeactivate, (!canProceed || loading) && styles.btnDisabled]}
          onPress={handleDeactivate}
          disabled={!canProceed || loading}
          activeOpacity={0.85}
        >
          {loading
            ? <ActivityIndicator size="small" color="#F59E0B" />
            : <Text style={[styles.btnDeactivateText, !canProceed && styles.btnDisabledText]}>Temporarily Deactivate</Text>
          }
        </TouchableOpacity>

        {/* ── Delete button ── */}
        <TouchableOpacity
          style={[styles.btnDelete, (!canProceed || loading) && styles.btnDisabled]}
          onPress={handleDelete}
          disabled={!canProceed || loading}
          activeOpacity={0.85}
        >
          {loading ? (
            <ActivityIndicator size="small" color="#FFFFFF" />
          ) : (
            <>
              <Ionicons
                name="trash-outline"
                size={16}
                color={canProceed ? '#FFFFFF' : '#4B5563'}
                style={{ marginRight: 8 }}
              />
              <Text style={[styles.btnDeleteText, !canProceed && styles.btnDisabledText]}>
                Permanently Delete
              </Text>
            </>
          )}
        </TouchableOpacity>

        {/* Hint */}
        {!canProceed && (
          <Text style={styles.hintText}>
            {selectedReason === 'other' && otherText.trim().length === 0
              ? 'Please describe your reason above.'
              : 'Please select a reason before continuing.'}
          </Text>
        )}

        {/* ── Cancel link ── */}
        <TouchableOpacity
          style={styles.cancelWrap}
          onPress={() => router.back()}
        >
          <Text style={styles.cancelText}>Cancel — keep my account</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#111118' },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 56,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#1C1C27',
  },
  backBtn: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { color: '#FFFFFF', fontSize: 18, fontWeight: '700' },

  // Scroll
  scroll: {
    paddingHorizontal: 20,
    paddingTop: 32,
    paddingBottom: 48,
  },

  // Hero
  heroArea: {
    alignItems: 'center',
    marginBottom: 28,
  },
  heading: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 8,
  },
  subheading: {
    color: '#6B7280',
    fontSize: 14,
    textAlign: 'center',
  },

  // "Other" text input
  otherInput: {
    backgroundColor: '#1C1C27',
    borderWidth: 1,
    borderColor: '#0EA5E940',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: '#FFFFFF',
    fontSize: 14,
    lineHeight: 20,
    marginTop: -4,
    marginBottom: 10,
  },

  // Divider
  divider: {
    height: 1,
    backgroundColor: '#2D2D3E',
    marginVertical: 24,
  },

  // Deactivate button
  btnDeactivate: {
    borderWidth: 1.5,
    borderColor: '#F59E0B',
    borderRadius: 14,
    paddingVertical: 15,
    alignItems: 'center',
    marginBottom: 12,
  },
  btnDeactivateText: {
    color: '#F59E0B',
    fontSize: 15,
    fontWeight: '700',
  },

  // Delete button
  btnDelete: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#EF4444',
    borderRadius: 14,
    paddingVertical: 15,
    marginBottom: 10,
  },
  btnDeleteText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },

  // Shared disabled state
  btnDisabled: {
    opacity: 0.35,
  },
  btnDisabledText: {
    color: '#6B7280',
  },

  // Hint
  hintText: {
    color: '#6B7280',
    fontSize: 12,
    textAlign: 'center',
    marginBottom: 8,
  },

  // Cancel link
  cancelWrap: {
    alignItems: 'center',
    paddingVertical: 20,
    marginTop: 8,
  },
  cancelText: {
    color: '#0EA5E9',
    fontSize: 14,
    fontWeight: '500',
  },
});
