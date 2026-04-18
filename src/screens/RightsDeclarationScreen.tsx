import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
} from 'react-native';
import { useState } from 'react';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons, Feather } from '@expo/vector-icons';

// ─── Data ─────────────────────────────────────────────────────────────────────
const RIGHTS_OPTIONS = [
  { id: 'composer',     label: 'I am the composer or creator of this music' },
  { id: 'performer',    label: 'I am the performer in this recording' },
  { id: 'licensed',     label: 'I hold a license or permission to transcribe this work' },
  { id: 'personal',     label: 'This is for my personal practice and learning only' },
  { id: 'publicdomain', label: 'This is public domain music (composer deceased 100+ years)' },
];

// ─── Radio Option Row ─────────────────────────────────────────────────────────
function RadioOption({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity style={radio.row} onPress={onPress} activeOpacity={0.7}>
      <View style={[radio.circle, selected && radio.circleSelected]}>
        {selected && <View style={radio.dot} />}
      </View>
      <Text style={[radio.label, selected && radio.labelSelected]}>{label}</Text>
    </TouchableOpacity>
  );
}

const radio = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 13,
    paddingHorizontal: 16,
    backgroundColor: '#1C1C27',
    borderRadius: 12,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#2D2D3E',
    gap: 14,
  },
  circle: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: '#4B5563',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  circleSelected: {
    borderColor: '#0EA5E9',
    backgroundColor: '#0EA5E915',
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#0EA5E9',
  },
  label: {
    flex: 1,
    color: '#9CA3AF',
    fontSize: 14,
    lineHeight: 20,
  },
  labelSelected: {
    color: '#FFFFFF',
  },
});

// ─── Checkbox Row ─────────────────────────────────────────────────────────────
function CheckboxRow({
  checked,
  onPress,
}: {
  checked: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity style={cb.row} onPress={onPress} activeOpacity={0.7}>
      <View style={[cb.box, checked && cb.boxChecked]}>
        {checked && <Ionicons name="checkmark" size={14} color="#FFFFFF" />}
      </View>
      <Text style={cb.text}>
        I understand that generating sheet music from copyrighted audio may constitute a derivative
        work under copyright law.{' '}
        <Text style={cb.textBold}>I accept full responsibility for my use of this tool.</Text>
      </Text>
    </TouchableOpacity>
  );
}

const cb = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    marginTop: 4,
  },
  box: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: '#4B5563',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    marginTop: 1,
  },
  boxChecked: {
    backgroundColor: '#0EA5E9',
    borderColor: '#0EA5E9',
  },
  text: {
    flex: 1,
    color: '#9CA3AF',
    fontSize: 13,
    lineHeight: 20,
  },
  textBold: {
    color: '#D1D5DB',
    fontWeight: '600',
  },
});

// ─── Main Screen ──────────────────────────────────────────────────────────────
export default function RightsDeclarationScreen() {
  const router = useRouter();
  const { filePath, fileName, fileUri, fileMime, sourceType, linkUrl, instrument, outputFormat } = useLocalSearchParams<{
    filePath?: string;
    fileName?: string;
    fileUri?: string;
    fileMime?: string;
    sourceType?: string;
    linkUrl?: string;
    instrument?: string;
    outputFormat?: string;
  }>();

  const [selectedRight, setSelectedRight] = useState<string>('');
  const [accepted, setAccepted] = useState(false);

  const canProceed = selectedRight !== '' && accepted;

  function handleProceed() {
    if (!canProceed) return;
    console.log('[RightsDeclaration] proceeding to processing', { filePath, fileName, fileUri, fileMime, sourceType, linkUrl, instrument, outputFormat, rightsDeclaration: selectedRight });
    router.push({
      pathname: '/processing',
      params: {
        filePath: filePath ?? '',
        fileName: fileName ?? '',
        fileUri: fileUri ?? '',
        fileMime: fileMime ?? '',
        sourceType: sourceType ?? '',
        linkUrl: linkUrl ?? '',
        instrument: instrument ?? '',
        outputFormat: outputFormat ?? '',
        rightsDeclaration: selectedRight,
      },
    });
  }

  return (
    <View style={styles.root}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()} hitSlop={8}>
          <Feather name="arrow-left" size={22} color="#FFFFFF" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Confirm Your Rights</Text>
        {/* Spacer to keep title centered */}
        <View style={styles.backBtn} />
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        {/* Question */}
        <Text style={styles.question}>What is your relationship to this audio?</Text>

        {/* Radio options */}
        {RIGHTS_OPTIONS.map((opt) => (
          <RadioOption
            key={opt.id}
            label={opt.label}
            selected={selectedRight === opt.id}
            onPress={() => setSelectedRight(opt.id)}
          />
        ))}

        {/* Divider */}
        <View style={styles.divider} />

        {/* Checkbox */}
        <CheckboxRow checked={accepted} onPress={() => setAccepted((v) => !v)} />

        {/* Copyright link */}
        <TouchableOpacity
          style={styles.learnMoreWrap}
          onPress={() => console.log('Learn more about music copyright tapped')}
        >
          <Ionicons name="information-circle-outline" size={14} color="#0EA5E9" />
          <Text style={styles.learnMoreText}>Learn more about music copyright</Text>
        </TouchableOpacity>

        {/* Proceed button */}
        <TouchableOpacity
          style={[styles.proceedBtn, !canProceed && styles.proceedBtnDisabled]}
          onPress={handleProceed}
          disabled={!canProceed}
          activeOpacity={0.85}
        >
          <Text style={[styles.proceedBtnText, !canProceed && styles.proceedBtnTextDisabled]}>
            Proceed to Processing
          </Text>
          {canProceed && (
            <Ionicons name="arrow-forward" size={18} color="#FFFFFF" style={{ marginLeft: 8 }} />
          )}
        </TouchableOpacity>

        {/* Validation hint */}
        {!canProceed && (
          <Text style={styles.hintText}>
            {!selectedRight
              ? 'Please select your relationship to this audio.'
              : 'Please tick the checkbox to confirm you understand.'}
          </Text>
        )}
      </ScrollView>
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
    paddingHorizontal: 16,
    paddingTop: 28,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#1C1C27',
  },
  backBtn: {
    width: 38,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '700',
    textAlign: 'center',
  },

  // Scroll
  scroll: {
    paddingHorizontal: 20,
    paddingTop: 28,
    paddingBottom: 48,
  },

  // Question
  question: {
    color: '#9CA3AF',
    fontSize: 14,
    fontWeight: '500',
    marginBottom: 16,
    lineHeight: 20,
  },

  // Divider
  divider: {
    height: 1,
    backgroundColor: '#2D2D3E',
    marginVertical: 20,
  },

  // Learn more
  learnMoreWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 16,
    alignSelf: 'flex-start',
  },
  learnMoreText: {
    color: '#0EA5E9',
    fontSize: 13,
  },

  // Proceed button
  proceedBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0EA5E9',
    borderRadius: 14,
    paddingVertical: 16,
    marginTop: 28,
    marginBottom: 10,
  },
  proceedBtnDisabled: {
    backgroundColor: '#1C1C27',
    borderWidth: 1,
    borderColor: '#2D2D3E',
  },
  proceedBtnText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
  proceedBtnTextDisabled: {
    color: '#4B5563',
  },

  // Hint
  hintText: {
    color: '#6B7280',
    fontSize: 12,
    textAlign: 'center',
    lineHeight: 18,
  },
});
