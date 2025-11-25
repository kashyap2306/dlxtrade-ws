import { useState, useEffect } from 'react';
import Sidebar from '../components/Sidebar';
import Toast from '../components/Toast';
import { useAuth } from '../hooks/useAuth';
import { agentsApi } from '../services/api';
import AgentCard, { AgentCardData } from '../components/AgentCard';
import UnlockFormModal from '../components/UnlockFormModal';

interface Agent {
  id: string;
  name: string;
  description: string;
  features: string[];
  price: number;
  whatsappNumber?: string;
  category: string;
  badge?: string;
  imageUrl?: string;
  enabled?: boolean;
}

export default function AgentsMarketplace() {
  const { user, logout } = useAuth();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [unlockedAgents, setUnlockedAgents] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [, setMenuOpen] = useState(false);
  const [selectedAgent, setSelectedAgent] = useState<AgentCardData | null>(null);
  const [showUnlockModal, setShowUnlockModal] = useState(false);

  useEffect(() => {
    if (user) {
      loadData();
    }
  }, [user]);

  const loadData = async () => {
    if (!user) return;
    setLoading(true);
    try {
      // Load agents from backend
      const agentsResponse = await agentsApi.getAll();
      console.log('Agents API response:', agentsResponse.data);
      const backendAgents = agentsResponse.data.agents || [];
      
      if (backendAgents.length === 0) {
        console.warn('No agents found in backend. Please add agents to Firestore.');
        showToast('No agents available. Please contact admin.', 'error');
      }
      
      // Map backend agents to frontend format
      const mappedAgents = backendAgents.map((agent: any) => ({
        id: agent.id || agent.name?.toLowerCase().replace(/\s+/g, '_') || '',
        name: agent.name || '',
        description: agent.description || '',
        features: agent.features || [],
        price: agent.price || 0,
        whatsappNumber: agent.whatsappNumber || '9155604591',
        category: agent.category || 'Trading',
        badge: agent.badge,
        imageUrl: agent.imageUrl,
        enabled: agent.enabled !== false, // Default to enabled if not specified
        displayOrder: agent.displayOrder || 999, // Default high number for sorting
      }));
      
      // Sort agents by displayOrder (Premium Trading Agent first)
      const sortedAgents = mappedAgents.sort((a, b) => (a.displayOrder || 999) - (b.displayOrder || 999));
      setAgents(sortedAgents);

      // Load unlocked agents from backend
      const unlocksResponse = await agentsApi.getUnlocks();
      console.log('Agent unlocks API response:', unlocksResponse.data);
      const unlocks = unlocksResponse.data.unlocks || [];
      const unlockedMap: Record<string, boolean> = {};
      
      unlocks.forEach((unlock: any) => {
        const agent = mappedAgents.find(a => a.name === unlock.agentName);
        if (agent) {
          unlockedMap[agent.id] = true;
        }
      });
      
      setUnlockedAgents(unlockedMap);
    } catch (err: any) {
      console.error('Error loading data:', err);
      showToast(err.response?.data?.error || 'Failed to load agents', 'error');
      setAgents([]); // Set empty array instead of fallback
    } finally {
      setLoading(false);
    }
  };

  const handleUnlockClick = (agent: AgentCardData) => {
    setSelectedAgent(agent);
    setShowUnlockModal(true);
  };

  const handleCloseModal = () => {
    setShowUnlockModal(false);
    setSelectedAgent(null);
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
      {/* Animated background elements */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none z-0">
        <div className="absolute -top-40 -right-40 w-80 h-80 bg-purple-500 rounded-full mix-blend-multiply filter blur-xl opacity-20 animate-blob"></div>
        <div className="absolute -bottom-40 -left-40 w-80 h-80 bg-blue-500 rounded-full mix-blend-multiply filter blur-xl opacity-20 animate-blob animation-delay-2000"></div>
        <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-80 h-80 bg-pink-500 rounded-full mix-blend-multiply filter blur-xl opacity-20 animate-blob animation-delay-4000"></div>
      </div>

      <Sidebar onLogout={logout} onMenuToggle={setMenuOpen} />
      <div className="relative z-10 pt-16 lg:pt-0">
        {/* Hero Header Section */}
        <div className="relative overflow-hidden bg-gradient-to-br from-purple-900/30 via-pink-900/20 to-slate-900 border-b border-purple-500/20">
          <div 
            className="absolute inset-0 opacity-10"
            style={{
              backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%239C92AC' fill-opacity='0.05'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`
            }}
          ></div>
          <div className="relative px-4 sm:px-6 md:px-8 py-6 sm:py-8 md:py-12 lg:py-20">
            <div className="max-w-4xl mx-auto mt-8 animate-fade-in">
              <h1 className="text-3xl sm:text-4xl md:text-5xl lg:text-6xl font-extrabold bg-gradient-to-r from-purple-400 via-pink-400 to-blue-400 bg-clip-text text-transparent mb-4 leading-tight">
                Discover Premium Trading Agents
              </h1>
              {/* Glowing underline animation */}
              <div className="relative mb-6">
                <div className="absolute bottom-0 left-0 h-1 bg-gradient-to-r from-purple-500 via-pink-500 to-purple-500 rounded-full w-32 animate-pulse shadow-lg shadow-purple-500/50"></div>
              </div>
              <p className="text-lg sm:text-xl text-gray-300 max-w-3xl leading-relaxed">
                Choose from our collection of advanced AI-powered agents designed to automate your trading and maximize profits 24/7.
              </p>
            </div>
          </div>
        </div>

        {/* Agents Grid Section */}
        <div className="p-4 sm:p-6 md:p-8 lg:p-12">
          <div className="max-w-7xl mx-auto">
            {/* Stats Bar */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
              <div className="bg-gradient-to-br from-slate-800/70 via-slate-800/50 to-slate-900/70 backdrop-blur-2xl border border-purple-500/30 rounded-2xl p-4 text-center animate-fade-in">
                <div className="text-2xl md:text-3xl font-bold bg-gradient-to-r from-purple-400 to-pink-400 bg-clip-text text-transparent">
                  {agents.length}
                </div>
                <div className="text-xs md:text-sm text-gray-400 mt-1">Premium Agents</div>
              </div>
              <div className="bg-gradient-to-br from-slate-800/70 via-slate-800/50 to-slate-900/70 backdrop-blur-2xl border border-purple-500/30 rounded-2xl p-4 text-center animate-fade-in" style={{ animationDelay: '0.1s' }}>
                <div className="text-2xl md:text-3xl font-bold bg-gradient-to-r from-blue-400 to-cyan-400 bg-clip-text text-transparent">
                  24/7
                </div>
                <div className="text-xs md:text-sm text-gray-400 mt-1">Active Trading</div>
              </div>
              <div className="bg-gradient-to-br from-slate-800/70 via-slate-800/50 to-slate-900/70 backdrop-blur-2xl border border-purple-500/30 rounded-2xl p-4 text-center animate-fade-in" style={{ animationDelay: '0.2s' }}>
                <div className="text-2xl md:text-3xl font-bold bg-gradient-to-r from-green-400 to-emerald-400 bg-clip-text text-transparent">
                  AI
                </div>
                <div className="text-xs md:text-sm text-gray-400 mt-1">Powered</div>
              </div>
              <div className="bg-gradient-to-br from-slate-800/70 via-slate-800/50 to-slate-900/70 backdrop-blur-2xl border border-purple-500/30 rounded-2xl p-4 text-center animate-fade-in" style={{ animationDelay: '0.3s' }}>
                <div className="text-2xl md:text-3xl font-bold bg-gradient-to-r from-yellow-400 to-orange-400 bg-clip-text text-transparent">
                  ⚡
                </div>
                <div className="text-xs md:text-sm text-gray-400 mt-1">Lightning Fast</div>
              </div>
            </div>

            {/* Agents Grid - Using Shared AgentCard Component */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 sm:gap-6">
              {agents
                .filter((agent) => agent.enabled !== false)
                .map((agent, index) => {
                  const isUnlocked = unlockedAgents[agent.id] || false;

                  return (
                    <AgentCard
                      key={agent.id}
                      agent={agent}
                      isUnlocked={isUnlocked}
                      onUnlockClick={handleUnlockClick}
                      index={index}
                    />
                  );
                })}
            </div>
          </div>
        </div>
      </div>
      {toast && <Toast message={toast.message} type={toast.type} />}
      <UnlockFormModal
        agent={selectedAgent}
        isOpen={showUnlockModal}
        onClose={handleCloseModal}
      />
    </div>
  );
}

