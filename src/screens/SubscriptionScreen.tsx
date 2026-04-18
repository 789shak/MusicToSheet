import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Pressable,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { useState, useEffect } from 'react';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { getOfferings, purchasePackage, restorePurchases } from '../lib/revenuecat';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

type BillingCycle = 'monthly' | 'quarterly' | 'annual';

// ─── Billing Toggle ───────────────────────────────────────────────────────────
function BillingToggle({
  cycle,
  onChange,
}: {
  cycle: BillingCycle;
  onChange: (c: BillingCycle) => void;
}) {
  const options: { value: BillingCycle; label: string; badge?: string }[] = [
    { value: 'monthly',   label: 'Monthly' },
    { value: 'quarterly', label: '3 Months', badge: 'Save 25%' },
    { value: 'annual',    label: 'Annual',   badge: 'Save 50%' },
  ];

  return (
    <View style={toggle.row}>
      {options.map((opt) => (
        <Pressable
          key={opt.value}
          style={[toggle.pill, cycle === opt.value && toggle.pillActive]}
          onPress={() => onChange(opt.value)}
        >
          <Text style={[toggle.pillLabel, cycle === opt.value && toggle.pillLabelActive]}>
            {opt.label}
          </Text>
          {opt.badge ? (
            <Text style={[toggle.pillBadge, cycle === opt.value && toggle.pillBadgeActive]}>
              {opt.badge}
            </Text>
          ) : null}
        </Pressable>
      ))}
    </View>
  );
}

const toggle = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginBottom: 28,
  },
  pill: {
    alignItems: 'center',
    backgroundColor: '#1C1C27',
    borderWidth: 1,
    borderColor: '#2D2D3E',
    borderRadius: 100,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  pillActive: {
    backgroundColor: '#0EA5E9',
    borderColor: '#0EA5E9',
  },
  pillLabel: {
    color: '#6B7280',
    fontSize: 13,
    fontWeight: '600',
  },
  pillLabelActive: {
    color: '#FFFFFF',
  },
  pillBadge: {
    color: '#4B5563',
    fontSize: 10,
    fontWeight: '700',
    marginTop: 1,
  },
  pillBadgeActive: {
    color: '#FFFFFF',
    opacity: 0.85,
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
  const insets = useSafeAreaInsets();
  const [cycle, setCycle] = useState<BillingCycle>('annual');
  const [offerings, setOfferings] = useState<any>(null);
  const [purchasing, setPurchasing] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(false);

  useEffect(() => {
    getOfferings()
      .then(setOfferings)
      .catch(() => { /* fall back to hardcoded prices */ });
  }, []);

  async function handlePurchase(planId: string) {
    if (purchasing) return;
    try {
      setPurchasing(planId);

      // Find the matching package in the current offering by identifier,
      // or fall back to the first available package.
      const pkg =
        offerings?.current?.availablePackages?.find(
          (p: any) => p.identifier === planId
        ) ?? offerings?.current?.availablePackages?.[0];

      if (!pkg) throw new Error('Package not available yet. Please try again later.');

      await purchasePackage(pkg);
      Alert.alert('Purchase successful', 'Your plan has been activated.');
    } catch (e: any) {
      if (!e?.userCancelled) {
        Alert.alert('Purchase failed', e?.message ?? 'Something went wrong. Please try again.');
      }
    } finally {
      setPurchasing(null);
    }
  }

  async function handleRestore() {
    if (restoring) return;
    try {
      setRestoring(true);
      await restorePurchases();
      Alert.alert('Purchases restored', 'Your previous purchases have been restored.');
    } catch (e: any) {
      Alert.alert('Restore failed', e?.message ?? 'Could not restore purchases. Please try again.');
    } finally {
      setRestoring(false);
    }
  }

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 16 }]}
      showsVerticalScrollIndicator={false}
    >
      <Text style={styles.header}>Choose Your Plan</Text>
      <Text style={styles.subheader}>Unlock your musical potential</Text>

      <BillingToggle cycle={cycle} onChange={setCycle} />

      {/* ── Card 1: Free Forever ── */}
      <View style={[styles.card, styles.cardDark]}>
        <View style={styles.badgeRow}>
          <Text style={styles.planName}>Free Forever</Text>
          <View style={styles.badgeCurrent}>
            <Text style={styles.badgeCurrentText}>Current Plan</Text>
          </View>
        </View>
        <Text style={styles.price}>$0 <Text style={styles.priceSub}>/ forever</Text></Text>
        <View style={styles.divider} />
        <Feature text="No sign-up: up to 60 sec audio, watermarked" />
        <Feature text="Sign up free: up to 180 sec audio, watermarked" />
        <Feature text="5 sheets per month (signed in)" />
        <Feature text="Free Metronome access" />
        <Feature text="Free recording up to 10 minutes" />
        <Feature text="PDF with watermark — play & listen only" />
        <Feature text="No clean download" muted />
        <Feature text="No transpose, BPM, or note editing" muted />
      </View>

      {/* ── Card 2: Pay As You Go ── */}
      <View style={[styles.card, styles.cardGray]}>
        <Text style={styles.planName}>Pay As You Go</Text>
        <Text style={styles.price}>$1.99 <Text style={styles.priceSub}>/ track</Text></Text>
        <View style={styles.divider} />
        <Feature text="Up to 600 seconds output" />
        <Feature text="5 attempts per track" />
        <Feature text="Clean PDF without watermark" />
        <Feature text="Transpose, BPM & note editing" />
        <Feature text="No subscription needed" />
        <TouchableOpacity
          style={styles.btnGray}
          onPress={() => console.log('Pay-per-track purchase initiated')}
          activeOpacity={0.85}
        >
          <Text style={styles.btnGrayText}>Buy Per Track — $1.99</Text>
        </TouchableOpacity>
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

          {cycle === 'quarterly' ? (
            <>
              <View style={styles.annualPriceRow}>
                <Text style={styles.price}>$11.24<Text style={styles.priceSub}> /mo</Text></Text>
                <Text style={styles.priceStrike}>$14.99/mo</Text>
              </View>
              <View style={styles.annualInfoRow}>
                <Text style={styles.billedNote}>billed $33.72 every 3 months</Text>
                <View style={styles.saveBadgeGreen}>
                  <Text style={styles.saveBadgeGreenText}>Save 25%</Text>
                </View>
              </View>
            </>
          ) : cycle === 'annual' ? (
            <>
              <View style={styles.annualPriceRow}>
                <Text style={styles.price}>$7.49<Text style={styles.priceSub}> /mo</Text></Text>
                <Text style={styles.priceStrike}>$14.99/mo</Text>
              </View>
              <View style={styles.annualInfoRow}>
                <Text style={styles.billedNote}>billed $89.88/year</Text>
                <View style={styles.saveBadgeGreen}>
                  <Text style={styles.saveBadgeGreenText}>Save 50%</Text>
                </View>
              </View>
            </>
          ) : (
            <Text style={styles.price}>$14.99<Text style={styles.priceSub}> /mo</Text></Text>
          )}

          <View style={styles.divider} />
          <Feature text="Up to 15 minutes output" />
          <Feature text="60 sheets per month" />
          <Feature text="2× priority processing" />
          <Feature text="Clean PDF download" />
          <Feature text="Transpose, BPM & note editing" />

          <TouchableOpacity
            style={styles.btnTurquoise}
            onPress={() => handlePurchase(
              cycle === 'annual' ? 'pro_annual' : cycle === 'quarterly' ? 'pro_quarterly' : 'pro_monthly'
            )}
            activeOpacity={0.85}
            disabled={!!purchasing}
          >
            {purchasing === 'pro_monthly' || purchasing === 'pro_quarterly' || purchasing === 'pro_annual'
              ? <ActivityIndicator size="small" color="#FFFFFF" />
              : <Text style={styles.btnTurquoiseText}>
                  {cycle === 'monthly' ? 'Subscribe' : 'Subscribe · Best Value'}
                </Text>
            }
          </TouchableOpacity>
        </View>
      </View>

      {/* ── Card 4: Virtuosos ── */}
      <View style={styles.cardGoldOuter}>
        <View style={[styles.card, styles.cardGoldInner]}>
          <Text style={styles.planNameGold}>Virtuosos</Text>

          {cycle === 'quarterly' ? (
            <>
              <View style={styles.annualPriceRow}>
                <Text style={styles.priceGold}>$14.99<Text style={styles.priceSubGold}> /mo</Text></Text>
                <Text style={styles.priceStrikeGold}>$19.99/mo</Text>
              </View>
              <View style={styles.annualInfoRow}>
                <Text style={styles.billedNote}>billed $44.97 every 3 months</Text>
                <View style={styles.saveBadgeGreen}>
                  <Text style={styles.saveBadgeGreenText}>Save 25%</Text>
                </View>
              </View>
            </>
          ) : cycle === 'annual' ? (
            <>
              <View style={styles.annualPriceRow}>
                <Text style={styles.priceGold}>$9.99<Text style={styles.priceSubGold}> /mo</Text></Text>
                <Text style={styles.priceStrikeGold}>$19.99/mo</Text>
              </View>
              <View style={styles.annualInfoRow}>
                <Text style={styles.billedNote}>billed $119.88/year</Text>
                <View style={styles.saveBadgeGreen}>
                  <Text style={styles.saveBadgeGreenText}>Save 50%</Text>
                </View>
              </View>
            </>
          ) : (
            <Text style={styles.priceGold}>$19.99<Text style={styles.priceSubGold}> /mo</Text></Text>
          )}

          <View style={styles.dividerGold} />
          <Feature text="Full-length output" />
          <Feature text="100 sheets per month" />
          <Feature text="5× priority processing" />
          <Feature text="Download PDF/JPG (clean)" />
          <Feature text="Transpose, BPM & note editing" />
          <Feature text="30 minutes max recording" />
          <Feature text="Every feature unlocked" />

          <TouchableOpacity
            style={styles.btnGold}
            onPress={() => handlePurchase(
              cycle === 'annual' ? 'virtuosos_annual' : cycle === 'quarterly' ? 'virtuosos_quarterly' : 'virtuosos_monthly'
            )}
            activeOpacity={0.85}
            disabled={!!purchasing}
          >
            {purchasing === 'virtuosos_monthly' || purchasing === 'virtuosos_quarterly' || purchasing === 'virtuosos_annual'
              ? <ActivityIndicator size="small" color="#111118" />
              : <Text style={styles.btnGoldText}>
                  {cycle === 'monthly' ? 'Subscribe' : 'Subscribe · Best Value'}
                </Text>
            }
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

      <TouchableOpacity
        style={styles.btnRestore}
        onPress={handleRestore}
        activeOpacity={0.7}
        disabled={restoring}
      >
        {restoring
          ? <ActivityIndicator size="small" color="#6B7280" />
          : <Text style={styles.btnRestoreText}>Restore Purchases</Text>
        }
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
  annualPriceRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 10,
    marginBottom: 2,
  },
  priceStrike: {
    color: '#6B7280',
    fontSize: 14,
    fontWeight: '400',
    textDecorationLine: 'line-through',
  },
  priceStrikeGold: {
    color: '#92400E',
    fontSize: 14,
    fontWeight: '400',
    textDecorationLine: 'line-through',
  },
  annualInfoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6,
  },
  billedNote: {
    color: '#9CA3AF',
    fontSize: 12,
    fontWeight: '400',
  },
  saveBadgeGreen: {
    backgroundColor: '#064E3B',
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: '#34D39940',
  },
  saveBadgeGreenText: {
    color: '#34D399',
    fontSize: 13,
    fontWeight: '700',
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

  // ── Restore ──
  btnRestore: {
    paddingVertical: 12,
    alignItems: 'center',
    marginBottom: 4,
  },
  btnRestoreText: {
    color: '#6B7280',
    fontSize: 13,
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
