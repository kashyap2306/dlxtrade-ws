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
    console.log('[useAuth] Setting up auth state listener');

    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
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

          console.log('[AUTH] Active user:', cleanUser);

          // Store in localStorage for persistence
          localStorage.setItem('firebaseToken', token);
          localStorage.setItem('firebaseUser', JSON.stringify({
            uid: cleanUser.uid,
            email: cleanUser.email,
            displayName: cleanUser.displayName,
            photoURL: cleanUser.photoURL,
          }));

          setUser(cleanUser);
        } else {
          // No user - clear everything
          console.log('[useAuth] No user - clearing auth state');
          setUser(null);
          localStorage.removeItem('firebaseToken');
          localStorage.removeItem('firebaseUser');
        }
      } catch (error) {
        console.error('[useAuth] Error in auth state change:', error);
        setUser(null);
        localStorage.removeItem('firebaseToken');
        localStorage.removeItem('firebaseUser');
      } finally {
        // Set loading to false ONLY after the first auth state is resolved
        setLoading(false);
      }
    });

    console.log('[useAuth] Auth listener setup complete');

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
      await signOut(auth);
      localStorage.removeItem('firebaseToken');
      localStorage.removeItem('firebaseUser');
      window.location.href = '/';
    } catch (error) {
      console.error('Error signing out:', error);
    }
  };

  return { user, loading, logout, handleLogout: logout };
}

