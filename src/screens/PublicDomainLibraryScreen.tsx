import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  TextInput,
  ScrollView,
} from 'react-native';
import { useState, useMemo } from 'react';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { BottomTabBar } from '../components/BottomTabBar';

// ─── Types ────────────────────────────────────────────────────────────────────
type Difficulty = 'Easy' | 'Medium' | 'Hard';

type Composition = {
  id: string;
  composer: string;
  title: string;
  instrument: string;
  era: string;
  difficulty: Difficulty;
};

// ─── Sample data ──────────────────────────────────────────────────────────────
const COMPOSITIONS: Composition[] = [
  { id: '1', composer: 'Bach',       title: 'Prelude in C Major',       instrument: 'Piano',      era: 'Baroque',   difficulty: 'Easy'   },
  { id: '2', composer: 'Beethoven',  title: 'Für Elise',                instrument: 'Piano',      era: 'Classical', difficulty: 'Medium' },
  { id: '3', composer: 'Mozart',     title: 'Eine Kleine Nachtmusik',   instrument: 'Orchestral', era: 'Classical', difficulty: 'Medium' },
  { id: '4', composer: 'Chopin',     title: 'Nocturne Op.9 No.2',       instrument: 'Piano',      era: 'Romantic',  difficulty: 'Hard'   },
  { id: '5', composer: 'Vivaldi',    title: 'Spring (Four Seasons)',    instrument: 'Violin',     era: 'Baroque',   difficulty: 'Medium' },
  { id: '6', composer: 'Debussy',    title: 'Clair de Lune',            instrument: 'Piano',      era: 'Romantic',  difficulty: 'Hard'   },
  { id: '7', composer: 'Handel',     title: 'Hallelujah Chorus',        instrument: 'Orchestral', era: 'Baroque',   difficulty: 'Medium' },
  { id: '8', composer: 'Schubert',   title: 'Ave Maria',                instrument: 'Vocals',     era: 'Romantic',  difficulty: 'Easy'   },
];

const FILTERS = ['All', 'Piano', 'Guitar', 'Violin', 'Cello', 'Flute', 'Orchestral'];

const DIFFICULTY_DOTS: Record<Difficulty, number> = { Easy: 1, Medium: 2, Hard: 3 };

// ─── Difficulty Dots ──────────────────────────────────────────────────────────
function DifficultyDots({ difficulty }: { difficulty: Difficulty }) {
  const filled = DIFFICULTY_DOTS[difficulty];
  return (
    <View style={dots.row}>
      {[1, 2, 3].map((i) => (
        <View key={i} style={[dots.dot, i <= filled ? dots.dotFilled : dots.dotEmpty]} />
      ))}
    </View>
  );
}

const dots = StyleSheet.create({
  row: { flexDirection: 'row', gap: 4, alignItems: 'center' },
  dot: { width: 7, height: 7, borderRadius: 4 },
  dotFilled: { backgroundColor: '#0EA5E9' },
  dotEmpty: { backgroundColor: '#2D2D3E' },
});

// ─── Composition Card ─────────────────────────────────────────────────────────
function CompositionCard({
  item,
  onTranscribe,
}: {
  item: Composition;
  onTranscribe: () => void;
}) {
  return (
    <View style={card.wrap}>
      <View style={card.body}>
        <Text style={card.composer}>{item.composer}</Text>
        <Text style={card.title} numberOfLines={1}>{item.title}</Text>

        <View style={card.badges}>
          <View style={card.instrumentBadge}>
            <Text style={card.instrumentText}>{item.instrument}</Text>
          </View>
          <View style={card.eraBadge}>
            <Text style={card.eraText}>{item.era}</Text>
          </View>
          <DifficultyDots difficulty={item.difficulty} />
        </View>
      </View>

      <TouchableOpacity style={card.transcribeBtn} onPress={onTranscribe} activeOpacity={0.8}>
        <Ionicons name="musical-notes" size={13} color="#FFFFFF" style={{ marginBottom: 2 }} />
        <Text style={card.transcribeText}>Transcribe</Text>
      </TouchableOpacity>
    </View>
  );
}

const card = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1C1C27',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#2D2D3E',
    paddingLeft: 16,
    paddingRight: 12,
    paddingVertical: 14,
    marginBottom: 10,
  },
  body: { flex: 1, marginRight: 10 },
  composer: {
    color: '#0EA5E9',
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  title: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 8,
  },
  badges: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  instrumentBadge: {
    backgroundColor: '#0EA5E920',
    borderWidth: 1,
    borderColor: '#0EA5E940',
    borderRadius: 20,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  instrumentText: { color: '#0EA5E9', fontSize: 11, fontWeight: '600' },
  eraBadge: {
    backgroundColor: '#1F1F2E',
    borderRadius: 20,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  eraText: { color: '#6B7280', fontSize: 11 },
  transcribeBtn: {
    backgroundColor: '#0EA5E9',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    alignItems: 'center',
    minWidth: 72,
  },
  transcribeText: { color: '#FFFFFF', fontSize: 12, fontWeight: '700' },
});

// ─── Main Screen ──────────────────────────────────────────────────────────────
export default function PublicDomainLibraryScreen() {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [activeFilter, setActiveFilter] = useState('All');

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return COMPOSITIONS.filter((c) => {
      const matchesFilter = activeFilter === 'All' || c.instrument === activeFilter;
      const matchesSearch =
        !q ||
        c.composer.toLowerCase().includes(q) ||
        c.title.toLowerCase().includes(q);
      return matchesFilter && matchesSearch;
    });
  }, [search, activeFilter]);

  function handleTranscribe(item: Composition) {
    // Public domain — skip RightsDeclaration, go straight to processing
    router.push({
      pathname: '/processing',
      params: {
        rightsOption: 'publicdomain',
        rightsAccepted: 'true',
        composer: item.composer,
        title: item.title,
      },
    });
  }

  return (
    <View style={styles.root}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Public Domain Library</Text>
      </View>

      {/* Search bar */}
      <View style={styles.searchWrap}>
        <Ionicons name="search-outline" size={16} color="#6B7280" style={styles.searchIcon} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search by composer or piece name"
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

      {/* Filter chips */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.filterBar}
      >
        {FILTERS.map((f) => (
          <TouchableOpacity
            key={f}
            style={[styles.chip, activeFilter === f && styles.chipActive]}
            onPress={() => setActiveFilter(f)}
            activeOpacity={0.8}
          >
            <Text style={[styles.chipText, activeFilter === f && styles.chipTextActive]}>
              {f}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* Composition list */}
      <FlatList
        data={visible}
        keyExtractor={(item) => item.id}
        contentContainerStyle={[
          styles.listContent,
          visible.length === 0 && { flex: 1 },
        ]}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          <View style={styles.emptyWrap}>
            <Ionicons name="musical-notes-outline" size={48} color="#2D2D3E" style={{ marginBottom: 12 }} />
            <Text style={styles.emptyText}>No compositions found</Text>
          </View>
        }
        ListFooterComponent={
          visible.length > 0 ? (
            <Text style={styles.footerNote}>
              All compositions are by composers deceased 100+ years.{'\n'}
              Recordings sourced from public domain archives.
            </Text>
          ) : null
        }
        renderItem={({ item }) => (
          <CompositionCard item={item} onTranscribe={() => handleTranscribe(item)} />
        )}
      />

      <BottomTabBar active="library" />
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
  headerTitle: { color: '#FFFFFF', fontSize: 24, fontWeight: '700' },

  // Search
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1C1C27',
    borderRadius: 12,
    marginHorizontal: 20,
    marginTop: 16,
    marginBottom: 4,
    paddingHorizontal: 12,
    paddingVertical: 11,
    borderWidth: 1,
    borderColor: '#2D2D3E',
  },
  searchIcon: { marginRight: 8 },
  searchInput: { flex: 1, color: '#FFFFFF', fontSize: 14 },

  // Filter bar
  filterBar: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
  },
  chip: {
    borderWidth: 1,
    borderColor: '#0EA5E9',
    borderRadius: 16,
    paddingHorizontal: 14,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#111118',
    marginRight: 8,
  },
  chipActive: {
    backgroundColor: '#0EA5E9',
    borderColor: '#0EA5E9',
  },
  chipText: { color: '#0EA5E9', fontSize: 13, fontWeight: '600', lineHeight: 16 },
  chipTextActive: { color: '#FFFFFF', fontWeight: '600', lineHeight: 16 },

  // List
  listContent: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 16,
  },

  // Empty
  emptyWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 60,
  },
  emptyText: { color: '#4B5563', fontSize: 14 },

  // Footer note
  footerNote: {
    color: '#374151',
    fontSize: 11,
    textAlign: 'center',
    lineHeight: 17,
    paddingVertical: 16,
    paddingHorizontal: 16,
  },
});
