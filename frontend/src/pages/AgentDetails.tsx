import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import Sidebar from '../components/Sidebar';
import Toast from '../components/Toast';
import UnlockFormModal from '../components/UnlockFormModal';
import { useAuth } from '../hooks/useAuth';
import { agentsApi } from '../services/api';
import { AgentCardData } from '../components/AgentCard';

export default function AgentDetails() {
  const { agentId } = useParams<{ agentId: string }>();
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [agent, setAgent] = useState<AgentCardData & { longDescription?: string } | null>(null);
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [, setMenuOpen] = useState(false);
  const [showUnlockModal, setShowUnlockModal] = useState(false);

  useEffect(() => {
    if (user && agentId) {
      loadAgent();
    }
  }, [user, agentId]);

  const loadAgent = async () => {
    if (!agentId) return;
    setLoading(true);
    try {
      // Load all agents and find the one matching agentId
      const agentsResponse = await agentsApi.getAll();
      const agents = agentsResponse.data.agents || [];
      const foundAgent = agents.find((a: any) => 
        (a.id === agentId) || 
        (a.name?.toLowerCase().replace(/\s+/g, '_') === agentId) ||
        (a.id === decodeURIComponent(agentId))
      );

      if (foundAgent) {
        const mappedAgent = {
          id: foundAgent.id || foundAgent.name?.toLowerCase().replace(/\s+/g, '_') || '',
          name: foundAgent.name || '',
          description: foundAgent.description || '',
          longDescription: foundAgent.longDescription || foundAgent.description || '',
          features: foundAgent.features || [],
          price: foundAgent.price || 0,
          category: foundAgent.category || 'Trading',
          badge: foundAgent.badge,
          imageUrl: foundAgent.imageUrl,
          enabled: foundAgent.enabled !== false,
        };
        setAgent(mappedAgent);

        // Check if unlocked
        const unlockedResponse = await agentsApi.getUnlocked();
        const unlocked = unlockedResponse.data.unlocked || [];
        const isUnlocked = unlocked.some((agentIdOrName: string) => agentIdOrName === foundAgent.id || agentIdOrName === foundAgent.name);
        setIsUnlocked(isUnlocked);
      } else {
        showToast('Agent not found', 'error');
        setTimeout(() => navigate('/agents'), 2000);
      }
    } catch (err: any) {
      console.error('Error loading agent:', err);
      showToast(err.response?.data?.error || 'Failed to load agent', 'error');
      setTimeout(() => navigate('/agents'), 2000);
    } finally {
      setLoading(false);
    }
  };

  const handleUnlockClick = () => {
    if (agent) {
      setShowUnlockModal(true);
    }
  };

  const showToast = (message: string, type: 'success' | 'error') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900/20 to-slate-900 flex items-center justify-center">
        <div className="text-lg text-gray-300">Loading agent details...</div>
      </div>
    );
  }

  if (!agent) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900/20 to-slate-900 flex items-center justify-center">
        <div className="text-center">
          <p className="text-lg text-gray-300 mb-4">Agent not found</p>
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

      <Sidebar onLogout={logout} onMenuToggle={setMenuOpen} />
      <div className="relative z-10 pt-16 lg:pt-0">
        {/* Hero Banner Section */}
        <div className="relative overflow-hidden bg-gradient-to-br from-purple-900/30 via-pink-900/20 to-slate-900 border-b border-purple-500/20">
          <div className="relative h-64 sm:h-80 md:h-96 overflow-hidden">
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
            
            {/* Status and Badge */}
            <div className="absolute top-4 left-4 flex gap-2">
              <div className={`px-4 py-2 rounded-lg text-sm font-semibold backdrop-blur-md
                ${isUnlocked ? 'bg-green-500/20 border border-green-500/50 text-green-300' : 'bg-slate-700/80 border border-slate-500/50 text-gray-300'}`}>
                {isUnlocked ? '✓ Active' : '🔒 Locked'}
              </div>
              {agent.badge && (
                <div className="px-4 py-2 bg-purple-500/20 border border-purple-500/50 rounded-lg text-purple-300 text-sm font-semibold backdrop-blur-md">
                  {agent.badge}
                </div>
              )}
            </div>

            {/* Back Button */}
            <button
              onClick={() => navigate('/agents')}
              className="absolute top-4 right-4 px-4 py-2 bg-slate-800/80 backdrop-blur-md border border-slate-600/50 rounded-lg text-gray-300 hover:text-white hover:bg-slate-700/80 transition-all"
            >
              ← Back
            </button>
          </div>

          {/* Title Section */}
          <div className="relative px-4 sm:px-6 md:px-8 py-6 sm:py-8">
            <div className="max-w-4xl mx-auto">
              <div className="inline-block px-4 py-2 mb-4 bg-purple-500/20 border border-purple-500/50 rounded-full text-purple-300 text-sm font-semibold backdrop-blur-sm">
                {agent.category}
              </div>
              <h1 className="text-3xl sm:text-4xl md:text-5xl lg:text-6xl font-extrabold bg-gradient-to-r from-purple-400 via-pink-400 to-blue-400 bg-clip-text text-transparent mb-4 leading-tight">
                {agent.name}
              </h1>
              <p className="text-lg sm:text-xl text-gray-300 max-w-3xl leading-relaxed">
                {agent.description}
              </p>
            </div>
          </div>
        </div>

        {/* Content Section */}
        <div className="p-4 sm:p-6 md:p-8 lg:p-12">
          <div className="max-w-7xl mx-auto">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 lg:gap-8">
              {/* Main Content */}
              <div className="lg:col-span-2 space-y-6">
                {/* Long Description */}
                <div className="bg-gradient-to-br from-slate-800/70 via-slate-800/50 to-slate-900/70 backdrop-blur-2xl border border-purple-500/30 rounded-3xl shadow-2xl p-6 md:p-8 animate-slide-up">
                  <h2 className="text-2xl md:text-3xl font-bold text-white mb-6">About This Agent</h2>
                  <div className="text-gray-300 text-base md:text-lg leading-relaxed whitespace-pre-line">
                    {agent.longDescription || agent.description || 'No detailed description available.'}
                  </div>
                </div>

                {/* Features */}
                {agent.features && agent.features.length > 0 && (
                  <div className="bg-gradient-to-br from-slate-800/70 via-slate-800/50 to-slate-900/70 backdrop-blur-2xl border border-purple-500/30 rounded-3xl shadow-2xl p-6 md:p-8 animate-slide-up" style={{ animationDelay: '0.1s' }}>
                    <h2 className="text-2xl md:text-3xl font-bold text-white mb-6 flex items-center">
                      <svg className="w-6 h-6 mr-3 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      Key Features
                    </h2>
                    <ul className="space-y-4">
                      {agent.features.map((feature, idx) => (
                        <li key={idx} className="text-gray-300 flex items-start group">
                          <span className="text-purple-400 mr-4 mt-1 text-xl group-hover:scale-110 transition-transform">✓</span>
                          <span className="text-base md:text-lg leading-relaxed flex-1">{feature}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>

              {/* Sidebar - Pricing & CTA */}
              <div className="lg:col-span-1">
                <div className="sticky top-8 bg-gradient-to-br from-slate-800/70 via-slate-800/50 to-slate-900/70 backdrop-blur-2xl border border-purple-500/30 rounded-3xl shadow-2xl p-6 md:p-8 animate-fade-in">
                  <h2 className="text-2xl md:text-3xl font-bold bg-gradient-to-r from-purple-400 to-pink-400 bg-clip-text text-transparent mb-6">
                    Pricing
                  </h2>

                  <div className="mb-6 p-6 bg-gradient-to-br from-purple-500/10 to-pink-500/10 border border-purple-500/30 rounded-2xl backdrop-blur-sm">
                    <div className="text-center">
                      <div className="text-4xl md:text-5xl font-bold bg-gradient-to-r from-purple-400 to-pink-400 bg-clip-text text-transparent mb-2">
                        {agent.price ? `$${agent.price}` : 'Free'}
                      </div>
                      <div className="text-gray-400 text-sm">One-time payment</div>
                    </div>
                  </div>

                  {isUnlocked ? (
                    <div className="p-5 bg-green-500/20 border border-green-500/50 rounded-2xl text-center backdrop-blur-sm">
                      <div className="text-green-400 font-semibold mb-2 flex items-center justify-center">
                        <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        Agent Already Unlocked
                      </div>
                      <div className="text-gray-300 text-sm">This agent is active in your account</div>
                    </div>
                  ) : (
                    <button
                      onClick={handleUnlockClick}
                      className="w-full px-6 py-4 md:py-5 bg-gradient-to-r from-purple-500 via-pink-500 to-purple-500 text-white font-bold text-lg rounded-2xl hover:from-purple-600 hover:via-pink-600 hover:to-purple-600 transition-all duration-300 shadow-2xl shadow-purple-500/40 hover:shadow-purple-500/60 hover:scale-105 relative overflow-hidden group"
                    >
                      <span className="relative z-10 flex items-center justify-center">
                        <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                        </svg>
                        Unlock Now
                      </span>
                      <div className="absolute inset-0 bg-gradient-to-r from-purple-400 to-pink-400 opacity-0 group-hover:opacity-20 transition-opacity duration-300"></div>
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      {toast && <Toast message={toast.message} type={toast.type} />}
      <UnlockFormModal
        agent={agent}
        isOpen={showUnlockModal}
        onClose={() => setShowUnlockModal(false)}
      />
    </div>
  );
}

