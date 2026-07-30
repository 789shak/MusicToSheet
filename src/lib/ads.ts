import { Platform } from 'react-native';
import { InterstitialAd, AdEventType, TestIds } from 'react-native-google-mobile-ads';

const REAL_AD_UNIT_ID = Platform.select({
  android: 'ca-app-pub-3727257220772079/4390693807',
  ios:     'ca-app-pub-3727257220772079/7893605950',
}) as string;

// Google requires test ad unit IDs in development builds — serving real ads
// to a dev device risks invalid-traffic flags on the AdMob account.
const AD_UNIT_ID = __DEV__ ? TestIds.INTERSTITIAL : REAL_AD_UNIT_ID;

const interstitial = InterstitialAd.createForAdRequest(AD_UNIT_ID);

let isLoaded = false;
let isLoading = false;

interstitial.addAdEventListener(AdEventType.LOADED, () => {
  isLoaded = true;
  isLoading = false;
});

interstitial.addAdEventListener(AdEventType.ERROR, (error) => {
  console.log('[ads] interstitial failed to load:', error);
  isLoaded = false;
  isLoading = false;
});

interstitial.addAdEventListener(AdEventType.CLOSED, () => {
  isLoaded = false;
  loadInterstitial();
});

export function loadInterstitial(): void {
  if (isLoaded || isLoading) return;

  try {
    isLoading = true;
    interstitial.load();
  } catch (error) {
    console.log('[ads] interstitial load threw:', error);
    isLoading = false;
  }
}

// Resolves once the ad is closed, fails to show, or was never loaded —
// callers should never be blocked waiting on an ad.
export function showInterstitial(): Promise<void> {
  return new Promise((resolve) => {
    if (!isLoaded) {
      resolve();
      return;
    }

    let settled = false;
    const settle = () => {
      if (settled) return;
      settled = true;
      unsubscribeClosed();
      unsubscribeError();
      resolve();
    };

    const unsubscribeClosed = interstitial.addAdEventListener(AdEventType.CLOSED, settle);
    const unsubscribeError = interstitial.addAdEventListener(AdEventType.ERROR, settle);

    try {
      interstitial.show();
    } catch (error) {
      console.log('[ads] interstitial show threw:', error);
      settle();
    }
  });
}
