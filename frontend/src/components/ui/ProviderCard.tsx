import React, { useState } from 'react';

interface ProviderCardProps {
  icon: React.ReactNode;
  name: string;
  description: string;
  status: 'Success' | 'Failed' | 'Rate-Limited';
  latencyMs: number;
  jsonData?: any;
  sentiment?: number;
  articles?: any[];
  children?: React.ReactNode;
}

const ProviderCard: React.FC<ProviderCardProps> = ({
  icon,
  name,
  description,
  status,
  latencyMs,
  jsonData,
  sentiment,
  articles,
  children
}) => {
  const [isJsonExpanded, setIsJsonExpanded] = useState(false);

  const getStatusBadge = () => {
    switch (status) {
      case 'Success':
        return 'bg-emerald-500/20 text-emerald-400';
      case 'Failed':
        return 'bg-red-500/20 text-red-400';
      case 'Rate-Limited':
        return 'bg-yellow-500/20 text-yellow-400';
      default:
        return 'bg-gray-500/20 text-gray-400';
    }
  };

  return (
    <div className="bg-slate-800/50 backdrop-blur-sm border border-slate-600/30 rounded-xl overflow-hidden hover:bg-slate-800/70 transition-all duration-200 shadow-md hover:shadow-lg">
      <div className="p-4 md:p-5">
        {/* Header */}
        <div className="flex items-center justify-between mb-3 md:mb-4">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 md:w-10 md:h-10 rounded-lg bg-slate-700/50 flex items-center justify-center">
              {icon}
            </div>
            <div>
              <div className="text-sm md:text-base font-medium text-white">{name}</div>
              <div className="text-xs md:text-sm text-slate-400">{description}</div>
              {sentiment !== undefined && (
                <div className="text-xs text-slate-400 flex items-center gap-2 mt-1">
                  Sentiment: {(sentiment * 100).toFixed(0)}%
                  {sentiment > 0.6 && '📈'}
                  {sentiment < 0.4 && '📉'}
                  {sentiment >= 0.4 && sentiment <= 0.6 && '➡️'}
                </div>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className={`px-2 py-1 rounded text-xs font-medium ${getStatusBadge()}`}>
              {status}
            </span>
            <span className="px-2 py-1 rounded text-xs font-medium bg-slate-600/20 text-slate-400">
              {latencyMs}ms
            </span>
          </div>
        </div>

        {/* Content */}
        {children && (
          <div className="mb-4">
            {children}
          </div>
        )}

        {/* Articles */}
        {articles && articles.length > 0 && (
          <div className="mb-4 space-y-3 max-h-96 overflow-y-auto">
            {articles.slice(0, 5).map((article: any, index: number) => (
              <div key={index} className="bg-slate-900/50 rounded-lg p-3 border border-slate-600/20">
                <h4 className="text-sm font-medium text-white mb-1 line-clamp-2">{article.title}</h4>
                <div className="flex items-center justify-between text-xs text-slate-400 mb-2">
                  <span>{article.source}</span>
                  <span>{article.published_at ? new Date(article.published_at).toLocaleDateString() : 'Recent'}</span>
                </div>
                <button
                  onClick={() => window.open(article.url, "_blank")}
                  className="inline-flex items-center gap-1 px-3 py-1 bg-blue-500/20 hover:bg-blue-500/30 text-blue-400 rounded text-xs font-medium transition-colors"
                >
                  Read Full Article →
                </button>
              </div>
            ))}
          </div>
        )}

        {/* JSON Viewer Toggle */}
        {jsonData && (
          <div className="border-t border-slate-600/20 pt-3">
            <button
              onClick={() => setIsJsonExpanded(!isJsonExpanded)}
              className="flex items-center gap-2 text-xs text-slate-400 hover:text-white transition-colors w-full justify-center"
            >
              <span>{isJsonExpanded ? 'Hide' : 'Show'} Raw JSON</span>
              <svg
                className={`w-4 h-4 transition-transform duration-200 ${isJsonExpanded ? 'rotate-180' : ''}`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>

            {/* JSON Viewer */}
            <div
              className={`mt-3 overflow-hidden transition-all duration-300 ease-in-out ${
                isJsonExpanded ? 'max-h-56 md:max-h-64' : 'max-h-0'
              }`}
            >
              <div className="bg-white rounded-lg p-3 overflow-y-auto max-h-48 md:max-h-56">
                <pre className="text-xs text-gray-800 font-mono whitespace-pre-wrap break-all">
                  {JSON.stringify(jsonData, null, 2)}
                </pre>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default ProviderCard;
