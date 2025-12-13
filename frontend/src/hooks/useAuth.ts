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
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    console.log('[useAuth] Setting up Firebase auth state listener');

    // Check if Firebase is available before setting up listener
    if (!auth) {
      console.error('[useAuth] ❌ CRITICAL: Firebase auth not available, cannot proceed');
      setLoading(false);
      return;
    }

    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      console.log("[AUTH EVENT REAL]", firebaseUser?.uid);
      console.log('[AUTH EVENT] firebaseUid=', firebaseUser?.uid);
      console.log('[useAuth] Auth state changed:', {
        hasUser: !!firebaseUser,
        userEmail: firebaseUser?.email,
        uid: firebaseUser?.uid
      });

      try {
        if (firebaseUser) {
          // Get fresh token
          const token = await firebaseUser.getIdToken();

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

          console.log('[useAuth] ✅ User authenticated:', cleanUser.email);
          console.log("[AUTH-READY] firebaseUid=", cleanUser.uid);

          setUser(cleanUser);
          console.log("[useAuth] Auth processing complete, setting loading=false");
          setLoading(false);
        } else {
          // No user - clear everything
          console.log('[useAuth] ℹ️ No authenticated user');
          setUser(null);
          localStorage.removeItem('firebaseToken');
          // Do NOT resolve loading until a real uid arrives
          return;
        }
      } catch (error) {
        console.error('[useAuth] ❌ Error in auth state change:', error);
        setUser(null);
        localStorage.removeItem('firebaseToken');
        return;
      } finally {
        // loading is set false only when we have a real uid
      }
    });

    console.log('[useAuth] ✅ Auth listener setup complete');

    return () => {
      console.log('[useAuth] Cleaning up auth listener');
      try {
        unsubscribe();
      } catch (error) {
        console.error('Error unsubscribing from auth:', error);
      }
    };
  }, []);

  const logout = async () => {
    try {
      console.log('[useAuth] Logging out user...');
      await signOut(auth);
      console.log('[useAuth] Sign out successful, clearing local storage and redirecting');
    } catch (error) {
      console.error('[useAuth] Error signing out:', error);
      // Even if signOut fails, we should clear local state
    } finally {
      // Always clear local storage and redirect, regardless of signOut success
      localStorage.removeItem('firebaseToken');
      localStorage.removeItem('firebaseUser');
      window.location.href = '/login';
    }
  };

  return { user, loading, logout, handleLogout: logout };
}

