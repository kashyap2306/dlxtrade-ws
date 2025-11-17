import { Routes, Route, Navigate } from 'react-router-dom';
import Login from './pages/Login';
import Signup from './pages/Signup';
import Dashboard from './pages/Dashboard';
import Home from './pages/Home';
import EngineControl from './pages/EngineControl';
import ResearchPanel from './pages/ResearchPanel';
import Settings from './pages/Settings';
import ExecutionLogs from './pages/ExecutionLogs';
import Profile from './pages/Profile';
import HFTSettings from './pages/HFTSettings';
import HFTLogs from './pages/HFTLogs';
import AdminDashboard from './pages/AdminDashboard';
import AdminUsersList from './pages/AdminUsersList';
import AdminUserDetail from './pages/AdminUserDetail';
import AdminAgentsManager from './pages/AdminAgentsManager';
import AdminUnlockRequests from './pages/AdminUnlockRequests';
import AdminBroadcastPopup from './pages/AdminBroadcastPopup';
import AdminLogin from './pages/AdminLogin';
import AdminToken from './pages/AdminToken';
import AdminRoute from './components/AdminRoute';
import AgentsMarketplace from './pages/AgentsMarketplace';
import AgentDetails from './pages/AgentDetails';
import AgentFeature from './pages/AgentFeature';
import Onboarding from './pages/Onboarding';
import TopNavigation from './components/TopNavigation';
import UserRoute from './components/UserRoute';
import { ErrorProvider } from './contexts/ErrorContext';
import { NotificationProvider } from './contexts/NotificationContext';
import NotificationToast from './components/NotificationToast';
import BroadcastPopup from './components/BroadcastPopup';
import { wsService } from './services/ws';
import { useAuth } from './hooks/useAuth';
import { useEffect } from 'react';

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

// AdminRoute moved to components/AdminRoute with simplified logic

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
    <ErrorProvider>
      <NotificationProvider>
        <NotificationToast />
        <BroadcastPopup />
        <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/signup" element={<Signup />} />
      <Route path="/onboarding" element={<Onboarding />} />
      <Route path="/admin-login" element={<AdminLogin />} />
      <Route
        path="/"
        element={<Home />}
      />
      <Route
        path="/dashboard"
        element={
          <UserRoute>
            <Dashboard />
          </UserRoute>
        }
      />
      <Route
        path="/engine"
        element={
          <UserRoute>
            <EngineControl />
          </UserRoute>
        }
      />
      <Route
        path="/research"
        element={
          <UserRoute>
            <ResearchPanel />
          </UserRoute>
        }
      />
      <Route
        path="/settings"
        element={
          <UserRoute>
            <Settings />
          </UserRoute>
        }
      />
      <Route
        path="/execution"
        element={
          <UserRoute>
            <ExecutionLogs />
          </UserRoute>
        }
      />
      <Route
        path="/profile"
        element={
          <UserRoute>
            <Profile />
          </UserRoute>
        }
      />
      <Route
        path="/agents"
        element={
          <UserRoute>
            <AgentsMarketplace />
          </UserRoute>
        }
      />
      <Route
        path="/agents/:agentId"
        element={
          <UserRoute>
            <AgentDetails />
          </UserRoute>
        }
      />
      <Route
        path="/agent/:agentId"
        element={
          <UserRoute>
            <AgentFeature />
          </UserRoute>
        }
      />
      <Route
        path="/hft/settings"
        element={
          <UserRoute>
            <HFTSettings />
          </UserRoute>
        }
      />
      <Route
        path="/hft/logs"
        element={
          <UserRoute>
            <HFTLogs />
          </UserRoute>
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
      <Route
        path="/admin/unlock-requests"
        element={
          <AdminRoute>
            <AdminUnlockRequests />
          </AdminRoute>
        }
      />
      <Route
        path="/admin/broadcast-popup"
        element={
          <AdminRoute>
            <AdminBroadcastPopup />
          </AdminRoute>
        }
      />
      <Route
        path="/admin/settings"
        element={
          <AdminRoute>
            <AdminDashboard />
          </AdminRoute>
        }
      />
      <Route
        path="/admin/logs"
        element={
          <AdminRoute>
            <AdminDashboard />
          </AdminRoute>
        }
      />
      <Route
        path="/admin-token"
        element={
          <PrivateRoute>
            <AdminToken />
          </PrivateRoute>
        }
      />
    </Routes>
      </NotificationProvider>
    </ErrorProvider>
  );
}

export default App;

