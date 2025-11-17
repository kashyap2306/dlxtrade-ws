import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import Toast from '../components/Toast';
import { useAuth } from '../hooks/useAuth';
import { adminApi } from '../services/api';

interface Agent {
  name: string;
  description: string;
  price: number;
  usersUnlocked: number;
  userIds: string[];
}

export default function AdminAgentsManager() {
  const { logout } = useAuth();
  const navigate = useNavigate();
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
  const [agentUsers, setAgentUsers] = useState<any[]>([]);
  const [showUsersModal, setShowUsersModal] = useState(false);

  const agentDefinitions = [
    {
      name: 'Airdrop Multiverse Agent',
      description: 'Creates 100–500 wallets, auto airdrop tasks runner, auto-claim, auto-merge profits',
      price: 350,
    },
    {
      name: 'Liquidity Sniper & Arbitrage Agent',
      description: 'DEX–CEX arbitrage with micro-second gap execution',
      price: 500,
    },
    {
      name: 'AI Launchpad Hunter & Presale Sniper',
      description: 'Whitelists, presales, early launch detection, auto-entry & auto-exit',
      price: 450,
    },
    {
      name: 'Whale Movement Tracker Agent',
      description: 'Tracks big wallets (whales), auto-buy/sell on accumulation & distribution',
      price: 250,
    },
    {
      name: 'Pre-Market AI Alpha Agent',
      description: 'On-chain + sentiment + funding + volatility analysis, predicts next pump tokens',
      price: 300,
    },
    {
      name: 'Whale Copy Trade Agent',
      description: 'Tracks top 500 whales, copies entries/exits automatically',
      price: 400,
    },
  ];

  useEffect(() => {
    loadAgentStats();
  }, []);

  const loadAgentStats = async () => {
    try {
      const response = await adminApi.getAgentStats();
      const stats = response.data.agentStats || {};

      const agentsWithStats = agentDefinitions.map((agent) => ({
        ...agent,
        usersUnlocked: stats[agent.name]?.unlocked || 0,
        userIds: stats[agent.name]?.users || [],
      }));

      setAgents(agentsWithStats);
    } catch (err: any) {
      if (err.response?.status === 403) {
        showToast('Admin access required', 'error');
        navigate('/admin-login');
      } else {
        showToast(err.response?.data?.error || 'Error loading agent stats', 'error');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleViewUsers = async (agentName: string) => {
    try {
      const response = await adminApi.getAgentUsers(agentName);
      setAgentUsers(response.data.users || []);
      setSelectedAgent(agentName);
      setShowUsersModal(true);
    } catch (err: any) {
      showToast(err.response?.data?.error || 'Error loading users', 'error');
    }
  };

  const showToast = (message: string, type: 'success' | 'error') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900/20 to-slate-900 flex items-center justify-center">
        <div className="text-lg text-gray-300">Loading agents...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900/20 to-slate-900">
      <div className="p-6">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-3xl font-bold bg-gradient-to-r from-purple-400 to-pink-400 bg-clip-text text-transparent">
            Agents Manager
          </h1>
          <button
            onClick={() => navigate('/admin')}
            className="btn btn-secondary"
          >
            Back to Dashboard
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {agents.map((agent) => (
            <div key={agent.name} className="card">
              <h3 className="text-xl font-bold text-white mb-2">{agent.name}</h3>
              <p className="text-gray-400 text-sm mb-4">{agent.description}</p>
              <div className="flex items-center justify-between mb-4">
                <div>
                  <div className="text-sm text-gray-400">Price</div>
                  <div className="text-2xl font-bold text-purple-400">${agent.price}</div>
                </div>
                <div>
                  <div className="text-sm text-gray-400">Users Unlocked</div>
                  <div className="text-2xl font-bold text-green-400">{agent.usersUnlocked}</div>
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => showToast('Edit price feature coming soon', 'success')}
                  className="btn btn-secondary flex-1 text-sm"
                >
                  Edit Price
                </button>
                <button
                  onClick={() => handleViewUsers(agent.name)}
                  className="btn btn-secondary flex-1 text-sm"
                >
                  View Users ({agent.usersUnlocked})
                </button>
              </div>
              <button
                onClick={() => showToast('Disable agent feature coming soon', 'success')}
                className="btn btn-danger w-full mt-2 text-sm"
              >
                Disable Agent
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Users Modal */}
      {showUsersModal && selectedAgent && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center">
          <div className="card max-w-2xl w-full mx-4 max-h-[80vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold text-white">
                Users who unlocked: {selectedAgent}
              </h2>
              <button
                onClick={() => {
                  setShowUsersModal(false);
                  setSelectedAgent(null);
                  setAgentUsers([]);
                }}
                className="text-gray-400 hover:text-white"
              >
                ✕
              </button>
            </div>
            {agentUsers.length === 0 ? (
              <div className="text-center text-gray-400 py-8">
                No users have unlocked this agent yet
              </div>
            ) : (
              <div className="space-y-2">
                {agentUsers.map((user, idx) => (
                  <div
                    key={idx}
                    className="p-3 bg-slate-700/30 rounded-lg flex items-center justify-between"
                  >
                    <div>
                      <div className="text-white font-medium">{user.email || 'N/A'}</div>
                      <div className="text-gray-400 text-sm font-mono">{user.uid.substring(0, 12)}...</div>
                    </div>
                    <div className="text-gray-400 text-xs">
                      {user.unlockedAt ? new Date(user.unlockedAt).toLocaleDateString() : 'N/A'}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {toast && <Toast message={toast.message} type={toast.type} />}
    </div>
  );
}

