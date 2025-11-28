import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { auth, db } from '../config/firebase';
import { doc, getDoc } from 'firebase/firestore';
import AdminLayout from './AdminLayout';
import { useAuth } from '../hooks/useAuth';

export default function AdminRoute({ children }: { children: React.ReactNode }) {
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

      // Firestore root-only check
      try {
        const docRef = doc(db, 'users', user.uid);
        const snap = await getDoc(docRef);
        const data: any = (snap.exists() && snap.data()) || {};
        if (data.isAdmin === true || data.role === 'admin') {
          setRender(<AdminLayout>{children}</AdminLayout>);
          return;
        }
      } catch {}

      // Final fallback → Access Denied
      setRender(<Navigate to="/login" replace />);
    };

    run();
  }, [loading]);

  return render;
}

