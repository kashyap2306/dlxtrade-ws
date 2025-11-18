import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { auth, db } from '../config/firebase';
import { doc, getDoc } from 'firebase/firestore';
import TopNavigation from './TopNavigation';
import { useAuth } from '../hooks/useAuth';

export default function UserRoute({ children }: { children: React.ReactNode }) {
  const { loading } = useAuth();
  const [render, setRender] = useState<JSX.Element | null>(null);

  useEffect(() => {
    const run = async () => {
      if (loading) {
        setRender(
          <div className="min-h-screen flex items-center justify-center">
            <div className="text-lg">Loading...</div>
          </div>
        );
        return;
      }

      const user = auth.currentUser;
      if (!user) {
        setRender(<Navigate to="/login" replace />);
        return;
      }

      // If admin, redirect to admin
      try {
        const snap = await getDoc(doc(db, 'users', user.uid));
        const data: any = (snap.exists() && snap.data()) || {};
        if (data.role === 'admin' || data.isAdmin === true) {
          setRender(<Navigate to="/admin" replace />);
          return;
        }
      } catch {}

      setRender(
        <>
          <TopNavigation />
          {children}
        </>
      );
    };

    run();
  }, [loading, children]);

  return render;
}

