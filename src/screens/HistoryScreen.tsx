import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  TextInput,
  RefreshControl,
  Animated,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { useRef, useState, useEffect, useCallback } from 'react';
import { useRouter } from 'expo-router';
import { Ionicons, Feather } from '@expo/vector-icons';
import { BottomTabBar } from '../components/BottomTabBar';
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';

// ─── Types ────────────────────────────────────────────────────────────────────
type HistoryItem = {
  id: string;
  trackName: string;
  instrument: string;
  instrumentIcon: keyof typeof Ionicons.glyphMap;
  format: string;
  date: string;
  duration: string;
  favorited: boolean;
  saved: boolean;
};

type ActiveTab = 'history' | 'saved' | 'favorites';

// Maps instrument name → Ionicons icon name
function iconForInstrument(instrument: string | null): keyof typeof Ionicons.glyphMap {
  switch (instrument?.toLowerCase()) {
    case 'piano':   return 'piano-outline' in Ionicons.glyphMap ? 'piano-outline' as any : 'musical-note';
    case 'guitar':  return 'musical-note';
    case 'violin':
    case 'viola':
    case 'cello':   return 'musical-notes';
    case 'drums':   return 'musical-notes';
    default:        return 'musical-note';
  }
}

// Converts a raw conversion_history row + favorited/saved id sets → HistoryItem
function rowToItem(row: any, favIds: Set<string>, savedIds: Set<string>): HistoryItem {
  const secs = row.duration_seconds ?? 0;
  const m = Math.floor(secs / 60);
  const s = String(secs % 60).padStart(2, '0');
  const date = new Date(row.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  return {
    id: row.id,
    trackName: row.track_name ?? 'Untitled',
    instrument: row.instrument ?? '',
    instrumentIcon: iconForInstrument(row.instrument),
    format: row.output_format ?? '',
    date,
    duration: `${m}:${s}`,
    favorited: favIds.has(row.id),
    saved: savedIds.has(row.id),
  };
}

// ─── Empty State ──────────────────────────────────────────────────────────────
function EmptyState({ tab }: { tab: ActiveTab }) {
  const config = {
    history:   { icon: 'musical-notes-outline' as const, text: 'No conversions yet — convert your first track!' },
    saved:     { icon: 'bookmark-outline'       as const, text: 'No saved items yet — save your best work!' },
    favorites: { icon: 'heart-outline'          as const, text: 'No favorites yet — tap the heart on any result!' },
  }[tab];

  return (
    <View style={empty.wrap}>
      <Ionicons name={config.icon} size={52} color="#2D2D3E" style={{ marginBottom: 14 }} />
      <Text style={empty.text}>{config.text}</Text>
    </View>
  );
}

const empty = StyleSheet.create({
  wrap: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 80 },
  text: { color: '#4B5563', fontSize: 14, textAlign: 'center', lineHeight: 22, paddingHorizontal: 32 },
});

// ─── History Card ─────────────────────────────────────────────────────────────
function HistoryCard({
  item,
  onPress,
  onToggleFavorite,
  onDelete,
}: {
  item: HistoryItem;
  onPress: () => void;
  onToggleFavorite: () => void;
  onDelete: () => void;
}) {
  const heartScale = useRef(new Animated.Value(1)).current;

  function handleFavorite() {
    onToggleFavorite();
    if (!item.favorited) {
      Animated.sequence([
        Animated.timing(heartScale, { toValue: 1.35, duration: 140, useNativeDriver: true }),
        Animated.spring(heartScale, { toValue: 1, useNativeDriver: true, bounciness: 10 }),
      ]).start();
    } else {
      heartScale.setValue(1);
    }
  }

  function handleLongPress() {
    Alert.alert(
      item.trackName,
      'What would you like to do?',
      [
        { text: 'Delete', style: 'destructive', onPress: onDelete },
        { text: 'Cancel', style: 'cancel' },
      ]
    );
  }

  return (
    <TouchableOpacity
      style={card.wrap}
      onPress={onPress}
      onLongPress={handleLongPress}
      delayLongPress={400}
      activeOpacity={0.75}
    >
      {/* Left: track info */}
      <View style={card.left}>
        <Text style={card.trackName} numberOfLines={1}>{item.trackName}</Text>
        <View style={card.metaRow}>
          <Ionicons name={item.instrumentIcon} size={12} color="#6B7280" style={{ marginRight: 4 }} />
          <Text style={card.metaText}>{item.instrument}</Text>
          <Text style={card.dot}>·</Text>
          <Text style={card.metaText}>{item.duration}</Text>
        </View>
        <View style={card.formatPill}>
          <Text style={card.formatText}>{item.format}</Text>
        </View>
      </View>

      {/* Right: date + heart */}
      <View style={card.right}>
        <Text style={card.date}>{item.date}</Text>
        <TouchableOpacity onPress={handleFavorite} hitSlop={10} style={{ marginTop: 8 }}>
          <Animated.View style={{ transform: [{ scale: heartScale }] }}>
            <Ionicons
              name={item.favorited ? 'heart' : 'heart-outline'}
              size={18}
              color={item.favorited ? '#DC143C' : '#4B5563'}
            />
          </Animated.View>
        </TouchableOpacity>
      </View>
    </TouchableOpacity>
  );
}

const card = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1C1C27',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#2D2D3E',
  },
  left: { flex: 1, marginRight: 12 },
  trackName: { color: '#FFFFFF', fontSize: 15, fontWeight: '700', marginBottom: 4 },
  metaRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  metaText: { color: '#6B7280', fontSize: 12 },
  dot: { color: '#4B5563', fontSize: 12, marginHorizontal: 5 },
  formatPill: {
    alignSelf: 'flex-start',
    backgroundColor: '#0EA5E920',
    borderWidth: 1,
    borderColor: '#0EA5E940',
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  formatText: { color: '#0EA5E9', fontSize: 11, fontWeight: '600' },
  right: { alignItems: 'flex-end' },
  date: { color: '#6B7280', fontSize: 12 },
});

// ─── Main Screen ──────────────────────────────────────────────────────────────
export default function HistoryScreen() {
  const router = useRouter();
  const { isGuest } = useAuth();
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [activeTab, setActiveTab] = useState<ActiveTab>('history');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const userIdRef = useRef<string | null>(null);

  const fetchItems = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    const uid = session?.user?.id ?? null;
    userIdRef.current = uid;

    if (!uid) {
      console.log('HistoryScreen: no session');
      setItems([]);
      return;
    }

    const [histRes, favRes, savedRes] = await Promise.all([
      supabase
        .from('conversion_history')
        .select('*')
        .eq('user_id', uid)
        .order('created_at', { ascending: false }),
      supabase
        .from('favorites')
        .select('history_id')
        .eq('user_id', uid),
      supabase
        .from('saved_items')
        .select('history_id')
        .eq('user_id', uid),
    ]);

    if (histRes.error)  console.log('conversion_history error:', histRes.error);
    if (favRes.error)   console.log('favorites error:', favRes.error);
    if (savedRes.error) console.log('saved_items error:', savedRes.error);

    const favIds   = new Set<string>((favRes.data   ?? []).map((f: any) => f.history_id));
    const savedIds = new Set<string>((savedRes.data ?? []).map((s: any) => s.history_id));
    setItems((histRes.data ?? []).map((row: any) => rowToItem(row, favIds, savedIds)));
  }, []);

  useEffect(() => {
    fetchItems().finally(() => setLoading(false));
  }, [fetchItems]);

  async function onRefresh() {
    setRefreshing(true);
    await fetchItems();
    setRefreshing(false);
  }

  async function toggleFavorite(id: string) {
    const uid = userIdRef.current;
    if (!uid) return;
    const item = items.find(it => it.id === id);
    if (!item) return;

    // Optimistic update
    setItems(prev => prev.map(it => it.id === id ? { ...it, favorited: !it.favorited } : it));

    if (item.favorited) {
      const { error } = await supabase.from('favorites').delete().eq('user_id', uid).eq('history_id', id);
      if (error) {
        console.log('unfavorite error:', error);
        setItems(prev => prev.map(it => it.id === id ? { ...it, favorited: true } : it));
        Alert.alert('Error', error.message);
      }
    } else {
      const { error } = await supabase.from('favorites').insert({ user_id: uid, history_id: id });
      if (error) {
        console.log('favorite error:', error);
        setItems(prev => prev.map(it => it.id === id ? { ...it, favorited: false } : it));
        Alert.alert('Error', error.message);
      }
    }
  }

  async function deleteItem(id: string) {
    const { error } = await supabase.from('conversion_history').delete().eq('id', id);
    if (error) {
      console.log('delete error:', error);
      Alert.alert('Error', error.message);
    } else {
      setItems(prev => prev.filter(it => it.id !== id));
    }
  }

  // Filter by tab
  const tabFiltered = items.filter((it) => {
    if (activeTab === 'saved')     return it.saved;
    if (activeTab === 'favorites') return it.favorited;
    return true;
  });

  // Filter by search
  const query = search.trim().toLowerCase();
  const visible = query
    ? tabFiltered.filter(
        (it) =>
          it.trackName.toLowerCase().includes(query) ||
          it.instrument.toLowerCase().includes(query)
      )
    : tabFiltered;

  const TABS: { key: ActiveTab; label: string }[] = [
    { key: 'history',   label: 'History' },
    { key: 'saved',     label: 'Saved' },
    { key: 'favorites', label: 'Favorites' },
  ];

  if (loading) {
    return (
      <View style={[styles.root, { alignItems: 'center', justifyContent: 'center' }]}>
        <ActivityIndicator color="#0EA5E9" size="large" />
      </View>
    );
  }

  if (isGuest) {
    return (
      <View style={styles.root}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>My Music</Text>
        </View>
        <View style={guestWall.wrap}>
          <Ionicons name="person-circle-outline" size={64} color="#2D2D3E" style={{ marginBottom: 16 }} />
          <Text style={guestWall.title}>Sign in to see your history</Text>
          <Text style={guestWall.sub}>
            Create a free account to save conversions, favorites, and access your library across devices.
          </Text>
          <TouchableOpacity style={guestWall.btn} onPress={() => router.replace('/')} activeOpacity={0.85}>
            <Text style={guestWall.btnText}>Sign Up Free</Text>
          </TouchableOpacity>
          <TouchableOpacity style={guestWall.secondaryBtn} onPress={() => router.replace('/')} activeOpacity={0.7}>
            <Text style={guestWall.secondaryBtnText}>Log In</Text>
          </TouchableOpacity>
        </View>
        <BottomTabBar active="history" />
      </View>
    );
  }

  return (
    <View style={styles.root}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>My Music</Text>
      </View>

      {/* Inner tabs */}
      <View style={styles.tabRow}>
        {TABS.map((t) => (
          <TouchableOpacity
            key={t.key}
            style={styles.tabBtn}
            onPress={() => setActiveTab(t.key)}
            activeOpacity={0.7}
          >
            <Text style={[styles.tabLabel, activeTab === t.key && styles.tabLabelActive]}>
              {t.label}
            </Text>
            {activeTab === t.key && <View style={styles.tabUnderline} />}
          </TouchableOpacity>
        ))}
      </View>

      {/* Search bar */}
      <View style={styles.searchWrap}>
        <Ionicons name="search-outline" size={16} color="#6B7280" style={styles.searchIcon} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search by track name or instrument"
          placeholderTextColor="#6B7280"
          value={search}
          onChangeText={setSearch}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
        />
        {search.length > 0 && (
          <TouchableOpacity onPress={() => setSearch('')} hitSlop={8}>
            <Ionicons name="close-circle" size={16} color="#6B7280" />
          </TouchableOpacity>
        )}
      </View>

      {/* List */}
      <FlatList
        data={visible}
        keyExtractor={(item) => item.id}
        contentContainerStyle={[
          styles.listContent,
          visible.length === 0 && { flex: 1 },
        ]}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor="#0EA5E9"
            colors={['#0EA5E9']}
          />
        }
        ListEmptyComponent={<EmptyState tab={activeTab} />}
        renderItem={({ item }) => (
          <HistoryCard
            item={item}
            onPress={() => {
              console.log('[HistoryScreen] opening result for historyId:', item.id);
              router.push({
                pathname: '/results',
                params: { historyId: item.id },
                // notesJson intentionally omitted — ResultsScreen loads output_data from DB
              });
            }}
            onToggleFavorite={() => toggleFavorite(item.id)}
            onDelete={() => deleteItem(item.id)}
          />
        )}
      />

      <BottomTabBar active="history" />
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#111118' },

  // Header
  header: {
    paddingHorizontal: 20,
    paddingTop: 56,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#1C1C27',
  },
  headerTitle: { color: '#0EA5E9', fontSize: 26, fontWeight: '700' },

  // Inner tabs
  tabRow: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#1C1C27',
  },
  tabBtn: {
    marginRight: 28,
    paddingVertical: 12,
    alignItems: 'center',
  },
  tabLabel: { color: '#6B7280', fontSize: 14, fontWeight: '500' },
  tabLabelActive: { color: '#FFFFFF', fontWeight: '700' },
  tabUnderline: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 2,
    backgroundColor: '#0EA5E9',
    borderRadius: 1,
  },

  // Search
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1C1C27',
    borderRadius: 12,
    marginHorizontal: 20,
    marginTop: 16,
    marginBottom: 12,
    paddingHorizontal: 12,
    paddingVertical: 11,
    borderWidth: 1,
    borderColor: '#2D2D3E',
  },
  searchIcon: { marginRight: 8 },
  searchInput: { flex: 1, color: '#FFFFFF', fontSize: 14 },

  // List
  listContent: {
    paddingHorizontal: 20,
    paddingBottom: 16,
  },
});

const guestWall = StyleSheet.create({
  wrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 36,
    paddingBottom: 80,
  },
  title: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 10,
  },
  sub: {
    color: '#6B7280',
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 32,
  },
  btn: {
    backgroundColor: '#0EA5E9',
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 40,
    alignItems: 'center',
    marginBottom: 12,
    width: '100%',
  },
  btnText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
  secondaryBtn: {
    paddingVertical: 10,
    alignItems: 'center',
  },
  secondaryBtnText: {
    color: '#6B7280',
    fontSize: 14,
    textDecorationLine: 'underline',
  },
});
