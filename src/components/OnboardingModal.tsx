import {
  View,
  Text,
  Modal,
  StyleSheet,
  TouchableOpacity,
  Dimensions,
} from 'react-native';
import { useEffect, useState } from 'react';
import * as SecureStore from 'expo-secure-store';
import { Ionicons, Feather } from '@expo/vector-icons';

const STORAGE_KEY = 'onboarding_completed';
const { width: SCREEN_WIDTH } = Dimensions.get('window');

// ─── Feature row ─────────────────────────────────────────────────────────────
function Feature({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <View style={feat.row}>
      <View style={feat.iconWrap}>{icon}</View>
      <Text style={feat.text}>{text}</Text>
    </View>
  );
}

const feat = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 14 },
  iconWrap: { width: 28, marginTop: 1 },
  text: { flex: 1, color: '#9CA3AF', fontSize: 14, lineHeight: 20 },
});

// ─── Component ────────────────────────────────────────────────────────────────
export function OnboardingModal() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    SecureStore.getItemAsync(STORAGE_KEY).then((value) => {
      if (!value) setVisible(true);
    });
  }, []);

  async function handleDismiss() {
    await SecureStore.setItemAsync(STORAGE_KEY, 'true');
    setVisible(false);
  }

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={handleDismiss}
    >
      <View style={styles.backdrop}>
        <View style={styles.card}>
          {/* Icon */}
          <View style={styles.iconCircle}>
            <Ionicons name="musical-notes" size={36} color="#FFFFFF" />
          </View>

          {/* Title — turquoise #0EA5E9 */}
          <Text style={styles.title}>Welcome to Music-To-Sheet</Text>

          {/* Features */}
          <View style={styles.features}>
            <Feature
              icon={<Feather name="upload-cloud" size={17} color="#0EA5E9" />}
              text="Upload audio, paste a link, or record your voice"
            />
            <Feature
              icon={<Ionicons name="musical-notes-outline" size={17} color="#0EA5E9" />}
              text="Get sheet music for any instrument instantly"
            />
            <Feature
              icon={<Feather name="download" size={17} color="#0EA5E9" />}
              text="Download as PDF or share with others"
            />
          </View>

          {/* Notice box */}
          <View style={styles.noticeBox}>
            <Ionicons
              name="information-circle-outline"
              size={14}
              color="#6B7280"
              style={{ marginRight: 6, marginTop: 1, flexShrink: 0 }}
            />
            <Text style={styles.noticeText}>
              Please only upload content you own or have permission to use. Generated sheet
              music may constitute a derivative work under copyright law.
            </Text>
          </View>

          {/* Button */}
          <TouchableOpacity style={styles.btn} onPress={handleDismiss} activeOpacity={0.85}>
            <Text style={styles.btnText}>I Understand</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.72)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  card: {
    backgroundColor: '#1A1A24',
    borderRadius: 20,
    padding: 28,
    width: Math.min(SCREEN_WIDTH * 0.9, 400),
    alignItems: 'center',
  },

  // Icon
  iconCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: '#0EA5E9',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },

  // Title — explicitly turquoise
  title: {
    color: '#0EA5E9',
    fontSize: 20,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 22,
    lineHeight: 28,
  },

  // Features
  features: {
    width: '100%',
    marginBottom: 18,
  },

  // Notice
  noticeBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: '#111118',
    borderWidth: 1,
    borderColor: '#2D2D3E',
    borderRadius: 10,
    padding: 12,
    marginBottom: 22,
    width: '100%',
  },
  noticeText: {
    flex: 1,
    color: '#6B7280',
    fontSize: 12,
    lineHeight: 18,
  },

  // Button
  btn: {
    backgroundColor: '#0EA5E9',
    borderRadius: 12,
    paddingVertical: 14,
    width: '100%',
    alignItems: 'center',
  },
  btnText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
});
