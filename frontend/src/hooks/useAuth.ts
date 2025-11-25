import { useState, useEffect } from 'react';
import { onAuthStateChanged, signOut, User } from 'firebase/auth';
import { auth } from '../config/firebase';

type AuthState = 'loading' | 'loggedIn' | 'loggedOut';

export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [authState, setAuthState] = useState<AuthState>('loading');

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        try {
          // User is authenticated - get fresh token and store
          const token = await firebaseUser.getIdToken();
          localStorage.setItem('firebaseToken', token);
          localStorage.setItem('firebaseUser', JSON.stringify({
            uid: firebaseUser.uid,
            email: firebaseUser.email,
          }));
          setUser(firebaseUser);
          setAuthState('loggedIn');
        } catch (error) {
          // Token refresh failed - treat as logged out
          console.error('Token refresh failed:', error);
          localStorage.removeItem('firebaseToken');
          localStorage.removeItem('firebaseUser');
          setUser(null);
          setAuthState('loggedOut');
        }
      } else {
        // No Firebase user - check for stored token
        const storedToken = localStorage.getItem('firebaseToken');
        const storedUser = localStorage.getItem('firebaseUser');

        if (storedToken && storedUser) {
          // We have stored credentials - try to restore user
          try {
            const userData = JSON.parse(storedUser);
            // For now, assume token is valid if it exists
            // In production, you might want to validate the token
            setUser({ uid: userData.uid, email: userData.email } as User);
            setAuthState('loggedIn');
          } catch (error) {
            // Invalid stored data - clear and logout
            localStorage.removeItem('firebaseToken');
            localStorage.removeItem('firebaseUser');
            setUser(null);
            setAuthState('loggedOut');
          }
        } else {
          // No stored credentials - logged out
          setUser(null);
          setAuthState('loggedOut');
        }
      }
    });

    // Refresh token periodically
    const tokenRefreshInterval = setInterval(async () => {
      if (auth.currentUser && authState === 'loggedIn') {
        try {
          const token = await auth.currentUser.getIdToken(true);
          localStorage.setItem('firebaseToken', token);
        } catch (error) {
          console.error('Token refresh failed:', error);
          // Don't change auth state here - let Firebase handle it
        }
      }
    }, 55 * 60 * 1000); // Refresh every 55 minutes

    return () => {
      unsubscribe();
      clearInterval(tokenRefreshInterval);
    };
  }, [authState]);

  const logout = async () => {
    try {
      await signOut(auth);
      localStorage.removeItem('firebaseToken');
      localStorage.removeItem('firebaseUser');
      setUser(null);
      setAuthState('loggedOut');
      window.location.href = '/';
    } catch (error) {
      console.error('Error signing out:', error);
    }
  };

  return { user, authState, logout };
}

