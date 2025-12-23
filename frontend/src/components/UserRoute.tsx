import { Navigate } from 'react-router-dom';
import TopNavigation from './TopNavigation';
import { useAuth } from '../hooks/useAuth';

export default function UserRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();

  // Show loading screen when auth is loading
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

  // If no user, redirect to login
  if (!user) {
    return <Navigate to="/login" replace />;
  }

  // User is authenticated, render protected content
  return (
    <>
      <TopNavigation />
      {children}
    </>
  );
}

