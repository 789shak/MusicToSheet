import Purchases from 'react-native-purchases';
import { Platform } from 'react-native';

// NOTE: Expo only inlines env vars prefixed with EXPO_PUBLIC_ into the client
// bundle. Without that prefix these were always undefined in a real build, so
// RevenueCat silently disabled itself. RevenueCat SDK (client) keys are designed
// to live in the app, so EXPO_PUBLIC_ is the correct place for them. Set them as
// EAS environment variables (see eas.json / the deploy notes).
const API_KEY_ANDROID = process.env.EXPO_PUBLIC_REVENUECAT_API_KEY_ANDROID;
const API_KEY_IOS     = process.env.EXPO_PUBLIC_REVENUECAT_API_KEY_IOS;
const API_KEY         = Platform.OS === 'ios' ? API_KEY_IOS : API_KEY_ANDROID;

let _configured = false;

/**
 * Call once on app start. Silently skips if no API key is configured.
 */
export function configureRevenueCat() {
  if (!API_KEY) {
    console.warn('[RevenueCat] No API key configured — subscription features disabled.');
    return;
  }
  try {
    Purchases.configure({ apiKey: API_KEY });
    _configured = true;
  } catch (e) {
    console.warn('[RevenueCat] Failed to configure:', e?.message ?? e);
  }
}

function assertConfigured() {
  if (!_configured) throw new Error('RevenueCat not configured');
}

export async function getOfferings() {
  assertConfigured();
  return Purchases.getOfferings();
}

export async function purchasePackage(pkg) {
  assertConfigured();
  const { customerInfo } = await Purchases.purchasePackage(pkg);
  return customerInfo;
}

export async function restorePurchases() {
  assertConfigured();
  return Purchases.restorePurchases();
}

export async function getCustomerInfo() {
  assertConfigured();
  return Purchases.getCustomerInfo();
}
