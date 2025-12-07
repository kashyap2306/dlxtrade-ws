import { useState, useEffect, useCallback, useRef } from 'react';
import Sidebar from '../components/Sidebar';
import Toast from '../components/Toast';
import { useAuth } from '../hooks/useAuth';
import { agentsApi } from '../services/api';
import AgentCard, { AgentCardData } from '../components/AgentCard';
import UnlockFormModal from '../components/UnlockFormModal';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { LoadingState } from '../components/LoadingState';
import { ErrorState } from '../components/ErrorState';
import { suppressConsoleError } from '../utils/errorHandler';

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
  const [loading, setLoading] = useState(false); // Never show global loading like Research page
  const [error, setError] = useState<any>(null);
  const [retryCount, setRetryCount] = useState(0);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [, setMenuOpen] = useState(false);
  const [selectedAgent, setSelectedAgent] = useState<AgentCardData | null>(null);
  const [showUnlockModal, setShowUnlockModal] = useState(false);
  const isMountedRef = useRef(true);

  const loadData = useCallback(async () => {
    if (!user || !isMountedRef.current) return;

    setLoading(true);
    setError(null);

    try {
      // Load agents and unlocked agents
      const [agentsResult, unlockedResult] = await Promise.allSettled([
        agentsApi.getAll(),
        agentsApi.getUnlocked()
      ]);

      // Handle agents loading
      if (agentsResult.status === 'fulfilled') {
        const backendAgents = agentsResult.value.data.agents || [];

        if (backendAgents.length === 0) {
          console.warn('No agents found in backend. Please add agents to Firestore.');
          // Don't show error toast for empty agents list - might be normal during setup
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

        // Handle unlocked agents loading
        if (unlockedResult.status === 'fulfilled') {
          const unlocked = unlockedResult.value.data.unlocked || [];
          const unlockedMap: Record<string, boolean> = {};

          unlocked.forEach((agentIdOrName: string) => {
            const agent = mappedAgents.find(a => a.id === agentIdOrName || a.name === agentIdOrName);
            if (agent) {
              unlockedMap[agent.id] = true;
            }
          });

          setUnlockedAgents(unlockedMap);
        } else {
          // Unlocked agents failed, but agents loaded - still show agents
          suppressConsoleError(unlockedResult.reason, 'loadUnlockedAgents');
          setUnlockedAgents({});
        }
      } else {
        // Agents failed to load - this is a critical error
        throw agentsResult.reason;
      }

      setRetryCount(0); // Reset retry count on successful load

    } catch (err: any) {
      suppressConsoleError(err, 'loadAgentsData');
      if (isMountedRef.current) {
        setError(err);
        setAgents([]); // Set empty array instead of fallback
      }
    } finally {
      if (isMountedRef.current) {
        setLoading(false);
      }
    }
  }, [user]);

  useEffect(() => {
    if (user) {
      loadData();
    }
  }, [user, loadData]);

  // Emergency timeout: force loading=false after 3 seconds
  useEffect(() => {
    if (loading) {
      const timeout = setTimeout(() => {
        console.log('[AgentsMarketplace] EMERGENCY: Forcing loading=false after 3 seconds');
        if (isMountedRef.current) {
          setLoading(false);
        }
      }, 3000);
      return () => clearTimeout(timeout);
    }
  }, [loading]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

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

  const handleRetry = useCallback(async () => {
    setRetryCount(prev => prev + 1);
    await loadData();
  }, [loadData]);

  // Always render content like Research page - no global loading/error states

  return (
    <ErrorBoundary>
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900/20 to-slate-900">
      {/* Animated background elements */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none z-0">
        <div className="absolute -top-40 -right-40 w-80 h-80 bg-purple-500 rounded-full mix-blend-multiply filter blur-xl opacity-20 animate-blob"></div>
        <div className="absolute -bottom-40 -left-40 w-80 h-80 bg-blue-500 rounded-full mix-blend-multiply filter blur-xl opacity-20 animate-blob animation-delay-2000"></div>
        <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-80 h-80 bg-pink-500 rounded-full mix-blend-multiply filter blur-xl opacity-20 animate-blob animation-delay-4000"></div>
      </div>

      <Sidebar onLogout={logout} onMenuToggle={setMenuOpen} />
      <div className="relative z-10 smooth-scroll">
        {/* Hero Header Section - Mobile Optimized */}
        <div className="relative overflow-hidden bg-gradient-to-br from-purple-900/30 via-pink-900/20 to-slate-900 border-b border-purple-500/20 gpu-accelerated">
          <div
            className="absolute inset-0 opacity-10"
            style={{
              backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%239C92AC' fill-opacity='0.05'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`
            }}
          ></div>
          <div className="relative px-4 sm:px-6 md:px-8 py-8 sm:py-12 md:py-16 lg:py-20">
            <div className="max-w-4xl mx-auto mt-4 sm:mt-8 animate-fade-in">
              <h1 className="text-2xl sm:text-3xl md:text-4xl lg:text-5xl xl:text-6xl font-extrabold bg-gradient-to-r from-purple-400 via-pink-400 to-blue-400 bg-clip-text text-transparent mb-4 leading-tight">
                Discover Premium Trading Agents
              </h1>
              {/* Glowing underline animation - Hidden on mobile */}
              <div className="relative mb-4 sm:mb-6">
                <div className="hidden sm:block absolute bottom-0 left-0 h-1 bg-gradient-to-r from-purple-500 via-pink-500 to-purple-500 rounded-full w-32 animate-pulse shadow-lg shadow-purple-500/50"></div>
              </div>
              <p className="text-base sm:text-lg md:text-xl text-gray-300 max-w-3xl leading-relaxed">
                Choose from our collection of advanced AI-powered agents designed to automate your trading and maximize profits 24/7.
              </p>
            </div>
          </div>
        </div>

        {/* Agents Grid Section */}
        <div className="max-w-7xl mx-auto px-4 py-6 md:py-8 lg:py-12">
            {/* Stats Bar - Mobile Optimized */}
            <div className="grid grid-cols-2 gap-2 md:flex md:space-x-4 mb-6 sm:mb-8">
              <div className="bg-gradient-to-br from-slate-800/70 via-slate-800/50 to-slate-900/70 backdrop-blur-sm border border-purple-500/30 rounded-xl p-3 sm:p-4 text-center animate-fade-in touch-target hover:scale-[1.01] transition-all duration-200 shadow-lg hover:shadow-purple-500/20">
                <div className="text-xl sm:text-2xl md:text-3xl font-bold bg-gradient-to-r from-purple-400 to-pink-400 bg-clip-text text-transparent">
                  {agents.length}
                </div>
                <div className="text-xs sm:text-sm text-gray-400 mt-1">Premium Agents</div>
              </div>
              <div className="bg-gradient-to-br from-slate-800/70 via-slate-800/50 to-slate-900/70 backdrop-blur-sm border border-purple-500/30 rounded-xl p-3 sm:p-4 text-center animate-fade-in touch-target hover:scale-[1.01] transition-all duration-200 shadow-lg hover:shadow-purple-500/20" style={{ animationDelay: '0.1s' }}>
                <div className="text-xl sm:text-2xl md:text-3xl font-bold bg-gradient-to-r from-blue-400 to-cyan-400 bg-clip-text text-transparent">
                  24/7
                </div>
                <div className="text-xs sm:text-sm text-gray-400 mt-1">Active Trading</div>
              </div>
              <div className="bg-gradient-to-br from-slate-800/70 via-slate-800/50 to-slate-900/70 backdrop-blur-sm border border-purple-500/30 rounded-xl p-3 sm:p-4 text-center animate-fade-in touch-target hover:scale-[1.01] transition-all duration-200 shadow-lg hover:shadow-purple-500/20" style={{ animationDelay: '0.2s' }}>
                <div className="text-xl sm:text-2xl md:text-3xl font-bold bg-gradient-to-r from-green-400 to-emerald-400 bg-clip-text text-transparent">
                  AI
                </div>
                <div className="text-xs sm:text-sm text-gray-400 mt-1">Powered</div>
              </div>
              <div className="bg-gradient-to-br from-slate-800/70 via-slate-800/50 to-slate-900/70 backdrop-blur-sm border border-purple-500/30 rounded-xl p-3 sm:p-4 text-center animate-fade-in touch-target hover:scale-[1.01] transition-all duration-200 shadow-lg hover:shadow-purple-500/20" style={{ animationDelay: '0.3s' }}>
                <div className="text-xl sm:text-2xl md:text-3xl font-bold bg-gradient-to-r from-yellow-400 to-orange-400 bg-clip-text text-transparent">
                  ⚡
                </div>
                <div className="text-xs sm:text-sm text-gray-400 mt-1">Lightning Fast</div>
              </div>
            </div>

            {/* Agents Grid - Responsive and Performance Optimized */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6">
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
    </ErrorBoundary>
  );
}

