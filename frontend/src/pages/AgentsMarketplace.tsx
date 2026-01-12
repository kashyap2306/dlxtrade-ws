import { useState, useEffect } from 'react';
import { useAuth } from '../hooks/useAuth';
import { agentsApi } from '../services/api';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../config/firebase-config';
import Toast from '../components/Toast';

interface Agent {
  id: string;
  name: string;
  description: string;
  price: number;
  features: string[];
  icon?: string;
  category: string;
  badge?: string;
}

export default function AgentsMarketplace() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  // Hardcoded agents as per requirements - only these 2
  const availableAgents: Agent[] = [
    {
      id: 'TRADING_AGENT',
      name: 'Rule-Based Trading Agent',
      description: 'Fully automated trading agent with RSI/Bollinger Bands strategy. Executes deterministic trades 24/7 with SL/TP protection.',
      price: 500,
      features: [
        'RSI + Bollinger Bands signals',
        'Stop Loss & Take Profit',
        'BTC/USDT & ETH/USDT pairs',
        'Spot & Futures markets',
        'Daily safety limits',
        'Admin approval required'
      ],
      icon: '📊',
      category: 'Trading Bot',
      badge: 'Premium'
    },
    {
      id: 'COPY_TRADING_AGENT',
      name: 'Crowd Consensus Copy Trade Agent',
      description: 'Follows crowd consensus across 10+ exchanges, trades when multiple exchanges agree on direction',
      price: 600,
      features: [
        'Monitors 10+ exchanges for consensus signals',
        'Detects crowd LONG/SHORT direction',
        'Auto-trades on one exchange when consensus is strong',
        'Risk management with SL/TP',
        'No individual trader data accessed'
      ],
      icon: '👥',
      category: 'Copy Trading',
      badge: 'Advanced'
    }
  ];

  useEffect(() => {
    // Simple loading effect
    setTimeout(() => setLoading(false), 1000);
  }, []);

  const handleRequestAgent = async (agent: Agent) => {
    if (!user) return;

    setSubmitting(agent.id);
    try {
      let tradingAgentId: string | null = null;

      if (agent.id === 'TRADING_AGENT') {
        const resp = await agentsApi.createTradingAgentRequest({
          userId: user.uid,
          name: 'Rule-Based Trading Agent',
          tradingPair: 'BTC/USDT',
          marketType: 'spot',
        });
        tradingAgentId = resp.data?.agentId || null;
      }

      // Create agent request document in Firestore
      await addDoc(collection(db, 'agentRequests'), {
        agentId: agent.id,
        agentType: agent.id === 'TRADING_AGENT' ? 'TRADING' : 'COPY',
        requestedBy: user.uid,
        status: 'PENDING_APPROVAL',
        tradingAgentId,
        createdAt: serverTimestamp()
      });

      setToast({
        message: `Request for ${agent.name} submitted successfully! Awaiting admin approval.`,
        type: 'success'
      });
    } catch (err: any) {
      console.error('Error requesting agent:', err);
      setToast({
        message: 'Failed to submit request. Please try again.',
        type: 'error'
      });
    } finally {
      setSubmitting(null);
    }
  };

  const showToast = (message: string, type: 'success' | 'error') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 5000);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900/20 to-slate-900 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4"></div>
          <p className="text-blue-200">Loading Agents Marketplace...</p>
        </div>
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

      <div className="relative z-10 smooth-scroll">
        {/* Hero Header Section */}
        <div className="relative overflow-hidden bg-gradient-to-br from-purple-900/30 via-pink-900/20 to-slate-900 border-b border-purple-500/20 gpu-accelerated">
          <div className="relative px-4 sm:px-6 md:px-8 py-8 sm:py-12 md:py-16 lg:py-20">
            <div className="max-w-4xl mx-auto mt-4 sm:mt-8 animate-fade-in">
              <h1 className="text-2xl sm:text-3xl md:text-4xl lg:text-5xl xl:text-6xl font-extrabold bg-gradient-to-r from-purple-400 via-pink-400 to-blue-400 bg-clip-text text-transparent mb-4 leading-tight">
                Discover Premium Trading Agents
              </h1>
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
          {/* Stats Bar */}
          <div className="grid grid-cols-2 gap-2 md:flex md:space-x-4 mb-6 sm:mb-8">
            <div className="bg-gradient-to-br from-slate-800/70 via-slate-800/50 to-slate-900/70 backdrop-blur-sm border border-purple-500/30 rounded-xl p-3 sm:p-4 text-center animate-fade-in touch-target hover:scale-[1.01] transition-all duration-200 shadow-lg hover:shadow-purple-500/20">
              <div className="text-xl sm:text-2xl md:text-3xl font-bold bg-gradient-to-r from-purple-400 to-pink-400 bg-clip-text text-transparent">
                {availableAgents.length}
              </div>
              <div className="text-xs sm:text-sm text-gray-400 mt-1">Premium Agents</div>
            </div>
            <div className="bg-gradient-to-br from-slate-800/70 via-slate-800/50 to-slate-900/70 backdrop-blur-sm border border-purple-500/30 rounded-xl p-3 sm:p-4 text-center animate-fade-in touch-target hover:scale-[1.01] transition-all duration-200 shadow-lg hover:shadow-purple-500/20" style={{ animationDelay: '0.1s' }}>
              <div className="text-xl sm:text-2xl md:text-3xl font-bold bg-gradient-to-r from-blue-400 to-cyan-400 bg-clip-text text-transparent">
                24/7
              </div>
              <div className="text-xs sm:text-sm text-gray-400 mt-1">Active Trading</div>
            </div>
          </div>

          {/* Agents Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {availableAgents.map((agent, index) => (
              <div
                key={agent.id}
                className="bg-gradient-to-br from-slate-800/70 via-slate-800/50 to-slate-900/70 backdrop-blur-sm border border-purple-500/30 rounded-xl p-6 shadow-lg hover:shadow-purple-500/20 transition-all duration-300 animate-fade-in"
                style={{ animationDelay: `${index * 0.1}s` }}
              >
                {/* Agent Header */}
                <div className="flex items-start justify-between mb-4">
                  <div className="flex items-center">
                    <div className="text-3xl mr-3">{agent.icon}</div>
                    <div>
                      <h3 className="text-xl font-bold text-white">{agent.name}</h3>
                      <div className="flex items-center mt-1">
                        <span className="text-xs px-2 py-1 bg-purple-500/20 text-purple-300 rounded-full">
                          {agent.category}
                        </span>
                        {agent.badge && (
                          <span className="text-xs px-2 py-1 bg-blue-500/20 text-blue-300 rounded-full ml-2">
                            {agent.badge}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-lg font-bold text-green-400">${agent.price}</div>
                    <div className="text-xs text-gray-400">one-time</div>
                  </div>
                </div>

                {/* Description */}
                <p className="text-gray-300 mb-4 leading-relaxed">{agent.description}</p>

                {/* Features */}
                <div className="mb-6">
                  <h4 className="text-sm font-semibold text-gray-200 mb-2">Features:</h4>
                  <ul className="space-y-1">
                    {agent.features.slice(0, 4).map((feature, idx) => (
                      <li key={idx} className="text-sm text-gray-400 flex items-center">
                        <span className="text-green-400 mr-2">✓</span>
                        {feature}
                      </li>
                    ))}
                  </ul>
                </div>

                {/* Request Button */}
                <button
                  onClick={() => handleRequestAgent(agent)}
                  disabled={submitting === agent.id}
                  className="w-full btn btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {submitting === agent.id ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin mr-2"></div>
                      Submitting...
                    </>
                  ) : (
                    '🎯 Request Agent'
                  )}
                </button>

                {/* Status Badge */}
                <div className="mt-3 text-center">
                  <span className="inline-block px-3 py-1 text-xs bg-yellow-500/20 text-yellow-300 rounded-full">
                    Requestable - Admin Approval Required
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Toast Notifications */}
      {toast && <Toast message={toast.message} type={toast.type} />}
    </div>
  );
}