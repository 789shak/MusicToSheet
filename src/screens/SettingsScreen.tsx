import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Feather, Ionicons, MaterialIcons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useAuth } from '../hooks/useAuth';

// ─── Row ──────────────────────────────────────────────────────────────────────
type RowProps = {
  icon: React.ReactNode;
  label: string;
  onPress?: () => void;
  rightLabel?: string;
  destructive?: boolean;
  last?: boolean;
};

function Row({ icon, label, onPress, rightLabel, destructive = false, last = false }: RowProps) {
  const isStatic = !onPress;

  const inner = (
    <View style={[row.wrap, last && row.wrapLast]}>
      <View style={row.left}>
        <View style={row.iconWrap}>{icon}</View>
        <Text style={[row.label, destructive && row.labelDestructive]}>{label}</Text>
      </View>
      <View style={row.right}>
        {rightLabel ? (
          <Text style={row.rightLabel}>{rightLabel}</Text>
        ) : !isStatic ? (
          <Feather name="chevron-right" size={16} color="#4B5563" />
        ) : null}
      </View>
    </View>
  );

  if (isStatic) return inner;

  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.6}>
      {inner}
    </TouchableOpacity>
  );
}

const row = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#2D2D3E',
  },
  wrapLast: {
    borderBottomWidth: 0,
  },
  left: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  iconWrap: { width: 22, alignItems: 'center' },
  label: { color: '#FFFFFF', fontSize: 15 },
  labelDestructive: { color: '#EF4444' },
  right: { flexDirection: 'row', alignItems: 'center' },
  rightLabel: { color: '#6B7280', fontSize: 14 },
});

// ─── Section ──────────────────────────────────────────────────────────────────
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={section.wrap}>
      <Text style={section.title}>{title}</Text>
      <View style={section.card}>{children}</View>
    </View>
  );
}

const section = StyleSheet.create({
  wrap: { marginBottom: 28 },
  title: {
    color: '#6B7280',
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 8,
    paddingHorizontal: 4,
  },
  card: {
    backgroundColor: '#1C1C27',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#2D2D3E',
    overflow: 'hidden',
  },
});

// ─── Main Screen ──────────────────────────────────────────────────────────────
export default function SettingsScreen() {
  const router = useRouter();
  const { signOut } = useAuth();

  function handleLogOut() {
    Alert.alert(
      'Log out of Music-To-Sheet?',
      'You can always log back in with your credentials.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Log Out',
          style: 'destructive',
          onPress: async () => {
            try {
              await signOut();
              router.replace('/');
            } catch (e) {
              console.log('Sign out error:', e);
            }
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
        <Text style={styles.headerTitle}>Settings</Text>
        <View style={styles.backBtn} />
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Account ── */}
        <Section title="Account">
          <Row
            icon={<Feather name="user" size={18} color="#9CA3AF" />}
            label="My Profile"
            onPress={() => router.push('/profile')}
          />
          <Row
            icon={<Feather name="credit-card" size={18} color="#9CA3AF" />}
            label="Subscription"
            onPress={() => router.push('/subscription')}
          />
          <Row
            icon={<Feather name="trash-2" size={18} color="#EF4444" />}
            label="Delete Account"
            onPress={() => router.push('/delete-account')}
            destructive
            last
          />
        </Section>

        {/* ── Legal ── */}
        <Section title="Legal">
          <Row
            icon={<Feather name="file-text" size={18} color="#9CA3AF" />}
            label="Terms of Service"
            onPress={() => console.log('Terms of Service pressed')}
          />
          <Row
            icon={<Feather name="shield" size={18} color="#9CA3AF" />}
            label="Privacy Policy"
            onPress={() => console.log('Privacy Policy pressed')}
          />
          <Row
            icon={<MaterialCommunityIcons name="copyright" size={18} color="#9CA3AF" />}
            label="Copyright Policy (DMCA)"
            onPress={() => console.log('Copyright Policy pressed')}
          />
          <Row
            icon={<Feather name="flag" size={18} color="#9CA3AF" />}
            label="Submit Takedown Request"
            onPress={() => console.log('Submit Takedown Request pressed')}
            last
          />
        </Section>

        {/* ── About ── */}
        <Section title="About">
          <Row
            icon={<Feather name="info" size={18} color="#9CA3AF" />}
            label="App Version"
            rightLabel="1.0.0"
          />
          <Row
            icon={<Ionicons name="star-outline" size={18} color="#9CA3AF" />}
            label="Rate This App"
            onPress={() => console.log('Rate This App pressed')}
          />
          <Row
            icon={<Feather name="mail" size={18} color="#9CA3AF" />}
            label="Contact Support"
            onPress={() => console.log('Contact Support pressed')}
            last
          />
        </Section>

        {/* ── Log Out ── */}
        <TouchableOpacity style={styles.logOutBtn} onPress={handleLogOut} activeOpacity={0.8}>
          <Feather name="log-out" size={17} color="#EF4444" style={{ marginRight: 8 }} />
          <Text style={styles.logOutText}>Log Out</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#111118' },

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

  scroll: {
    paddingHorizontal: 20,
    paddingTop: 28,
    paddingBottom: 48,
  },

  logOutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: '#EF4444',
    borderRadius: 14,
    paddingVertical: 15,
  },
  logOutText: {
    color: '#EF4444',
    fontSize: 15,
    fontWeight: '700',
  },
});
