import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  TextInput,
  TouchableOpacity,
  Modal,
  FlatList,
  Pressable,
  Animated,
  ActivityIndicator,
} from 'react-native';
import { useRef, useState, useEffect, useCallback } from 'react';
import { useRouter } from 'expo-router';
import { Feather, Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useAuth } from '../hooks/useAuth';
import { supabase } from '../lib/supabase';

// ─── Countries ────────────────────────────────────────────────────────────────
const COUNTRIES = [
  'Afghanistan','Albania','Algeria','Argentina','Australia','Austria','Bangladesh',
  'Belgium','Bolivia','Brazil','Canada','Chile','China','Colombia','Croatia',
  'Czech Republic','Denmark','Ecuador','Egypt','Ethiopia','Finland','France',
  'Germany','Ghana','Greece','Guatemala','Hungary','India','Indonesia','Iran',
  'Iraq','Ireland','Israel','Italy','Japan','Jordan','Kenya','South Korea',
  'Malaysia','Mexico','Morocco','Netherlands','New Zealand','Nigeria','Norway',
  'Pakistan','Peru','Philippines','Poland','Portugal','Romania','Russia',
  'Saudi Arabia','Serbia','Singapore','South Africa','Spain','Sri Lanka','Sweden',
  'Switzerland','Tanzania','Thailand','Turkey','Uganda','Ukraine','United Arab Emirates',
  'United Kingdom','United States','Uruguay','Venezuela','Vietnam','Zimbabwe',
].sort();

// ─── Toast ────────────────────────────────────────────────────────────────────
function useToast() {
  const [message, setMessage] = useState('');
  const opacity = useRef(new Animated.Value(0)).current;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function show(msg: string) {
    if (timer.current) clearTimeout(timer.current);
    setMessage(msg);
    opacity.setValue(0);
    Animated.sequence([
      Animated.timing(opacity, { toValue: 1, duration: 200, useNativeDriver: true }),
      Animated.delay(1600),
      Animated.timing(opacity, { toValue: 0, duration: 300, useNativeDriver: true }),
    ]).start();
    timer.current = setTimeout(() => setMessage(''), 2200);
  }

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  return { message, opacity, show };
}

// ─── Country Picker ───────────────────────────────────────────────────────────
function CountryPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');

  const filtered = search
    ? COUNTRIES.filter((c) => c.toLowerCase().includes(search.toLowerCase()))
    : COUNTRIES;

  return (
    <>
      <TouchableOpacity style={styles.input} onPress={() => setOpen(true)} activeOpacity={0.8}>
        <Text style={value ? styles.inputText : styles.inputPlaceholder}>
          {value || 'Select Country'}
        </Text>
        <Ionicons name="chevron-down" size={18} color="#6B7280" />
      </TouchableOpacity>

      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <View style={picker.overlay}>
          <View style={picker.sheet}>
            <View style={picker.handle} />
            <Text style={picker.title}>Select Country</Text>

            {/* Search inside modal */}
            <View style={picker.searchWrap}>
              <Ionicons name="search-outline" size={16} color="#6B7280" style={{ marginRight: 8 }} />
              <TextInput
                style={picker.searchInput}
                placeholder="Search…"
                placeholderTextColor="#6B7280"
                value={search}
                onChangeText={setSearch}
                autoCapitalize="none"
              />
            </View>

            <FlatList
              data={filtered}
              keyExtractor={(item) => item}
              keyboardShouldPersistTaps="handled"
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={[picker.option, item === value && picker.optionSelected]}
                  onPress={() => { onChange(item); setSearch(''); setOpen(false); }}
                >
                  <Text style={[picker.optionText, item === value && picker.optionTextSelected]}>
                    {item}
                  </Text>
                  {item === value && <Ionicons name="checkmark" size={16} color="#0EA5E9" />}
                </TouchableOpacity>
              )}
            />

            <Pressable style={picker.cancelBtn} onPress={() => { setSearch(''); setOpen(false); }}>
              <Text style={picker.cancelText}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </>
  );
}

const picker = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: '#1C1C27',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '75%',
    paddingBottom: 16,
  },
  handle: {
    width: 36, height: 4, borderRadius: 2,
    backgroundColor: '#4B5563',
    alignSelf: 'center', marginTop: 12, marginBottom: 8,
  },
  title: {
    color: '#9CA3AF', fontSize: 12, fontWeight: '600',
    textTransform: 'uppercase', letterSpacing: 1,
    paddingHorizontal: 20, marginBottom: 8,
  },
  searchWrap: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#111118', borderRadius: 10,
    marginHorizontal: 16, marginBottom: 8,
    paddingHorizontal: 12, paddingVertical: 10,
  },
  searchInput: { flex: 1, color: '#FFFFFF', fontSize: 14 },
  option: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 13, paddingHorizontal: 20,
  },
  optionSelected: { backgroundColor: '#0EA5E915' },
  optionText: { color: '#D1D5DB', fontSize: 15 },
  optionTextSelected: { color: '#FFFFFF', fontWeight: '600' },
  cancelBtn: { paddingVertical: 14, alignItems: 'center', marginTop: 4 },
  cancelText: { color: '#6B7280', fontSize: 15 },
});

// ─── Labelled Input ───────────────────────────────────────────────────────────
function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.fieldWrap}>
      <Text style={styles.fieldLabel}>{label}</Text>
      {children}
    </View>
  );
}

// ─── Social Input Row ─────────────────────────────────────────────────────────
function SocialField({
  icon,
  placeholder,
  value,
  onChange,
}: {
  icon: React.ReactNode;
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <View style={[styles.inputRow, { marginBottom: 10 }]}>
      <View style={styles.inputIconWrap}>{icon}</View>
      <TextInput
        style={styles.inputWithIcon}
        placeholder={placeholder}
        placeholderTextColor="#6B7280"
        value={value}
        onChangeText={onChange}
        autoCapitalize="none"
        autoCorrect={false}
      />
    </View>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────
export default function ProfileScreen() {
  const router = useRouter();
  // useAuth context is populated by onAuthStateChange — does NOT depend on storage
  const { user, session, loading: authLoading } = useAuth();
  const { show: showToast, message: toastMsg, opacity: toastOpacity } = useToast();

  console.log("PROFILE RENDER - user:", user?.email, "session:", !!session);

  const [email,        setEmail]        = useState('');
  const [fetchLoading, setFetchLoading] = useState(true);
  const [saveLoading,  setSaveLoading]  = useState(false);
  const [saveError,    setSaveError]    = useState('');

  const [fullName,  setFullName]  = useState('');
  const [phone,     setPhone]     = useState('');
  const [country,   setCountry]   = useState('');
  const [instagram, setInstagram] = useState('');
  const [twitter,   setTwitter]   = useState('');
  const [facebook,  setFacebook]  = useState('');
  const [tiktok,    setTiktok]    = useState('');
  const [youtube,   setYoutube]   = useState('');
  const [linkedin,  setLinkedin]  = useState('');

  // Derived after fullName / email state are populated
  const initials = (fullName || email)[0]?.toUpperCase() ?? '?';

  // ── Fetch profile — depends on context user, re-runs when user becomes available ──
  const fetchProfile = useCallback(async () => {
    // Auth context still loading — wait for onAuthStateChange to fire
    if (authLoading) return;

    console.log('fetchProfile — user from context:', user?.id ?? 'null');
    console.log('fetchProfile — session from context:', session?.access_token ? 'present' : 'null');

    if (!user) { setFetchLoading(false); return; }

    if (user.email) setEmail(user.email);
    setFetchLoading(true);

    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .single();

      console.log('fetchProfile — profile row:', JSON.stringify(data), '| error:', error?.message ?? 'none');

      if (!error && data) {
        setFullName(data.full_name ?? '');
        setPhone(data.phone ?? '');
        setCountry(data.country ?? '');
        setInstagram(data.social_instagram ?? '');
        setTwitter(data.social_twitter ?? '');
        setFacebook(data.social_facebook ?? '');
        setTiktok(data.social_tiktok ?? '');
        setYoutube(data.social_youtube ?? '');
        setLinkedin(data.social_linkedin ?? '');
        if (data.email) setEmail(data.email);
      }
    } finally {
      setFetchLoading(false);
    }
  }, [user, session, authLoading]);

  useEffect(() => { fetchProfile(); }, [fetchProfile]);

  // ── Save profile — reads user/session from context, NOT from storage ──
  async function handleSave() {
    console.log("SAVE PRESSED - user:", user?.email, "session:", !!session);
    console.log('handleSave — user from context:', user?.id ?? 'null');
    console.log('handleSave — session from context:', session?.access_token ? 'present' : 'null');

    if (!user || !session) {
      setSaveError('Session not found. Please sign out and sign in again.');
      return;
    }

    setSaveLoading(true);
    setSaveError('');

    const userEmail = user.email ?? email;

    const { error } = await supabase.from('profiles').upsert({
      id:               user.id,
      email:            userEmail,
      full_name:        fullName,
      phone:            phone || null,
      country:          country || null,
      social_instagram: instagram || null,
      social_twitter:   twitter   || null,
      social_facebook:  facebook  || null,
      social_tiktok:    tiktok    || null,
      social_youtube:   youtube   || null,
      social_linkedin:  linkedin  || null,
    });
    setSaveLoading(false);
    if (error) {
      console.log('handleSave — upsert error:', error.message, error.code);
      setSaveError(error.message);
    } else {
      if (userEmail && !email) setEmail(userEmail);
      showToast('Profile saved');
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()} hitSlop={8}>
          <Feather name="arrow-left" size={22} color="#FFFFFF" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>My Profile</Text>
        <View style={styles.backBtn} />
      </View>

      {(authLoading || fetchLoading) ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator size="large" color="#0EA5E9" />
        </View>
      ) : null}

      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* ── Avatar ── */}
        <View style={styles.avatarArea}>
          <View style={styles.avatarCircle}>
            <Text style={styles.avatarInitial}>{initials}</Text>
            <TouchableOpacity style={styles.avatarEdit} onPress={() => console.log('Edit avatar pressed')}>
              <Feather name="camera" size={13} color="#FFFFFF" />
            </TouchableOpacity>
          </View>
          <Text style={styles.avatarEmail}>{email}</Text>
        </View>

        {/* ── Required Fields ── */}
        <View
          pointerEvents={(authLoading || fetchLoading) ? 'none' : 'auto'}
          style={{ opacity: (authLoading || fetchLoading) ? 0.3 : 1 }}
        >
          <Text style={styles.sectionLabel}>Account Info</Text>

          <Field label="Full Name">
            <TextInput
              style={[styles.input, styles.inputText]}
              placeholder="Your full name"
              placeholderTextColor="#6B7280"
              value={fullName}
              onChangeText={setFullName}
              autoCapitalize="words"
            />
          </Field>

          <Field label="Email">
            <View style={[styles.inputRow, styles.inputLocked]}>
              <TextInput
                style={[styles.inputWithIcon, { color: '#6B7280' }]}
                value={email}
                editable={false}
                selectTextOnFocus={false}
              />
              <Feather name="lock" size={15} color="#4B5563" style={styles.lockIcon} />
            </View>
          </Field>

          <Field label="Phone">
            <TextInput
              style={[styles.input, styles.inputText]}
              placeholder="+1 (555) 000-0000"
              placeholderTextColor="#6B7280"
              value={phone}
              onChangeText={setPhone}
              keyboardType="phone-pad"
            />
          </Field>

          <Field label="Country">
            <CountryPicker value={country} onChange={setCountry} />
          </Field>

          {/* ── Social Media ── */}
          <Text style={[styles.sectionLabel, { marginTop: 28 }]}>Social Media <Text style={styles.optional}>(Optional)</Text></Text>

          <SocialField
            icon={<Ionicons name="logo-instagram" size={18} color="#E1306C" />}
            placeholder="@username"
            value={instagram}
            onChange={setInstagram}
          />
          <SocialField
            icon={<MaterialCommunityIcons name="twitter" size={18} color="#1DA1F2" />}
            placeholder="@username"
            value={twitter}
            onChange={setTwitter}
          />
          <SocialField
            icon={<Ionicons name="logo-facebook" size={18} color="#1877F2" />}
            placeholder="Profile URL or name"
            value={facebook}
            onChange={setFacebook}
          />
          <SocialField
            icon={<MaterialCommunityIcons name="music-note" size={18} color="#FFFFFF" />}
            placeholder="@username"
            value={tiktok}
            onChange={setTiktok}
          />
          <SocialField
            icon={<Ionicons name="logo-youtube" size={18} color="#FF0000" />}
            placeholder="Channel name or URL"
            value={youtube}
            onChange={setYoutube}
          />
          <SocialField
            icon={<Ionicons name="logo-linkedin" size={18} color="#0A66C2" />}
            placeholder="Profile URL or name"
            value={linkedin}
            onChange={setLinkedin}
          />
        </View>

        {/* ── Save error ── */}
        {saveError ? <Text style={styles.saveError}>{saveError}</Text> : null}

        {/* ── Save Button ── */}
        <TouchableOpacity
          style={[styles.saveBtn, saveLoading && { opacity: 0.7 }]}
          onPress={handleSave}
          disabled={saveLoading}
          activeOpacity={0.85}
        >
          {saveLoading
            ? <ActivityIndicator size="small" color="#FFFFFF" />
            : <Text style={styles.saveBtnText}>Save Profile</Text>
          }
        </TouchableOpacity>

        {/* ── Delete Account ── */}
        <View style={styles.deleteSection}>
          <TouchableOpacity onPress={() => router.push('/delete-account')}>
            <Text style={styles.deleteText}>Delete Account</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>

      {/* Toast */}
      {toastMsg ? (
        <Animated.View style={[styles.toast, { opacity: toastOpacity }]}>
          <Ionicons name="checkmark-circle" size={16} color="#22C55E" style={{ marginRight: 6 }} />
          <Text style={styles.toastText}>{toastMsg}</Text>
        </Animated.View>
      ) : null}
    </KeyboardAvoidingView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#111118' },

  // Header
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingTop: 56, paddingBottom: 16,
    borderBottomWidth: 1, borderBottomColor: '#1C1C27',
  },
  backBtn: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { color: '#FFFFFF', fontSize: 18, fontWeight: '700' },

  // Scroll
  scroll: { paddingHorizontal: 20, paddingTop: 28, paddingBottom: 48 },

  // Avatar
  avatarArea: { alignItems: 'center', marginBottom: 32 },
  avatarCircle: {
    width: 88, height: 88, borderRadius: 44,
    backgroundColor: '#0EA5E920',
    borderWidth: 2, borderColor: '#0EA5E9',
    alignItems: 'center', justifyContent: 'center',
  },
  avatarInitial: { color: '#0EA5E9', fontSize: 36, fontWeight: '700' },
  avatarEdit: {
    position: 'absolute', bottom: 0, right: 0,
    backgroundColor: '#0EA5E9', borderRadius: 12,
    width: 24, height: 24,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: '#111118',
  },
  avatarEmail: { color: '#6B7280', fontSize: 13, marginTop: 10 },

  // Section label
  sectionLabel: {
    color: '#9CA3AF', fontSize: 11, fontWeight: '700',
    textTransform: 'uppercase', letterSpacing: 1,
    marginBottom: 14,
  },
  optional: { color: '#4B5563', fontWeight: '400', textTransform: 'none' },

  // Field wrapper
  fieldWrap: { marginBottom: 14 },
  fieldLabel: { color: '#6B7280', fontSize: 12, fontWeight: '500', marginBottom: 6 },

  // Inputs
  input: {
    backgroundColor: '#1C1C27',
    borderWidth: 1, borderColor: '#2D2D3E',
    borderRadius: 12,
    paddingHorizontal: 16, paddingVertical: 13,
    flexDirection: 'row', alignItems: 'center',
  },
  inputText: { color: '#FFFFFF', fontSize: 15 },
  inputPlaceholder: { color: '#6B7280', fontSize: 15, flex: 1 },
  inputRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#1C1C27', borderWidth: 1, borderColor: '#2D2D3E',
    borderRadius: 12, paddingHorizontal: 14, paddingVertical: 11,
  },
  inputLocked: { borderColor: '#1C1C27', backgroundColor: '#161620' },
  inputWithIcon: { flex: 1, color: '#FFFFFF', fontSize: 15, paddingVertical: 2 },
  inputIconWrap: { width: 28, alignItems: 'center', marginRight: 8 },
  lockIcon: { marginLeft: 4 },

  // Loading overlay
  loadingWrap: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    alignItems: 'center', justifyContent: 'center', zIndex: 10,
  },

  // Save error
  saveError: {
    color: '#EF4444', fontSize: 13, textAlign: 'center',
    marginTop: 12, marginBottom: 4,
  },

  // Save
  saveBtn: {
    backgroundColor: '#0EA5E9', borderRadius: 14,
    paddingVertical: 15, alignItems: 'center', marginTop: 16,
  },
  saveBtnText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },

  // Delete
  deleteSection: {
    marginTop: 36, paddingTop: 24,
    borderTopWidth: 1, borderTopColor: '#1C1C27',
    alignItems: 'center',
  },
  deleteText: {
    color: '#EF4444', fontSize: 14, fontWeight: '500',
  },

  // Toast
  toast: {
    position: 'absolute', bottom: 36, alignSelf: 'center',
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#1C1C27', borderWidth: 1, borderColor: '#2D2D3E',
    borderRadius: 20, paddingHorizontal: 18, paddingVertical: 10,
  },
  toastText: { color: '#FFFFFF', fontSize: 13, fontWeight: '500' },
});
