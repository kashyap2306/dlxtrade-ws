import { useState, useEffect } from 'react';
import { onAuthStateChanged, signOut, User } from 'firebase/auth';
import { auth } from '../config/firebase';

export function useAuth() {
  // Initialize with current Firebase user if available
  const [user, setUser] = useState<User | null>(() => auth.currentUser);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    console.log('[useAuth] Setting up auth state listener');

    // Emergency fallback: force loading=false after 1 second to prevent infinite loading
    const forceLoadingTimeout = setTimeout(() => {
      setLoading(false);
    }, 1000);

    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      clearTimeout(forceLoadingTimeout); // Clear emergency timeout

      try {
        if (firebaseUser) {
          const token = await firebaseUser.getIdToken();
          localStorage.setItem('firebaseToken', token);
          localStorage.setItem('firebaseUser', JSON.stringify({
            uid: firebaseUser.uid,
            email: firebaseUser.email,
          }));
          setUser(firebaseUser);
        } else {
          // Only clear if we're sure there's no user
          const token = localStorage.getItem('firebaseToken');
          if (!token) {
            localStorage.removeItem('firebaseToken');
            localStorage.removeItem('firebaseUser');
            setUser(null);
          }
        }
      } catch (error) {
        console.error('Auth state change error:', error);
        localStorage.removeItem('firebaseToken');
        localStorage.removeItem('firebaseUser');
        setUser(null);
      } finally {
        setLoading(false);
      }
    });

    // Refresh token periodically - Firebase handles this automatically, but we'll do it less frequently
    const tokenRefreshInterval = setInterval(async () => {
      try {
        if (auth.currentUser && !loading) { // Only refresh if not currently loading
          console.log('[useAuth] Refreshing token periodically');
          const token = await auth.currentUser.getIdToken(true);
          localStorage.setItem('firebaseToken', token);
        }
      } catch (error) {
        console.error('Error refreshing token:', error);
      }
    }, 50 * 60 * 1000); // Refresh every 50 minutes

    console.log('[useAuth] Auth listener setup complete');

    return () => {
      console.log('[useAuth] Cleaning up auth listener');
      clearTimeout(forceLoadingTimeout);
      try {
        unsubscribe();
      } catch (error) {
        console.error('Error unsubscribing from auth:', error);
      }
      clearInterval(tokenRefreshInterval);
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

