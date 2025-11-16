import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import Sidebar from '../components/Sidebar';
import Toast from '../components/Toast';
import { adminApi } from '../services/api';
import { useAuth } from '../hooks/useAuth';

export default function AdminUserDetail() {
  const { uid } = useParams<{ uid: string }>();
  const { logout } = useAuth();
  const navigate = useNavigate();
  const [userData, setUserData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [selectedAgent, setSelectedAgent] = useState<string>('');

  useEffect(() => {
    if (uid) {
      loadUserData();
    }
  }, [uid]);

  const loadUserData = async () => {
    if (!uid) return;
    try {
      const [userResponse, logsResponse, hftLogsResponse] = await Promise.all([
        adminApi.getUser(uid),
        adminApi.getUserLogs(uid, 10),
        adminApi.getUserHFTLogs(uid, 10),
      ]);
      setUserData({
        ...userResponse.data,
        executionLogs: logsResponse.data.logs || [],
        hftLogs: hftLogsResponse.data.logs || [],
      });
    } catch (err: any) {
      if (err.response?.status === 403) {
        showToast('Admin access required', 'error');
        navigate('/admin');
      } else {
        showToast(err.response?.data?.error || 'Error loading user data', 'error');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleStopEngine = async () => {
    if (!uid) return;
    try {
      await adminApi.stopEngine(uid);
      showToast('Engine stopped', 'success');
      loadUserData();
    } catch (err: any) {
      showToast(err.response?.data?.error || 'Error stopping engine', 'error');
    }
  };

  const handleStopHFT = async () => {
    if (!uid) return;
    try {
      await adminApi.stopHFT(uid);
      showToast('HFT engine stopped', 'success');
      loadUserData();
    } catch (err: any) {
      showToast(err.response?.data?.error || 'Error stopping HFT', 'error');
    }
  };

  const handleResetRisk = async () => {
    if (!uid) return;
    try {
      await adminApi.resetRisk(uid);
      showToast('Risk manager reset', 'success');
      loadUserData();
    } catch (err: any) {
      showToast(err.response?.data?.error || 'Error resetting risk', 'error');
    }
  };

  const handleReloadKeys = async () => {
    if (!uid) return;
    try {
      await adminApi.reloadKeys(uid);
      showToast('API keys reloaded', 'success');
      loadUserData();
    } catch (err: any) {
      showToast(err.response?.data?.error || 'Error reloading keys', 'error');
    }
  };

  const handleUnlockAgent = async () => {
    if (!uid || !selectedAgent) return;
    try {
      await adminApi.unlockAgent(uid, selectedAgent);
      showToast(`Agent "${selectedAgent}" unlocked`, 'success');
      setSelectedAgent('');
      loadUserData();
    } catch (err: any) {
      showToast(err.response?.data?.error || 'Error unlocking agent', 'error');
    }
  };

  const handleLockAgent = async () => {
    if (!uid || !selectedAgent) return;
    try {
      await adminApi.lockAgent(uid, selectedAgent);
      showToast(`Agent "${selectedAgent}" locked`, 'success');
      setSelectedAgent('');
      loadUserData();
    } catch (err: any) {
      showToast(err.response?.data?.error || 'Error locking agent', 'error');
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
        <div className="text-lg text-gray-300">Loading user details...</div>
      </div>
    );
  }

  if (!userData) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900/20 to-slate-900 flex items-center justify-center">
        <div className="text-lg text-red-400">User not found</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900/20 to-slate-900">
      <Sidebar onLogout={logout} />
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-3xl font-bold bg-gradient-to-r from-purple-400 to-pink-400 bg-clip-text text-transparent">
            User Details
          </h1>
          <button
            onClick={() => navigate('/admin/users')}
            className="btn btn-secondary"
          >
            Back to Users
          </button>
        </div>

        {/* User Info */}
        <div className="card">
          <h2 className="text-xl font-bold text-white mb-4">User Information</h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <div className="text-sm text-gray-400">Email</div>
              <div className="text-white">{userData.email || 'N/A'}</div>
            </div>
            <div>
              <div className="text-sm text-gray-400">UID</div>
              <div className="text-gray-300 font-mono text-sm">{userData.uid}</div>
            </div>
            <div>
              <div className="text-sm text-gray-400">Engine Status</div>
              <div className={userData.stats?.engineRunning ? 'text-green-400' : 'text-gray-400'}>
                {userData.stats?.engineRunning ? 'Running' : 'Stopped'}
              </div>
            </div>
            <div>
              <div className="text-sm text-gray-400">HFT Status</div>
              <div className={userData.stats?.hftRunning ? 'text-blue-400' : 'text-gray-400'}>
                {userData.stats?.hftRunning ? 'Running' : 'Stopped'}
              </div>
            </div>
            <div>
              <div className="text-sm text-gray-400">Current PnL</div>
              <div className={userData.stats?.currentPnL >= 0 ? 'text-green-400' : 'text-red-400'}>
                ${(userData.stats?.currentPnL || 0).toFixed(2)}
              </div>
            </div>
            <div>
              <div className="text-sm text-gray-400">Open Orders</div>
              <div className="text-white">{userData.stats?.openOrders || 0}</div>
            </div>
          </div>
        </div>

        {/* API Connections */}
        <div className="card">
          <h2 className="text-xl font-bold text-white mb-4">API Connections</h2>
          <div className="space-y-2">
            {userData.integrations?.map((integration: any) => (
              <div key={integration.name} className="flex items-center justify-between p-3 bg-slate-700/30 rounded-lg">
                <span className="text-gray-300">{integration.name}</span>
                <span className={`px-2 py-1 rounded text-xs ${integration.enabled && integration.hasKey ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}>
                  {integration.enabled && integration.hasKey ? 'Connected' : 'Not Connected'}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Unlocked Agents */}
        <div className="card">
          <h2 className="text-xl font-bold text-white mb-4">Unlocked Agents</h2>
          <div className="space-y-2 mb-4">
            {Object.entries(userData.agents || {}).map(([name, status]: [string, any]) => (
              <div key={name} className="flex items-center justify-between p-3 bg-slate-700/30 rounded-lg">
                <span className="text-gray-300">{name}</span>
                <span className={`px-2 py-1 rounded text-xs ${status.unlocked ? 'bg-green-500/20 text-green-400' : 'bg-gray-500/20 text-gray-400'}`}>
                  {status.unlocked ? 'Unlocked' : 'Locked'}
                </span>
              </div>
            ))}
          </div>
          <div className="space-y-3">
            <select
              value={selectedAgent}
              onChange={(e) => setSelectedAgent(e.target.value)}
              className="input"
            >
              <option value="">Select an agent...</option>
              {agentNames.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
            {selectedAgent && (
              <div className="flex gap-3">
                <button
                  onClick={handleUnlockAgent}
                  className="btn btn-primary flex-1"
                >
                  Unlock Agent
                </button>
                <button
                  onClick={handleLockAgent}
                  className="btn btn-danger flex-1"
                >
                  Lock Agent
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Recent Execution Logs */}
        <div className="card">
          <h2 className="text-xl font-bold text-white mb-4">Last 10 Execution Logs</h2>
          <div className="space-y-2 max-h-96 overflow-y-auto">
            {userData.executionLogs?.length === 0 ? (
              <div className="text-gray-400 text-center py-4">No execution logs</div>
            ) : (
              userData.executionLogs?.map((log: any, idx: number) => (
                <div key={idx} className="p-3 bg-slate-700/30 rounded-lg text-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-purple-400">{log.action}</span>
                    <span className="text-gray-400 text-xs">{log.timestamp ? new Date(log.timestamp).toLocaleString() : ''}</span>
                  </div>
                  <div className="text-gray-300 mt-1">{log.reason || JSON.stringify(log)}</div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Recent HFT Logs */}
        <div className="card">
          <h2 className="text-xl font-bold text-white mb-4">Last 10 HFT Logs</h2>
          <div className="space-y-2 max-h-96 overflow-y-auto">
            {userData.hftLogs?.length === 0 ? (
              <div className="text-gray-400 text-center py-4">No HFT logs</div>
            ) : (
              userData.hftLogs?.map((log: any, idx: number) => (
                <div key={idx} className="p-3 bg-slate-700/30 rounded-lg text-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-blue-400">{log.action}</span>
                    <span className="text-gray-400 text-xs">{log.timestamp ? new Date(log.timestamp).toLocaleString() : ''}</span>
                  </div>
                  <div className="text-gray-300 mt-1">{log.reason || JSON.stringify(log)}</div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Admin Controls */}
        <div className="card">
          <h2 className="text-xl font-bold text-white mb-4">Admin Controls</h2>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <button
              onClick={handleStopEngine}
              className="btn btn-danger"
            >
              Stop Engine
            </button>
            <button
              onClick={handleStopHFT}
              className="btn btn-danger"
            >
              Stop HFT
            </button>
            <button
              onClick={handleResetRisk}
              className="btn btn-secondary"
            >
              Reset Risk
            </button>
            <button
              onClick={handleReloadKeys}
              className="btn btn-secondary"
            >
              Reload API Keys
            </button>
          </div>
        </div>
      </div>
      {toast && <Toast message={toast.message} type={toast.type} />}
    </div>
  );
}

