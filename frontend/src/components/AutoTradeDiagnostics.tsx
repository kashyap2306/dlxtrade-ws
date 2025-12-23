import React from 'react';
import { useNavigate } from 'react-router-dom';

interface AutoTradeDiagnosticsProps {
  visible: boolean;
  onClose: () => void;
  results: any;
  runSelfTest: () => Promise<any>;
  isRunning?: boolean;
  showToast: (message: string, type: 'success' | 'error') => void;
  // Backend diagnostic data from GET /api/auto-trade/status
  // CRITICAL: Backend is SINGLE source of truth - no local config fallback
  backendDiagnostics?: {
    providersReady: boolean | null; // null = timeout (unknown), not false (failed)
    providerConfigTimeout?: boolean; // Flag indicating provider-config timeout
    diagnostics: {
      marketDataReady: boolean | null; // null = timeout (unknown)
      newsReady: boolean | null; // null = timeout (unknown)
      exchangeConnected?: boolean; // Exchange health from backend (authoritative)
      exchangeReason?: string; // Human-readable reason from backend
      userAuthenticated?: boolean;
    };
  };
  // REMOVED: isExchangeReadyByConfig - no local config fallback
  isConfigLoaded?: boolean; // True once backend has responded
}

export const AutoTradeDiagnostics: React.FC<AutoTradeDiagnosticsProps> = ({
  visible,
  onClose,
  results,
  runSelfTest,
  isRunning = false,
  showToast,
  backendDiagnostics,
  isConfigLoaded = false, // True once backend has responded
}) => {
  const navigate = useNavigate();

  if (!visible) {
    return null;
  }

  // Use ONLY backend diagnostics response - NO local config fallback
  const providersReady = backendDiagnostics?.providersReady;
  const marketDataReady = backendDiagnostics?.diagnostics?.marketDataReady;
  const newsReady = backendDiagnostics?.diagnostics?.newsReady;
  const providerConfigTimeout = backendDiagnostics?.providerConfigTimeout ?? false;

  // CRITICAL: Exchange status ONLY from backend - no local config fallback
  // Backend is SINGLE source of truth using resolveExchangeConnector() - same as trading engine
  const exchangeConnected = backendDiagnostics?.diagnostics?.exchangeConnected;
  const exchangeReason = backendDiagnostics?.diagnostics?.exchangeReason || 'Unknown status';
  
  // Determine display status:
  // - undefined/null = Still loading (backend hasn't responded yet)
  // - true = Connected (backend confirmed)
  // - false = Not connected (backend confirmed)
  const exchangeStatus = (() => {
    if (!isConfigLoaded || exchangeConnected === undefined || exchangeConnected === null) {
      return 'loading';
    }
    return exchangeConnected ? 'connected' : 'disconnected';
  })();

  // Debug log for troubleshooting - use JSON.stringify for proper object display
  console.log("[AUTO_TRADE_DIAGNOSTIC_INPUT]", JSON.stringify({
    isConfigLoaded,
    providersReady,
    providerConfigTimeout,
    exchangeConnected,
    exchangeReason,
    exchangeStatus,
    source: 'Backend ONLY (no local fallback)',
    diagnostics: {
      marketDataReady,
      newsReady,
    },
  }, null, 2));

  // Badge class helper - handles null (timeout/unknown) vs false (failed) vs true (ready)
  const badgeClass = (ready: boolean | null | undefined) => {
    if (ready === true) return 'bg-green-600/40 text-green-300';
    if (ready === null || ready === undefined) {
      return providerConfigTimeout ? 'bg-yellow-600/40 text-yellow-300' : 'bg-blue-600/40 text-blue-300';
    }
    return 'bg-red-600/40 text-red-300'; // Failed
  };

  const badgeText = (ready: boolean | null | undefined, label: string) => {
    if (ready === true) return 'PASS';
    if (ready === null || ready === undefined) {
      return providerConfigTimeout ? 'TIMEOUT' : 'AVAILABLE';
    }
    return 'FAIL';
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 px-4">
      <div className="bg-[#0a0f1a] border border-blue-500/20 rounded-xl p-6 max-w-2xl mx-4 max-h-[90vh] overflow-y-auto w-full sm:w-auto">
        <h3 className="text-xl font-semibold text-blue-200 mb-6">Auto-Trade Enable Diagnostic Report</h3>

        {(!results && isRunning) && (
          <div className="flex items-center gap-3 text-blue-100">
            <div className="w-5 h-5 border-2 border-blue-400 border-t-transparent rounded-full animate-spin"></div>
            <p className="text-sm">Running self-test...</p>
          </div>
        )}

        {backendDiagnostics && (
          <div className="space-y-4 mb-6">
            {/* Exchange Connection - Backend is SINGLE source of truth */}
            <div className="p-4 bg-gray-900/50 border border-gray-600/40 rounded-lg">
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-blue-200 font-medium">Exchange Connection</h4>
                <span className={`px-2 py-1 rounded text-xs font-medium ${
                  exchangeStatus === 'connected' ? 'bg-green-600/40 text-green-300' :
                  exchangeStatus === 'loading' ? 'bg-blue-600/40 text-blue-300' :
                  'bg-red-600/40 text-red-300'
                }`}>
                  {exchangeStatus === 'connected' ? 'CONNECTED' :
                   exchangeStatus === 'loading' ? 'CHECKING...' :
                   'NOT CONNECTED'}
                </span>
              </div>
              <p className="text-blue-100 text-sm mb-1">
                {/* CRITICAL: Show backend reason - no local config messages */}
                Status: {exchangeStatus === 'loading' 
                  ? 'Checking exchange status...'
                  : exchangeReason}
              </p>
              {exchangeStatus === 'connected' ? (
                <p className="text-green-300 text-sm">✓ Exchange is connected and ready for trading</p>
              ) : exchangeStatus === 'loading' ? (
                <p className="text-blue-300 text-sm">⏳ Verifying exchange connection with backend...</p>
              ) : (
                <p className="text-red-300 text-sm">✗ {exchangeReason.includes('Settings') ? exchangeReason : 'Connect your exchange API keys in Settings → Trading API Integration'}</p>
              )}
            </div>

            {/* Provider Config Timeout Warning */}
            {providerConfigTimeout && (
              <div className="p-4 bg-yellow-900/30 border border-yellow-500/40 rounded-lg">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-yellow-400">⚠️</span>
                  <h4 className="text-yellow-200 font-medium">Provider Configuration Loading Slowly</h4>
                </div>
                <p className="text-yellow-100 text-sm">
                  Provider configuration is taking longer than expected. This does not affect exchange connectivity or Auto-Trade functionality.
                </p>
              </div>
            )}

            {/* Market Data Providers */}
            <div className="p-4 bg-gray-900/50 border border-gray-600/40 rounded-lg">
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-blue-200 font-medium">Market Data Providers</h4>
                <span className={`px-2 py-1 rounded text-xs font-medium ${badgeClass(marketDataReady)}`}>
                  {badgeText(marketDataReady, 'Market Data')}
                </span>
              </div>
              {marketDataReady === true ? (
                <>
                  <p className="text-blue-100 text-sm mb-1">
                    Status: At least one enabled provider configured
                  </p>
                  <p className="text-green-300 text-sm">✓ Market data providers ready</p>
                </>
              ) : marketDataReady === null ? (
                <>
                  <p className="text-blue-100 text-sm mb-1">
                    Status: {providerConfigTimeout ? 'Configuration check timed out' : 'Available (Non-blocking)'}
                  </p>
                  <p className={`${providerConfigTimeout ? 'text-yellow-300' : 'text-blue-300'} text-sm`}>
                    {providerConfigTimeout
                      ? '⚠ Provider configuration loading slowly - this does not block Auto-Trade'
                      : '✓ Market data check complete'}
                  </p>
                </>
              ) : (
                <>
                  <p className="text-blue-100 text-sm mb-1">
                    Status: No enabled providers found
                  </p>
                  <p className="text-red-300 text-sm">✗ Configure at least one market data provider</p>
                  <div className="flex flex-wrap gap-2 mt-2">
                    <button
                      onClick={() => navigate('/settings#market-data')}
                      className="px-3 py-1 text-xs bg-blue-600 hover:bg-blue-700 text-white rounded transition-colors"
                    >
                      Fix in Settings
                    </button>
                  </div>
                </>
              )}
            </div>

            {/* News Providers */}
            <div className="p-4 bg-gray-900/50 border border-gray-600/40 rounded-lg">
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-blue-200 font-medium">News Providers</h4>
                <span className={`px-2 py-1 rounded text-xs font-medium ${badgeClass(newsReady)}`}>
                  {badgeText(newsReady, 'News')}
                </span>
              </div>
              {newsReady === true ? (
                <>
                  <p className="text-blue-100 text-sm mb-1">
                    Status: At least one enabled provider configured
                  </p>
                  <p className="text-green-300 text-sm">✓ News providers ready</p>
                </>
              ) : newsReady === null ? (
                <>
                  <p className="text-blue-100 text-sm mb-1">
                    Status: {providerConfigTimeout ? 'Configuration check timed out' : 'Available (Non-blocking)'}
                  </p>
                  <p className={`${providerConfigTimeout ? 'text-yellow-300' : 'text-blue-300'} text-sm`}>
                    {providerConfigTimeout
                      ? '⚠ Provider configuration loading slowly - this does not block Auto-Trade'
                      : '✓ News provider check complete'}
                  </p>
                </>
              ) : (
                <>
                  <p className="text-blue-100 text-sm mb-1">
                    Status: No enabled providers found
                  </p>
                  <p className="text-red-300 text-sm">✗ Configure at least one news provider</p>
                  <div className="flex flex-wrap gap-2 mt-2">
                    <button
                      onClick={() => navigate('/settings#news')}
                      className="px-3 py-1 text-xs bg-blue-600 hover:bg-blue-700 text-white rounded transition-colors"
                    >
                      Fix in Settings
                    </button>
                  </div>
                </>
              )}
            </div>

            {/* Overall Status */}
            <div className="p-4 bg-gray-900/50 border border-gray-600/40 rounded-lg">
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-blue-200 font-medium">AutoTrade Readiness</h4>
                <span className={`px-2 py-1 rounded text-xs font-medium ${badgeClass(providersReady)}`}>
                  {providersReady === true ? 'READY' : providersReady === null ? (providerConfigTimeout ? 'TIMEOUT' : 'AVAILABLE') : 'NOT READY'}
                </span>
              </div>
              <p className="text-blue-100 text-sm">
                {providersReady === true
                  ? 'AutoTrade can run - both market data and news providers are configured'
                  : providersReady === null
                    ? (providerConfigTimeout
                      ? 'Provider configuration check timed out - Auto-Trade remains functional if exchange is connected'
                      : 'Provider configuration validated - Auto-Trade is ready')
                    : 'AutoTrade cannot run - configure both market data and news providers'
                }
              </p>
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
