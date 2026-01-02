import { useState, useEffect, useCallback, useRef } from 'react';
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
  unlocked?: boolean;
  displayOrder?: number;
  requestStatus?: 'pending' | 'approved' | 'rejected';
}

export default function AgentsMarketplace() {
  const { user, logout } = useAuth();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [unlockedAgents, setUnlockedAgents] = useState<Record<string, boolean>>({});
  const [agentRequests, setAgentRequests] = useState<Record<string, { status: string; requestedAt?: string }>>({});
  const [agentDataMap, setAgentDataMap] = useState<Record<string, any>>({});
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
      // PRIMARY: Fetch agents directly from Firestore (users/{uid}/agents)
      // Each document in users/{uid}/agents is a separate agent
      // agentId = document ID, agent data = document data
      const { db } = await import('../config/firebase');
      const { collection, getDocs } = await import('firebase/firestore');
      const agentsSnapshot = await getDocs(collection(db, 'users', user.uid, 'agents'));
      
      // TEMPORARY DEBUG: Log fetched agent documents
      const agentDocs: Array<{ id: string; data: any }> = [];
      agentsSnapshot.forEach((doc) => {
        agentDocs.push({ id: doc.id, data: doc.data() });
      });
      console.log('[AgentsMarketplace] Fetched agent documents:', {
        count: agentDocs.length,
        agentIds: agentDocs.map(d => d.id),
        agents: agentDocs
      });

      if (isMountedRef.current) {
        // Fetch all agents metadata from global agents collection (for enrichment)
        let allAgentsMetadata: any[] = [];
        try {
          const allAgentsResponse = await agentsApi.getAll();
          allAgentsMetadata = allAgentsResponse.data.agents || [];
        } catch (err) {
          console.warn('Failed to load global agents metadata:', err);
        }

        // Process each document from users/{uid}/agents as a separate agent
        const combinedAgents: Agent[] = [];
        const unlockedMap: Record<string, boolean> = {};

        // Process all agents from user's Firestore collection
        agentsSnapshot.forEach((doc) => {
          const agentId = doc.id; // Document ID is the agent ID
          const agentData = doc.data(); // Document data contains agent properties

          // Skip system documents
          if (agentId === '_init' || agentId.startsWith('_')) {
            return;
          }

          // Agent is unlocked if explicitly unlocked or approved
          const isUnlocked = agentData?.unlocked === true || agentData?.status === 'approved';
          unlockedMap[agentId] = isUnlocked;

          // Store agent data for later use
          agentDataMap[agentId] = agentData;

          // Find matching metadata from global agents collection (optional enrichment)
          const metadata = allAgentsMetadata.find((a: any) => 
            a.id === agentId || 
            a.name === agentId ||
            a.name?.toLowerCase().replace(/\s+/g, '_') === agentId
          );

          // Use metadata if available, otherwise use document data
          const finalAgent = metadata || agentData;
          combinedAgents.push({
            id: agentId,
            name: finalAgent?.name || agentData?.name || agentId.replace(/_/g, ' ').replace(/\b\w/g, (l: string) => l.toUpperCase()),
            description: finalAgent?.description || agentData?.description || '',
            features: finalAgent?.features || agentData?.features || [],
            price: finalAgent?.price || agentData?.price || 0,
            whatsappNumber: finalAgent?.whatsappNumber || agentData?.whatsappNumber || '9155604591',
            category: finalAgent?.category || agentData?.category || 'Trading',
            badge: finalAgent?.badge || agentData?.badge,
            imageUrl: finalAgent?.imageUrl || agentData?.imageUrl,
            enabled: agentData?.enabled !== undefined ? agentData.enabled : (finalAgent?.enabled !== false),
            displayOrder: finalAgent?.displayOrder || agentData?.displayOrder || 999,
            unlocked: isUnlocked,
          });
        });

        // Also include any agents from global collection that aren't in user's collection yet
        allAgentsMetadata.forEach((metadata: any) => {
          const agentId = metadata.id || metadata.name?.toLowerCase().replace(/\s+/g, '_') || '';
          if (!combinedAgents.find(a => a.id === agentId)) {
            combinedAgents.push({
              id: agentId,
              name: metadata.name || '',
              description: metadata.description || '',
              features: metadata.features || [],
              price: metadata.price || 0,
              whatsappNumber: metadata.whatsappNumber || '9155604591',
              category: metadata.category || 'Trading',
              badge: metadata.badge,
              imageUrl: metadata.imageUrl,
              enabled: metadata.enabled !== false,
              displayOrder: metadata.displayOrder || 999,
              unlocked: false,
            });
          }
        });

        // Sort by displayOrder
        combinedAgents.sort((a, b) => (a.displayOrder || 999) - (b.displayOrder || 999));

        console.log('[AgentsMarketplace] Final combined agents:', {
          count: combinedAgents.length,
          agentIds: combinedAgents.map(a => a.id),
          enabledCount: combinedAgents.filter(a => a.enabled !== false).length
        });

        setAgents(combinedAgents);
        setUnlockedAgents(unlockedMap);
        setAgentDataMap(agentDataMap);
        
        // TEMPORARY DEBUG: Log count after state update
        console.log('[AgentsMarketplace] Rendered agents count:', combinedAgents.length, 'Agent IDs:', combinedAgents.map(a => a.id));

        // Load agent requests to show pending status
        try {
          const { db } = await import('../config/firebase');
          const { collection, query, where, getDocs } = await import('firebase/firestore');
          const requestsQuery = query(collection(db, 'users', user.uid, 'agentRequests'));
          const requestsSnapshot = await getDocs(requestsQuery);
          const requestsMap: Record<string, { status: string; requestedAt?: string }> = {};
          requestsSnapshot.forEach((doc) => {
            const data = doc.data();
            requestsMap[doc.id] = {
              status: data.status || 'pending',
              requestedAt: data.requestedAt?.toDate?.()?.toISOString() || data.requestedAt,
            };
          });
          if (isMountedRef.current) {
            setAgentRequests(requestsMap);
          }
        } catch (requestsErr: any) {
          console.warn('Failed to load agent requests:', requestsErr);
        }
      }

      setRetryCount(0); // Reset retry count on successful load

    } catch (err: any) {
      suppressConsoleError(err, 'loadAgentsData');
      if (isMountedRef.current) {
        setError(err);
        setAgents([]);
        setUnlockedAgents({});
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

  const handleUnlockClick = async (agent: AgentCardData) => {
    if (!user) return;

    // Check if there's already a pending request
    const existingRequest = agentRequests[agent.id || agent.name];
    if (existingRequest?.status === 'pending') {
      showToast('Request already pending. Awaiting admin approval.', 'error');
      return;
    }

    // Check if already unlocked
    if (unlockedAgents[agent.id || agent.name]) {
      showToast('Agent is already unlocked', 'error');
      return;
    }

    setSelectedAgent(agent);
    setShowUnlockModal(true);
  };

  const handleBuyRequest = async (agent: AgentCardData, formData: { fullName: string; phoneNumber: string; email: string }) => {
    if (!user) return;

    try {
      // Create buy request in Firestore: users/{uid}/agentRequests/{agentId}
      const { db } = await import('../config/firebase');
      const { doc, setDoc, serverTimestamp } = await import('firebase/firestore');
      const requestRef = doc(db, 'users', user.uid, 'agentRequests', agent.id || agent.name);
      
      await setDoc(requestRef, {
        agentId: agent.id || agent.name,
        agentName: agent.name,
        fullName: formData.fullName,
        phoneNumber: formData.phoneNumber,
        email: formData.email,
        status: 'pending',
        requestedAt: serverTimestamp(),
      });

      // Update local state
      setAgentRequests({
        ...agentRequests,
        [agent.id || agent.name]: { status: 'pending' },
      });

      showToast('Buy request submitted. Awaiting admin approval.', 'success');
      setShowUnlockModal(false);
      setSelectedAgent(null);
    } catch (err: any) {
      console.error('Error submitting buy request:', err);
      showToast('Failed to submit buy request', 'error');
    }
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
                .map((agent, index) => {
                  const isUnlocked = unlockedAgents[agent.id] === true;
                  const agentData = agentDataMap[agent.id];
                  let requestStatus: 'pending' | 'approved' | 'rejected' | undefined;

                  if (isUnlocked) {
                    requestStatus = 'approved';
                  } else if (agentData?.status === 'pending') {
                    requestStatus = 'pending';
                  } else if (agentData?.status === 'rejected') {
                    requestStatus = 'rejected';
                  }

                  return (
                    <AgentCard
                      key={agent.id}
                      agent={{
                        ...agent,
                        requestStatus: requestStatus as 'pending' | 'approved' | 'rejected' | undefined,
                      }}
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
        onSuccess={(formData) => {
          if (selectedAgent) {
            handleBuyRequest(selectedAgent, formData);
          }
        }}
      />
    </ErrorBoundary>
  );
}

