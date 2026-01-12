import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import Toast from '../components/Toast';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '../config/firebase-config';
import { useAuth } from '../hooks/useAuth';

export default function AdminDashboard() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  useEffect(() => {
    loadStats();
    const interval = setInterval(loadStats, 30000); // Refresh every 30 seconds
    return () => clearInterval(interval);
  }, []);

  const loadStats = async () => {
    try {
      // Get total users count
      const usersQuery = query(collection(db, 'users'));
      const usersSnapshot = await getDocs(usersQuery);
      const totalUsers = usersSnapshot.size;

      // Get pending agent requests count
      const requestsQuery = query(collection(db, 'agentRequests'), where('status', '==', 'PENDING_APPROVAL'));
      const requestsSnapshot = await getDocs(requestsQuery);
      const pendingRequests = requestsSnapshot.size;

      // Count total assigned agents across all users
      let totalAssignedAgents = 0;
      usersSnapshot.forEach((doc) => {
        const userData = doc.data();
        const unlockedAgents = userData?.unlockedAgents || [];
        totalAssignedAgents += unlockedAgents.length;
      });

      setStats({
        totalUsers,
        pendingRequests,
        totalAssignedAgents
      });
    } catch (err: any) {
      console.error('Error loading stats:', err);
      showToast('Error loading admin stats', 'error');
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
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-3xl font-bold bg-gradient-to-r from-purple-400 to-pink-400 bg-clip-text text-transparent">
            Admin Dashboard
          </h1>
        </div>

        {/* Essential Admin Stats */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="card">
            <div className="text-sm text-gray-400 mb-1">Total Users</div>
            <div className="text-3xl font-bold text-white">{stats?.totalUsers || 0}</div>
          </div>
          <div className="card">
            <div className="text-sm text-gray-400 mb-1">Pending Agent Requests</div>
            <div className="text-3xl font-bold text-yellow-400">{stats?.pendingRequests || 0}</div>
          </div>
          <div className="card">
            <div className="text-sm text-gray-400 mb-1">Total Agent Assignments</div>
            <div className="text-3xl font-bold text-green-400">{stats?.totalAssignedAgents || 0}</div>
          </div>
        </div>

        {/* Quick Actions */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <button
            onClick={() => navigate('/admin/users')}
            className="btn btn-primary"
          >
            👥 Users
          </button>
          <button
            onClick={() => navigate('/admin/agent-access')}
            className="btn btn-primary"
          >
            🤖 Agent Access
          </button>
          <button
            onClick={() => navigate('/admin/unlock-requests')}
            className="btn btn-secondary"
          >
            🔔 Unlock Requests
          </button>
          <button
            onClick={() => navigate('/admin/logs')}
            className="btn btn-secondary"
          >
            📋 Logs
          </button>
        </div>
      </div>
      {toast && <Toast message={toast.message} type={toast.type} />}
    </div>
  );
}

