import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

type TabKey = 'upload' | 'history' | 'library';

const TABS: { key: TabKey; label: string; icon: keyof typeof Ionicons.glyphMap; route: string }[] = [
  { key: 'upload',  label: 'Upload',  icon: 'cloud-upload-outline', route: '/upload' },
  { key: 'history', label: 'History', icon: 'time-outline',          route: '/history' },
  { key: 'library', label: 'Library', icon: 'library-outline',       route: '/public-domain-library' },
];

export function BottomTabBar({ active }: { active: TabKey }) {
  const router = useRouter();
  return (
    <View style={styles.bar}>
      {TABS.map((t) => {
        const isActive = active === t.key;
        return (
          <TouchableOpacity
            key={t.key}
            style={styles.item}
            onPress={() => router.replace(t.route)}
            activeOpacity={0.7}
          >
            <Ionicons name={t.icon} size={22} color={isActive ? '#0EA5E9' : '#6B7280'} />
            <Text style={[styles.label, isActive && styles.labelActive]}>{t.label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    backgroundColor: '#16161F',
    borderTopWidth: 1,
    borderTopColor: '#2D2D3E',
    paddingBottom: 24,
    paddingTop: 10,
  },
  item: { flex: 1, alignItems: 'center', gap: 4 },
  label: { color: '#6B7280', fontSize: 11, fontWeight: '500' },
  labelActive: { color: '#0EA5E9', fontWeight: '600' },
});
