// ─── Subscription Tier Configuration ─────────────────────────────────────────
//
// TODO: Replace CURRENT_TIER with a real RevenueCat entitlement check once
// RevenueCat is integrated. Example:
//
//   import Purchases from 'react-native-purchases';
//   const customerInfo = await Purchases.getCustomerInfo();
//   const tier = customerInfo.entitlements.active['virtuosos']  ? 'virtuosos'
//              : customerInfo.entitlements.active['advancedPro'] ? 'advancedPro'
//              : customerInfo.entitlements.active['payAsYouGo']  ? 'payAsYouGo'
//              : 'free';
//
// For now we default to 'free' (20 MB limit).

const TIER_CONFIG = {
  free: {
    label: 'Free',
    maxFileSizeMB: 20,
  },
  advancedPro: {
    label: 'Advanced Pro',
    maxFileSizeMB: 40,
  },
  virtuosos: {
    label: 'Virtuosos',
    maxFileSizeMB: 50,
  },
  payAsYouGo: {
    label: 'Pay As You Go',
    maxFileSizeMB: 40,
  },
};

// ─── Hook ─────────────────────────────────────────────────────────────────────
export function useSubscription() {
  // TODO: derive from RevenueCat — see comment above
  const currentTier = 'free';

  const config = TIER_CONFIG[currentTier];

  return {
    tier: currentTier,
    maxFileSizeMB: config.maxFileSizeMB,
    tierLabel: config.label,
  };
}
