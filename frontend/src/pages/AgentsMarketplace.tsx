import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import Sidebar from '../components/Sidebar';
import Header from '../components/Header';
import Toast from '../components/Toast';
import { useAuth } from '../hooks/useAuth';
import { agentsApi } from '../services/api';

interface Agent {
  id: string;
  name: string;
  description: string;
  features: string[];
  price: number;
  whatsappNumber?: string;
  category: string;
  badge?: string;
}

export default function AgentsMarketplace() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [unlockedAgents, setUnlockedAgents] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

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
      }));
      
      setAgents(mappedAgents);

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

  const handleAgentClick = (agent: Agent) => {
    // Navigate to checkout page with agent data
    navigate(`/checkout/${agent.id}`, { state: { agent } });
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
      <div className="relative z-10">
        {/* Hero Header Section */}
        <div className="relative overflow-hidden bg-gradient-to-br from-purple-900/30 via-pink-900/20 to-slate-900 border-b border-purple-500/20">
          <div 
            className="absolute inset-0 opacity-10"
            style={{
              backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%239C92AC' fill-opacity='0.05'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`
            }}
          ></div>
          <div className="relative px-4 sm:px-6 md:px-8 py-8 sm:py-12 md:py-16 lg:py-20">
            <Header
              title="Premium Agents Marketplace"
              subtitle="Unlock powerful AI-powered trading agents to maximize your profits and automate your trading strategy"
              onMenuToggle={() => {
                const toggle = (window as any).__sidebarToggle;
                if (toggle) toggle();
              }}
              menuOpen={menuOpen}
            />
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

            {/* Agents Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 lg:gap-8">
              {agents.map((agent, index) => {
                const isUnlocked = unlockedAgents[agent.id] || false;
                return (
                  <div
                    key={agent.id}
                    onClick={() => !isUnlocked && handleAgentClick(agent)}
                    className={`group relative bg-gradient-to-br from-slate-800/70 via-slate-800/50 to-slate-900/70 backdrop-blur-2xl border border-purple-500/30 rounded-3xl shadow-2xl p-6 md:p-8 cursor-pointer transition-all duration-500 hover:border-purple-500/60 hover:shadow-purple-500/30 hover:-translate-y-2 hover:scale-[1.02] overflow-hidden animate-slide-up`}
                    style={{ animationDelay: `${index * 0.1}s` }}
                  >
                    {/* Gradient overlay on hover */}
                    <div className="absolute inset-0 bg-gradient-to-br from-purple-500/0 to-pink-500/0 group-hover:from-purple-500/10 group-hover:to-pink-500/10 transition-all duration-500 pointer-events-none"></div>
                    
                    {/* Badge */}
                    {agent.badge && (
                      <div className="absolute top-4 right-4 px-3 py-1.5 bg-gradient-to-r from-purple-500/30 to-pink-500/30 border border-purple-400/50 rounded-full text-purple-300 text-xs font-semibold backdrop-blur-sm z-10">
                        {agent.badge}
                      </div>
                    )}

                    {/* Unlocked Badge */}
                    {isUnlocked && (
                      <div className="absolute top-4 right-4 px-3 py-1.5 bg-green-500/20 border border-green-500/50 rounded-full text-green-400 text-xs font-medium backdrop-blur-sm z-10 flex items-center space-x-1">
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        <span>Unlocked</span>
                      </div>
                    )}

                    {/* Category Tag */}
                    <div className="inline-block px-3 py-1.5 mb-4 bg-purple-500/10 border border-purple-500/30 rounded-lg text-purple-300 text-xs font-semibold backdrop-blur-sm">
                      {agent.category}
                    </div>

                    <h3 className="text-xl md:text-2xl font-bold text-white mb-3 group-hover:text-purple-300 transition-colors relative z-10">
                      {agent.name}
                    </h3>
                    <p className="text-gray-400 text-sm md:text-base mb-6 leading-relaxed relative z-10">{agent.description}</p>

                    {/* Features */}
                    {agent.features && agent.features.length > 0 && (
                      <div className="mb-6 relative z-10">
                        <div className="text-xs text-gray-500 mb-3 font-semibold uppercase tracking-wide flex items-center">
                          <svg className="w-4 h-4 mr-2 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                          Key Features
                        </div>
                        <ul className="space-y-2.5">
                          {agent.features.slice(0, 3).map((feature, idx) => (
                            <li key={idx} className="text-gray-300 text-sm flex items-start group-hover:text-gray-200 transition-colors">
                              <span className="text-purple-400 mr-3 mt-1 text-lg group-hover:scale-110 transition-transform">✓</span>
                              <span className="leading-relaxed">{feature}</span>
                            </li>
                          ))}
                          {agent.features.length > 3 && (
                            <li className="text-purple-400 text-sm font-medium">
                              +{agent.features.length - 3} more features
                            </li>
                          )}
                        </ul>
                      </div>
                    )}

                    {/* Price and CTA */}
                    <div className="flex items-center justify-between pt-6 border-t border-purple-500/20 relative z-10">
                      <div>
                        <div className="text-xs text-gray-500 uppercase tracking-wide mb-1">Price</div>
                        <div className="text-3xl md:text-4xl font-bold bg-gradient-to-r from-purple-400 to-pink-400 bg-clip-text text-transparent">
                          ${agent.price}
                        </div>
                      </div>
                      {!isUnlocked && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleAgentClick(agent);
                          }}
                          className="px-6 py-3 bg-gradient-to-r from-purple-500 via-pink-500 to-purple-500 text-white font-semibold rounded-xl hover:from-purple-600 hover:via-pink-600 hover:to-purple-600 transition-all shadow-lg shadow-purple-500/30 hover:shadow-purple-500/50 hover:scale-105 relative overflow-hidden group/btn"
                        >
                          <span className="relative z-10 flex items-center space-x-2">
                            <span>View Details</span>
                            <svg className="w-4 h-4 group-hover/btn:translate-x-1 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                            </svg>
                          </span>
                          <div className="absolute inset-0 bg-gradient-to-r from-purple-400 to-pink-400 opacity-0 group-hover/btn:opacity-20 transition-opacity"></div>
                        </button>
                      )}
                      {isUnlocked && (
                        <div className="px-6 py-3 bg-green-500/20 border border-green-500/50 rounded-xl text-green-400 font-semibold flex items-center space-x-2 backdrop-blur-sm">
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                          <span>Active</span>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
      {toast && <Toast message={toast.message} type={toast.type} />}
    </div>
  );
}

