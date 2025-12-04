import { useState, useEffect } from 'react';
import { onAuthStateChanged, signOut, User } from 'firebase/auth';
import { auth } from '../config/firebase';

export function useAuth() {
  // Initialize with current Firebase user if available
  const [user, setUser] = useState<User | null>(() => auth.currentUser);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Add timeout to prevent infinite loading if Firebase auth hangs
    const authTimeout = setTimeout(() => {
      console.log('[useAuth] Forcing auth loading completion after timeout');
      setLoading(false);
    }, 10000); // 10 seconds timeout

    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      clearTimeout(authTimeout); // Clear timeout if auth resolves normally
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
          // Don't clear on initial load if token exists
          const token = localStorage.getItem('firebaseToken');
          if (!token) {
            localStorage.removeItem('firebaseToken');
            localStorage.removeItem('firebaseUser');
            setUser(null);
          }
        }
      } catch (error) {
        console.error('Error in auth state change:', error);
        // On error, clear auth state to prevent infinite loading
        localStorage.removeItem('firebaseToken');
        localStorage.removeItem('firebaseUser');
        setUser(null);
      } finally {
        setLoading(false);
      }
    });

    // Refresh token periodically
    const tokenRefreshInterval = setInterval(async () => {
      try {
        if (auth.currentUser) {
          const token = await auth.currentUser.getIdToken(true);
          localStorage.setItem('firebaseToken', token);
        }
      } catch (error) {
        console.error('Error refreshing token:', error);
      }
    }, 55 * 60 * 1000); // Refresh every 55 minutes (tokens expire in 1 hour)

    return () => {
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

  return { user, loading, logout };
}

