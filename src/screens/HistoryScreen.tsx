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
} from 'react-native';
import { useRef, useState } from 'react';
import { useRouter } from 'expo-router';
import { Ionicons, Feather } from '@expo/vector-icons';
import { BottomTabBar } from '../components/BottomTabBar';

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

// ─── Dummy data ───────────────────────────────────────────────────────────────
const INITIAL_ITEMS: HistoryItem[] = [
  { id: '1', trackName: 'Bohemian Rhapsody', instrument: 'Piano',  instrumentIcon: 'piano',         format: 'Score',      date: 'Mar 30', duration: '0:30', favorited: false, saved: false },
  { id: '2', trackName: 'Hotel California',  instrument: 'Guitar', instrumentIcon: 'musical-note',  format: 'Tabs',       date: 'Mar 29', duration: '0:30', favorited: false, saved: false },
  { id: '3', trackName: 'Clair de Lune',     instrument: 'Piano',  instrumentIcon: 'piano',         format: 'Staff',      date: 'Mar 28', duration: '0:30', favorited: true,  saved: true  },
  { id: '4', trackName: 'Stairway to Heaven',instrument: 'Guitar', instrumentIcon: 'musical-note',  format: 'Lead Sheet', date: 'Mar 27', duration: '0:30', favorited: false, saved: false },
  { id: '5', trackName: 'Für Elise',         instrument: 'Piano',  instrumentIcon: 'piano',         format: 'Score',      date: 'Mar 26', duration: '0:30', favorited: true,  saved: true  },
];

type ActiveTab = 'history' | 'saved' | 'favorites';

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
  const [items, setItems] = useState<HistoryItem[]>(INITIAL_ITEMS);
  const [activeTab, setActiveTab] = useState<ActiveTab>('history');
  const [search, setSearch] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  function onRefresh() {
    setRefreshing(true);
    setTimeout(() => setRefreshing(false), 1200);
  }

  function toggleFavorite(id: string) {
    setItems((prev) =>
      prev.map((it) => (it.id === id ? { ...it, favorited: !it.favorited } : it))
    );
  }

  function deleteItem(id: string) {
    setItems((prev) => prev.filter((it) => it.id !== id));
  }

  // Filter by tab
  const tabFiltered = items.filter((it) => {
    if (activeTab === 'saved')     return it.saved;
    if (activeTab === 'favorites') return it.favorited;
    return true; // history = all
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
            onPress={() => router.push('/results')}
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
  headerTitle: { color: '#FFFFFF', fontSize: 26, fontWeight: '700' },

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
