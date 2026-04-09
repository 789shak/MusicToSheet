import Purchases from 'react-native-purchases';

// RevenueCat public API key — safe to embed in mobile apps (not a secret).
// Replace with separate iOS / Android keys once both are set up in the dashboard.
const API_KEY = 'test_xQbinSlnzqKtOIvcnXVgnEntyUV';

/**
 * Call once on app start (before any subscription checks).
 */
export function configureRevenueCat() {
  Purchases.configure({ apiKey: API_KEY });
}

/**
 * Fetch available offerings (plans + packages with live prices).
 * @returns {Promise<import('react-native-purchases').PurchasesOfferings>}
 */
export async function getOfferings() {
  return Purchases.getOfferings();
}

/**
 * Purchase a RevenueCat package.
 * Throws with { userCancelled: true } if the user dismissed the payment sheet.
 * @param {import('react-native-purchases').PurchasesPackage} pkg
 * @returns {Promise<import('react-native-purchases').CustomerInfo>}
 */
export async function purchasePackage(pkg) {
  const { customerInfo } = await Purchases.purchasePackage(pkg);
  return customerInfo;
}

/**
 * Restore previous purchases (required by App Store / Play Store guidelines).
 * @returns {Promise<import('react-native-purchases').CustomerInfo>}
 */
export async function restorePurchases() {
  return Purchases.restorePurchases();
}

/**
 * Get the latest customer info / entitlements for the current user.
 * @returns {Promise<import('react-native-purchases').CustomerInfo>}
 */
export async function getCustomerInfo() {
  return Purchases.getCustomerInfo();
}
