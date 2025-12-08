import { useNavigate } from 'react-router-dom';

export interface AgentCardData {
  id?: string;
  name: string;
  description?: string;
  price?: number;
  category?: string;
  imageUrl?: string;
  badge?: string;
  enabled?: boolean;
  features?: string[];
}

interface AgentCardProps {
  agent: AgentCardData;
  isUnlocked: boolean;
  onUnlockClick: (agent: AgentCardData) => void;
  onViewDetails?: (agent: AgentCardData) => void;
  index?: number;
}

export default function AgentCard({ agent, isUnlocked, onUnlockClick, onViewDetails, index = 0 }: AgentCardProps) {
  const navigate = useNavigate();
  const aid = (agent.id || agent.name).toString();
  const imageUrl = agent.imageUrl || `https://ui-avatars.com/api/?name=${encodeURIComponent(agent.name)}&background=6366f1&color=fff&size=200`;

  const handleViewDetails = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onViewDetails) {
      onViewDetails(agent);
    } else {
      navigate(`/agents/${aid}`);
    }
  };

  return (
    <div
      className={`relative group rounded-2xl overflow-hidden transition-all duration-300
        bg-gradient-to-br from-slate-800/90 via-slate-800/70 to-slate-900/90
        border-2 backdrop-blur-xl
        ${isUnlocked ? 'border-green-500/50 shadow-lg shadow-green-500/20' : 'border-purple-500/50 shadow-lg shadow-purple-500/20'}
        hover:scale-[1.02] hover:border-purple-500/80 hover:shadow-2xl hover:shadow-purple-500/30
        animate-fade-in`}
      style={{ animationDelay: `${index * 0.1}s` }}
    >
      {/* Image Section - Always show image */}
      <div className="relative h-48 overflow-hidden bg-gradient-to-br from-purple-500/20 to-pink-500/20">
        <img
          src={imageUrl}
          alt={agent.name}
          className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500"
          onError={(e) => {
            const target = e.target as HTMLImageElement;
            target.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(agent.name)}&background=6366f1&color=fff&size=400`;
          }}
        />
        {/* Gradient Overlay */}
        <div className="absolute inset-0 bg-gradient-to-t from-slate-900/80 via-slate-900/40 to-transparent"></div>
        
        {/* Status Badge */}
        <div className={`absolute top-3 left-3 px-3 py-1.5 rounded-lg text-xs font-semibold backdrop-blur-md
          ${isUnlocked ? 'bg-green-500/20 border border-green-500/50 text-green-300' : 'bg-slate-700/80 border border-slate-500/50 text-gray-300'}`}>
          {isUnlocked ? '✓ Active' : '🔒 Locked'}
        </div>

        {/* Premium Badge */}
        {agent.badge && (
          <div className="absolute top-3 right-3 px-3 py-1.5 bg-purple-500/20 border border-purple-500/50 rounded-lg text-purple-300 text-xs font-semibold backdrop-blur-md">
            {agent.badge}
          </div>
        )}
      </div>

      {/* Content Section */}
      <div className="p-5 sm:p-6">
        <h3 className="text-lg sm:text-xl font-bold text-white mb-2 line-clamp-1">{agent.name}</h3>
        <p className="text-gray-300 text-sm mb-4 leading-relaxed line-clamp-2 min-h-[2.5rem]">
          {agent.description || 'Premium trading agent'}
        </p>

        {/* Features Preview */}
        {agent.features && agent.features.length > 0 && (
          <div className="mb-4">
            <ul className="space-y-1.5">
              {agent.features.slice(0, 2).map((feature, idx) => (
                <li key={idx} className="text-gray-400 text-xs flex items-start">
                  <span className="text-purple-400 mr-2 mt-0.5">✓</span>
                  <span className="line-clamp-1">{feature}</span>
                </li>
              ))}
              {agent.features.length > 2 && (
                <li className="text-purple-400 text-xs font-medium">
                  +{agent.features.length - 2} more features
                </li>
              )}
            </ul>
          </div>
        )}

        {/* Price and CTA */}
        <div className="pt-4 border-t border-slate-700/50 space-y-3">
          <div className="text-xl sm:text-2xl font-bold bg-gradient-to-r from-purple-400 to-pink-400 bg-clip-text text-transparent">
            {agent.price ? `$${agent.price}` : 'Free'}
          </div>
          <div className="flex gap-2">
            {!isUnlocked ? (
              <>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onUnlockClick(agent);
                  }}
                  className="flex-1 px-4 py-2 text-sm font-semibold rounded-lg bg-gradient-to-r from-purple-500 to-pink-500 text-white hover:from-purple-600 hover:to-pink-600 transition-all shadow-lg shadow-purple-500/30 hover:shadow-purple-500/50"
                >
                  Unlock Now
                </button>
                <button
                  onClick={handleViewDetails}
                  className="px-4 py-2 text-sm font-semibold rounded-lg bg-slate-700/50 border border-slate-600/50 text-gray-300 hover:bg-slate-700/70 transition-all"
                >
                  Details
                </button>
              </>
            ) : (
              <button
                onClick={handleViewDetails}
                className="w-full px-4 py-2 text-sm font-semibold rounded-lg bg-gradient-to-r from-green-500 to-emerald-500 text-white hover:from-green-600 hover:to-emerald-600 transition-all shadow-lg shadow-green-500/30 hover:shadow-green-500/50"
              >
                ✓ Active - View Details
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Hover Glow Effect */}
      <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none">
        <div className="absolute inset-0 bg-gradient-to-r from-purple-500/10 via-pink-500/10 to-purple-500/10"></div>
      </div>
    </div>
  );
}

