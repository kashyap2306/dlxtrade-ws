import { useState, useEffect } from 'react';
import { agentKeyToSlug } from '../utils/agentKeyToSlug';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useUnlockedAgents } from '../hooks/useUnlockedAgents';
import { agentsApi } from '../services/api';
import { ErrorBoundary } from '../components/ErrorBoundary';
import Toast from '../components/Toast';

// Agent-specific content components
const ArbitrageAgentContent = ({ agent, dashboardData }: { agent: any, dashboardData: any }) => (
  <div className="space-y-6">
    {/* Status Overview */}
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      <div className="bg-slate-800/40 backdrop-blur-xl border border-purple-500/20 rounded-xl p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-lg bg-green-500/20 flex items-center justify-center">
            <svg className="w-5 h-5 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
          </div>
          <h3 className="text-lg font-semibold text-white">Opportunities Found</h3>
        </div>
        <div className="text-2xl font-bold text-green-400">0</div>
        <p className="text-sm text-gray-400">Today</p>
      </div>

      <div className="bg-slate-800/40 backdrop-blur-xl border border-purple-500/20 rounded-xl p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-lg bg-blue-500/20 flex items-center justify-center">
            <svg className="w-5 h-5 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
            </svg>
          </div>
          <h3 className="text-lg font-semibold text-white">Profit Generated</h3>
        </div>
        <div className="text-2xl font-bold text-blue-400">$0.00</div>
        <p className="text-sm text-gray-400">This month</p>
      </div>

      <div className="bg-slate-800/40 backdrop-blur-xl border border-purple-500/20 rounded-xl p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-lg bg-purple-500/20 flex items-center justify-center">
            <svg className="w-5 h-5 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h3 className="text-lg font-semibold text-white">Execution Speed</h3>
        </div>
          <div className="text-2xl font-bold text-purple-400">&lt; 50ms</div>
        <p className="text-sm text-gray-400">Average latency</p>
      </div>
    </div>

    {/* How to Use */}
    <div className="bg-slate-800/40 backdrop-blur-xl border border-purple-500/20 rounded-xl p-6">
      <h2 className="text-xl font-semibold text-white mb-4">How to Use Arbitrage Agent</h2>
      <div className="prose prose-invert max-w-none">
        <ol className="list-decimal list-inside space-y-2 text-gray-300">
          <li>Configure your exchange API keys in Settings → Exchange Accounts</li>
          <li>Enable the agent using the control panel below</li>
          <li>The agent will automatically scan for arbitrage opportunities across DEX/CEX pairs</li>
          <li>Profits are automatically captured when opportunities are detected</li>
          <li>Monitor performance through the dashboard metrics</li>
        </ol>
      </div>
    </div>

    {/* Control Panel */}
    <div className="bg-slate-800/40 backdrop-blur-xl border border-purple-500/20 rounded-xl p-6">
      <h2 className="text-xl font-semibold text-white mb-4">Agent Controls</h2>
      <div className="flex gap-4">
        <button className="btn btn-primary">
          {agent.userSettings?.status === 'active' ? 'Stop Agent' : 'Start Agent'}
        </button>
        <button className="btn btn-secondary">
          Configure Settings
        </button>
      </div>
    </div>
  </div>
);

const LaunchpadAgentContent = ({ agent, dashboardData }: { agent: any, dashboardData: any }) => (
  <div className="space-y-6">
    {/* Status Overview */}
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      <div className="bg-slate-800/40 backdrop-blur-xl border border-purple-500/20 rounded-xl p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-lg bg-orange-500/20 flex items-center justify-center">
            🚀
          </div>
          <h3 className="text-lg font-semibold text-white">Launchpads Tracked</h3>
        </div>
        <div className="text-2xl font-bold text-orange-400">25+</div>
        <p className="text-sm text-gray-400">Active platforms</p>
      </div>

      <div className="bg-slate-800/40 backdrop-blur-xl border border-purple-500/20 rounded-xl p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-lg bg-green-500/20 flex items-center justify-center">
            🎯
          </div>
          <h3 className="text-lg font-semibold text-white">Opportunities Found</h3>
        </div>
        <div className="text-2xl font-bold text-green-400">0</div>
        <p className="text-sm text-gray-400">This week</p>
      </div>

      <div className="bg-slate-800/40 backdrop-blur-xl border border-purple-500/20 rounded-xl p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-lg bg-cyan-500/20 flex items-center justify-center">
            💎
          </div>
          <h3 className="text-lg font-semibold text-white">Tokens Sniped</h3>
        </div>
        <div className="text-2xl font-bold text-cyan-400">0</div>
        <p className="text-sm text-gray-400">Successful entries</p>
      </div>
    </div>

    {/* How to Use */}
    <div className="bg-slate-800/40 backdrop-blur-xl border border-purple-500/20 rounded-xl p-6">
      <h2 className="text-xl font-semibold text-white mb-4">How to Use Launchpad Hunter</h2>
      <div className="prose prose-invert max-w-none">
        <ol className="list-decimal list-inside space-y-2 text-gray-300">
          <li>Configure your wallet connection and exchange API keys</li>
          <li>Set your investment parameters and risk limits</li>
          <li>Enable whitelist detection to get early access</li>
          <li>The agent will automatically monitor upcoming launches</li>
          <li>Get notified of presale opportunities and execute entries</li>
        </ol>
      </div>
    </div>

    {/* Control Panel */}
    <div className="bg-slate-800/40 backdrop-blur-xl border border-purple-500/20 rounded-xl p-6">
      <h2 className="text-xl font-semibold text-white mb-4">Agent Controls</h2>
      <div className="flex gap-4">
        <button className="btn btn-primary">
          {agent.userSettings?.status === 'active' ? 'Stop Agent' : 'Start Agent'}
        </button>
        <button className="btn btn-secondary">
          Configure Settings
        </button>
      </div>
    </div>
  </div>
);

const DefaultAgentContent = ({ agent, dashboardData }: { agent: any, dashboardData: any }) => (
  <div className="space-y-6">
    {/* Status Overview */}
    <div className="bg-slate-800/40 backdrop-blur-xl border border-purple-500/20 rounded-xl p-6">
      <h2 className="text-xl font-semibold text-white mb-4">Agent Overview</h2>
      <p className="text-gray-300 mb-4">{agent.description || 'Advanced AI trading agent'}</p>

      {agent.features && (
        <div>
          <h3 className="text-lg font-medium text-white mb-2">Features:</h3>
          <ul className="list-disc list-inside space-y-1 text-gray-300">
            {agent.features.map((feature: string, idx: number) => (
              <li key={idx}>{feature}</li>
            ))}
          </ul>
        </div>
      )}
    </div>

    {/* How to Use */}
    <div className="bg-slate-800/40 backdrop-blur-xl border border-purple-500/20 rounded-xl p-6">
      <h2 className="text-xl font-semibold text-white mb-4">How to Use This Agent</h2>
      <div className="prose prose-invert max-w-none">
        <ol className="list-decimal list-inside space-y-2 text-gray-300">
          <li>Configure your API keys and settings</li>
          <li>Enable the agent using the control panel</li>
          <li>Monitor performance through the dashboard</li>
          <li>Adjust parameters as needed for optimal performance</li>
        </ol>
      </div>
    </div>

    {/* Control Panel */}
    <div className="bg-slate-800/40 backdrop-blur-xl border border-purple-500/20 rounded-xl p-6">
      <h2 className="text-xl font-semibold text-white mb-4">Agent Controls</h2>
      <div className="flex gap-4">
        <button className="btn btn-primary">
          {agent.userSettings?.status === 'active' ? 'Stop Agent' : 'Start Agent'}
        </button>
        <button className="btn btn-secondary">
          Configure Settings
        </button>
      </div>
    </div>
  </div>
);

// Placeholder components for other agents
const WhaleTrackerContent = DefaultAgentContent;
const AlphaAgentContent = DefaultAgentContent;
const CopyTradeAgentContent = DefaultAgentContent;
const AirdropAgentContent = DefaultAgentContent;

export default function AgentDashboard() {
  const { agentKey } = useParams<{ agentKey: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();
  const { unlockedAgents, loading: unlockedLoading } = useUnlockedAgents();
  const [agent, setAgent] = useState<any | null | undefined>(undefined);
  const [dashboardData, setDashboardData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  useEffect(() => {
    if (!agentKey || unlockedLoading) return;
    let isMounted = true;
    setAgent(undefined); // start resolving
    const fetchAgent = async () => {
      try {
        const resolved = await resolveAgentDoc(agentKey);
        const foundAgent = resolved ? { ...resolved.data, agent_id: resolved.id } : null;
        if (isMounted) setAgent(foundAgent);
      } catch (err) {
        if (isMounted) setAgent(null);
      }
    };
    fetchAgent();
    return () => { isMounted = false; };
  }, [agentKey, unlockedLoading]);

  const resolvedApprovalKey = (() => {
    const k = (agentKey || '').toLowerCase();
    switch (k) {
      case 'liquidity_sniper_arbitrage':
        return 'LIQUIDITY_SWEEP_AGENT';
      default:
        return agentKey || '';
    }
  })();

  const isUnlocked = unlockedAgents.some(a => a.agentId === resolvedApprovalKey);



  const isResolvingAgent = agent === undefined;

  if (isResolvingAgent || unlockedLoading) {
    return null; // or a loading spinner if desired
  }

  if (agent === null) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-2xl font-bold text-white mb-4">Agent not found</h2>
          <p className="text-gray-400 mb-6">This agent does not exist.</p>
          <button
            onClick={() => navigate('/agents')}
            className="btn btn-primary"
          >
            Back to Agents
          </button>
        </div>
      </div>
    );
  }

  if (!isUnlocked) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-2xl font-bold text-white mb-4">Access Required</h2>
          <p className="text-gray-400 mb-6">You do not have access to this agent. Request access to unlock.</p>
          <button
            onClick={() => navigate('/agents')}
            className="btn btn-primary"
          >
            Back to Agents
          </button>
        </div>
      </div>
    );
  }

  // Agent-specific content based on agent ID
  const renderAgentContent = () => {
    const agentKeyLower = agentKey?.toLowerCase() || '';

    switch (agentKeyLower) {
      case 'arbitrage_agent':
      case 'liquidity_sniper_arbitrage':
        return (
          <ArbitrageAgentContent agent={agent} dashboardData={dashboardData} />
        );
      case 'launchpad_agent':
      case 'ai_launchpad_hunter':
        // Redirect to dedicated launchpad hunter page
        if (typeof window !== 'undefined') {
          window.location.href = '/agents/launchpad-hunter';
          return <div>Redirecting...</div>;
        }
        return (
          <LaunchpadAgentContent agent={agent} dashboardData={dashboardData} />
        );
      case 'crowd_consensus_copy_trade':
        // Redirect to dedicated crowd consensus page
        if (typeof window !== 'undefined') {
          window.location.href = '/agents/crowd-consensus';
          return <div>Redirecting...</div>;
        }
        return (
          <LaunchpadAgentContent agent={agent} dashboardData={dashboardData} />
        );
      case 'whale_movement_tracker':
        return (
          <WhaleTrackerContent agent={agent} dashboardData={dashboardData} />
        );
      case 'pre_market_ai_alpha':
        return (
          <AlphaAgentContent agent={agent} dashboardData={dashboardData} />
        );
      case 'whale_copy_trade':
        return (
          <CopyTradeAgentContent agent={agent} dashboardData={dashboardData} />
        );
      case 'airdrop_multiverse':
        return (
          <AirdropAgentContent agent={agent} dashboardData={dashboardData} />
        );
      default:
        return (
          <DefaultAgentContent agent={agent} dashboardData={dashboardData} />
        );
    }
  };

  return (
    <ErrorBoundary>
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900">
        <div className="container mx-auto px-4 py-8">
          {/* Header */}
          <div className="mb-8">
            <div className="flex items-center gap-4 mb-4">
              <div className="w-16 h-16 rounded-xl bg-gradient-to-br from-purple-500/20 to-pink-500/20 flex items-center justify-center">
                <span className="text-2xl">{agent.icon || '🤖'}</span>
              </div>
              <div>
                <h1 className="text-3xl sm:text-4xl font-bold bg-gradient-to-r from-purple-300 via-pink-300 to-cyan-300 bg-clip-text text-transparent mb-2">
                  {agent.name || agentKey}
                </h1>
                <div className="flex items-center gap-4">
                  <span className={`px-3 py-1 rounded-full text-sm font-medium ${
                    agent.userSettings?.status === 'active'
                      ? 'bg-green-500/20 text-green-300 border border-green-500/30'
                      : 'bg-slate-500/20 text-slate-300 border border-slate-500/30'
                  }`}>
                    {agent.userSettings?.status === 'active' ? 'Active' : 'Inactive'}
                  </span>
                  <span className="text-gray-400 text-sm">
                    Last updated: {new Date().toLocaleDateString()}
                  </span>
                </div>
              </div>
            </div>
            <p className="text-gray-400 text-lg">{agent.description}</p>
          </div>

          {/* Agent-specific content */}
          {renderAgentContent()}
        </div>
      </div>
      {toast && <Toast message={toast.message} type={toast.type} />}
    </ErrorBoundary>
  );
}
