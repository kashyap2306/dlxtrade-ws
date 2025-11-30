import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import Toast from '../components/Toast';
import { adminApi } from '../services/api';
import { useAuth } from '../hooks/useAuth';

interface User {
  uid: string;
  email?: string;
  engineRunning: boolean;
  hftRunning: boolean;
  currentPnL: number;
  openOrders: number;
  unlockedAgentsCount: number;
  apiStatus: Record<string, { connected: boolean; hasKey: boolean }>;
  autoTradeEnabled: boolean;
  hftEnabled: boolean;
  createdAt?: string;
}

export default function AdminUsersList() {
  const { logout } = useAuth();
  const navigate = useNavigate();
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [selectedAgent, setSelectedAgent] = useState<{ uid: string; agentName: string } | null>(null);
  const [deleteUser, setDeleteUser] = useState<{ uid: string; email: string } | null>(null);

  useEffect(() => {
    loadUsers();
    const interval = setInterval(loadUsers, 10000);
    return () => clearInterval(interval);
  }, []);

  const loadUsers = async () => {
    try {
      const response = await adminApi.getUsers();
      setUsers(response.data.users || []);
    } catch (err: any) {
      if (err.response?.status === 403) {
        showToast('Admin access required', 'error');
        navigate('/admin-login');
      } else {
        showToast(err.response?.data?.error || 'Error loading users', 'error');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleStopEngine = async (uid: string) => {
    try {
      await adminApi.stopEngine(uid);
      showToast('Engine stopped', 'success');
      loadUsers();
    } catch (err: any) {
      showToast(err.response?.data?.error || 'Error stopping engine', 'error');
    }
  };

  const handleStopHFT = async (uid: string) => {
    try {
      await adminApi.stopHFT(uid);
      showToast('HFT engine stopped', 'success');
      loadUsers();
    } catch (err: any) {
      showToast(err.response?.data?.error || 'Error stopping HFT', 'error');
    }
  };

  const handleUnlockAgent = async (uid: string, agentName: string) => {
    try {
      await adminApi.unlockAgent(uid, agentName);
      showToast(`Agent "${agentName}" unlocked`, 'success');
      loadUsers();
      setSelectedAgent(null);
    } catch (err: any) {
      showToast(err.response?.data?.error || 'Error unlocking agent', 'error');
    }
  };

  const handleLockAgent = async (uid: string, agentName: string) => {
    try {
      await adminApi.lockAgent(uid, agentName);
      showToast(`Agent "${agentName}" locked`, 'success');
      loadUsers();
      setSelectedAgent(null);
    } catch (err: any) {
      showToast(err.response?.data?.error || 'Error locking agent', 'error');
    }
  };

  const handleDeleteUser = (uid: string, email: string) => {
    setDeleteUser({ uid, email });
  };

  const handleEnableAllAgentsForUser = async (targetUid: string | null) => {
    try {
      // If targetUid is null, enable for all users
      const uids = targetUid ? [targetUid] : users.map(u => u.uid);

      for (const uid of uids) {
        // Unlock Premium Trading Agent
        await adminApi.unlockAgent(uid, 'Premium Trading Agent');

        // Unlock all other agents
        const allAgentNames = [
          'Airdrop Multiverse Agent',
          'Liquidity Sniper & Arbitrage Agent',
          'AI Launchpad Hunter & Presale Sniper',
          'Whale Movement Tracker Agent',
          'Pre-Market AI Alpha Agent',
          'Whale Copy Trade Agent',
        ];

        for (const agentName of allAgentNames) {
          try {
            await adminApi.unlockAgent(uid, agentName);
          } catch (err) {
            // Continue if agent already unlocked
            console.warn(`Agent ${agentName} may already be unlocked for user ${uid}`);
          }
        }

        // Set autoTradeEnabled = true
        // This would need a new API endpoint to update user settings
        // For now, we'll unlock the agents and let the user know they need to enable auto trade manually
      }

      const message = targetUid
        ? 'All agents unlocked successfully for user'
        : 'All agents unlocked successfully for all users';
      showToast(message, 'success');
      loadUsers();
    } catch (err: any) {
      showToast(err.response?.data?.error || 'Error enabling all agents', 'error');
    }
  };

  const handleGiveFullAccess = async (uid: string) => {
    try {
      await adminApi.giveFullAccess(uid);
      showToast('Full access granted successfully', 'success');
      loadUsers();
    } catch (err: any) {
      showToast(err.response?.data?.error || 'Error giving full access', 'error');
    }
  };

  const confirmDeleteUser = async () => {
    if (!deleteUser) return;

    try {
      await adminApi.deleteUser(deleteUser.uid);
      showToast(`User ${deleteUser.email} deleted successfully`, 'success');
      setDeleteUser(null);
      loadUsers();
    } catch (err: any) {
      showToast(err.response?.data?.error || 'Error deleting user', 'error');
    }
  };

  const showToast = (message: string, type: 'success' | 'error') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  const agentNames = [
    'Airdrop Multiverse Agent',
    'Liquidity Sniper & Arbitrage Agent',
    'AI Launchpad Hunter Agent',
    'Whale Movement Tracker Agent',
    'AI Alpha Predictor Agent',
    'Whale Copy Trade Agent',
  ];

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900/20 to-slate-900 flex items-center justify-center">
        <div className="text-lg text-gray-300">Loading users...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900/20 to-slate-900">
      <div className="p-6">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-3xl font-bold bg-gradient-to-r from-purple-400 to-pink-400 bg-clip-text text-transparent">
            All Users
          </h1>
          <div className="flex gap-3">
            <button
              onClick={() => handleEnableAllAgentsForUser(null)}
              className="btn btn-primary bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600"
            >
              ⚡ Enable All Agents (Global)
            </button>
            <button
              onClick={() => navigate('/admin')}
              className="btn btn-secondary"
            >
              Back to Dashboard
            </button>
          </div>
        </div>

        <div className="card overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-purple-500/20">
                <th className="text-left p-4 text-gray-300">Email</th>
                <th className="text-left p-4 text-gray-300">UID</th>
                <th className="text-left p-4 text-gray-300">Engine</th>
                <th className="text-left p-4 text-gray-300">HFT</th>
                <th className="text-left p-4 text-gray-300">PnL</th>
                <th className="text-left p-4 text-gray-300">Open Orders</th>
                <th className="text-left p-4 text-gray-300">Agents</th>
                <th className="text-left p-4 text-gray-300">API Status</th>
                <th className="text-left p-4 text-gray-300">Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.uid} className="border-b border-purple-500/10 hover:bg-slate-700/20">
                  <td className="p-4 text-gray-200">{user.email || 'N/A'}</td>
                  <td className="p-4 text-gray-400 text-sm font-mono">{user.uid.substring(0, 12)}...</td>
                  <td className="p-4">
                    <span className={`px-2 py-1 rounded text-xs ${user.engineRunning ? 'bg-green-500/20 text-green-400' : 'bg-gray-500/20 text-gray-400'}`}>
                      {user.engineRunning ? 'Running' : 'Stopped'}
                    </span>
                  </td>
                  <td className="p-4">
                    <span className={`px-2 py-1 rounded text-xs ${user.hftRunning ? 'bg-blue-500/20 text-blue-400' : 'bg-gray-500/20 text-gray-400'}`}>
                      {user.hftRunning ? 'Running' : 'Stopped'}
                    </span>
                  </td>
                  <td className={`p-4 font-medium ${user.currentPnL >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    ${user.currentPnL.toFixed(2)}
                  </td>
                  <td className="p-4 text-gray-300">{user.openOrders}</td>
                  <td className="p-4 text-gray-300">{user.unlockedAgentsCount}</td>
                  <td className="p-4">
                    <div className="flex flex-col gap-1">
                      {Object.entries(user.apiStatus).map(([api, status]) => (
                        <span
                          key={api}
                          className={`text-xs px-2 py-1 rounded ${status.connected && status.hasKey ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}
                        >
                          {api}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="p-4">
                    <div className="flex flex-wrap gap-2">
                      <button
                        onClick={() => navigate(`/admin/user/${user.uid}`)}
                        className="btn btn-secondary text-xs px-2 py-1"
                      >
                        View
                      </button>
                      {user.engineRunning && (
                        <button
                          onClick={() => handleStopEngine(user.uid)}
                          className="btn btn-danger text-xs px-2 py-1"
                        >
                          Stop Bot
                        </button>
                      )}
                      {user.hftRunning && (
                        <button
                          onClick={() => handleStopHFT(user.uid)}
                          className="btn btn-danger text-xs px-2 py-1"
                        >
                          Stop HFT
                        </button>
                      )}
                      <button
                        onClick={() => setSelectedAgent({ uid: user.uid, agentName: '' })}
                        className="btn btn-primary text-xs px-2 py-1"
                      >
                        Agent
                      </button>
                      <button
                        onClick={() => handleEnableAllAgentsForUser(user.uid)}
                        className="btn btn-success text-xs px-2 py-1"
                      >
                        All Agents
                      </button>
                      <button
                        onClick={() => handleGiveFullAccess(user.uid)}
                        className="btn btn-primary text-xs px-2 py-1"
                      >
                        Full Access
                      </button>
                      <button
                        onClick={() => handleDeleteUser(user.uid, user.email || 'unknown')}
                        className="btn btn-danger text-xs px-2 py-1"
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Agent Unlock/Lock Modal */}
        {selectedAgent && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center">
            <div className="card max-w-md w-full mx-4">
              <h2 className="text-xl font-bold text-white mb-4">Manage Agent</h2>
              <div className="space-y-3">
                <label className="block text-gray-300 text-sm mb-2">Select Agent</label>
                <select
                  value={selectedAgent.agentName}
                  onChange={(e) => setSelectedAgent({ ...selectedAgent, agentName: e.target.value })}
                  className="input"
                >
                  <option value="">Select an agent...</option>
                  {agentNames.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
                {selectedAgent.agentName && (
                  <div className="flex gap-3 mt-4">
                    <button
                      onClick={() => handleUnlockAgent(selectedAgent.uid, selectedAgent.agentName)}
                      className="btn btn-primary flex-1"
                    >
                      Unlock Agent
                    </button>
                    <button
                      onClick={() => handleLockAgent(selectedAgent.uid, selectedAgent.agentName)}
                      className="btn btn-danger flex-1"
                    >
                      Lock Agent
                    </button>
                  </div>
                )}
                <button
                  onClick={() => setSelectedAgent(null)}
                  className="btn btn-secondary w-full mt-2"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Delete User Confirmation Modal */}
        {deleteUser && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center">
            <div className="card max-w-md w-full mx-4">
              <h2 className="text-xl font-bold text-red-400 mb-4">⚠️ Delete User Permanently</h2>
              <div className="space-y-4">
                <div className="bg-red-900/20 border border-red-500/30 rounded-lg p-4">
                  <p className="text-white text-sm mb-2">
                    Are you sure you want to delete user <strong>{deleteUser.email}</strong>?
                  </p>
                  <div className="text-xs text-red-300 space-y-1">
                    <p>• All user data will be permanently removed</p>
                    <p>• API keys and integrations will be deleted</p>
                    <p>• Agent unlocks will be revoked</p>
                    <p>• Running engines will be stopped</p>
                    <p>• Scheduled research will stop for this user</p>
                  </div>
                </div>
                <div className="flex gap-3">
                  <button
                    onClick={() => setDeleteUser(null)}
                    className="btn btn-secondary flex-1"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={confirmDeleteUser}
                    className="btn btn-danger flex-1"
                  >
                    Yes, Delete User
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
      {toast && <Toast message={toast.message} type={toast.type} />}
    </div>
  );
}

