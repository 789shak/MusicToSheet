import { Session, User } from '@supabase/supabase-js';
import React from 'react';

export interface AuthContextValue {
  user: User | null;
  session: Session | null;
  loading: boolean;
  isGuest: boolean;
  enterGuestMode: () => void;
  signUp: (email: string, password: string) => Promise<any>;
  signIn: (email: string, password: string) => Promise<any>;
  signOut: () => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  signInWithApple: () => Promise<void>;
  signInWithMicrosoft: () => Promise<void>;
}

export function AuthProvider(props: { children: React.ReactNode }): JSX.Element;
export function useAuth(): AuthContextValue;
