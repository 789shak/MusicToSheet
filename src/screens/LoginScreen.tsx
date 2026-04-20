import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Image,
} from 'react-native';
import { useState } from 'react';
import { useRouter } from 'expo-router';
import { AntDesign, FontAwesome, Ionicons } from '@expo/vector-icons';
import { useAuth } from '../hooks/useAuth';

type SocialButtonProps = {
  icon: React.ReactNode;
  label: string;
  buttonStyle: object;
  textStyle: object;
  onPress: () => void;
  disabled?: boolean;
};

function SocialButton({ icon, label, buttonStyle, textStyle, onPress, disabled }: SocialButtonProps) {
  return (
    <TouchableOpacity
      style={[styles.socialBtn, buttonStyle, disabled && styles.btnDisabled]}
      onPress={onPress}
      activeOpacity={0.85}
      disabled={disabled}
    >
      <View style={styles.socialBtnInner}>
        <View style={styles.socialIconWrap}>{icon}</View>
        <Text style={[styles.socialBtnText, textStyle]}>{label}</Text>
      </View>
    </TouchableOpacity>
  );
}

export default function LoginScreen() {
  const router = useRouter();
  const { signUp, signIn, signInWithGoogle, signInWithApple, signInWithMicrosoft, enterGuestMode } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSignUp() {
    const trimmedEmail = email.trim();
    if (!trimmedEmail || !password) {
      Alert.alert('Missing Fields', 'Please enter your email and password.');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      Alert.alert('Invalid Email', 'Please enter a valid email address.');
      return;
    }
    if (password.length < 6) {
      Alert.alert('Password Too Short', 'Password must be at least 6 characters.');
      return;
    }
    setLoading(true);
    try {
      const data = await signUp(trimmedEmail, password);
      if (!data.session) {
        // Supabase email confirmation is enabled — session won't arrive until confirmed
        Alert.alert('Check Your Email', 'A confirmation link has been sent to ' + trimmedEmail + '. Please confirm your email to complete sign up.');
      }
      // If session exists, AuthGate in _layout.tsx handles navigation automatically
    } catch (e: any) {
      Alert.alert('Sign Up Failed', e.message ?? 'Please try again.');
    } finally {
      setLoading(false);
    }
  }

  async function handleSignIn() {
    const trimmedEmail = email.trim();
    if (!trimmedEmail || !password) {
      Alert.alert('Missing Fields', 'Please enter your email and password.');
      return;
    }
    setLoading(true);
    try {
      await signIn(trimmedEmail, password);
      // AuthGate in _layout.tsx handles navigation automatically
    } catch (e: any) {
      Alert.alert('Login Failed', 'Invalid email or password. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  async function handleSocialLogin(fn: () => Promise<void>, label: string) {
    setLoading(true);
    try {
      await fn();
      // AuthGate in _layout.tsx handles navigation automatically
    } catch (e: any) {
      Alert.alert(`${label} Sign-In Failed`, e.message ?? 'Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Logo */}
        <View style={styles.logoArea}>
          <Image
            source={require('../../assets/icon.png')}
            style={styles.logoImage}
          />
          <Text style={styles.appName}>Music-To-Sheet</Text>
          <Text style={styles.tagline}>Audio to Sheet Music, Instantly</Text>
        </View>

        {/* Email */}
        <TextInput
          style={styles.input}
          placeholder="Email address"
          placeholderTextColor="#6B7280"
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          value={email}
          onChangeText={(t) => { setEmail(t); clearError(); }}
          editable={!loading}
        />

        {/* Password */}
        <TextInput
          style={styles.input}
          placeholder="Password"
          placeholderTextColor="#6B7280"
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
          value={password}
          onChangeText={(t) => { setPassword(t); clearError(); }}
          editable={!loading}
        />

        {/* Forgot Password */}
        <TouchableOpacity
          style={styles.forgotWrap}
          onPress={() => console.log('Forgot Password pressed')}
          disabled={loading}
        >
          <Text style={styles.forgotText}>Forgot Password?</Text>
        </TouchableOpacity>

        {/* Sign Up + Log In side by side */}
        <View style={styles.btnRow}>
          <TouchableOpacity
            style={[styles.btnPrimary, styles.btnHalf, loading && styles.btnDisabled]}
            onPress={handleSignUp}
            activeOpacity={0.85}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="#FFFFFF" size="small" />
            ) : (
              <Text style={styles.btnPrimaryText}>Sign Up</Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.btnOutline, styles.btnHalf, loading && styles.btnDisabled]}
            onPress={handleSignIn}
            activeOpacity={0.85}
            disabled={loading}
          >
            <Text style={styles.btnOutlineText}>Log In</Text>
          </TouchableOpacity>
        </View>

        {/* Divider */}
        <View style={styles.dividerRow}>
          <View style={styles.dividerLine} />
          <Text style={styles.dividerText}>OR</Text>
          <View style={styles.dividerLine} />
        </View>

        {/* Social Login Buttons */}
        <SocialButton
          icon={<AntDesign name="google" size={20} color="#4285F4" />}
          label="Continue with Google"
          buttonStyle={styles.btnGoogle}
          textStyle={styles.btnGoogleText}
          onPress={() => handleSocialLogin(signInWithGoogle, 'Google')}
          disabled={loading}
        />
        <SocialButton
          icon={<Ionicons name="logo-apple" size={20} color="#6B7280" />}
          label="Continue with Apple (Coming Soon)"
          buttonStyle={styles.btnApple}
          textStyle={styles.btnAppleComingSoon}
          onPress={() => {}}
          disabled={true}
        />
        <SocialButton
          icon={<FontAwesome name="windows" size={20} color="#FFFFFF" />}
          label="Continue with Microsoft"
          buttonStyle={styles.btnMicrosoft}
          textStyle={styles.btnMicrosoftText}
          onPress={() => handleSocialLogin(signInWithMicrosoft, 'Microsoft')}
          disabled={loading}
        />

        {/* Get Started without account */}
        <View style={styles.guestSeparator}>
          <View style={styles.guestLine} />
        </View>
        <TouchableOpacity
          style={styles.guestBtn}
          onPress={() => { enterGuestMode(); router.replace('/upload'); }}
          activeOpacity={0.7}
          disabled={loading}
        >
          <Text style={styles.guestBtnText}>Get Started (No Signup Required)</Text>
          <Text style={styles.guestBtnSub}>60 sec limit · watermarked results</Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#111118',
  },
  scroll: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingTop: 80,
    paddingBottom: 20,
  },

  // Logo
  logoArea: {
    alignItems: 'center',
    marginBottom: 32,
  },
  logoImage: {
    width: 96,
    height: 96,
    borderRadius: 22,
    marginBottom: 16,
  },
  appName: {
    color: '#0EA5E9',
    fontSize: 28,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  tagline: {
    color: '#6B7280',
    fontSize: 14,
    marginTop: 6,
    letterSpacing: 0.3,
  },

  // Inputs
  input: {
    backgroundColor: '#1C1C27',
    borderWidth: 1,
    borderColor: '#2D2D3E',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    color: '#FFFFFF',
    fontSize: 15,
    marginBottom: 12,
  },

  // Forgot password
  forgotWrap: {
    alignSelf: 'flex-end',
    marginBottom: 12,
  },
  forgotText: {
    color: '#0EA5E9',
    fontSize: 13,
  },

  // Error
  errorText: {
    color: '#EF4444',
    fontSize: 13,
    marginBottom: 12,
    textAlign: 'center',
  },

  // Primary button (Sign Up)
  btnPrimary: {
    backgroundColor: '#0EA5E9',
    borderRadius: 12,
    paddingVertical: 15,
    alignItems: 'center',
  },
  btnPrimaryText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },

  // Row wrapper for side-by-side buttons
  btnRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 24,
  },
  btnHalf: {
    flex: 1,
  },

  // Outline button (Log In)
  btnOutline: {
    borderWidth: 1.5,
    borderColor: '#0EA5E9',
    borderRadius: 12,
    paddingVertical: 15,
    alignItems: 'center',
  },
  btnOutlineText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },

  // Disabled state
  btnDisabled: {
    opacity: 0.5,
  },

  // Divider
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 24,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: '#2D2D3E',
  },
  dividerText: {
    color: '#6B7280',
    fontSize: 13,
    marginHorizontal: 12,
  },

  // Social buttons — shared
  socialBtn: {
    borderRadius: 12,
    paddingVertical: 15,
    paddingHorizontal: 20,
    marginBottom: 12,
  },
  socialBtnInner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  socialIconWrap: {
    width: 20,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  socialBtnText: {
    fontSize: 15,
    fontWeight: '600',
  },

  // Google
  btnGoogle: {
    backgroundColor: '#FFFFFF',
  },
  btnGoogleText: {
    color: '#111118',
  },

  // Apple
  btnApple: {
    backgroundColor: '#000000',
    borderWidth: 1,
    borderColor: '#2D2D3E',
  },
  btnAppleText: {
    color: '#FFFFFF',
  },
  btnAppleComingSoon: {
    color: '#4B5563',
  },

  // Microsoft
  btnMicrosoft: {
    backgroundColor: '#0078D4',
    marginBottom: 0,
  },
  btnMicrosoftText: {
    color: '#FFFFFF',
  },

  // Guest / no-signup
  guestSeparator: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 20,
    marginBottom: 4,
  },
  guestLine: {
    flex: 1,
    height: 1,
    backgroundColor: '#1C1C27',
  },
  guestBtn: {
    alignItems: 'center',
    paddingVertical: 12,
  },
  guestBtnText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '500',
    textDecorationLine: 'underline',
    textDecorationColor: '#4B5563',
    marginBottom: 4,
  },
  guestBtnSub: {
    color: '#4B5563',
    fontSize: 11,
    letterSpacing: 0.2,
  },
});
