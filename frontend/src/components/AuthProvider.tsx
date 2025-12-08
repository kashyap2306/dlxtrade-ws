import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { onAuthStateChanged, User, getIdToken } from 'firebase/auth';
import { auth } from '../config/firebase';
import { useNavigate } from 'react-router-dom';

interface AuthContextType {
  user: User | null;
  loading: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const useAuthContext = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuthContext must be used within an AuthProvider');
  }
  return context;
};

interface AuthProviderProps {
  children: ReactNode;
}

export const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    console.log('[AuthProvider] Setting up Firebase auth state listener');

    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      console.log('[AuthProvider] Auth state changed:', {
        hasUser: !!firebaseUser,
        userEmail: firebaseUser?.email,
        uid: firebaseUser?.uid
      });

      try {
        if (firebaseUser) {
          // Wait for idToken to be available
          console.log('[AuthProvider] Getting idToken...');
          const token = await getIdToken(firebaseUser, true); // Force refresh to ensure validity
          console.log('[AuthProvider] idToken obtained, length:', token?.length || 0);

          setUser(firebaseUser);

          // Store in localStorage for persistence
          localStorage.setItem('firebaseToken', token);
          localStorage.setItem('firebaseUser', JSON.stringify({
            uid: firebaseUser.uid,
            email: firebaseUser.email,
          }));

        } else {
          // No user - clear everything and redirect
          console.log('[AuthProvider] No user - clearing auth state and redirecting to login');
          setUser(null);

          localStorage.removeItem('firebaseToken');
          localStorage.removeItem('firebaseUser');

          // Redirect to login if we're not already there
          if (window.location.pathname !== '/login' && window.location.pathname !== '/signup') {
            navigate('/login', { replace: true });
          }
        }
      } catch (error) {
        console.error('[AuthProvider] Error in auth state change:', error);
        setUser(null);
        updateAxiosAuthState(null, null);
        localStorage.removeItem('firebaseToken');
        localStorage.removeItem('firebaseUser');
      } finally {
        setLoading(false);
      }
    });

    return () => {
      console.log('[AuthProvider] Cleaning up auth listener');
      unsubscribe();
    };
  }, [navigate]);

  // Global auth gate - only render children when auth is resolved
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-cyan-400 mx-auto mb-4"></div>
          <p className="text-cyan-400 text-lg font-medium">Authenticating...</p>
          <p className="text-slate-400 text-sm mt-2">Please wait while we verify your session</p>
        </div>
      </div>
    );
  }

  // If user is null after loading, don't render children (redirect handled above)
  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-cyan-400 mx-auto mb-4"></div>
          <p className="text-slate-400 text-lg font-medium">Redirecting to login...</p>
        </div>
      </div>
    );
  }

  // Auth resolved and user exists - provide context
  const value: AuthContextType = {
    user,
    loading: false,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};
