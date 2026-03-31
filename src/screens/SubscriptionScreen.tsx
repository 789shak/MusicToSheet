import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Pressable,
} from 'react-native';
import { useState } from 'react';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

type BillingCycle = 'monthly' | 'annual';

// ─── Billing Toggle ───────────────────────────────────────────────────────────
function BillingToggle({
  cycle,
  onChange,
}: {
  cycle: BillingCycle;
  onChange: (c: BillingCycle) => void;
}) {
  return (
    <View style={toggle.row}>
      <Pressable onPress={() => onChange('monthly')}>
        <Text style={[toggle.label, cycle === 'monthly' && toggle.labelActive]}>Monthly</Text>
      </Pressable>

      <Pressable style={[toggle.track, cycle === 'annual' && toggle.trackOn]} onPress={() => onChange(cycle === 'monthly' ? 'annual' : 'monthly')}>
        <View style={[toggle.thumb, cycle === 'annual' && toggle.thumbOn]} />
      </Pressable>

      <Pressable onPress={() => onChange('annual')}>
        <Text style={[toggle.label, cycle === 'annual' && toggle.labelActive]}>
          Annual <Text style={toggle.saveBadge}>Save up to 8%</Text>
        </Text>
      </Pressable>
    </View>
  );
}

const toggle = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    marginBottom: 28,
  },
  label: {
    color: '#6B7280',
    fontSize: 14,
    fontWeight: '500',
  },
  labelActive: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  saveBadge: {
    color: '#0EA5E9',
    fontSize: 12,
    fontWeight: '600',
  },
  track: {
    width: 44,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#2D2D3E',
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
  trackOn: {
    backgroundColor: '#0EA5E9',
  },
  thumb: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#FFFFFF',
    alignSelf: 'flex-start',
  },
  thumbOn: {
    alignSelf: 'flex-end',
  },
});

// ─── Feature Row ──────────────────────────────────────────────────────────────
function Feature({ text, muted = false }: { text: string; muted?: boolean }) {
  return (
    <View style={feat.row}>
      <Ionicons
        name={muted ? 'close-circle-outline' : 'checkmark-circle-outline'}
        size={16}
        color={muted ? '#6B7280' : '#0EA5E9'}
        style={feat.icon}
      />
      <Text style={[feat.text, muted && feat.textMuted]}>{text}</Text>
    </View>
  );
}

const feat = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  icon: { marginRight: 8 },
  text: { color: '#D1D5DB', fontSize: 13 },
  textMuted: { color: '#6B7280' },
});

// ─── Main Screen ──────────────────────────────────────────────────────────────
export default function SubscriptionScreen() {
  const router = useRouter();
  const [cycle, setCycle] = useState<BillingCycle>('monthly');

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={styles.scroll}
      showsVerticalScrollIndicator={false}
    >
      <Text style={styles.header}>Choose Your Plan</Text>
      <Text style={styles.subheader}>Unlock your musical potential</Text>

      <BillingToggle cycle={cycle} onChange={setCycle} />

      {/* ── Card 1: Pay As You Go ── */}
      <View style={[styles.card, styles.cardGray]}>
        <Text style={styles.planName}>Pay As You Go</Text>
        <Text style={styles.price}>$0.99 <Text style={styles.priceSub}>/ track</Text></Text>
        <View style={styles.divider} />
        <Feature text="Up to 300 seconds output" />
        <Feature text="3 attempts per track" />
        <Feature text="Download with watermark" />
        <Feature text="No subscription needed" />
        <TouchableOpacity
          style={styles.btnGray}
          onPress={() => console.log('Buy Per Track pressed')}
          activeOpacity={0.85}
        >
          <Text style={styles.btnGrayText}>Buy Per Track</Text>
        </TouchableOpacity>
      </View>

      {/* ── Card 2: Free Forever ── */}
      <View style={[styles.card, styles.cardDark]}>
        <View style={styles.badgeRow}>
          <Text style={styles.planName}>Free Forever</Text>
          <View style={styles.badgeCurrent}>
            <Text style={styles.badgeCurrentText}>Current Plan</Text>
          </View>
        </View>
        <Text style={styles.price}>Free</Text>
        <View style={styles.divider} />
        <Feature text="30 sec max output" />
        <Feature text="2 attempts per track" />
        <Feature text="No recording" muted />
        <Feature text="No download" muted />
        <Feature text="Watermarked sharing only" muted />
      </View>

      {/* ── Card 3: Advanced Pro ── */}
      <View style={styles.cardProOuter}>
        <View style={[styles.card, styles.cardProInner]}>
          <View style={styles.badgeRow}>
            <Text style={styles.planName}>Advanced Pro</Text>
            <View style={styles.badgeRecommended}>
              <Text style={styles.badgeRecommendedText}>Recommended</Text>
            </View>
          </View>

          <Text style={styles.price}>
            {cycle === 'monthly' ? '$8.99' : '$99.99'}
            <Text style={styles.priceSub}>
              {cycle === 'monthly' ? ' /mo' : ' /yr'}
            </Text>
          </Text>
          {cycle === 'annual' && (
            <Text style={styles.savingsNote}>Save 7% vs monthly</Text>
          )}

          <View style={styles.divider} />
          <Feature text="120 sec max output" />
          <Feature text="6 attempts per track" />
          <Feature text="2× priority processing" />
          <Feature text="Download PDF/JPG (clean)" />
          <Feature text="Record vocals" />

          <TouchableOpacity
            style={styles.btnTurquoise}
            onPress={() => console.log('Subscribe Advanced Pro pressed')}
            activeOpacity={0.85}
          >
            <Text style={styles.btnTurquoiseText}>Subscribe</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* ── Card 4: Virtuosos ── */}
      <View style={styles.cardGoldOuter}>
        <View style={[styles.card, styles.cardGoldInner]}>
          <Text style={styles.planNameGold}>Virtuosos</Text>

          <Text style={styles.priceGold}>
            {cycle === 'monthly' ? '$12.99' : '$143.99'}
            <Text style={styles.priceSubGold}>
              {cycle === 'monthly' ? ' /mo' : ' /yr'}
            </Text>
          </Text>
          {cycle === 'annual' && (
            <Text style={styles.savingsNoteGold}>Save 8% vs monthly</Text>
          )}

          <View style={styles.dividerGold} />
          <Feature text="300 sec max output" />
          <Feature text="Unlimited attempts" />
          <Feature text="5× priority processing" />
          <Feature text="Download PDF/JPG (clean)" />
          <Feature text="Record vocals" />

          <TouchableOpacity
            style={styles.btnGold}
            onPress={() => console.log('Subscribe Virtuosos pressed')}
            activeOpacity={0.85}
          >
            <Text style={styles.btnGoldText}>Subscribe</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Continue with Free */}
      <TouchableOpacity
        style={styles.btnSkip}
        onPress={() => router.replace('/upload')}
        activeOpacity={0.7}
      >
        <Text style={styles.btnSkipText}>Continue with Free</Text>
      </TouchableOpacity>

      <Text style={styles.legalNote}>
        Subscriptions auto-renew. Cancel anytime in your account settings.
      </Text>
    </ScrollView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#111118',
  },
  scroll: {
    paddingHorizontal: 20,
    paddingTop: 32,
    paddingBottom: 48,
  },
  header: {
    color: '#FFFFFF',
    fontSize: 28,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 6,
  },
  subheader: {
    color: '#6B7280',
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 24,
  },

  // ── Base card ──
  card: {
    borderRadius: 16,
    padding: 20,
    marginBottom: 16,
  },

  // ── Card 1: gray outlined ──
  cardGray: {
    backgroundColor: '#1C1C27',
    borderWidth: 1,
    borderColor: '#3D3D4E',
  },

  // ── Card 2: dark subtle ──
  cardDark: {
    backgroundColor: '#161620',
    borderWidth: 1,
    borderColor: '#2D2D3E',
  },

  // ── Card 3: turquoise border wrapper ──
  cardProOuter: {
    borderRadius: 18,
    padding: 2,
    marginBottom: 16,
    backgroundColor: '#0EA5E9',
    // Shadow to make it pop
    shadowColor: '#0EA5E9',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 12,
    elevation: 8,
  },
  cardProInner: {
    backgroundColor: '#13131F',
    marginBottom: 0,
  },

  // ── Card 4: gold border wrapper ──
  cardGoldOuter: {
    borderRadius: 18,
    padding: 2,
    marginBottom: 16,
    backgroundColor: '#F59E0B',
    shadowColor: '#F59E0B',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 8,
  },
  cardGoldInner: {
    backgroundColor: '#161510',
    marginBottom: 0,
  },

  // ── Plan names ──
  planName: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '700',
    marginBottom: 4,
  },
  planNameGold: {
    color: '#F59E0B',
    fontSize: 17,
    fontWeight: '700',
    marginBottom: 4,
  },

  // ── Prices ──
  price: {
    color: '#FFFFFF',
    fontSize: 28,
    fontWeight: '800',
    marginBottom: 4,
  },
  priceSub: {
    fontSize: 15,
    fontWeight: '400',
    color: '#9CA3AF',
  },
  priceGold: {
    color: '#F59E0B',
    fontSize: 28,
    fontWeight: '800',
    marginBottom: 4,
  },
  priceSubGold: {
    fontSize: 15,
    fontWeight: '400',
    color: '#9CA3AF',
  },
  savingsNote: {
    color: '#0EA5E9',
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 4,
  },
  savingsNoteGold: {
    color: '#F59E0B',
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 4,
  },

  // ── Dividers ──
  divider: {
    height: 1,
    backgroundColor: '#2D2D3E',
    marginVertical: 14,
  },
  dividerGold: {
    height: 1,
    backgroundColor: '#3D2E0A',
    marginVertical: 14,
  },

  // ── Badges ──
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  badgeCurrent: {
    backgroundColor: '#1E3A4A',
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  badgeCurrentText: {
    color: '#0EA5E9',
    fontSize: 11,
    fontWeight: '600',
  },
  badgeRecommended: {
    backgroundColor: '#0EA5E9',
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  badgeRecommendedText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '700',
  },

  // ── Buttons ──
  btnGray: {
    marginTop: 16,
    borderWidth: 1,
    borderColor: '#3D3D4E',
    borderRadius: 10,
    paddingVertical: 11,
    alignItems: 'center',
  },
  btnGrayText: {
    color: '#D1D5DB',
    fontSize: 14,
    fontWeight: '600',
  },
  btnTurquoise: {
    marginTop: 16,
    backgroundColor: '#0EA5E9',
    borderRadius: 10,
    paddingVertical: 13,
    alignItems: 'center',
  },
  btnTurquoiseText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
  btnGold: {
    marginTop: 16,
    backgroundColor: '#F59E0B',
    borderRadius: 10,
    paddingVertical: 13,
    alignItems: 'center',
  },
  btnGoldText: {
    color: '#111118',
    fontSize: 15,
    fontWeight: '700',
  },

  // ── Skip / Continue with Free ──
  btnSkip: {
    marginTop: 8,
    marginBottom: 16,
    paddingVertical: 14,
    alignItems: 'center',
  },
  btnSkipText: {
    color: '#6B7280',
    fontSize: 14,
    fontWeight: '600',
    textDecorationLine: 'underline',
  },

  // ── Legal ──
  legalNote: {
    color: '#4B5563',
    fontSize: 11,
    textAlign: 'center',
    lineHeight: 16,
  },
});
