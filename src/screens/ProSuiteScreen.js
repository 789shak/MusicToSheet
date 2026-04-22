import React from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { BottomTabBar } from '../components/BottomTabBar';
import { useSubscription } from '../hooks/useSubscription';

const CARDS = [
  {
    key: 'metronome',
    title: 'Metronome',
    description: 'Tap tempo, adjustable BPM, multiple time signatures',
    icon: 'musical-notes',
    iconColor: '#0EA5E9',
    free: true,
    route: '/metronome',
  },
  {
    key: 'noise-cleaner',
    title: 'DeNoise',
    description: 'Remove background noise from recordings before transcription',
    icon: 'mic-off',
    iconColor: '#A78BFA',
    free: false,
    route: '/noise-cleaner',
  },
];

export default function ProSuiteScreen() {
  const router = useRouter();
  const { tier } = useSubscription();
  const isPro = tier === 'advancedPro' || tier === 'virtuosos';

  function handleCard(card) {
    if (card.comingSoon) return;
    if (!card.free && !isPro) {
      router.push('/subscription');
      return;
    }
    router.push(card.route);
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Pro Suite</Text>
        <Text style={styles.headerSub}>Professional tools for musicians</Text>
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.grid}>
          {CARDS.map((card) => (
            <TouchableOpacity
              key={card.key}
              style={[styles.card, card.comingSoon && styles.cardDimmed]}
              onPress={() => handleCard(card)}
              activeOpacity={card.comingSoon ? 1 : 0.75}
            >
              <View style={[styles.iconWrap, { backgroundColor: card.iconColor + '22' }]}>
                <Ionicons name={card.icon} size={28} color={card.iconColor} />
              </View>

              <Text style={styles.cardTitle}>{card.title}</Text>
              <Text style={styles.cardDesc}>{card.description}</Text>

              {card.comingSoon && (
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>Coming Soon</Text>
                </View>
              )}

              {!card.free && !card.comingSoon && (
                <View style={[styles.badge, styles.proBadge]}>
                  <Ionicons name="star" size={10} color="#0EA5E9" />
                  <Text style={[styles.badgeText, styles.proBadgeText]}>Pro</Text>
                </View>
              )}
            </TouchableOpacity>
          ))}
        </View>

        {!isPro && (
          <TouchableOpacity style={styles.upgradeBar} onPress={() => router.push('/subscription')}>
            <Ionicons name="sparkles" size={16} color="#0EA5E9" />
            <Text style={styles.upgradeText}>Upgrade to unlock all Pro Suite tools</Text>
            <Ionicons name="chevron-forward" size={14} color="#0EA5E9" />
          </TouchableOpacity>
        )}
      </ScrollView>

      <BottomTabBar active="prosuite" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#111118' },

  header: {
    paddingTop: 56,
    paddingBottom: 16,
    paddingHorizontal: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#2D2D3E',
  },
  headerTitle: { fontSize: 24, fontWeight: '700', color: '#FFFFFF' },
  headerSub: { fontSize: 13, color: '#6B7280', marginTop: 2 },

  content: { padding: 20, paddingBottom: 16 },

  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 14,
  },

  card: {
    width: '47%',
    backgroundColor: '#1C1C28',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#2D2D3E',
  },
  cardDimmed: { opacity: 0.55 },

  iconWrap: {
    width: 52,
    height: 52,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },

  cardTitle: { fontSize: 15, fontWeight: '700', color: '#FFFFFF', marginBottom: 6 },
  cardDesc: { fontSize: 12, color: '#9CA3AF', lineHeight: 17 },

  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 10,
    alignSelf: 'flex-start',
    backgroundColor: '#2D2D3E',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  badgeText: { fontSize: 11, color: '#9CA3AF', fontWeight: '600' },

  proBadge: { backgroundColor: '#0EA5E922' },
  proBadgeText: { color: '#0EA5E9' },

  upgradeBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 24,
    backgroundColor: '#0EA5E911',
    borderWidth: 1,
    borderColor: '#0EA5E933',
    borderRadius: 12,
    padding: 14,
  },
  upgradeText: { flex: 1, color: '#0EA5E9', fontSize: 13, fontWeight: '600' },
});
