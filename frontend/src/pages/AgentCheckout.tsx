import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import Sidebar from '../components/Sidebar';
import Header from '../components/Header';
import Toast from '../components/Toast';
import { useAuth } from '../hooks/useAuth';
import { agentsApi } from '../services/api';

export default function AgentCheckout() {
  const { agentId } = useParams<{ agentId: string }>();
  const location = useLocation();
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [agent, setAgent] = useState<any>(null);
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  const showToast = useCallback((message: string, type: 'success' | 'error') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  }, []);

  const checkUnlockedStatus = useCallback(async (agentData: any) => {
    if (!user) {
      setLoading(false);
      return;
    }
    try {
      const unlocksResponse = await agentsApi.getUnlocks();
      console.log('Agent unlocks API response:', unlocksResponse.data);
      const unlocks = unlocksResponse.data.unlocks || [];
      const isUnlocked = unlocks.some((unlock: any) => unlock.agentName === agentData.name);
      setIsUnlocked(isUnlocked);
    } catch (err: any) {
      console.error('Error checking unlock status:', err);
      showToast(err.response?.data?.error || 'Failed to check unlock status', 'error');
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    const loadAgent = async () => {
      setLoading(true);
      // Get agent from location state or find by ID
      const agentFromState = location.state?.agent;
      
      if (agentFromState) {
        setAgent(agentFromState);
        await checkUnlockedStatus(agentFromState);
      } else if (agentId) {
        try {
          // Fetch all agents from backend and find the one matching agentId
          const agentsResponse = await agentsApi.getAll();
          console.log('Agents API response:', agentsResponse.data);
          const agents = agentsResponse.data.agents || [];
          const foundAgent = agents.find((a: any) => 
            (a.id === agentId) || 
            (a.name?.toLowerCase().replace(/\s+/g, '_') === agentId)
          );
          
          if (foundAgent) {
            const mappedAgent = {
              id: foundAgent.id || foundAgent.name?.toLowerCase().replace(/\s+/g, '_') || '',
              name: foundAgent.name || '',
              description: foundAgent.description || '',
              features: foundAgent.features || [],
              price: foundAgent.price || 0,
              whatsappNumber: foundAgent.whatsappNumber || '9155604591',
              category: foundAgent.category || 'Trading',
            };
            setAgent(mappedAgent);
            await checkUnlockedStatus(mappedAgent);
          } else {
            showToast('Agent not found', 'error');
            setLoading(false);
            setTimeout(() => navigate('/agents'), 2000);
          }
        } catch (err: any) {
          console.error('Error loading agent:', err);
          showToast(err.response?.data?.error || 'Failed to load agent', 'error');
          setLoading(false);
          setTimeout(() => navigate('/agents'), 2000);
        }
      } else {
        showToast('No agent specified', 'error');
        setLoading(false);
        setTimeout(() => navigate('/agents'), 2000);
      }
    };

    loadAgent();
  }, [agentId, location.state, navigate, checkUnlockedStatus, showToast]);

  const handleUnlockNow = () => {
    if (!agent) return;
    const message = encodeURIComponent(`I want to unlock ${agent.name}`);
    const whatsappUrl = `https://wa.me/${agent.whatsappNumber}?text=${message}`;
    window.open(whatsappUrl, '_blank');
  };

  if (loading || !agent) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900/20 to-slate-900 flex items-center justify-center">
        <div className="text-lg text-gray-300">Loading checkout...</div>
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
            <div className="flex items-center gap-4 mb-6">
              <Header
                onMenuToggle={() => {
                  const toggle = (window as any).__sidebarToggle;
                  if (toggle) toggle();
                }}
                menuOpen={menuOpen}
              />
              <button
                onClick={() => navigate('/agents')}
                className="ml-auto flex items-center space-x-2 text-gray-400 hover:text-white transition-all duration-300 group"
              >
                <svg className="w-5 h-5 group-hover:-translate-x-1 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
                <span className="font-medium hidden sm:inline">Back to Marketplace</span>
              </button>
            </div>
            <div className="max-w-4xl mx-auto animate-fade-in">
              <div className="inline-block px-4 py-2 mb-6 bg-purple-500/20 border border-purple-500/50 rounded-full text-purple-300 text-sm font-semibold backdrop-blur-sm">
                {agent.category}
              </div>
              <h1 className="text-3xl sm:text-4xl md:text-5xl lg:text-6xl font-extrabold bg-gradient-to-r from-purple-400 via-pink-400 to-blue-400 bg-clip-text text-transparent mb-6 leading-tight">
                {agent.name}
              </h1>
              {/* Glowing underline animation */}
              <div className="relative mb-6">
                <div className="absolute bottom-0 left-0 h-1 bg-gradient-to-r from-purple-500 via-pink-500 to-purple-500 rounded-full w-32 animate-pulse shadow-lg shadow-purple-500/50"></div>
              </div>
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
              {/* Left Column - Features & Info */}
              <div className="lg:col-span-2 space-y-6">
                {/* What You Will Get Section */}
                <div className="bg-gradient-to-br from-slate-800/70 via-slate-800/50 to-slate-900/70 backdrop-blur-2xl border border-purple-500/30 rounded-3xl shadow-2xl p-6 md:p-8 animate-slide-up">
                  <h3 className="text-2xl md:text-3xl font-bold text-white mb-6 flex items-center">
                    <svg className="w-6 h-6 mr-3 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    What You Will Get
                  </h3>
                  <ul className="space-y-4">
                    {agent.features.map((feature: string, idx: number) => (
                      <li key={idx} className="text-gray-300 flex items-start group">
                        <span className="text-purple-400 mr-4 mt-1 text-xl group-hover:scale-110 transition-transform">✓</span>
                        <span className="text-base md:text-lg leading-relaxed">{feature}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                {/* Why This Agent is Premium Section */}
                <div className="bg-gradient-to-br from-slate-800/70 via-slate-800/50 to-slate-900/70 backdrop-blur-2xl border border-purple-500/30 rounded-3xl shadow-2xl p-6 md:p-8 animate-slide-up" style={{ animationDelay: '0.1s' }}>
                  <h3 className="text-2xl md:text-3xl font-bold text-white mb-6 flex items-center">
                    <svg className="w-6 h-6 mr-3 text-pink-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
                    </svg>
                    Why This Agent is Premium
                  </h3>
                  <div className="space-y-4 text-gray-300">
                    <p className="text-base md:text-lg leading-relaxed">
                      This premium agent leverages cutting-edge AI technology and real-time market analysis to deliver exceptional trading performance. With automated execution and intelligent risk management, you'll have access to professional-grade trading tools that work 24/7.
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-6">
                      <div className="flex items-start space-x-3">
                        <div className="w-10 h-10 rounded-lg bg-purple-500/20 border border-purple-500/50 flex items-center justify-center flex-shrink-0">
                          <svg className="w-5 h-5 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                          </svg>
                        </div>
                        <div>
                          <div className="font-semibold text-white">Lightning Fast</div>
                          <div className="text-sm text-gray-400">Micro-second execution</div>
                        </div>
                      </div>
                      <div className="flex items-start space-x-3">
                        <div className="w-10 h-10 rounded-lg bg-pink-500/20 border border-pink-500/50 flex items-center justify-center flex-shrink-0">
                          <svg className="w-5 h-5 text-pink-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                          </svg>
                        </div>
                        <div>
                          <div className="font-semibold text-white">Secure & Reliable</div>
                          <div className="text-sm text-gray-400">Enterprise-grade security</div>
                        </div>
                      </div>
                      <div className="flex items-start space-x-3">
                        <div className="w-10 h-10 rounded-lg bg-blue-500/20 border border-blue-500/50 flex items-center justify-center flex-shrink-0">
                          <svg className="w-5 h-5 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                          </svg>
                        </div>
                        <div>
                          <div className="font-semibold text-white">AI-Powered</div>
                          <div className="text-sm text-gray-400">Advanced algorithms</div>
                        </div>
                      </div>
                      <div className="flex items-start space-x-3">
                        <div className="w-10 h-10 rounded-lg bg-green-500/20 border border-green-500/50 flex items-center justify-center flex-shrink-0">
                          <svg className="w-5 h-5 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                        </div>
                        <div>
                          <div className="font-semibold text-white">24/7 Active</div>
                          <div className="text-sm text-gray-400">Never miss opportunities</div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Right Column - Checkout Panel */}
              <div className="lg:col-span-1">
                <div className="sticky top-8 bg-gradient-to-br from-slate-800/70 via-slate-800/50 to-slate-900/70 backdrop-blur-2xl border border-purple-500/30 rounded-3xl shadow-2xl p-6 md:p-8 animate-fade-in">
                  <h2 className="text-2xl md:text-3xl font-bold bg-gradient-to-r from-purple-400 to-pink-400 bg-clip-text text-transparent mb-8">
                    Checkout
                  </h2>

                  {/* Pricing Box */}
                  <div className="mb-6 p-6 bg-gradient-to-br from-purple-500/10 to-pink-500/10 border border-purple-500/30 rounded-2xl backdrop-blur-sm">
                    <div className="space-y-4 mb-6">
                      <div className="flex items-center justify-between">
                        <span className="text-gray-400 text-sm">Agent</span>
                        <span className="text-white font-medium text-sm text-right max-w-[60%]">{agent.name}</span>
                      </div>
                      <div className="flex items-center justify-between pb-4 border-b border-purple-500/20">
                        <span className="text-gray-400 text-sm">Price</span>
                        <span className="text-3xl md:text-4xl font-bold bg-gradient-to-r from-purple-400 to-pink-400 bg-clip-text text-transparent">
                          ${agent.price}
                        </span>
                      </div>
                      <div className="flex items-center justify-between pt-2">
                        <span className="text-gray-300 font-semibold">Total</span>
                        <span className="text-2xl md:text-3xl font-bold text-white">${agent.price}</span>
                      </div>
                    </div>
                  </div>

                  {/* Unlock Status */}
                  {isUnlocked ? (
                    <div className="p-5 bg-green-500/20 border border-green-500/50 rounded-2xl text-center mb-6 backdrop-blur-sm">
                      <div className="text-green-400 font-semibold mb-2 flex items-center justify-center">
                        <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        Agent Already Unlocked
                      </div>
                      <div className="text-gray-300 text-sm">This agent is active in your account</div>
                    </div>
                  ) : (
                    <>
                      <button
                        onClick={handleUnlockNow}
                        className="w-full px-6 py-4 md:py-5 bg-gradient-to-r from-purple-500 via-pink-500 to-purple-500 text-white font-bold text-lg rounded-2xl hover:from-purple-600 hover:via-pink-600 hover:to-purple-600 transition-all duration-300 shadow-2xl shadow-purple-500/40 hover:shadow-purple-500/60 hover:scale-105 mb-4 relative overflow-hidden group"
                      >
                        <span className="relative z-10 flex items-center justify-center">
                          <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                          </svg>
                          Unlock Now
                        </span>
                        <div className="absolute inset-0 bg-gradient-to-r from-purple-400 to-pink-400 opacity-0 group-hover:opacity-20 transition-opacity duration-300"></div>
                        <div className="absolute inset-0 bg-white/10 opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
                      </button>
                      <p className="text-gray-400 text-xs md:text-sm text-center mb-6">
                        You will be redirected to WhatsApp to complete the purchase
                      </p>
                    </>
                  )}

                  {/* Payment Status */}
                  <div className="p-5 bg-gradient-to-br from-slate-700/40 to-slate-800/40 border border-purple-500/20 rounded-2xl backdrop-blur-sm">
                    <div className="text-xs font-semibold text-gray-400 mb-3 uppercase tracking-wide">Payment Status</div>
                    <div className="text-base md:text-lg font-bold">
                      {isUnlocked ? (
                        <span className="text-green-400 flex items-center space-x-2">
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                          <span>Paid & Unlocked</span>
                        </span>
                      ) : (
                        <span className="text-yellow-400 flex items-center space-x-2">
                          <svg className="w-5 h-5 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                          <span>Pending Payment</span>
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      {toast && <Toast message={toast.message} type={toast.type} />}
    </div>
  );
}

