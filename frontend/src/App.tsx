import { Routes, Route, Navigate } from 'react-router-dom';
import Login from './pages/Login';
import Signup from './pages/Signup';
import Dashboard from './pages/Dashboard';
import EngineControl from './pages/EngineControl';
import ResearchPanel from './pages/ResearchPanel';
import Settings from './pages/Settings';
import ExecutionLogs from './pages/ExecutionLogs';
import APIIntegrations from './pages/APIIntegrations';
import Profile from './pages/Profile';
import HFTSettings from './pages/HFTSettings';
import HFTLogs from './pages/HFTLogs';
import AdminDashboard from './pages/AdminDashboard';
import AdminUsersList from './pages/AdminUsersList';
import AdminUserDetail from './pages/AdminUserDetail';
import AdminAgentsManager from './pages/AdminAgentsManager';
import AdminLogin from './pages/AdminLogin';
import AgentsMarketplace from './pages/AgentsMarketplace';
import AgentCheckout from './pages/AgentCheckout';
import TopNavigation from './components/TopNavigation';
import { wsService } from './services/ws';
import { useAuth } from './hooks/useAuth';
import { useEffect, useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from './config/firebase';

function PrivateRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-lg">Loading...</div>
      </div>
    );
  }

  return user ? (
    <>
      <TopNavigation />
      {children}
    </>
  ) : <Navigate to="/login" />;
}

function AdminRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    const checkAdmin = async () => {
      if (!user) {
        setIsAdmin(false);
        setChecking(false);
        return;
      }

      try {
        const userDoc = await getDoc(doc(db, 'users', user.uid));
        if (userDoc.exists()) {
          const userData = userDoc.data();
          const profile = userData?.profile || {};
          setIsAdmin(profile.role === 'admin');
        } else {
          setIsAdmin(false);
        }
      } catch (error) {
        console.error('Error checking admin role:', error);
        setIsAdmin(false);
      } finally {
        setChecking(false);
      }
    };

    if (!loading) {
      checkAdmin();
    }
  }, [user, loading]);

  if (loading || checking) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-lg">Loading...</div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" />;
  }

  if (!isAdmin) {
    return <Navigate to="/admin-login" />;
  }

  return (
    <>
      <TopNavigation />
      {children}
    </>
  );
}

function App() {
  const { user } = useAuth();

  useEffect(() => {
    if (user) {
      wsService.connect();
    }

    return () => {
      wsService.disconnect();
    };
  }, [user]);

  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/signup" element={<Signup />} />
      <Route path="/admin-login" element={<AdminLogin />} />
      <Route
        path="/"
        element={
          <PrivateRoute>
            <Dashboard />
          </PrivateRoute>
        }
      />
      <Route
        path="/engine"
        element={
          <PrivateRoute>
            <EngineControl />
          </PrivateRoute>
        }
      />
      <Route
        path="/research"
        element={
          <PrivateRoute>
            <ResearchPanel />
          </PrivateRoute>
        }
      />
      <Route
        path="/settings"
        element={
          <PrivateRoute>
            <Settings />
          </PrivateRoute>
        }
      />
      <Route
        path="/execution"
        element={
          <PrivateRoute>
            <ExecutionLogs />
          </PrivateRoute>
        }
      />
      <Route
        path="/integrations"
        element={
          <PrivateRoute>
            <APIIntegrations />
          </PrivateRoute>
        }
      />
      <Route
        path="/profile"
        element={
          <PrivateRoute>
            <Profile />
          </PrivateRoute>
        }
      />
      <Route
        path="/agents"
        element={
          <PrivateRoute>
            <AgentsMarketplace />
          </PrivateRoute>
        }
      />
      <Route
        path="/checkout/:agentId"
        element={
          <PrivateRoute>
            <AgentCheckout />
          </PrivateRoute>
        }
      />
      <Route
        path="/hft/settings"
        element={
          <PrivateRoute>
            <HFTSettings />
          </PrivateRoute>
        }
      />
      <Route
        path="/hft/logs"
        element={
          <PrivateRoute>
            <HFTLogs />
          </PrivateRoute>
        }
      />
      {/* Admin Routes */}
      <Route
        path="/admin"
        element={
          <AdminRoute>
            <AdminDashboard />
          </AdminRoute>
        }
      />
      <Route
        path="/admin/users"
        element={
          <AdminRoute>
            <AdminUsersList />
          </AdminRoute>
        }
      />
      <Route
        path="/admin/user/:uid"
        element={
          <AdminRoute>
            <AdminUserDetail />
          </AdminRoute>
        }
      />
      <Route
        path="/admin/agents"
        element={
          <AdminRoute>
            <AdminAgentsManager />
          </AdminRoute>
        }
      />
    </Routes>
  );
}

export default App;

