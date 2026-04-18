import React, { useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { readAsStringAsync } from 'expo-file-system/legacy';
import { decode } from 'base64-arraybuffer';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../lib/supabase';

const API_URL = 'https://musictosheet.onrender.com';

export default function NoiseCleanerScreen() {
  const router = useRouter();
  const [file, setFile] = useState(null);
  const [status, setStatus] = useState('idle'); // idle | uploading | cleaning | done | error
  const [cleanedUri, setCleanedUri] = useState(null);
  const [errorMsg, setErrorMsg] = useState('');

  async function pickFile() {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['audio/*'],
        copyToCacheDirectory: true,
      });
      if (result.canceled) return;
      setFile(result.assets[0]);
      setStatus('idle');
      setCleanedUri(null);
      setErrorMsg('');
    } catch {
      Alert.alert('Error', 'Could not pick file.');
    }
  }

  async function cleanAudio() {
    if (!file) return;
    setStatus('uploading');
    setErrorMsg('');
    setCleanedUri(null);

    let remotePath = null;

    try {
      // Step 1: Upload to Supabase using base64-arraybuffer (same pattern as main upload flow)
      const ext = file.name.split('.').pop() ?? 'mp3';
      const { data: { session } } = await supabase.auth.getSession();
      const uid = session?.user?.id;
      if (!uid) throw new Error('You must be signed in to use Noise Cleaner.');
      remotePath = `${uid}/noise-cleaner_${Date.now()}_${file.name}`;

      const base64 = await readAsStringAsync(file.uri, { encoding: 'base64' });
      const { error: uploadError } = await supabase.storage
        .from('audio-uploads')
        .upload(remotePath, decode(base64), {
          contentType: file.mimeType ?? `audio/${ext}`,
          upsert: true,
        });

      if (uploadError) throw new Error(`Upload failed: ${uploadError.message}`);

      // Step 2: Create a signed URL (60 min TTL) so server can download it
      const { data: signedData, error: signedError } = await supabase.storage
        .from('audio-uploads')
        .createSignedUrl(remotePath, 3600);

      if (signedError || !signedData?.signedUrl) {
        throw new Error('Could not create signed URL for server access.');
      }

      setStatus('cleaning');

      // Step 3: Send signed URL to server — server returns JSON with base64 WAV
      const response = await fetch(`${API_URL}/clean-audio`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ audio_url: signedData.signedUrl, prop_decrease: 0.75 }),
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Server error ${response.status}: ${text}`);
      }

      const json = await response.json();
      if (!json.audio_base64) throw new Error(json.error ?? 'Server returned no audio data.');

      // Step 4: Write base64 MP3 to cache and share
      const fmt = json.format ?? 'mp3';
      const outPath = FileSystem.cacheDirectory + `cleaned_${Date.now()}.${fmt}`;
      await FileSystem.writeAsStringAsync(outPath, json.audio_base64, {
        encoding: FileSystem.EncodingType.Base64,
      });

      setCleanedUri(outPath);
      setStatus('done');
    } catch (e) {
      setErrorMsg(e.message ?? 'Something went wrong.');
      setStatus('error');
    } finally {
      // Clean up the Supabase upload regardless of outcome
      if (remotePath) {
        supabase.storage.from('audio-uploads').remove([remotePath]).catch(() => {});
      }
    }
  }

  async function shareFile() {
    if (!cleanedUri) return;
    const canShare = await Sharing.isAvailableAsync();
    if (!canShare) {
      Alert.alert('Not available', 'Sharing is not available on this device.');
      return;
    }
    await Sharing.shareAsync(cleanedUri, { mimeType: 'audio/mpeg', dialogTitle: 'Save cleaned audio' });
  }

  const isBusy = status === 'uploading' || status === 'cleaning';

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={22} color="#FFFFFF" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Noise Cleaner</Text>
      </View>

      <View style={styles.body}>
        <View style={styles.iconWrap}>
          <Ionicons name="mic-off" size={40} color="#A78BFA" />
        </View>
        <Text style={styles.title}>Remove Background Noise</Text>
        <Text style={styles.subtitle}>
          Upload a recording and we'll strip out background hiss, hum, and ambient noise.
        </Text>

        <TouchableOpacity style={styles.pickBtn} onPress={pickFile} disabled={isBusy}>
          <Ionicons name="document-attach-outline" size={18} color="#FFFFFF" />
          <Text style={styles.pickBtnText} numberOfLines={1}>
            {file ? file.name : 'Choose audio file'}
          </Text>
        </TouchableOpacity>

        {file && (
          <Text style={styles.fileHint}>
            {file.size ? (file.size / 1024 / 1024).toFixed(1) + ' MB · ' : ''}{file.mimeType ?? ''}
          </Text>
        )}

        {status === 'uploading' && (
          <View style={styles.statusRow}>
            <ActivityIndicator color="#0EA5E9" size="small" />
            <Text style={styles.statusText}>Uploading to server…</Text>
          </View>
        )}
        {status === 'cleaning' && (
          <View style={styles.statusRow}>
            <ActivityIndicator color="#A78BFA" size="small" />
            <Text style={styles.statusText}>Cleaning noise… this may take a moment</Text>
          </View>
        )}
        {status === 'error' && (
          <Text style={styles.errorText}>{errorMsg}</Text>
        )}

        {file && status !== 'done' && (
          <TouchableOpacity
            style={[styles.cleanBtn, (!file || isBusy) && styles.cleanBtnDisabled]}
            onPress={cleanAudio}
            disabled={!file || isBusy}
          >
            {isBusy ? (
              <ActivityIndicator color="#FFFFFF" size="small" />
            ) : (
              <>
                <Ionicons name="sparkles" size={18} color="#FFFFFF" />
                <Text style={styles.cleanBtnText}>Clean Audio</Text>
              </>
            )}
          </TouchableOpacity>
        )}

        {status === 'done' && cleanedUri && (
          <View style={styles.doneCard}>
            <Ionicons name="checkmark-circle" size={32} color="#34D399" />
            <Text style={styles.doneTitle}>Noise Removed!</Text>
            <Text style={styles.doneDesc}>Your cleaned audio is ready to save.</Text>
            <TouchableOpacity style={styles.shareBtn} onPress={shareFile}>
              <Ionicons name="share-outline" size={18} color="#FFFFFF" />
              <Text style={styles.shareBtnText}>Save / Share</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.resetBtn} onPress={() => { setFile(null); setStatus('idle'); setCleanedUri(null); }}>
              <Text style={styles.resetBtnText}>Clean another file</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#111118' },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: 52,
    paddingBottom: 14,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#2D2D3E',
    gap: 8,
  },
  backBtn: { padding: 4 },
  headerTitle: { fontSize: 18, fontWeight: '700', color: '#FFFFFF' },

  body: {
    flex: 1,
    alignItems: 'center',
    padding: 24,
    paddingTop: 40,
  },

  iconWrap: {
    width: 80,
    height: 80,
    borderRadius: 22,
    backgroundColor: '#A78BFA22',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },

  title: { fontSize: 22, fontWeight: '700', color: '#FFFFFF', marginBottom: 10, textAlign: 'center' },
  subtitle: { fontSize: 14, color: '#9CA3AF', textAlign: 'center', lineHeight: 21, marginBottom: 32, maxWidth: 300 },

  pickBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#1C1C28',
    borderWidth: 1,
    borderColor: '#2D2D3E',
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 20,
    width: '100%',
    marginBottom: 8,
  },
  pickBtnText: { color: '#FFFFFF', fontSize: 14, fontWeight: '500', flex: 1 },

  fileHint: { color: '#6B7280', fontSize: 12, marginBottom: 20, alignSelf: 'flex-start' },

  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginVertical: 12 },
  statusText: { color: '#9CA3AF', fontSize: 14, flexShrink: 1 },

  errorText: { color: '#F87171', fontSize: 13, textAlign: 'center', marginTop: 12 },

  cleanBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#A78BFA',
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 28,
    marginTop: 16,
    width: '100%',
    justifyContent: 'center',
  },
  cleanBtnDisabled: { opacity: 0.5 },
  cleanBtnText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },

  doneCard: {
    alignItems: 'center',
    backgroundColor: '#1C1C28',
    borderRadius: 16,
    padding: 28,
    width: '100%',
    marginTop: 16,
    borderWidth: 1,
    borderColor: '#2D2D3E',
    gap: 8,
  },
  doneTitle: { fontSize: 20, fontWeight: '700', color: '#34D399' },
  doneDesc: { fontSize: 13, color: '#9CA3AF', textAlign: 'center', marginBottom: 8 },

  shareBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#0EA5E9',
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 24,
    width: '100%',
    justifyContent: 'center',
    marginTop: 4,
  },
  shareBtnText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },

  resetBtn: { marginTop: 8 },
  resetBtnText: { color: '#6B7280', fontSize: 13 },
});
