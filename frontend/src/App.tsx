import React, { Suspense } from 'react';
import { Routes, Route, Navigate, BrowserRouter, Outlet } from 'react-router-dom';
import Login from './pages/Login';
import Signup from './pages/Signup';
import Dashboard from './pages/Dashboard';
import Home from './pages/Home';
import EngineControl from './pages/EngineControl';
import ResearchPanel from './pages/ResearchPanel';
import AutoTrade from './pages/AutoTrade';
import Settings from './pages/Settings';
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
import { ChatbotProvider } from './contexts/ChatbotContext';
import NotificationToast from './components/NotificationToast';
import BroadcastPopup from './components/BroadcastPopup';
import Chatbot from './components/Chatbot';
import { wsService } from './services/ws';
import { useAuth } from './hooks/useAuth';
import { useEffect } from 'react';

// Layout component that includes TopNavigation and renders page content via Outlet
function Layout() {
  return (
    <>
      <TopNavigation />
      <Outlet />
    </>
  );
}

// Loading screen component
function LoadingScreen() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-lg">Loading...</div>
    </div>
  );
}

function PrivateRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-lg">Loading...</div>
      </div>
    );
  }

  return user ? children : <Navigate to="/login" />;
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
    <BrowserRouter>
      <ErrorProvider>
        <NotificationProvider>
          <ChatbotProvider>
            <NotificationToast />
            <BroadcastPopup />
            <Chatbot />
            <Suspense fallback={<LoadingScreen />}>
              <Routes>
                {/* Public Routes */}
                <Route path="/login" element={<Login />} />
                <Route path="/signup" element={<Signup />} />
                <Route path="/onboarding" element={<Onboarding />} />
                <Route path="/admin-login" element={<AdminLogin />} />

                {/* Home route - redirect to dashboard for authenticated users */}
                <Route
                  path="/"
                  element={
                    <PrivateRoute>
                      <Navigate to="/dashboard" replace />
                    </PrivateRoute>
                  }
                />

                {/* Protected Routes with Layout */}
                <Route
                  path="/"
                  element={
                    <PrivateRoute>
                      <Layout />
                    </PrivateRoute>
                  }
                >
                  <Route path="dashboard" element={<Dashboard />} />
                  <Route path="engine" element={<EngineControl />} />
                  <Route path="research" element={<ResearchPanel />} />
                  <Route path="auto-trade" element={<AutoTrade />} />
                  <Route path="settings" element={<Settings />} />
                  <Route path="profile" element={<Profile />} />
                  <Route path="agents" element={<AgentsMarketplace />} />
                  <Route path="agents/:agentId" element={<AgentDetails />} />
                  <Route path="agent/:agentId" element={<AgentFeature />} />
                  <Route path="hft/settings" element={<HFTSettings />} />
                  <Route path="hft/logs" element={<HFTLogs />} />
                </Route>

                {/* Admin Routes with Layout */}
                <Route
                  path="/admin"
                  element={
                    <AdminRoute>
                      <Layout />
                    </AdminRoute>
                  }
                >
                  <Route index element={<AdminDashboard />} />
                  <Route path="users" element={<AdminUsersList />} />
                  <Route path="user/:uid" element={<AdminUserDetail />} />
                  <Route path="agents" element={<AdminAgentsManager />} />
                  <Route path="unlock-requests" element={<AdminUnlockRequests />} />
                  <Route path="broadcast-popup" element={<AdminBroadcastPopup />} />
                  <Route path="settings" element={<AdminDashboard />} />
                  <Route path="logs" element={<AdminDashboard />} />
                </Route>

                {/* Special Admin Token Route */}
                <Route
                  path="/admin-token"
                  element={
                    <PrivateRoute>
                      <AdminToken />
                    </PrivateRoute>
                  }
                />
              </Routes>
            </Suspense>
          </ChatbotProvider>
        </NotificationProvider>
      </ErrorProvider>
    </BrowserRouter>
  );
}

export default App;

