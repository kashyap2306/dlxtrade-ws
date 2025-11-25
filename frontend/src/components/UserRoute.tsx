import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { db } from '../config/firebase';
import { doc, getDoc } from 'firebase/firestore';
import TopNavigation from './TopNavigation';
import { useAuth } from '../hooks/useAuth';

export default function UserRoute({ children }: { children: React.ReactNode }) {
  const { user, authState } = useAuth();
  const [render, setRender] = useState<JSX.Element | null>(null);

  useEffect(() => {
    const run = async () => {
      // Show loading while checking auth state
      if (authState === 'loading') {
        setRender(
          <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-[#0a0f1c] via-[#101726] to-[#0a0f1c]">
            <div className="text-center">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-400 mx-auto mb-4"></div>
              <div className="text-lg text-gray-300">Loading...</div>
            </div>
          </div>
        );
        return;
      }

      // Not logged in
      if (authState === 'loggedOut') {
        setRender(<Navigate to="/login" replace />);
        return;
      }

      // User is logged in - check for admin/onboarding redirects
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
        } catch (error) {
          console.error('Error checking user data:', error);
        }
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
  }, [authState, user, children]);

  return render;
}

