import React, { createContext, useContext, useEffect, useState } from 'react';
import {
  User,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut as fbSignOut,
  sendPasswordResetEmail,
  updateProfile,
} from 'firebase/auth';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { auth, db } from '../lib/firebase';

export interface UserProfile {
  userId: string;
  fullName: string;
  email: string;
  role?: 'admin' | 'operator';
  createdAt?: string;
  updatedAt?: string;
}

interface AuthContextType {
  user: User | null;
  profile: UserProfile | null;
  loading: boolean;
  authError: string | null;
  signIn: (email: string, pass: string) => Promise<void>;
  signOut: () => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  provisionAccount: (fullName: string, email: string, pass: string, adminSecret: string) => Promise<void>;
  clearError: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [authError, setAuthError] = useState<string | null>(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      if (currentUser) {
        try {
          const userDocRef = doc(db, 'users', currentUser.uid);
          const docSnap = await getDoc(userDocRef);
          if (docSnap.exists()) {
            setProfile(docSnap.data() as UserProfile);
          } else {
            const fallbackProfile: UserProfile = {
              userId: currentUser.uid,
              fullName: currentUser.displayName || currentUser.email?.split('@')[0] || 'Operator',
              email: currentUser.email || '',
              role: 'operator',
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            };
            setProfile(fallbackProfile);
          }
        } catch (err) {
          console.warn('[AuthContext] Firestore profile fetch skipped:', err);
          setProfile({
            userId: currentUser.uid,
            fullName: currentUser.displayName || currentUser.email?.split('@')[0] || 'Operator',
            email: currentUser.email || '',
            role: 'operator',
          });
        }
      } else {
        setProfile(null);
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const clearError = () => setAuthError(null);

  const getFriendlyAuthError = (code?: string, defaultMsg?: string) => {
    switch (code) {
      case 'auth/invalid-credential':
      case 'auth/user-not-found':
      case 'auth/wrong-password':
        return 'Invalid email or password. Please verify your credentials.';
      case 'auth/email-already-in-use':
        return 'An account with this email address already exists in the system.';
      case 'auth/weak-password':
        return 'Password should be at least 6 characters.';
      case 'auth/invalid-email':
        return 'Please enter a valid work email address.';
      case 'auth/network-request-failed':
        return 'Network connection error. Check your connection to Firebase.';
      case 'auth/too-many-requests':
        return 'Too many failed login attempts. Please wait a few moments and try again.';
      default:
        return defaultMsg || 'Authentication failed. Please try again.';
    }
  };

  const signIn = async (email: string, pass: string) => {
    setAuthError(null);
    try {
      await signInWithEmailAndPassword(auth, email.trim(), pass);
    } catch (err: any) {
      const msg = getFriendlyAuthError(err.code, err.message);
      setAuthError(msg);
      throw new Error(msg);
    }
  };

  const signOut = async () => {
    setAuthError(null);
    try {
      await fbSignOut(auth);
    } catch (err: any) {
      setAuthError('Failed to sign out. Please try again.');
    }
  };

  const resetPassword = async (email: string) => {
    setAuthError(null);
    try {
      await sendPasswordResetEmail(auth, email.trim());
    } catch (err: any) {
      const msg = getFriendlyAuthError(err.code, err.message);
      setAuthError(msg);
      throw new Error(msg);
    }
  };

  /**
   * Secure Account Provisioning
   * Requires validation of administrator secret key against the server
   */
  const provisionAccount = async (fullName: string, email: string, pass: string, adminSecret: string) => {
    setAuthError(null);

    // 1. Verify admin setup secret on server
    const verifyRes = await fetch('/api/auth/verify-admin-secret', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret: adminSecret }),
    });

    if (!verifyRes.ok) {
      const errData = await verifyRes.json().catch(() => ({}));
      const msg = errData.error || 'Administrator verification failed. Unauthorized account creation.';
      setAuthError(msg);
      throw new Error(msg);
    }

    // 2. Create the authorized user account in Firebase
    try {
      const userCred = await createUserWithEmailAndPassword(auth, email.trim(), pass);
      const trimmedName = fullName.trim();
      await updateProfile(userCred.user, { displayName: trimmedName });

      const newProfile: UserProfile = {
        userId: userCred.user.uid,
        fullName: trimmedName,
        email: email.trim().toLowerCase(),
        role: 'operator',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      try {
        await setDoc(doc(db, 'users', userCred.user.uid), newProfile);
        setProfile(newProfile);
      } catch (docErr) {
        console.warn('[AuthContext] Firestore write skipped:', docErr);
      }
    } catch (err: any) {
      const msg = getFriendlyAuthError(err.code, err.message);
      setAuthError(msg);
      throw new Error(msg);
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        profile,
        loading,
        authError,
        signIn,
        signOut,
        resetPassword,
        provisionAccount,
        clearError,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
