import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { db, auth } from '../config/firebase';
import { doc, getDoc } from 'firebase/firestore';
import TopNavigation from './TopNavigation';
import { useAuth } from '../hooks/useAuth';

export default function UserRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const [render, setRender] = useState<JSX.Element | null>(null);

  useEffect(() => {
    const run = async () => {
      // Check if we have a token in localStorage (optimistic check)
      const token = localStorage.getItem('firebaseToken');
      const hasToken = !!token;
      
      // Show loading while checking auth state
      if (loading) {
        setRender(
          <div className="min-h-screen flex items-center justify-center">
            <div className="text-lg">Loading...</div>
          </div>
        );
        return;
      }

      // Check authentication: user OR token in localStorage
      const isAuthenticated = user || (hasToken && auth.currentUser);
      
      if (!isAuthenticated) {
        setRender(<Navigate to="/login" replace />);
        return;
      }

      // If we have user, check for admin/onboarding
      if (user) {
        try {
          const snap = await getDoc(doc(db, 'users', user.uid));
          const data: any = (snap.exists() && snap.data()) || {};
          
          // If admin, redirect to admin
          if (data.role === 'admin' || data.isAdmin === true) {
            setRender(<Navigate to="/admin" replace />);
            return;
          }
          
          // If onboarding required, redirect to onboarding
          if (data.onboardingRequired === true) {
            setRender(<Navigate to="/onboarding" replace />);
            return;
          }
        } catch {}
      }

      // Render protected content
      setRender(
        <>
          <TopNavigation />
          {children}
        </>
      );
    };

    run();
  }, [loading, user]);

  return render;
}

