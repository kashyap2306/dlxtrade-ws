import React, { useState, useEffect } from 'react';
import NotificationModal from './NotificationModal';

interface AccuracyAlertsActivationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (settings: {
    enabled: boolean;
    thresholdRange: '65-80' | '80-90' | '90+';
    telegramEnabled: boolean;
    telegramBotToken?: string;
    telegramChatId?: string;
  }) => Promise<void>;
  existingSettings?: {
    enabled?: boolean;
    threshold?: number;
    telegramEnabled?: boolean;
  };
  backgroundResearchTelegram?: {
    telegramBotToken?: string;
    telegramChatId?: string;
  };
}

const AccuracyAlertsActivationModal: React.FC<AccuracyAlertsActivationModalProps> = ({
  isOpen,
  onClose,
  onSave,
  existingSettings,
  backgroundResearchTelegram,
}) => {
  const [step, setStep] = useState<'validation' | 'threshold' | 'telegram' | 'confirm'>('validation');
  const [thresholdRange, setThresholdRange] = useState<'65-80' | '80-90' | '90+'>(
    existingSettings?.threshold
      ? existingSettings.threshold >= 90 ? '90+'
        : existingSettings.threshold >= 80 ? '80-90'
          : '65-80'
      : '80-90'
  );
  const [telegramEnabled, setTelegramEnabled] = useState(existingSettings?.telegramEnabled || false);
  const [telegramBotToken, setTelegramBotToken] = useState(backgroundResearchTelegram?.telegramBotToken || '');
  const [telegramChatId, setTelegramChatId] = useState(backgroundResearchTelegram?.telegramChatId || '');
  const [useExistingTelegram, setUseExistingTelegram] = useState(!!backgroundResearchTelegram?.telegramBotToken);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (isOpen && existingSettings?.enabled) {
      // If already enabled, start from threshold step
      setStep('threshold');
    } else if (isOpen) {
      setStep('validation');
    }
  }, [isOpen, existingSettings]);

  const handleNext = () => {
    if (step === 'validation') {
      setStep('threshold');
    } else if (step === 'threshold') {
      setStep('confirm');
    }
  };

  const handleBack = () => {
    if (step === 'threshold') {
      setStep('validation');
    } else if (step === 'confirm') {
      setStep('threshold');
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave({
        enabled: true,
        thresholdRange,
        telegramEnabled: false, // Independent of Telegram
      });
      onClose();
    } catch (error) {
      console.error('Failed to save accuracy alerts:', error);
    } finally {
      setSaving(false);
    }
  };

  const thresholdOptions = [
    { value: '65-80' as const, label: '65% – 80%', description: 'Moderate accuracy range' },
    { value: '80-90' as const, label: '80% – 90%', description: 'High accuracy range' },
    { value: '90+' as const, label: 'Above 90%', description: 'Very high accuracy' },
  ];

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      <div className="relative bg-slate-900/95 backdrop-blur-xl border border-blue-500/30 rounded-2xl shadow-2xl max-w-md w-full max-h-[90vh] overflow-y-auto">
        <div className="p-6">
          {/* Header */}
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-2xl font-bold text-white">Accuracy Alerts Setup</h2>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-white transition-colors"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Step Indicator */}
          <div className="flex items-center justify-center mb-6 space-x-2">
            {['validation', 'threshold', 'confirm'].map((s, idx) => (
              <React.Fragment key={s}>
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${['validation', 'threshold', 'confirm'].indexOf(step) >= idx
                    ? 'bg-blue-500 text-white'
                    : 'bg-slate-700 text-gray-400'
                  }`}>
                  {idx + 1}
                </div>
                {idx < 2 && (
                  <div className={`w-12 h-1 ${['validation', 'threshold', 'confirm'].indexOf(step) > idx
                      ? 'bg-blue-500'
                      : 'bg-slate-700'
                    }`} />
                )}
              </React.Fragment>
            ))}
          </div>

          {/* Step 1: Validation */}
          {step === 'validation' && (
            <div className="space-y-4">
              <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-4">
                <h3 className="text-lg font-semibold text-yellow-200 mb-2">API Validation Required</h3>
                <p className="text-sm text-gray-300 mb-4">
                  To enable Accuracy Alerts, you must have the following PRIMARY APIs configured and active:
                </p>
                <ul className="space-y-2 text-sm text-gray-300">
                  <li className="flex items-center gap-2">
                    <span className="text-yellow-400">✓</span>
                    <span>CryptoCompare (Market Data - Primary)</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="text-yellow-400">✓</span>
                    <span>NewsData.io (News - Primary)</span>
                  </li>
                </ul>
                <p className="text-xs text-gray-400 mt-4">
                  Backup APIs are optional. Please configure these in Settings → API Providers before continuing.
                </p>
              </div>
              <button
                onClick={handleNext}
                className="w-full px-6 py-3 bg-blue-600 text-white font-medium rounded-xl hover:bg-blue-700 transition-all"
              >
                Continue to Threshold Selection
              </button>
            </div>
          )}

          {/* Step 2: Threshold Selection */}
          {step === 'threshold' && (
            <div className="space-y-4">
              <h3 className="text-lg font-semibold text-white mb-4">Select Accuracy Threshold Range</h3>
              <div className="space-y-3">
                {thresholdOptions.map((option) => (
                  <button
                    key={option.value}
                    onClick={() => setThresholdRange(option.value)}
                    className={`w-full p-4 rounded-xl border-2 text-left transition-all ${thresholdRange === option.value
                        ? 'border-blue-500 bg-blue-500/20'
                        : 'border-slate-700 bg-slate-800/50 hover:border-slate-600'
                      }`}
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="font-semibold text-white">{option.label}</div>
                        <div className="text-sm text-gray-400">{option.description}</div>
                      </div>
                      {thresholdRange === option.value && (
                        <div className="w-6 h-6 rounded-full bg-blue-500 flex items-center justify-center">
                          <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                          </svg>
                        </div>
                      )}
                    </div>
                  </button>
                ))}
              </div>
              <div className="flex gap-3">
                <button
                  onClick={handleBack}
                  className="flex-1 px-6 py-3 bg-slate-700 text-white font-medium rounded-xl hover:bg-slate-600 transition-all"
                >
                  Back
                </button>
                <button
                  onClick={handleNext}
                  className="flex-1 px-6 py-3 bg-blue-600 text-white font-medium rounded-xl hover:bg-blue-700 transition-all"
                >
                  Continue
                </button>
              </div>
            </div>
          )}

          {/* Step 3: Confirmation */}
          {step === 'confirm' && (
            <div className="space-y-4">
              <h3 className="text-lg font-semibold text-white mb-4">Confirm Settings</h3>
              <div className="space-y-3 p-4 bg-slate-800/50 rounded-xl border border-slate-700">
                <div className="flex justify-between">
                  <span className="text-gray-400">Threshold Range:</span>
                  <span className="text-white font-medium">
                    {thresholdRange === '65-80' ? '65% – 80%' : thresholdRange === '80-90' ? '80% – 90%' : 'Above 90%'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">App Alerts:</span>
                  <span className="text-white font-medium">Enabled (Active)</span>
                </div>
                <p className="text-xs text-gray-400 mt-2">
                  Accuracy alerts are independent of external services. You will receive notifications in the dashboard.
                </p>
              </div>
              <div className="flex gap-3">
                <button
                  onClick={handleBack}
                  className="flex-1 px-6 py-3 bg-slate-700 text-white font-medium rounded-xl hover:bg-slate-600 transition-all"
                >
                  Back
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="flex-1 px-6 py-3 bg-green-600 text-white font-medium rounded-xl hover:bg-green-700 transition-all disabled:opacity-50"
                >
                  {saving ? 'Saving...' : 'Enable Accuracy Alerts'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default AccuracyAlertsActivationModal;
