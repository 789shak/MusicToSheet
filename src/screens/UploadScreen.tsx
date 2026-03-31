import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Pressable,
  Modal,
  FlatList,
} from 'react-native';
import { useState } from 'react';
import { useRouter } from 'expo-router';
import { Ionicons, Feather, MaterialIcons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import { BottomTabBar } from '../components/BottomTabBar';

// ─── Types ────────────────────────────────────────────────────────────────────
type PickedFile = { name: string; uri: string };

// ─── Dropdown ─────────────────────────────────────────────────────────────────
function Dropdown({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: string[];
  value: string;
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <TouchableOpacity style={dd.trigger} onPress={() => setOpen(true)} activeOpacity={0.8}>
        <Text style={value ? dd.valueText : dd.placeholder}>{value || label}</Text>
        <Ionicons name="chevron-down" size={18} color="#6B7280" />
      </TouchableOpacity>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={dd.backdrop} onPress={() => setOpen(false)}>
          <View style={dd.sheet}>
            <Text style={dd.sheetTitle}>{label}</Text>
            <FlatList
              data={options}
              keyExtractor={(item) => item}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={[dd.option, item === value && dd.optionSelected]}
                  onPress={() => { onChange(item); setOpen(false); }}
                >
                  <Text style={[dd.optionText, item === value && dd.optionTextSelected]}>{item}</Text>
                  {item === value && <Ionicons name="checkmark" size={16} color="#0EA5E9" />}
                </TouchableOpacity>
              )}
            />
          </View>
        </Pressable>
      </Modal>
    </>
  );
}

const dd = StyleSheet.create({
  trigger: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#1C1C27',
    borderWidth: 1,
    borderColor: '#2D2D3E',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  placeholder: { color: '#6B7280', fontSize: 15 },
  valueText: { color: '#FFFFFF', fontSize: 15 },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#1C1C27',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingTop: 20,
    paddingBottom: 36,
    maxHeight: '70%',
  },
  sheetTitle: {
    color: '#9CA3AF',
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 1,
    paddingHorizontal: 20,
    marginBottom: 8,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    paddingHorizontal: 20,
  },
  optionSelected: { backgroundColor: '#0EA5E915' },
  optionText: { color: '#D1D5DB', fontSize: 15 },
  optionTextSelected: { color: '#FFFFFF', fontWeight: '600' },
});


// ─── Constants ────────────────────────────────────────────────────────────────
const INSTRUMENTS = [
  'Piano', 'Guitar', 'Bass', 'Violin', 'Cello',
  'Flute', 'Drums', 'Trumpet', 'Saxophone', 'Vocals', 'Full Score',
];

const OUTPUT_FORMATS = [
  'Score', 'Part', 'Lead Sheet', 'Tablature (Tabs)', 'Fake Book', 'Staff/Stave',
];

// ─── Main Screen ──────────────────────────────────────────────────────────────
export default function UploadScreen() {
  const router = useRouter();

  const [file, setFile] = useState<PickedFile | null>(null);
  const [link, setLink] = useState('');
  const [instrument, setInstrument] = useState('');
  const [outputFormat, setOutputFormat] = useState('');

  const hasInput = !!file || link.trim().length > 0;
  const canConvert = hasInput && instrument.length > 0;

  async function pickFile() {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['audio/*'],
        copyToCacheDirectory: true,
      });
      if (!result.canceled && result.assets?.length > 0) {
        const asset = result.assets[0];
        setFile({ name: asset.name, uri: asset.uri });
      }
    } catch (e) {
      console.log('File picker error:', e);
    }
  }

  function handleConvert() {
    if (!canConvert) return;
    router.push('/rights-declaration');
  }

  return (
    <View style={styles.root}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerLogo}>
          <Ionicons name="musical-note" size={20} color="#0EA5E9" />
          <Text style={styles.headerTitle}>Music-To-Sheet</Text>
        </View>
        <View style={styles.headerActions}>
          <TouchableOpacity
            style={styles.headerIcon}
            onPress={() => router.push('/settings')}
          >
            <Feather name="settings" size={20} color="#9CA3AF" />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.headerIcon}
            onPress={() => router.push('/profile')}
          >
            <Feather name="user" size={20} color="#9CA3AF" />
          </TouchableOpacity>
        </View>
      </View>

      {/* Scrollable content */}
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* ── INPUT BOX ── */}
        <View style={styles.fieldset}>
          <View style={styles.fieldsetLegendWrap}>
            <Text style={styles.fieldsetLegend}>Input</Text>
          </View>

          {/* Upload File */}
          <Text style={styles.sectionLabel}>Upload File</Text>
          {file ? (
            <View style={styles.fileSelected}>
              <Ionicons name="musical-notes-outline" size={18} color="#0EA5E9" />
              <Text style={styles.fileName} numberOfLines={1}>{file.name}</Text>
              <TouchableOpacity onPress={() => setFile(null)} hitSlop={8}>
                <Ionicons name="close-circle" size={20} color="#6B7280" />
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity style={styles.uploadArea} onPress={pickFile} activeOpacity={0.7}>
              <Feather name="upload-cloud" size={28} color="#0EA5E9" style={{ marginBottom: 8 }} />
              <Text style={styles.uploadText}>Tap to upload audio file</Text>
              <Text style={styles.uploadSubtext}>MP3, WAV, M4A, FLAC, AAC</Text>
            </TouchableOpacity>
          )}

          {/* Paste Link */}
          <Text style={[styles.sectionLabel, { marginTop: 16 }]}>Paste Link</Text>
          <TextInput
            style={styles.input}
            placeholder="Paste audio link here"
            placeholderTextColor="#6B7280"
            value={link}
            onChangeText={setLink}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
          />

          {/* Record */}
          <Text style={[styles.sectionLabel, { marginTop: 16 }]}>Record</Text>
          <View style={styles.recordRow}>
            <View style={styles.recordBtn}>
              <Ionicons name="mic-outline" size={22} color="#6B7280" />
              <Text style={styles.recordText}>Record</Text>
            </View>
            <View style={styles.proLockOverlay}>
              <MaterialIcons name="lock" size={14} color="#F59E0B" />
              <Text style={styles.proLockText}>Pro feature</Text>
            </View>
          </View>
        </View>

        {/* ── OUTPUT BOX ── */}
        <View style={[styles.fieldset, { marginTop: 20 }]}>
          <View style={styles.fieldsetLegendWrap}>
            <Text style={styles.fieldsetLegend}>Output</Text>
          </View>

          {/* Instrument Focus */}
          <Text style={styles.sectionLabel}>Instrument Focus</Text>
          <Dropdown
            label="Select Instrument"
            options={INSTRUMENTS}
            value={instrument}
            onChange={setInstrument}
          />

          {/* Output Format */}
          <Text style={[styles.sectionLabel, { marginTop: 16 }]}>Output Format</Text>
          <Dropdown
            label="Output Format"
            options={OUTPUT_FORMATS}
            value={outputFormat}
            onChange={setOutputFormat}
          />
        </View>

        {/* ── Section 6: Action Button ── */}
        <TouchableOpacity
          style={[styles.convertBtn, !canConvert && styles.convertBtnDisabled]}
          onPress={handleConvert}
          disabled={!canConvert}
          activeOpacity={0.85}
        >
          <Ionicons
            name="musical-notes"
            size={18}
            color={canConvert ? '#FFFFFF' : '#4B5563'}
            style={{ marginRight: 8 }}
          />
          <Text style={[styles.convertBtnText, !canConvert && styles.convertBtnTextDisabled]}>
            Convert to Sheet Music
          </Text>
        </TouchableOpacity>

        <Text style={styles.legalText}>
          This tool is for personal practice. You are responsible for rights to uploaded content.
        </Text>
      </ScrollView>

      {/* Bottom Tab Bar */}
      <BottomTabBar active="upload" />
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#111118',
  },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 56,
    paddingBottom: 14,
    backgroundColor: '#111118',
    borderBottomWidth: 1,
    borderBottomColor: '#1C1C27',
  },
  headerLogo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  headerTitle: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
  headerActions: {
    flexDirection: 'row',
    gap: 4,
  },
  headerIcon: {
    padding: 8,
  },

  // Scroll
  scroll: { flex: 1 },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 24,
    paddingBottom: 32,
  },

  // Section labels
  sectionLabel: {
    color: '#9CA3AF',
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 10,
  },

  // Fieldset container
  fieldset: {
    borderWidth: 1,
    borderColor: '#0EA5E9',
    borderRadius: 14,
    padding: 16,
    paddingTop: 22,
    position: 'relative',
  },
  fieldsetLegendWrap: {
    position: 'absolute',
    top: -10,
    left: 14,
    backgroundColor: '#111118',
    paddingHorizontal: 6,
  },
  fieldsetLegend: {
    color: '#0EA5E9',
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },

  // Upload area — paddingVertical reduced from 36 → 27 (25% less)
  uploadArea: {
    borderWidth: 1.5,
    borderColor: '#2D2D3E',
    borderStyle: 'dashed',
    borderRadius: 12,
    paddingVertical: 27,
    alignItems: 'center',
    backgroundColor: '#1C1C27',
  },
  uploadText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '600',
    marginBottom: 4,
  },
  uploadSubtext: {
    color: '#6B7280',
    fontSize: 12,
  },

  // File selected
  fileSelected: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1C1C27',
    borderWidth: 1,
    borderColor: '#0EA5E940',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 10,
  },
  fileName: {
    flex: 1,
    color: '#FFFFFF',
    fontSize: 14,
  },

  // Link input
  input: {
    backgroundColor: '#1C1C27',
    borderWidth: 1,
    borderColor: '#2D2D3E',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    color: '#FFFFFF',
    fontSize: 15,
  },

  // Record vocals
  recordRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  recordBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1C1C27',
    borderWidth: 1,
    borderColor: '#2D2D3E',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 10,
    opacity: 0.5,
  },
  recordText: {
    color: '#6B7280',
    fontSize: 15,
  },
  proLockOverlay: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginLeft: 12,
    backgroundColor: '#1F1A0A',
    borderWidth: 1,
    borderColor: '#F59E0B40',
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  proLockText: {
    color: '#F59E0B',
    fontSize: 12,
    fontWeight: '600',
  },

  // Convert button
  convertBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0EA5E9',
    borderRadius: 14,
    paddingVertical: 16,
    marginTop: 32,
    marginBottom: 12,
  },
  convertBtnDisabled: {
    backgroundColor: '#1C1C27',
    borderWidth: 1,
    borderColor: '#2D2D3E',
  },
  convertBtnText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
  convertBtnTextDisabled: {
    color: '#4B5563',
  },

  // Legal
  legalText: {
    color: '#4B5563',
    fontSize: 11,
    textAlign: 'center',
    lineHeight: 16,
    paddingHorizontal: 16,
  },
});
