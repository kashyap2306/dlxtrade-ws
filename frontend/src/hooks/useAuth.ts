import { useState, useEffect } from 'react';
import { onAuthStateChanged, signOut, User } from 'firebase/auth';
import { auth } from '../config/firebase';

export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        const token = await firebaseUser.getIdToken();
        localStorage.setItem('firebaseToken', token);
        localStorage.setItem('firebaseUser', JSON.stringify({
          uid: firebaseUser.uid,
          email: firebaseUser.email,
        }));
        setUser(firebaseUser);
      } else {
        localStorage.removeItem('firebaseToken');
        localStorage.removeItem('firebaseUser');
        setUser(null);
      }
      setLoading(false);
    });

    // Refresh token periodically
    const tokenRefreshInterval = setInterval(async () => {
      if (auth.currentUser) {
        const token = await auth.currentUser.getIdToken(true);
        localStorage.setItem('firebaseToken', token);
      }
    }, 55 * 60 * 1000); // Refresh every 55 minutes (tokens expire in 1 hour)

    return () => {
      unsubscribe();
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

