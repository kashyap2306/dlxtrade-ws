import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import Sidebar from '../components/Sidebar';
import Toast from '../components/Toast';
import { adminApi } from '../services/api';
import { useAuth } from '../hooks/useAuth';
import { adminWsService } from '../services/adminWs';

export default function AdminDashboard() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [realtimeEvents, setRealtimeEvents] = useState<any[]>([]);

  useEffect(() => {
    loadStats();
    const interval = setInterval(loadStats, 10000); // Refresh every 10 seconds

    // Connect to admin WebSocket
    adminWsService.connect();
    const unsubscribe = adminWsService.subscribe('*', (event: any) => {
      setRealtimeEvents((prev) => [event, ...prev].slice(0, 50)); // Keep last 50 events
    });

    return () => {
      clearInterval(interval);
      unsubscribe();
      adminWsService.disconnect();
    };
  }, []);

  const loadStats = async () => {
    try {
      const response = await adminApi.getGlobalStats();
      setStats(response.data);
    } catch (err: any) {
      if (err.response?.status === 403) {
        showToast('Admin access required', 'error');
        navigate('/admin-login');
      } else {
        showToast(err.response?.data?.error || 'Error loading stats', 'error');
      }
    } finally {
      setLoading(false);
    }
  };

  const showToast = (message: string, type: 'success' | 'error') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900/20 to-slate-900 flex items-center justify-center">
        <div className="text-lg text-gray-300">Loading admin dashboard...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900/20 to-slate-900">
      <Sidebar onLogout={logout} />
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-3xl font-bold bg-gradient-to-r from-purple-400 to-pink-400 bg-clip-text text-transparent">
            Admin Dashboard
          </h1>
        </div>

        {/* Global Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <div className="card">
            <div className="text-sm text-gray-400 mb-1">Active Users</div>
            <div className="text-3xl font-bold text-white">{stats?.activeUsers || 0}</div>
          </div>
          <div className="card">
            <div className="text-sm text-gray-400 mb-1">Active Engines</div>
            <div className="text-3xl font-bold text-green-400">{stats?.activeEngines || 0}</div>
          </div>
          <div className="card">
            <div className="text-sm text-gray-400 mb-1">Active HFT Bots</div>
            <div className="text-3xl font-bold text-blue-400">{stats?.activeHFTBots || 0}</div>
          </div>
          <div className="card">
            <div className="text-sm text-gray-400 mb-1">Total Users</div>
            <div className="text-3xl font-bold text-purple-400">{stats?.activeUsers || 0}</div>
          </div>
        </div>

        {/* Trading Stats */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <div className="card">
            <div className="text-sm text-gray-400 mb-1">Today's PnL</div>
            <div className={`text-3xl font-bold ${(stats?.totalPnLToday || 0) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
              ${(stats?.totalPnLToday || 0).toFixed(2)}
            </div>
          </div>
          <div className="card">
            <div className="text-sm text-gray-400 mb-1">Today's Trades</div>
            <div className="text-3xl font-bold text-white">{stats?.totalTradesToday || 0}</div>
          </div>
          <div className="card">
            <div className="text-sm text-gray-400 mb-1">Total Volume</div>
            <div className="text-3xl font-bold text-yellow-400">
              ${(stats?.totalVolumeToday || 0).toLocaleString()}
            </div>
          </div>
          <div className="card">
            <div className="text-sm text-gray-400 mb-1">Success Rate</div>
            <div className="text-3xl font-bold text-green-400">{stats?.globalSuccessRate || 0}%</div>
          </div>
        </div>

        {/* Error Stats */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="card">
            <div className="text-sm text-gray-400 mb-1">Total Errors</div>
            <div className="text-3xl font-bold text-red-400">{stats?.totalErrors || 0}</div>
          </div>
          <div className="card">
            <div className="text-sm text-gray-400 mb-1">Total Cancels</div>
            <div className="text-3xl font-bold text-orange-400">{stats?.totalCancels || 0}</div>
          </div>
        </div>

        {/* Real-time Events */}
        <div className="card">
          <h2 className="text-xl font-bold text-white mb-4">Real-time Events</h2>
          <div className="space-y-2 max-h-96 overflow-y-auto">
            {realtimeEvents.length === 0 ? (
              <div className="text-gray-400 text-center py-8">No events yet</div>
            ) : (
              realtimeEvents.map((event, idx) => (
                <div
                  key={idx}
                  className="p-3 bg-slate-700/30 rounded-lg border border-purple-500/20 text-sm"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-purple-400 font-medium">{event.type}</span>
                    <span className="text-gray-400 text-xs">
                      {event.uid ? `UID: ${event.uid.substring(0, 8)}...` : ''}
                    </span>
                  </div>
                  <div className="text-gray-300 mt-1">
                    {JSON.stringify(event.data, null, 2)}
                  </div>
                  <div className="text-gray-500 text-xs mt-1">
                    {new Date(event.timestamp).toLocaleTimeString()}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Quick Actions */}
        <div className="card">
          <h2 className="text-xl font-bold text-white mb-4">Quick Actions</h2>
          <div className="flex flex-wrap gap-4">
            <button
              onClick={() => navigate('/admin/users')}
              className="btn btn-primary"
            >
              View All Users
            </button>
            <button
              onClick={() => navigate('/admin/agents')}
              className="btn btn-secondary"
            >
              Manage Agents
            </button>
          </div>
        </div>
      </div>
      {toast && <Toast message={toast.message} type={toast.type} />}
    </div>
  );
}

