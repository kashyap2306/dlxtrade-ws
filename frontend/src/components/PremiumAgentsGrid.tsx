import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';

interface AgentItem {
  id?: string;
  name: string;
  description?: string;
  price?: number;
  category?: string;
}

interface PremiumAgentsGridProps {
  agents: AgentItem[];
  unlockedAgents: Record<string, boolean>;
  supportNumber: string;
  dismissedAgents: string[];
  onDismiss: (agentId: string) => void;
}

export default function PremiumAgentsGrid({
  agents,
  unlockedAgents,
  supportNumber,
  dismissedAgents,
  onDismiss,
}: PremiumAgentsGridProps) {
  const navigate = useNavigate();

  // Ensure HFT Bot is present
  const mergedAgents = useMemo(() => {
    const exists = agents.some((a) => (a.id || a.name)?.toLowerCase() === 'hft bot' || (a.id || a.name)?.toLowerCase() === 'hftbot');
    const list = [...agents];
    if (!exists) {
      list.push({
        id: 'hftBot',
        name: 'HFT Bot',
        description: 'High Frequency Trading Engine',
        price: 0,
        category: 'Premium Agent',
      });
    }
    return list;
  }, [agents]);

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
      {mergedAgents
        .filter((agent) => !dismissedAgents.includes(agent.id || agent.name))
        .map((agent) => {
          const aid = (agent.id || agent.name).toString();
          const isUnlocked = !!unlockedAgents[aid];
          const waUrl = `https://wa.me/${supportNumber}?text=${encodeURIComponent(`Please unlock agent: ${agent.name}`)}`;

          return (
            <div
              key={aid}
              className={`relative group rounded-2xl p-5 transition-all
                bg-gradient-to-br from-slate-800/50 via-slate-800/30 to-slate-900/60 backdrop-blur-xl
                ${isUnlocked ? 'border border-green-500/30 shadow-lg shadow-green-500/10' : 'border border-purple-500/20 shadow-lg shadow-purple-500/10'}
                hover:scale-[1.03] hover:shadow-2xl`}
            >
              {/* Dismiss */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onDismiss(aid);
                }}
                className="absolute top-3 right-3 w-7 h-7 flex items-center justify-center text-gray-400 hover:text-red-300 hover:bg-red-500/20 rounded-full transition-all"
                title="Remove from dashboard"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>

              {/* Status */}
              <div className={`absolute top-3 left-3 px-2 py-1 rounded-lg text-xs font-medium
                ${isUnlocked ? 'bg-green-500/20 border border-green-500/50 text-green-300' : 'bg-slate-700/50 border border-slate-500/30 text-gray-300'}`}>
                {isUnlocked ? '✓ Active Agent' : '🔒 Locked'}
              </div>

              {/* Icon */}
              <div className="mb-4 flex items-center justify-center">
                <div className={`w-14 h-14 rounded-xl flex items-center justify-center
                  ${isUnlocked ? 'bg-green-500/10 border border-green-400/30' : 'bg-purple-500/10 border border-purple-400/30'}
                  shadow-inner`}>
                  {/* Simple SVG icon */}
                  <svg className={`${isUnlocked ? 'text-green-300' : 'text-purple-300'} w-7 h-7`} viewBox="0 0 24 24" fill="none" stroke="currentColor">
                    <path strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" d="M13 7H7v10h10V7h-4z" />
                  </svg>
                </div>
              </div>

              {/* Content */}
              <h3 className="text-lg font-bold text-white mb-2">{agent.name}</h3>
              <p className="text-gray-400 text-sm mb-5 line-clamp-2">{agent.description || 'Premium trading agent'}</p>

              <div className="pt-3 border-t border-slate-600/30 flex items-center justify-between">
                <div className="text-xl font-bold bg-gradient-to-r from-purple-400 to-pink-400 bg-clip-text text-transparent">
                  {agent.price ? `$${agent.price}` : ''}
                </div>
                {!isUnlocked ? (
                  <a
                    href={waUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-3 py-2 text-xs font-medium rounded-lg bg-slate-900/60 border border-purple-500/30 text-purple-200 hover:bg-slate-900/80 transition-colors"
                  >
                    Unlock via WhatsApp
                  </a>
                ) : (
                  <button
                    onClick={() => navigate(`/agent/${encodeURIComponent(aid)}`)}
                    className="px-3 py-2 text-xs font-medium rounded-lg bg-green-600/80 hover:bg-green-600 text-white transition-colors"
                  >
                    Use Agent
                  </button>
                )}
              </div>

              {/* Overlay for locked */}
              {!isUnlocked && (
                <div className="pointer-events-none absolute inset-0 rounded-2xl bg-slate-900/20 backdrop-blur-[1px]" />
              )}
            </div>
          );
        })}
    </div>
  );
}


