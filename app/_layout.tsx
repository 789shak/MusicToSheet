import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef } from 'react';
import * as SplashScreen from 'expo-splash-screen';
import { useFonts } from 'expo-font';
import { AntDesign, FontAwesome, Ionicons, Feather, MaterialIcons, MaterialCommunityIcons } from '@expo/vector-icons';
import 'react-native-reanimated';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { AuthProvider, useAuth } from '@/src/hooks/useAuth';
import { OnboardingModal } from '@/src/components/OnboardingModal';

SplashScreen.preventAutoHideAsync();

function AuthGate() {
  const { session, loading } = useAuth();
  const router = useRouter();
  const segments = useSegments();
  // Tracks whether we've made the initial routing decision on app start
  const initialRoutingDone = useRef(false);

  useEffect(() => {
    if (loading) return;

    // ── Case 1: Initial app open ──────────────────────────────────────────
    // Fires once, when loading transitions from true → false.
    // Segments is read as a snapshot here (not in deps) to avoid a loop.
    if (!initialRoutingDone.current) {
      initialRoutingDone.current = true;
      const onLoginScreen = segments.length === 0 || segments[0] === 'index';
      if (session && onLoginScreen) {
        // Already logged in — skip login and go straight to subscription
        router.replace('/subscription');
      }
      // If not logged in, stay on login screen (index) — no redirect needed
      return;
    }

    // ── Case 2: Session expires / user logs out while inside the app ──────
    // After initial routing is done, only act when session goes away.
    if (!session) {
      const onLoginScreen = segments.length === 0 || segments[0] === 'index';
      if (!onLoginScreen) {
        router.replace('/');
      }
    }

    // Note: post-login navigation (→ /subscription) is handled directly in
    // LoginScreen's handlers, not here. This avoids a double-redirect race.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, loading]); // segments intentionally omitted — read as snapshot to prevent loop

  return null;
}

function RootLayoutInner() {
  const [fontsLoaded] = useFonts({
    ...AntDesign.font,
    ...FontAwesome.font,
    ...Ionicons.font,
    ...Feather.font,
    ...MaterialIcons.font,
    ...MaterialCommunityIcons.font,
  });

  useEffect(() => {
    if (fontsLoaded) SplashScreen.hideAsync();
  }, [fontsLoaded]);

  if (!fontsLoaded) return null;

  return (
    <>
      <AuthGate />
      <OnboardingModal />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: '#111118' },
          headerTintColor: '#FFFFFF',
          headerTitleStyle: { color: '#FFFFFF' },
          contentStyle: { backgroundColor: '#111118' },
        }}
      >
        {/* Auth */}
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="onboarding" options={{ headerShown: false }} />

        {/* Post-login stack — SubscriptionScreen is the entry point */}
        <Stack.Screen name="subscription" options={{ headerShown: false }} />
        <Stack.Screen name="upload" options={{ title: 'Upload Music' }} />
        <Stack.Screen name="rights-declaration" options={{ title: 'Rights Declaration' }} />
        <Stack.Screen name="processing" options={{ title: 'Processing', headerShown: false }} />
        <Stack.Screen name="results" options={{ title: 'Results' }} />
        <Stack.Screen name="history" options={{ title: 'History' }} />
        <Stack.Screen name="public-domain-library" options={{ title: 'Public Domain Library' }} />
        <Stack.Screen name="settings" options={{ title: 'Settings' }} />
        <Stack.Screen name="profile" options={{ title: 'Profile' }} />
        <Stack.Screen name="delete-account" options={{ title: 'Delete Account' }} />
      </Stack>
      <StatusBar style="light" />
    </>
  );
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <AuthProvider>
        <RootLayoutInner />
      </AuthProvider>
    </GestureHandlerRootView>
  );
}
