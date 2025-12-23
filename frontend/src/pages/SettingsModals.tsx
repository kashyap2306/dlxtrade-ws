import React, { useState, useEffect } from "react";
import {
  CheckCircleIcon,
  XCircleIcon,
  ExclamationTriangleIcon,
  SpeakerWaveIcon,
} from "@heroicons/react/24/outline";

interface SettingsModalsProps {
  showAutoTradeModal: boolean;
  showTradeConfirmationModal: boolean;
  showSoundSelectorModal: boolean;
  notificationPrereqs: any;
  currentSoundPreferences: any;
  handleAutoTradeModalClose: () => void;
  handleTradeConfirmationModalClose: () => void;
  handleGoToAutoTradeSettings: () => void;
  handleSoundSelectorSave: (preferences: any) => void;
  handleSoundSelectorClose: () => void;
}

export const SettingsModals: React.FC<SettingsModalsProps> = ({
  showAutoTradeModal,
  showTradeConfirmationModal,
  showSoundSelectorModal,
  notificationPrereqs,
  currentSoundPreferences,
  handleAutoTradeModalClose,
  handleTradeConfirmationModalClose,
  handleGoToAutoTradeSettings,
  handleSoundSelectorSave,
  handleSoundSelectorClose,
}) => {
  const ready = notificationPrereqs || {};

  return (
    <>
      {/* Auto-Trade Prerequisite Modal */}
      {showAutoTradeModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
          <div className="bg-slate-900/90 backdrop-blur-lg rounded-2xl p-8 max-w-lg w-full text-center border border-amber-500/20 shadow-2xl">
            <div className="w-16 h-16 bg-amber-500/10 rounded-full flex items-center justify-center mx-auto mb-4">
              <ExclamationTriangleIcon className="w-8 h-8 text-amber-500" />
            </div>

            <h3 className="text-xl font-bold text-white mb-2">
              Auto-Trade Prerequisites Not Met
            </h3>

            <p className="text-gray-400 mb-4">
              You must complete the following steps before enabling Auto-Trade:
            </p>

            <ul className="text-left space-y-2 mb-6">
              <li
                className={`flex items-center gap-2 ${
                  ready.exchangeConnected ? "text-green-400" : "text-red-400"
                }`}
              >
                {ready.exchangeConnected ? (
                  <CheckCircleIcon className="w-5 h-5" />
                ) : (
                  <XCircleIcon className="w-5 h-5" />
                )}
                Connect a supported crypto exchange.
              </li>

              <li
                className={`flex items-center gap-2 ${
                  ready.telegramConfigured ? "text-green-400" : "text-red-400"
                }`}
              >
                {ready.telegramConfigured ? (
                  <CheckCircleIcon className="w-5 h-5" />
                ) : (
                  <XCircleIcon className="w-5 h-5" />
                )}
                Configure Telegram bot & chat ID.
              </li>

              <li
                className={`flex items-center gap-2 ${
                  ready.apiKeysValidated ? "text-green-400" : "text-red-400"
                }`}
              >
                {ready.apiKeysValidated ? (
                  <CheckCircleIcon className="w-5 h-5" />
                ) : (
                  <XCircleIcon className="w-5 h-5" />
                )}
                Validate required API keys.
              </li>
            </ul>

            <button
              onClick={handleAutoTradeModalClose}
              className="w-full px-6 py-3 bg-purple-500/80 text-white font-semibold rounded-xl hover:bg-purple-600/90 transition-all duration-300"
            >
              I Understand
            </button>
          </div>
        </div>
      )}

      {/* Trade Confirmation Prerequisite Modal */}
      {showTradeConfirmationModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
          <div className="bg-slate-900/90 backdrop-blur-lg rounded-2xl p-8 max-w-lg w-full text-center border border-blue-500/20 shadow-2xl">
            <div className="w-16 h-16 bg-blue-500/10 rounded-full flex items-center justify-center mx-auto mb-4">
              <ExclamationTriangleIcon className="w-8 h-8 text-blue-500" />
            </div>

            <h3 className="text-xl font-bold text-white mb-2">
              Auto Trade Mode Required
            </h3>

            <p className="text-gray-400 mb-6">
              Trade Confirmation Required can only be enabled when Auto Trade Mode is active.
              This feature allows you to review and approve each automated trade before execution.
            </p>

            <div className="flex gap-3">
              <button
                onClick={handleTradeConfirmationModalClose}
                className="flex-1 px-6 py-3 bg-gray-600/80 text-white font-semibold rounded-xl hover:bg-gray-700/90 transition-all duration-300"
              >
                Cancel
              </button>
              <button
                onClick={handleGoToAutoTradeSettings}
                className="flex-1 px-6 py-3 bg-blue-500/80 text-white font-semibold rounded-xl hover:bg-blue-600/90 transition-all duration-300"
              >
                Go to Auto Trade Settings
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Sound Selector Modal */}
      {showSoundSelectorModal && (
        <SoundSelectorModal
          currentSoundPreferences={currentSoundPreferences}
          onSave={handleSoundSelectorSave}
          onClose={handleSoundSelectorClose}
        />
      )}
    </>
  );
};

// Sound Selector Modal Component
const SoundSelectorModal: React.FC<{
  currentSoundPreferences: any;
  onSave: (preferences: any) => void;
  onClose: () => void;
}> = ({ currentSoundPreferences, onSave, onClose }) => {
  const [selectedSounds, setSelectedSounds] = useState<any>(currentSoundPreferences || {});
  const [enabledAlerts, setEnabledAlerts] = useState({
    autoTrade: true,
    whale: true,
    accuracy: false,
    confirmation: true,
    errors: true,
    ...currentSoundPreferences?.enabledAlerts
  });

  const soundTypes = [
    { id: 'pop', name: 'Pop' },
    { id: 'ding', name: 'Ding' },
    { id: 'pulse', name: 'Pulse' },
    { id: 'digital-beep', name: 'Digital Beep' },
    { id: 'alert-wave', name: 'Alert Wave' },
    { id: 'soft-bell', name: 'Soft Bell' },
    { id: 'metal-click', name: 'Metal Click' },
    { id: 'notification-rise', name: 'Notification Rise' },
    { id: 'success-tone', name: 'Success Tone' },
    { id: 'warning-tone', name: 'Warning Tone' },
  ];

  const alertTypes = [
    { id: 'autoTrade', name: 'Auto Trade Alerts' },
    { id: 'whale', name: 'Whale Alerts' },
    { id: 'accuracy', name: 'Accuracy Alerts' },
    { id: 'confirmation', name: 'Trade Confirmation Alerts' },
    { id: 'errors', name: 'Error Alerts' },
  ];

  const handleSave = () => {
    const preferences = {
      enabledAlerts,
      ...selectedSounds
    };
    onSave(preferences);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
      <div className="bg-slate-900/90 backdrop-blur-lg rounded-2xl p-8 max-w-2xl w-full border border-purple-500/20 shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 bg-purple-500/10 rounded-full flex items-center justify-center">
            <SpeakerWaveIcon className="w-6 h-6 text-purple-500" />
          </div>
          <div>
            <h3 className="text-xl font-bold text-white">Select Notification Sounds</h3>
            <p className="text-sm text-gray-400">Choose sounds for different alert types</p>
          </div>
        </div>

        {/* Alert Type Selection */}
        <div className="mb-6">
          <h4 className="text-lg font-semibold text-white mb-3">Enable Sound For:</h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {alertTypes.map((alert) => (
              <label key={alert.id} className="flex items-center gap-3 p-3 bg-slate-800/50 rounded-lg cursor-pointer hover:bg-slate-800/70 transition-colors">
                <input
                  type="checkbox"
                  checked={enabledAlerts[alert.id as keyof typeof enabledAlerts]}
                  onChange={(e) => setEnabledAlerts(prev => ({
                    ...prev,
                    [alert.id]: e.target.checked
                  }))}
                  className="w-4 h-4 text-purple-600 bg-gray-100 border-gray-300 rounded focus:ring-purple-500"
                />
                <span className="text-white text-sm">{alert.name}</span>
              </label>
            ))}
          </div>
        </div>

        {/* Sound Type Selection */}
        <div className="mb-6">
          <h4 className="text-lg font-semibold text-white mb-3">Choose Sounds:</h4>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {alertTypes.filter(alert => enabledAlerts[alert.id as keyof typeof enabledAlerts]).map((alert) => (
              <div key={alert.id} className="space-y-2">
                <label className="block text-sm font-medium text-gray-300">{alert.name}</label>
                <select
                  value={selectedSounds[alert.id] || 'ding'}
                  onChange={(e) => setSelectedSounds(prev => ({
                    ...prev,
                    [alert.id]: e.target.value
                  }))}
                  className="w-full px-3 py-2 bg-slate-800/50 border border-white/10 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                >
                  {soundTypes.map((sound) => (
                    <option key={sound.id} value={sound.id} className="bg-slate-900">
                      {sound.name}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex gap-3 pt-4 border-t border-white/10">
          <button
            onClick={onClose}
            className="flex-1 px-6 py-3 bg-gray-600/80 text-white font-semibold rounded-xl hover:bg-gray-700/90 transition-all duration-300"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="flex-1 px-6 py-3 bg-purple-500/80 text-white font-semibold rounded-xl hover:bg-purple-600/90 transition-all duration-300"
          >
            Save Sound Preferences
          </button>
        </div>
      </div>
    </div>
  );
};
