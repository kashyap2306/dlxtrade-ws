import React from 'react';
import { useNavigate } from 'react-router-dom';

interface AutoTradeDiagnosticsProps {
  visible: boolean;
  onClose: () => void;
  results: any;
  runSelfTest: () => Promise<any>;
  isRunning?: boolean;
  showToast: (message: string, type: 'success' | 'error') => void;
}

export const AutoTradeDiagnostics: React.FC<AutoTradeDiagnosticsProps> = ({
  visible,
  onClose,
  results,
  runSelfTest,
  isRunning = false,
  showToast,
}) => {
  const navigate = useNavigate();

  if (!visible) {
    return null;
  }

  const news = results?.news;
  const market = results?.marketData;
  const exchange = results?.exchange;

  const badgeClass = (status?: string) => {
    if (status === 'PASS') return 'bg-green-600/40 text-green-300';
    if (status === 'FAIL') return 'bg-red-600/40 text-red-300';
    return 'bg-yellow-600/40 text-yellow-300';
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 px-4">
      <div className="bg-[#0a0f1a] border border-blue-500/20 rounded-xl p-6 max-w-2xl mx-4 max-h-[90vh] overflow-y-auto w-full sm:w-auto">
        <h3 className="text-xl font-semibold text-blue-200 mb-6">Auto-Trade Enable Diagnostic Report</h3>

        {!results && (
          <div className="flex items-center gap-3 text-blue-100">
            <div className="w-5 h-5 border-2 border-blue-400 border-t-transparent rounded-full animate-spin"></div>
            <p className="text-sm">Running self-test...</p>
          </div>
        )}

        {results && (
          <div className="space-y-4 mb-6">
            {/* News API */}
            <div className="p-4 bg-gray-900/50 border border-gray-600/40 rounded-lg">
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-blue-200 font-medium">News API Key</h4>
                <span className={`px-2 py-1 rounded text-xs font-medium ${badgeClass(news?.status)}`}>
                  {news?.status || 'UNKNOWN'}
                </span>
              </div>
              <p className="text-blue-100 text-sm mb-1">
                Provider: {news?.provider || 'newsdata'}
              </p>
              {news?.status === 'PASS' ? (
                <p className="text-green-300 text-sm">✓ API key present</p>
              ) : (
                <p className="text-red-300 text-sm">✗ {news?.reason || 'Missing key'}</p>
              )}
              <div className="flex flex-wrap gap-2 mt-2">
                <button
                  onClick={() => navigate('/settings#news')}
                  className="px-3 py-1 text-xs bg-blue-600 hover:bg-blue-700 text-white rounded transition-colors"
                >
                  Fix in Settings
                </button>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(JSON.stringify(news || {}, null, 2));
                    showToast('Details copied to clipboard', 'success');
                  }}
                  className="px-3 py-1 text-xs bg-gray-600 hover:bg-gray-700 text-white rounded transition-colors"
                >
                  Copy Details
                </button>
              </div>
            </div>

            {/* Market Data */}
            <div className="p-4 bg-gray-900/50 border border-gray-600/40 rounded-lg">
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-blue-200 font-medium">Market Data API Key</h4>
                <span className={`px-2 py-1 rounded text-xs font-medium ${badgeClass(market?.status)}`}>
                  {market?.status || 'UNKNOWN'}
                </span>
              </div>
              <p className="text-blue-100 text-sm mb-1">
                Provider: {market?.provider || 'cryptocompare'}
              </p>
              {market?.status === 'PASS' ? (
                <p className="text-green-300 text-sm">✓ API key present</p>
              ) : (
                <p className="text-red-300 text-sm">✗ {market?.reason || 'Missing key'}</p>
              )}
              <div className="flex flex-wrap gap-2 mt-2">
                <button
                  onClick={() => navigate('/settings#providers')}
                  className="px-3 py-1 text-xs bg-blue-600 hover:bg-blue-700 text-white rounded transition-colors"
                >
                  Fix in Settings
                </button>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(JSON.stringify(market || {}, null, 2));
                    showToast('Details copied to clipboard', 'success');
                  }}
                  className="px-3 py-1 text-xs bg-gray-600 hover:bg-gray-700 text-white rounded transition-colors"
                >
                  Copy Details
                </button>
              </div>
            </div>

            {/* Exchange */}
            <div className="p-4 bg-gray-900/50 border border-gray-600/40 rounded-lg">
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-blue-200 font-medium">Exchange Configuration</h4>
                <span className={`px-2 py-1 rounded text-xs font-medium ${badgeClass(exchange?.status)}`}>
                  {exchange?.status || 'UNKNOWN'}
                </span>
              </div>
              <p className="text-blue-100 text-sm mb-1">
                Exchange: {exchange?.exchange || 'Unknown'}
              </p>
              {exchange?.status === 'PASS' ? (
                <p className="text-green-300 text-sm">✓ Exchange configuration detected</p>
              ) : (
                <p className="text-red-300 text-sm">✗ {exchange?.reason || 'Missing configuration'}</p>
              )}
              <div className="flex flex-wrap gap-2 mt-2">
                <button
                  onClick={() => navigate('/settings#exchange')}
                  className="px-3 py-1 text-xs bg-blue-600 hover:bg-blue-700 text-white rounded transition-colors"
                >
                  Fix in Settings
                </button>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(JSON.stringify(exchange || {}, null, 2));
                    showToast('Details copied to clipboard', 'success');
                  }}
                  className="px-3 py-1 text-xs bg-gray-600 hover:bg-gray-700 text-white rounded transition-colors"
                >
                  Copy Details
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Action buttons */}
        <div className="flex flex-col sm:flex-row gap-3">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2 text-sm bg-gray-700 hover:bg-gray-600 text-blue-100 rounded-lg transition-colors"
          >
            Close
          </button>
          <button
            onClick={async () => {
              await runSelfTest();
            }}
            disabled={isRunning}
            className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-700 disabled:bg-blue-800 text-white rounded-lg shadow-lg transition-colors"
          >
            {isRunning ? 'Testing...' : 'Re-run Tests'}
          </button>
        </div>

        {results && (
          <div className="mt-4 text-center">
            <button
              onClick={() => {
                const fullReport = JSON.stringify(results, null, 2);
                navigator.clipboard.writeText(fullReport);
                showToast('Full diagnostic report copied to clipboard', 'success');
              }}
              className="px-4 py-2 text-xs bg-gray-600 hover:bg-gray-700 text-white rounded transition-colors"
            >
              Copy Full Diagnostic Report
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
