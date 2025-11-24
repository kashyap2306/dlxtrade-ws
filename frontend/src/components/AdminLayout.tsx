import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../config/firebase';
import { useEffect, useState } from 'react';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const { user } = useAuth();
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    const check = async () => {
      if (!user) {
        setIsAdmin(false);
        return;
      }
      try {
        const snap = await getDoc(doc(db, 'users', user.uid));
        const data: any = (snap.exists() && snap.data()) || {};
        setIsAdmin(data.role === 'admin' || data.isAdmin === true);
      } catch {
        setIsAdmin(false);
      }
    };
    check();
  }, [user]);

  if (!isAdmin) {
    return <div className="min-h-screen flex items-center justify-center">Loading...</div>;
  }

  const adminItems = [
    { path: '/admin', label: 'Dashboard' },
    { path: '/admin/users', label: 'Users' },
    { path: '/admin/agents', label: 'Agents' },
    { path: '/admin/settings', label: 'System Settings' },
    { path: '/admin/logs', label: 'Activity Logs' },
  ];

  const isActive = (p: string) => (p === '/admin' ? location.pathname === p : location.pathname.startsWith(p));

  return (
    <div className="min-h-screen bg-slate-900 text-gray-100">
      <div className="fixed top-0 left-0 right-0 bg-slate-900/95 border-b border-cyan-500/20 z-50">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
          <Link to="/admin" className="text-lg font-bold bg-gradient-to-r from-cyan-400 via-blue-400 to-purple-400 bg-clip-text text-transparent">
            DLXTRADE Admin
          </Link>
          <nav className="flex items-center space-x-3">
            {adminItems.map((item) => (
              <Link
                key={item.path}
                to={item.path}
                className={`px-3 py-2 rounded-md text-sm ${isActive(item.path) ? 'text-cyan-400 bg-cyan-500/10' : 'text-gray-400 hover:text-cyan-300 hover:bg-cyan-500/5'}`}
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
      </div>
      <div className="h-16" />
      <main className="max-w-7xl mx-auto p-4">{children}</main>
    </div>
  );
}

