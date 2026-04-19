import { useState, useEffect } from 'react';
import { getCustomerInfo } from '../lib/revenuecat';
import { supabase } from '../lib/supabase';
import { useAuth } from './useAuth';

// ─── Tier Configuration ────────────────────────────────────────────────────────
const TIER_CONFIG = {
  // Guest (not signed in): full audio processed, first 60 s shown in preview
  freeGuest: {
    label:                 'Free (Guest)',
    maxFileSizeMB:         10,
    maxAudioInputSeconds:  Infinity,
    maxOutputSeconds:      60,
    watermarked:           true,
    canRecord:             false,
    canDownload:           false,
    maxAttempts:           1,
    priorityProcessing:    1,
    canTranspose:          false,
    canBPM:                false,
    canEdit:               false,
    canPlayOnly:           true,
    sheetsPerMonth:        0,
    maxRecordMinutes:      0,
  },
  // Signed-in free: full audio processed, first 180 s shown in preview
  free: {
    label:                 'Free',
    maxFileSizeMB:         20,
    maxAudioInputSeconds:  Infinity,
    maxOutputSeconds:      180,
    watermarked:           true,
    canRecord:             true,
    canDownload:           false,
    maxAttempts:           2,
    priorityProcessing:    1,
    canTranspose:          false,
    canBPM:                false,
    canEdit:               false,
    canPlayOnly:           true,
    sheetsPerMonth:        5,
    maxRecordMinutes:      10,
  },
  advancedPro: {
    label:                 'Advanced Pro',
    maxFileSizeMB:         40,
    maxAudioInputSeconds:  Infinity,
    maxOutputSeconds:      900,
    watermarked:           false,
    canRecord:             true,
    canDownload:           true,
    maxAttempts:           6,
    priorityProcessing:    2,
    canTranspose:          true,
    canBPM:                true,
    canEdit:               true,
    canPlayOnly:           false,
    sheetsPerMonth:        60,
    maxRecordMinutes:      20,
  },
  virtuosos: {
    label:                 'Virtuosos',
    maxFileSizeMB:         50,
    maxAudioInputSeconds:  Infinity,
    maxOutputSeconds:      Infinity,
    watermarked:           false,
    canRecord:             true,
    canDownload:           true,
    maxAttempts:           Infinity,
    priorityProcessing:    5,
    canTranspose:          true,
    canBPM:                true,
    canEdit:               true,
    canPlayOnly:           false,
    sheetsPerMonth:        100,
    maxRecordMinutes:      30,
  },
  payAsYouGo: {
    label:                 'Pay As You Go',
    maxFileSizeMB:         40,
    maxAudioInputSeconds:  Infinity,
    maxOutputSeconds:      600,
    watermarked:           false,
    canRecord:             false,
    canDownload:           true,
    maxAttempts:           5,
    priorityProcessing:    1,
    canTranspose:          true,
    canBPM:                true,
    canEdit:               true,
    canPlayOnly:           false,
    sheetsPerMonth:        Infinity,
    maxRecordMinutes:      0,
  },
};

// ─── Hook ─────────────────────────────────────────────────────────────────────
export function useSubscription() {
  const [currentTier, setCurrentTier] = useState('freeGuest');
  const { session } = useAuth();

  useEffect(() => {
    async function checkEntitlements() {
      // Unauthenticated users get the guest free tier (60 s, watermarked).
      if (!session) {
        setCurrentTier('freeGuest');
        return;
      }

      // TODO: Remove before final production build
      const TEST_EMAIL = 'gyuhfsaaer@gmail.com';
      if (session.user?.email === TEST_EMAIL) {
        setCurrentTier('virtuosos');
        return;
      }

      try {
        const customerInfo = await getCustomerInfo();
        const active = customerInfo.entitlements.active;

        if (active['virtuosos_access']) {
          setCurrentTier('virtuosos');
        } else if (active['pro_access']) {
          setCurrentTier('advancedPro');
        } else {
          // Signed-in free: 180 s, watermarked
          setCurrentTier('free');
        }
      } catch (e) {
        // RevenueCat unavailable (no network, not yet configured, simulator, etc.)
        // Signed-in users fall back to the authenticated free tier, never guest.
        setCurrentTier('free');
      }
    }

    checkEntitlements();
  }, [session]);

  const config = TIER_CONFIG[currentTier];

  return {
    tier:                  currentTier,
    tierLabel:             config.label,
    maxFileSizeMB:         config.maxFileSizeMB,
    maxAudioInputSeconds:  config.maxAudioInputSeconds,
    maxOutputSeconds:      config.maxOutputSeconds,
    watermarked:           config.watermarked,
    canRecord:             config.canRecord,
    canDownload:           config.canDownload,
    maxAttempts:           config.maxAttempts,
    priorityProcessing:    config.priorityProcessing,
    canTranspose:          config.canTranspose,
    canBPM:                config.canBPM,
    canEdit:               config.canEdit,
    canPlayOnly:           config.canPlayOnly,
    sheetsPerMonth:        config.sheetsPerMonth,
    maxRecordMinutes:      config.maxRecordMinutes,
  };
}
