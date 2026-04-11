import { useState, useEffect } from 'react';
import { getCustomerInfo } from '../lib/revenuecat';
import { supabase } from '../lib/supabase';

// ─── Tier Configuration ────────────────────────────────────────────────────────
const TIER_CONFIG = {
  free: {
    label:              'Free',
    maxFileSizeMB:      20,
    maxOutputSeconds:   30,
    canRecord:          false,
    canDownload:        false,
    maxAttempts:        2,
    priorityProcessing: 1,
  },
  advancedPro: {
    label:              'Advanced Pro',
    maxFileSizeMB:      40,
    maxOutputSeconds:   120,
    canRecord:          true,
    canDownload:        true,
    maxAttempts:        6,
    priorityProcessing: 2,
  },
  virtuosos: {
    label:              'Virtuosos',
    maxFileSizeMB:      50,
    maxOutputSeconds:   300,
    canRecord:          true,
    canDownload:        true,
    maxAttempts:        Infinity,
    priorityProcessing: 5,
  },
  payAsYouGo: {
    label:              'Pay As You Go',
    maxFileSizeMB:      40,
    maxOutputSeconds:   300,
    canRecord:          false,
    canDownload:        true,
    maxAttempts:        3,
    priorityProcessing: 1,
  },
};

// ─── Hook ─────────────────────────────────────────────────────────────────────
export function useSubscription() {
  const [currentTier, setCurrentTier] = useState('free');

  useEffect(() => {
    async function checkEntitlements() {
      // REMOVED: test bypass (shakes789@gmail.com → virtuosos)

      try {
        const customerInfo = await getCustomerInfo();
        const active = customerInfo.entitlements.active;

        if (active['virtuosos_access']) {
          setCurrentTier('virtuosos');
        } else if (active['pro_access']) {
          setCurrentTier('advancedPro');
        } else {
          setCurrentTier('free');
        }
      } catch (e) {
        // RevenueCat unavailable (no network, not yet configured, simulator, etc.)
        // Silently fall back to the Free tier — never block the user.
      }
    }

    checkEntitlements();
  }, []);

  const config = TIER_CONFIG[currentTier];

  return {
    tier:               currentTier,
    tierLabel:          config.label,
    maxFileSizeMB:      config.maxFileSizeMB,
    maxOutputSeconds:   config.maxOutputSeconds,
    canRecord:          config.canRecord,
    canDownload:        config.canDownload,
    maxAttempts:        config.maxAttempts,
    priorityProcessing: config.priorityProcessing,
  };
}
