import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import Toast from './Toast';
import { useAuth } from '../hooks/useAuth';
import { useUnlockedAgents } from '../hooks/useUnlockedAgents';
import { agentsApi } from '../services/api';

interface AgentFeaturePageProps {
  children?: React.ReactNode;
}

export default function AgentFeaturePage({ children }: AgentFeaturePageProps) {
  const { agentId } = useParams<{ agentId: string }>();
  const { user, logout } = useAuth();
  const { unlockedAgents, refresh } = useUnlockedAgents();
  const navigate = useNavigate();
  const [agent, setAgent] = useState<any>(null);
  const [agentSettings, setAgentSettings] = useState<any>({});
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [status, setStatus] = useState<'active' | 'inactive'>('inactive');

  useEffect(() => {
    if (user && agentId) {
      loadAgentData();
    }
  }, [user, agentId, unlockedAgents]);

  const loadAgentData = async () => {
    if (!agentId) return;
    setLoading(true);
    try {
      // Find unlocked agent
      const unlockedAgent = unlockedAgents.find(
        (ua) => ua.agentId === agentId || ua.agent?.id === agentId
      );

      if (!unlockedAgent) {
        showToast('Agent not unlocked or not found', 'error');
        setTimeout(() => navigate('/agents'), 2000);
        return;
      }

      setAgent(unlockedAgent.agent || { name: unlockedAgent.agentName });
      setAgentSettings(unlockedAgent.settings || {});
      setStatus(unlockedAgent.status === 'active' ? 'active' : 'inactive');
    } catch (err: any) {
      console.error('Error loading agent data:', err);
      showToast(err.response?.data?.error || 'Failed to load agent', 'error');
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
        <div className="text-lg text-gray-300">Loading agent...</div>
      </div>
    );
  }

  if (!agent) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900/20 to-slate-900 flex items-center justify-center">
        <div className="text-center">
          <p className="text-lg text-gray-300 mb-4">Agent not found or not unlocked</p>
          <button
            onClick={() => navigate('/agents')}
            className="btn btn-primary"
          >
            Back to Marketplace
          </button>
        </div>
      </div>
    );
  }

  const imageUrl = agent.imageUrl || `https://ui-avatars.com/api/?name=${encodeURIComponent(agent.name)}&background=6366f1&color=fff&size=400`;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900/20 to-slate-900">
      {/* Animated background elements */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none z-0">
        <div className="absolute -top-40 -right-40 w-80 h-80 bg-purple-500 rounded-full mix-blend-multiply filter blur-xl opacity-20 animate-blob"></div>
        <div className="absolute -bottom-40 -left-40 w-80 h-80 bg-blue-500 rounded-full mix-blend-multiply filter blur-xl opacity-20 animate-blob animation-delay-2000"></div>
        <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-80 h-80 bg-pink-500 rounded-full mix-blend-multiply filter blur-xl opacity-20 animate-blob animation-delay-4000"></div>
      </div>

      <div className="relative z-10 pt-16 lg:pt-0">
        {/* Header Banner */}
        <div className="relative overflow-hidden bg-gradient-to-br from-purple-900/30 via-pink-900/20 to-slate-900 border-b border-purple-500/20">
          <div className="relative h-48 sm:h-64 overflow-hidden">
            <img
              src={imageUrl}
              alt={agent.name}
              className="w-full h-full object-cover"
              onError={(e) => {
                const target = e.target as HTMLImageElement;
                target.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(agent.name)}&background=6366f1&color=fff&size=800`;
              }}
            />
            <div className="absolute inset-0 bg-gradient-to-t from-slate-900 via-slate-900/80 to-transparent"></div>
            
            {/* Status Badge */}
            <div className="absolute top-4 left-4">
              <div className={`px-4 py-2 rounded-lg text-sm font-semibold backdrop-blur-md
                ${status === 'active' ? 'bg-green-500/20 border border-green-500/50 text-green-300' : 'bg-slate-700/80 border border-slate-500/50 text-gray-300'}`}>
                {status === 'active' ? '✓ Active' : '⚪ Inactive'}
              </div>
            </div>
          </div>

          {/* Title Section */}
          <div className="relative px-4 sm:px-6 md:px-8 py-6 sm:py-8">
            <div className="max-w-4xl mx-auto">
              <h1 className="text-3xl sm:text-4xl md:text-5xl font-extrabold bg-gradient-to-r from-purple-400 via-pink-400 to-blue-400 bg-clip-text text-transparent mb-2">
                {agent.name}
              </h1>
              {agent.description && (
                <p className="text-lg sm:text-xl text-gray-300 max-w-3xl">
                  {agent.description}
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Content Area */}
        <div className="p-4 sm:p-6 md:p-8 lg:p-12">
          <div className="max-w-7xl mx-auto">
            {children || (
              <div className="bg-gradient-to-br from-slate-800/70 via-slate-800/50 to-slate-900/70 backdrop-blur-2xl border border-purple-500/30 rounded-3xl shadow-2xl p-6 md:p-8">
                <h2 className="text-2xl font-bold text-white mb-4">Agent Dashboard</h2>
                <p className="text-gray-400">Agent feature workspace coming soon...</p>
              </div>
            )}
          </div>
        </div>
      </div>
      {toast && <Toast message={toast.message} type={toast.type} />}
    </div>
  );
}

