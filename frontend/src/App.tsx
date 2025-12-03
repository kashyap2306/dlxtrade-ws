import React, { Suspense, useState, useEffect } from 'react';
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
import { ErrorBoundary } from './components/ErrorBoundary';
import { LoadingState } from './components/LoadingState';

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

// API-safe route wrapper that prevents blank screens on API failures
function SafeRoute({ children, fallbackMessage = "Content temporarily unavailable" }: { children: React.ReactNode, fallbackMessage?: string }) {
  const [hasError, setHasError] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // Set a timeout to ensure content renders even if APIs are slow
    const timeout = setTimeout(() => {
      setIsLoading(false);
    }, 5000); // 5 second timeout

    return () => clearTimeout(timeout);
  }, []);

  if (hasError) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 flex items-center justify-center">
        <div className="max-w-md mx-auto text-center p-8 bg-slate-800/50 backdrop-blur-sm border border-slate-700/50 rounded-2xl">
          <div className="text-slate-400 mb-4">
            <svg className="w-12 h-12 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
            </svg>
          </div>
          <h3 className="text-lg font-semibold text-white mb-2">Content Unavailable</h3>
          <p className="text-slate-400 text-sm mb-4">{fallbackMessage}</p>
          <button
            onClick={() => window.location.reload()}
            className="px-4 py-2 bg-slate-700/50 border border-slate-600/50 text-slate-300 rounded-lg hover:bg-slate-600/50 transition-colors text-sm font-medium"
          >
            Reload Page
          </button>
        </div>
      </div>
    );
  }

  return (
    <ErrorBoundary
      fallback={
        <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 flex items-center justify-center">
          <div className="max-w-md mx-auto text-center p-8 bg-slate-800/50 backdrop-blur-sm border border-slate-700/50 rounded-2xl">
            <div className="text-slate-400 mb-4">
              <svg className="w-12 h-12 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
              </svg>
            </div>
            <h3 className="text-lg font-semibold text-white mb-2">Something went wrong</h3>
            <p className="text-slate-400 text-sm mb-4">This page encountered an error but you can still use other features.</p>
            <button
              onClick={() => window.location.reload()}
              className="px-4 py-2 bg-slate-700/50 border border-slate-600/50 text-slate-300 rounded-lg hover:bg-slate-600/50 transition-colors text-sm font-medium"
            >
              Reload Page
            </button>
          </div>
        </div>
      }
    >
      <Suspense fallback={<LoadingState message="Loading page content..." />}>
        {children}
      </Suspense>
    </ErrorBoundary>
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
                  <Route path="dashboard" element={<SafeRoute><Dashboard /></SafeRoute>} />
                  <Route path="engine" element={<SafeRoute><EngineControl /></SafeRoute>} />
                  <Route path="research" element={<SafeRoute><ResearchPanel /></SafeRoute>} />
                  <Route path="auto-trade" element={<SafeRoute><AutoTrade /></SafeRoute>} />
                  <Route path="settings" element={<SafeRoute><Settings /></SafeRoute>} />
                  <Route path="profile" element={<SafeRoute><Profile /></SafeRoute>} />
                  <Route path="agents" element={<SafeRoute><AgentsMarketplace /></SafeRoute>} />
                  <Route path="agents/:agentId" element={<SafeRoute><AgentDetails /></SafeRoute>} />
                  <Route path="agent/:agentId" element={<SafeRoute><AgentFeature /></SafeRoute>} />
                  <Route path="hft/settings" element={<SafeRoute><HFTSettings /></SafeRoute>} />
                  <Route path="hft/logs" element={<SafeRoute><HFTLogs /></SafeRoute>} />
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
                  <Route index element={<SafeRoute><AdminDashboard /></SafeRoute>} />
                  <Route path="users" element={<SafeRoute><AdminUsersList /></SafeRoute>} />
                  <Route path="user/:uid" element={<SafeRoute><AdminUserDetail /></SafeRoute>} />
                  <Route path="agents" element={<SafeRoute><AdminAgentsManager /></SafeRoute>} />
                  <Route path="unlock-requests" element={<SafeRoute><AdminUnlockRequests /></SafeRoute>} />
                  <Route path="broadcast-popup" element={<SafeRoute><AdminBroadcastPopup /></SafeRoute>} />
                  <Route path="settings" element={<SafeRoute><AdminDashboard /></SafeRoute>} />
                  <Route path="logs" element={<SafeRoute><AdminDashboard /></SafeRoute>} />
                </Route>

                {/* Special Admin Token Route */}
                <Route
                  path="/admin-token"
                  element={
                    <PrivateRoute>
                      <SafeRoute>
                        <AdminToken />
                      </SafeRoute>
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

