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
  const { signUp, signIn, signInWithGoogle, signInWithApple, signInWithMicrosoft } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  function clearError() {
    if (error) setError('');
  }

  async function handleSignUp() {
    if (!email || !password) { setError('Please enter your email and password.'); return; }
    setLoading(true);
    setError('');
    try {
      const data = await signUp(email, password);
      console.log("SIGNUP SUCCESS - session:", data.session?.user?.email);
      // Navigation handled by AuthGate in _layout.tsx once onAuthStateChange fires
    } catch (e: any) {
      setError(e.message ?? 'Sign up failed. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  async function handleSignIn() {
    if (!email || !password) { setError('Please enter your email and password.'); return; }
    setLoading(true);
    setError('');
    try {
      const data = await signIn(email, password);
      console.log("LOGIN SUCCESS - session:", data.session?.user?.email);
      // Navigation handled by AuthGate in _layout.tsx once onAuthStateChange fires
    } catch (e: any) {
      setError(e.message ?? 'Login failed. Please check your credentials.');
    } finally {
      setLoading(false);
    }
  }

  async function handleSocialLogin(fn: () => Promise<void>, label: string) {
    setLoading(true);
    setError('');
    try {
      await fn();
      // Navigation handled by AuthGate in _layout.tsx once onAuthStateChange fires
    } catch (e: any) {
      setError(e.message ?? `${label} sign-in failed. Please try again.`);
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
          {/* Icon placeholder — swap require('../../assets/icon.png') once file is added */}
          <View style={styles.logoImage}>
            <Ionicons name="musical-notes" size={48} color="#FFFFFF" />
          </View>
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

        {/* Error message */}
        {error ? <Text style={styles.errorText}>{error}</Text> : null}

        {/* Sign Up */}
        <TouchableOpacity
          style={[styles.btnPrimary, loading && styles.btnDisabled]}
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

        {/* Log In */}
        <TouchableOpacity
          style={[styles.btnOutline, loading && styles.btnDisabled]}
          onPress={handleSignIn}
          activeOpacity={0.85}
          disabled={loading}
        >
          <Text style={styles.btnOutlineText}>Log In</Text>
        </TouchableOpacity>

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
          icon={<Ionicons name="logo-apple" size={20} color="#FFFFFF" />}
          label="Continue with Apple"
          buttonStyle={styles.btnApple}
          textStyle={styles.btnAppleText}
          onPress={() => handleSocialLogin(signInWithApple, 'Apple')}
          disabled={loading}
        />
        <SocialButton
          icon={<FontAwesome name="windows" size={20} color="#FFFFFF" />}
          label="Continue with Microsoft"
          buttonStyle={styles.btnMicrosoft}
          textStyle={styles.btnMicrosoftText}
          onPress={() => handleSocialLogin(signInWithMicrosoft, 'Microsoft')}
          disabled={loading}
        />
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
    paddingTop: 64,
    paddingBottom: 40,
  },

  // Logo
  logoArea: {
    alignItems: 'center',
    marginBottom: 40,
  },
  logoImage: {
    width: 96,
    height: 96,
    borderRadius: 22,
    backgroundColor: '#0EA5E9',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  appName: {
    color: '#FFFFFF',
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
    marginBottom: 12,
  },
  btnPrimaryText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },

  // Outline button (Log In)
  btnOutline: {
    borderWidth: 1.5,
    borderColor: '#0EA5E9',
    borderRadius: 12,
    paddingVertical: 15,
    alignItems: 'center',
    marginBottom: 24,
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

  // Microsoft
  btnMicrosoft: {
    backgroundColor: '#0078D4',
    marginBottom: 0,
  },
  btnMicrosoftText: {
    color: '#FFFFFF',
  },
});
