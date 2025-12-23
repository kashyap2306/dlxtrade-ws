import { useState, useEffect } from 'react';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { auth } from '../config/firebase';

interface CleanUser {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
  metadata: {
    creationTime: string | null;
    lastLoginTime: string | null;
  };
}

export function useAuth() {
  const [user, setUser] = useState<CleanUser | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authReady, setAuthReady] = useState(false);

  useEffect(() => {
    console.log('[useAuth] Setting up Firebase auth state listener');

    // Check if Firebase is available before setting up listener
    if (!auth) {
      console.error('[useAuth] ❌ CRITICAL: Firebase auth not available');
      setAuthLoading(false);
      setAuthReady(true);
      return;
    }

    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      console.log('[AUTH_EVENT] firebaseUid=', firebaseUser?.uid || 'NONE');

      try {
        if (firebaseUser) {
          // Get fresh token
          const token = await firebaseUser.getIdToken();
          console.log('[useAuth] 🔑 Token fetched successfully');

          // Create clean user object with proper metadata structure
          const cleanUser: CleanUser = {
            uid: firebaseUser.uid,
            email: firebaseUser.email,
            displayName: firebaseUser.displayName,
            photoURL: firebaseUser.photoURL,
            metadata: {
              creationTime: firebaseUser.metadata?.creationTime || null,
              lastLoginTime: firebaseUser.metadata?.lastSignInTime || null
            }
          };

          setUser(cleanUser);
          console.log('[useAuth] ✅ User set, authReady=true');
        } else {
          console.log('[useAuth] ℹ️ No authenticated user');
          setUser(null);
          localStorage.removeItem('firebaseToken');
        }
      } catch (error) {
        console.error('[useAuth] ❌ Error in auth state change:', error);
        setUser(null);
      } finally {
        setAuthLoading(false);
        setAuthReady(true);
        console.log('[useAuth] 🏁 Auth resolution complete: authReady=true, authLoading=false');
      }
    });

    return () => {
      unsubscribe();
    };
  }, []);

  const logout = async () => {
    try {
      console.log('[useAuth] Logging out user...');
      await signOut(auth);
    } catch (error) {
      console.error('[useAuth] Error signing out:', error);
    } finally {
      localStorage.removeItem('firebaseToken');
      localStorage.removeItem('firebaseUser');
      window.location.href = '/login';
    }
  };

  return {
    user,
    loading: authLoading,
    authLoading,
    authReady,
    logout,
    handleLogout: logout
  };
}

