import React, { useState, useEffect, useRef } from 'react';
import { autoTradeApi } from '../services/api';

interface AutoTradeEngineControlsProps {
  config: {
    autoTradeEnabled: boolean;
    cooldownSeconds: number;
  };
  engineStatus: 'Running' | 'Paused' | 'Stopped' | 'Outside Hours';
  cooldownRemaining: number;
  setCooldownRemaining: (value: number) => void;
  exchangeConfig: any;
  providerConfig: any;
  isExchangeConnected: (config: any) => boolean;
  updateEngineStatus: () => void;
  setAutoTradeStatus: (status: any) => void;
  setConfig: (config: any) => void;
  runSelfTest: () => Promise<any>;
  isRunningDiagnostics: boolean;
  showToast: (message: string, type: 'success' | 'error') => void;
  configsLoaded: boolean;
  isReady: boolean;
  autoTradeStatus: {
    enabled: boolean;
    lastResearchAt: string | null;
    nextScheduledAt: string | null;
  };
  user: any; // User object for modal
}

import { AutoTradeStartModal } from './AutoTradeStartModal';

export const AutoTradeEngineControls: React.FC<AutoTradeEngineControlsProps> = ({
  config,
  engineStatus,
  cooldownRemaining,
  setCooldownRemaining,
  exchangeConfig,
  providerConfig,
  isExchangeConnected,
  updateEngineStatus,
  setAutoTradeStatus,
  setConfig,
  runSelfTest,
  isRunningDiagnostics,
  showToast,
  configsLoaded,
  isReady,
  autoTradeStatus,
  user,
}) => {
  const togglingRef = useRef(false);
  const [saving, setSaving] = useState(false);
  const [showStartModal, setShowStartModal] = useState(false);

  // Cooldown timer effect
  useEffect(() => {
    if (config.cooldownSeconds > 0 && cooldownRemaining > 0) {
      const interval = setInterval(() => {
        setCooldownRemaining(prev => {
          if (prev <= 1) {
            // Cooldown finished
            return 0;
          }
          return prev - 1;
        });
      }, 1000);

      return () => clearInterval(interval);
    }
  }, [config.cooldownSeconds, cooldownRemaining, setCooldownRemaining]);

  const handleAutoTradeToggle = async (enabled: boolean, frequencyMinutes?: number) => {
    console.log("handleAutoTradeToggle called with:", { enabled, frequencyMinutes });
    console.log("exchangeConfig at toggle:", exchangeConfig);
    console.log("providerConfig at toggle:", providerConfig);

    if (togglingRef.current) return;
    togglingRef.current = true;

    // CRITICAL: Backend is source of truth - use isReady prop (computed from backend exchangeConnected)
    // Allow disabling always, allow enabling if backend says exchange is connected
    if (!enabled || isReady) {
      setSaving(true);
      try {
        // [DIAGNOSTIC] Log toggle request
        console.log('[FRONTEND_TOGGLE_DIAGNOSTIC] Sending toggle request:', {
          enabled,
          typeofEnabled: typeof enabled,
          frequencyMinutes
        });

        const response = await autoTradeApi.toggle(enabled, frequencyMinutes);

        // [DIAGNOSTIC] Log API response
        console.log('[FRONTEND_TOGGLE_DIAGNOSTIC] Toggle API response:', {
          response: response?.data,
          enabled: response?.data?.enabled,
          typeofEnabled: typeof response?.data?.enabled,
        });

        // Set correct state after enable
        const isEnabled = response?.data?.enabled ?? enabled;

        // [DIAGNOSTIC] Log final state being set
        console.log('[FRONTEND_TOGGLE_DIAGNOSTIC] Setting state:', {
          isEnabled,
          typeofIsEnabled: typeof isEnabled,
        });

        setAutoTradeStatus(prev => ({ ...prev, enabled: isEnabled }));
        setConfig(prev => ({ ...prev, autoTradeEnabled: isEnabled }));

        if (isEnabled) {
          updateEngineStatus();
          // Note: Research status would be set by backend updates
        }

        showToast(`Auto-Trade ${enabled ? 'started' : 'stopped'}`, 'success');
        setShowStartModal(false); // Close modal on success
        return response; // Return the promise result
      } catch (err: any) {
        console.error("AUTO-TRADE ENABLE API ERROR:", err);

        const backendStatus =
          err?.response?.status ||
          err?.status ||
          "NO_STATUS";

        const backendMessage =
          err?.response?.data?.message ||
          err?.message ||
          "Unknown backend error.";

        const backendDetails =
          err?.response?.data ||
          null;

        const errors = [
          {
            title: "Auto-Trade Enable Failed",
            reason: `Backend returned status: ${backendStatus}`,
            fix: backendMessage
          }
        ];

        if (backendDetails) {
          errors.push({
            title: "Backend Details",
            reason: JSON.stringify(backendDetails, null, 2),
            fix: "Review API keys, futures mode, permissions, and required settings."
          });
        }

        showToast(errors[0].title, 'error');
      } finally {
        setSaving(false);
        togglingRef.current = false;
      }
    } else {
      togglingRef.current = false;
      showToast('Exchange must be connected to enable Auto-Trade. Check diagnostics.', 'error');
      throw new Error('Exchange not connected');
    }
  };

  // Removed validateAutoTradeRequirements and checkAndEnableAutoTrade
  // Backend is single source of truth - use isReady prop (computed from backend exchangeConnected)

  return (
    <>
      <div className="bg-[#0a0f1a] backdrop-blur-sm border border-blue-500/20 rounded-xl p-6 mb-8 shadow-lg">
        <h2 className="text-xl font-semibold text-blue-200 mb-4">Engine Status</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="flex items-center justify-between">
            <span className="text-blue-100">Engine Status</span>
            <span className={`px-3 py-1 rounded-full text-sm font-medium ${engineStatus === 'Running' ? 'bg-green-600/40 text-green-300 border border-green-500/30' :
              'bg-red-600/40 text-red-300 border border-red-500/30'
              }`}>
              {engineStatus === 'Running' ? 'Running' : 'Stopped'}
            </span>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-blue-100">Auto-Trade</span>
            {autoTradeStatus?.enabled === true ? (
              <div className="flex gap-3">
                <span className="px-3 py-1 rounded-full text-sm font-medium bg-green-600/40 text-green-300 border border-green-500/30">
                  Enabled
                </span>
                <button
                  onClick={async () => {
                    const confirmed = window.confirm("Are you sure you want to turn off Auto-Trade?");
                    if (confirmed) {
                      await handleAutoTradeToggle(false);
                    }
                  }}
                  disabled={saving}
                  className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-sm rounded-lg shadow-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {saving ? 'Disabling...' : 'Auto-Trade OFF'}
                </button>
              </div>
            ) : (
              <div className="flex gap-3">
                <button
                  onClick={runSelfTest}
                  disabled={isRunningDiagnostics}
                  className="px-3 py-2 bg-gray-600 hover:bg-gray-700 text-white text-sm rounded-lg shadow-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
                >
                  {isRunningDiagnostics ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                      Testing...
                    </>
                  ) : (
                    <>
                      🔍 Run Self-Test
                    </>
                  )}
                </button>
                <div className="relative group">
                  <button
                    onClick={() => {
                      if (isReady) {
                        setShowStartModal(true);
                      } else {
                        showToast("Connect your exchange first.", "error");
                      }
                    }}
                    disabled={saving || !isReady}
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded-lg shadow-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    {saving ? 'Enabling...' : 'Start Auto-Trade'}
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="flex items-center justify-between">
            <span className="text-blue-100">Exchange</span>
            {isReady ? (
              <div className="flex flex-col items-end">
                <span className="text-sm font-medium text-blue-200">
                  {exchangeConfig?.exchange || exchangeConfig?.provider || 'Exchange'}
                </span>
                <span className="text-xs text-green-400">
                  Connected
                </span>
              </div>
            ) : (
              <span className="text-sm text-yellow-400">Not Connected</span>
            )}
          </div>
        </div>
      </div>

      <AutoTradeStartModal
        isOpen={showStartModal}
        onCancel={() => {
          setShowStartModal(false);
        }}
        onConfirm={(freq, _accuracyRiskConfig) => {
          // accuracyRiskConfig is already saved in the modal before calling onConfirm
          setShowStartModal(false); // Close modal first
          handleAutoTradeToggle(true, freq);
        }}
        user={user}
        showToast={showToast}
      />
    </>
  );
};
