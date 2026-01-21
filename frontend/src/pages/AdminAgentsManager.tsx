import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import Toast from '../components/Toast';
import { useAuth } from '../hooks/useAuth';
import { agentsApi } from '../services/api';

interface Agent {
  agent_id: string;
  name: string;
  description: string;
  category: string;
  icon: string;
  badge: string;
}

interface AgentStats {
  total_agents: number;
  total_requests: number;
  pending_requests: number;
  approved_requests: number;
  rejected_requests: number;
  active_users: number;
}

export default function AdminAgentsManager() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [stats, setStats] = useState<AgentStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [assignEmail, setAssignEmail] = useState('');
  const [assignAgentId, setAssignAgentId] = useState('');
  const [assigning, setAssigning] = useState(false);

  useEffect(() => {
    loadStats();
    loadAgents();
  }, []);

  const loadAgents = async () => {
    try {
      // Firestore: fetch agents where isActive === true
      const { collection, getDocs } = await import('firebase/firestore');
      const { db } = await import('../config/firebase-config');
      const agentsSnapshot = await getDocs(collection(db, 'agents'));
      const agents = agentsSnapshot.docs
        .map(doc => ({ ...doc.data(), agent_id: doc.id }))
        .filter((a: any) => a?.is_active !== false && a?.isActive !== false);
      setAgents(agents);
    } catch (error) {
      console.error('Error loading agents:', error);
    }
  };

  const loadStats = async () => {
    try {
      const response = await agentsApi.getAgentStats();
      setStats(response.data.stats);
    } catch (err: any) {
      console.error('Error loading agent stats:', err);
      showToast('Error loading agent statistics', 'error');
    } finally {
      setLoading(false);
    }
  };

  const showToast = (message: string, type: 'success' | 'error') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 5000);
  };

  const handleAssignAgent = async () => {
    if (!assignEmail || !assignAgentId) {
      showToast('Please fill in all fields', 'error');
      return;
    }

    setAssigning(true);
    try {
      await agentsApi.assignAgentToUser(assignEmail, assignAgentId);
      showToast('Agent assigned successfully', 'success');
      setAssignEmail('');
      setAssignAgentId('');
      await loadStats(); // Refresh stats
    } catch (error: any) {
      console.error('Error assigning agent:', error);
      showToast(error.response?.data?.error || 'Failed to assign agent', 'error');
    } finally {
      setAssigning(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900/20 to-slate-900 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4"></div>
          <p className="text-blue-200">Loading agent statistics...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900/20 to-slate-900">
      <div className="p-4 sm:p-6 lg:p-8">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-6 gap-4">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold bg-gradient-to-r from-purple-400 to-pink-400 bg-clip-text text-transparent">
              Agent Management
            </h1>
            <p className="text-gray-400 text-sm mt-1">Manage agent approvals and monitor system statistics</p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => navigate('/admin/unlock-requests')}
              className="btn btn-primary whitespace-nowrap"
            >
              Review Requests ({stats?.pending_requests || 0})
            </button>
            <button
              onClick={() => navigate('/admin')}
              className="btn btn-secondary whitespace-nowrap"
            >
              ← Back to Admin
            </button>
          </div>
        </div>

        {/* Statistics Cards */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-8">
          <div className="card text-center">
            <div className="text-2xl font-bold text-blue-400">{stats?.total_agents || 0}</div>
            <div className="text-sm text-gray-400">Total Agents</div>
          </div>
          <div className="card text-center">
            <div className="text-2xl font-bold text-yellow-400">{stats?.pending_requests || 0}</div>
            <div className="text-sm text-gray-400">Pending Requests</div>
          </div>
          <div className="card text-center">
            <div className="text-2xl font-bold text-green-400">{stats?.approved_requests || 0}</div>
            <div className="text-sm text-gray-400">Approved</div>
          </div>
          <div className="card text-center">
            <div className="text-2xl font-bold text-red-400">{stats?.rejected_requests || 0}</div>
            <div className="text-sm text-gray-400">Rejected</div>
          </div>
          <div className="card text-center">
            <div className="text-2xl font-bold text-purple-400">{stats?.total_requests || 0}</div>
            <div className="text-sm text-gray-400">Total Requests</div>
          </div>
          <div className="card text-center">
            <div className="text-2xl font-bold text-cyan-400">{stats?.active_users || 0}</div>
            <div className="text-sm text-gray-400">Active Users</div>
          </div>
        </div>

        {/* Quick Actions */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="card">
            <h3 className="text-xl font-bold text-white mb-4">Agent Request Management</h3>
            <p className="text-gray-300 mb-4">
              Review and approve agent access requests from users. All requests require admin approval before users can access premium agents.
            </p>
            <button
              onClick={() => navigate('/admin/unlock-requests')}
              className="btn btn-primary w-full"
            >
              Review Pending Requests ({stats?.pending_requests || 0})
            </button>
          </div>

          <div className="card">
            <h3 className="text-xl font-bold text-white mb-4">Direct Agent Assignment</h3>
            <p className="text-gray-300 mb-4">
              Assign agents directly to users by email address, bypassing the request process.
            </p>
            <div className="space-y-3">
              <input
                type="email"
                placeholder="User email address"
                value={assignEmail}
                onChange={(e) => setAssignEmail(e.target.value)}
                className="input w-full"
              />
              <select
                value={assignAgentId}
                onChange={(e) => setAssignAgentId(e.target.value)}
                className="input w-full"
              >
                <option value="">Select Agent</option>
                {agents.map((agent) => (
                  <option key={agent.agent_id} value={agent.agent_id}>
                    {agent.name}
                  </option>
                ))}
              </select>
              <button
                onClick={handleAssignAgent}
                disabled={assigning || !assignEmail || !assignAgentId}
                className="btn btn-success w-full disabled:opacity-50"
              >
                {assigning ? 'Assigning...' : 'Assign Agent'}
              </button>
            </div>
          </div>

          <div className="card">
            <h3 className="text-xl font-bold text-white mb-4">System Overview</h3>
            <p className="text-gray-300 mb-4">
              Monitor agent adoption and user engagement. Track approval rates and system usage patterns.
            </p>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-400">Approval Rate:</span>
                <span className="text-green-400">
                  {stats?.total_requests ?
                    Math.round((stats.approved_requests / stats.total_requests) * 100) : 0}%
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Rejection Rate:</span>
                <span className="text-red-400">
                  {stats?.total_requests ?
                    Math.round((stats.rejected_requests / stats.total_requests) * 100) : 0}%
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Avg Users per Agent:</span>
                <span className="text-cyan-400">
                  {stats?.total_agents ?
                    Math.round((stats.active_users / stats.total_agents) * 10) / 10 : 0}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Agent Details */}
        <div className="mt-8">
          <h3 className="text-xl font-bold text-white mb-4">Available Agents</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="card">
              <div className="flex items-center mb-3">
                <span className="text-2xl mr-3">👥</span>
                <div>
                  <h4 className="text-lg font-bold text-white">Crowd Consensus Copy Trade Agent</h4>
                  <span className="text-xs bg-blue-500/20 text-blue-300 px-2 py-1 rounded">COPY_TRADING_AGENT</span>
                </div>
              </div>
              <p className="text-gray-300 text-sm mb-3">
                Follows crowd consensus across 10+ exchanges, trades when multiple exchanges agree on direction.
              </p>
              <div className="text-green-400 font-semibold">$600.00 one-time</div>
            </div>
          </div>
        </div>
      </div>

      {toast && <Toast message={toast.message} type={toast.type} />}
    </div>
  );
}