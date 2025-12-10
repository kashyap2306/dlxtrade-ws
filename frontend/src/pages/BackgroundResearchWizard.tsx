import React, { useState, useEffect, useRef } from 'react';
import { settingsApi } from '../services/api';
import Toast from '../components/Toast';
import { LoadingState } from '../components/LoadingState';

interface BackgroundResearchWizardProps {
  handleLogout: () => void;
}

// Background Research Wizard Component
export const BackgroundResearchWizard: React.FC<BackgroundResearchWizardProps> = ({ handleLogout }) => {
  const [bgResearchEnabled, setBgResearchEnabled] = useState(false);
  const [currentStep, setCurrentStep] = useState(1);
  const [telegramBotToken, setTelegramBotToken] = useState('');
  const [telegramChatId, setTelegramChatId] = useState('');
  const [researchFrequency, setResearchFrequency] = useState(5);
  const [accuracyTrigger, setAccuracyTrigger] = useState(80);
  const [testingTelegram, setTestingTelegram] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [loadingSettings, setLoadingSettings] = useState(true);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [checkingApiKeys, setCheckingApiKeys] = useState(false);
  const [apiKeysValid, setApiKeysValid] = useState(false);

  // Helper to show toast inside this component
  const showToast = (message: string, type: 'success' | 'error') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  // Load existing settings on component mount
  useEffect(() => {
    loadBackgroundResearchSettings();
  }, []);

  const loadBackgroundResearchSettings = async () => {
    try {
      setLoadingSettings(true);
      const response = await settingsApi.backgroundResearch.getSettings();
      const data = response.data;
      setBgResearchEnabled(data.backgroundResearchEnabled || false);
      setTelegramBotToken(data.telegramBotToken || '');
      setTelegramChatId(data.telegramChatId || '');
      setResearchFrequency(data.researchFrequencyMinutes || 5);
      setAccuracyTrigger(data.accuracyTrigger || 80);
    } catch (error: any) {
      if (error.response?.status === 401) {
        handleLogout();
        return;
      }
      // Error is handled by not setting the states, which defaults to initial.
    } finally {
      setLoadingSettings(false);
    }
  };

  const testTelegramConnection = async () => {
    if (!telegramBotToken.trim() || !telegramChatId.trim()) {
      showToast('Please fill in both Bot Token and Chat ID', 'error');
      return;
    }

    // Validate bot token format (Telegram bot tokens start with a number and contain a colon)
    const botTokenRegex = /^\d+:[A-Za-z0-9_-]+$/;
    if (!botTokenRegex.test(telegramBotToken.trim())) {
      showToast('Invalid bot token format. Telegram bot tokens should be in format: 123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11', 'error');
      return;
    }

    // Validate chat ID format (should be a number or start with @ or -)
    const chatIdRegex = /^(@[A-Za-z0-9_]+|-\d+|\d+)$/;
    if (!chatIdRegex.test(telegramChatId.trim())) {
      showToast('Invalid chat ID format. Chat ID should be a number, start with @ for channels/groups, or start with - for groups', 'error');
      return;
    }

    setTestingTelegram(true);
    try {
      const response = await settingsApi.backgroundResearch.test({ botToken: telegramBotToken, chatId: telegramChatId });
      showToast(response.data.message || 'DLXTRADE Alert Test Successful: Telegram integration working.', 'success');
    } catch (error: any) {
      if (error.response?.status === 401) {
        handleLogout();
        return;
      }
      showToast(error.response?.data?.error || 'Failed to send test message', 'error');
    } finally {
      setTestingTelegram(false);
    }
  };

  const saveBackgroundResearchSettings = async () => {
    setSavingSettings(true);
    try {
      const settingsData: any = {
        backgroundResearchEnabled: bgResearchEnabled,
        researchFrequencyMinutes: researchFrequency,
        accuracyTrigger: accuracyTrigger,
      };

      // Only include Telegram fields if background research is enabled
      if (bgResearchEnabled) {
        settingsData.telegramBotToken = telegramBotToken;
        settingsData.telegramChatId = telegramChatId;
      }

      await settingsApi.backgroundResearch.saveSettings(settingsData);
      showToast('Background research settings saved successfully!', 'success');
      setCurrentStep(0); // Reset to API validation step
    } catch (error: any) {
      if (error.response?.status === 401) {
        handleLogout();
        return;
      }
      showToast(error.response?.data?.error || 'Failed to save settings', 'error');
    } finally {
      setSavingSettings(false);
    }
  };

  const checkApiKeys = async () => {
    setCheckingApiKeys(true);
    try {
      const requiredApis = [
        'CryptoCompare',
        'CoinGecko',
        'CoinPaprika',
        'NewsData',
        'CryptoPanic',
        'Reddit',
        'GNews',
        'KuCoin',
        'Bybit',
        'OKX',
        'Bitget'
      ];
      const missingKeys: string[] = [];

      // Check each required API key
      for (const apiName of requiredApis) {
        try {
          // REQ 8: Ensure API loader returns plain JSON data. CheckKey should return a success object.
          const response = await settingsApi.providers.test({
            providerName: apiName,
            type: 'marketData',
            apiKey: '' // Will be checked server-side
          });
          if (!response.data?.valid) {
            missingKeys.push(apiName);
          }
        } catch (error: any) {
          if (error.response?.status === 401) {
            handleLogout();
            return false;
          }
          missingKeys.push(apiName);
        }
      }

      if (missingKeys.length > 0) {
        showToast(`Missing API keys: ${missingKeys.join(', ')}`, 'error');
        setApiKeysValid(false);
        return false;
      } else {
        showToast('All required API keys are configured!', 'success');
        setApiKeysValid(true);
        return true;
      }
    } catch (error) {
      showToast('Failed to validate API keys', 'error');
      setApiKeysValid(false);
      return false;
    } finally {
      setCheckingApiKeys(false);
    }
  };

  const nextStep = async () => {
    if (currentStep === 0 && bgResearchEnabled) {
      // Check API keys before proceeding
      const keysValid = await checkApiKeys();
      if (keysValid) {
        setCurrentStep(1);
      }
    } else if (currentStep < 5) {
      setCurrentStep(currentStep + 1);
    }
  };

  const prevStep = () => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1);
    }
  };

  const canProceedToStep2 = telegramBotToken.trim() && telegramChatId.trim();

  // REQ 2: Fix TDZ fatal error - Remove incorrect Sidebar usage from nested component's loading state.
  if (loadingSettings) {
    return (
      <div className="flex items-center justify-center py-10">
        <LoadingState message="Loading background research settings..." />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Enable/Disable Toggle */}
      <div className="bg-slate-900/40 backdrop-blur-md rounded-2xl border border-white/10 p-6 sm:p-8 shadow-xl transition-all duration-300 hover:shadow-2xl hover:border-purple-500/20">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex-1">
            <label className="text-xl font-bold text-white mb-2 block">Background Deep Research</label>
            <p className="text-sm text-gray-400">Automatically run deep research analysis and receive Telegram alerts for high-accuracy signals</p>
          </div>
          <label className="relative inline-flex items-center cursor-pointer flex-shrink-0">
            <input
              type="checkbox"
              className="sr-only peer"
              checked={bgResearchEnabled}
              onChange={(e) => setBgResearchEnabled(e.target.checked)}
            />
            <div className="w-14 h-7 bg-gray-600 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-purple-300/20 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-6 after:w-6 after:transition-all peer-checked:bg-gradient-to-r peer-checked:from-purple-500 peer-checked:to-pink-500"></div>
          </label>
        </div>
      </div>

      {/* Multi-step Wizard */}
      {bgResearchEnabled && (
        <div className="bg-slate-900/40 backdrop-blur-md rounded-2xl border border-white/10 shadow-xl overflow-hidden">
          {/* Step Indicator */}
          <div className="bg-gradient-to-r from-slate-900/70 to-slate-800/70 backdrop-blur-sm px-6 py-4 border-b border-white/10">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div className="flex items-center space-x-3">
                {[0, 1, 2, 3, 4].map((step) => (
                  <div
                    key={step}
                    className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-semibold transition-all duration-300 hover:scale-105 ${step <= currentStep
                      ? 'bg-gradient-to-r from-purple-500 to-pink-500 text-white shadow-lg ring-2 ring-purple-300/50'
                      : 'bg-slate-700 text-gray-400'
                      }`}
                  >
                    {step === 0 ? '✓' : step + 1}
                  </div>
                ))}
              </div>
              <div className="text-right">
                <span className="text-sm font-medium text-gray-300">
                  Step {currentStep + 1} of 5
                </span>
                <p className="text-xs text-gray-400 mt-1">
                  {currentStep === 0 && 'API Key Validation'}
                  {currentStep === 1 && 'Configure Telegram'}
                  {currentStep === 2 && 'Set Research Frequency'}
                  {currentStep === 3 && 'Choose Accuracy Trigger'}
                  {currentStep === 4 && 'Review & Save'}
                </p>
              </div>
            </div>
          </div>

          {/* Step Content */}
          <div className="p-6 sm:p-8">
            {currentStep === 0 && (
              <div className="space-y-6">
                <div className="text-center sm:text-left">
                  <h3 className="text-2xl font-bold text-white mb-2">🔑 API Key Validation</h3>
                  <p className="text-gray-400">
                    Before enabling Deep Research, we need to verify all required API keys are configured.
                  </p>
                </div>
                <div className="bg-slate-800/30 rounded-xl p-6 border border-slate-600/30">
                  <h4 className="text-lg font-semibold text-white mb-4">Required API Keys:</h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {[
                      'CryptoCompare (Market Data)',
                      'CoinGecko (Metadata)',
                      'CoinPaprika (Metadata)',
                      'NewsData (News)',
                      'CryptoPanic (News)',
                      'Reddit (News)',
                      'GNews (News)',
                      'KuCoin (Exchange)',
                      'Bybit (Exchange)',
                      'OKX (Exchange)',
                      'Bitget (Exchange)'
                    ].map((api, index) => (
                      <div key={index} className="flex items-center gap-2">
                        <div className="w-2 h-2 bg-purple-400 rounded-full"></div>
                        <span className="text-sm text-gray-300">{api}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="bg-blue-500/10 border border-blue-500/20 rounded-xl p-4">
                  <p className="text-sm text-blue-200">
                    <span className="font-semibold">💡 Note:</span> Configure these API keys in the "API Provider Configuration" section above before proceeding.
                  </p>
                </div>
                <div className="flex flex-col sm:flex-row gap-4">
                  <button
                    onClick={checkApiKeys}
                    disabled={checkingApiKeys}
                    className="w-full flex-1 px-6 py-3 bg-gradient-to-r from-blue-500 to-blue-600 text-white font-semibold rounded-xl hover:from-blue-600 hover:to-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-slate-900 transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg hover:scale-[1.01]"
                  >
                    {checkingApiKeys ? (
                      <span className="flex items-center justify-center gap-2">
                        <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                        Checking API Keys...
                      </span>
                    ) : (
                      <span className="flex items-center justify-center gap-2">
                        🔍 Validate API Keys
                      </span>
                    )}
                  </button>
                </div>
                {apiKeysValid && (
                  <div className="flex justify-end pt-4 border-t border-white/10">
                    <button
                      onClick={nextStep}
                      className="w-full sm:w-auto px-8 py-3 bg-gradient-to-r from-purple-500 to-pink-500 text-white font-semibold rounded-xl hover:from-purple-600 hover:to-pink-600 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2 focus:ring-offset-slate-900 transition-all duration-300 shadow-lg hover:scale-[1.01]"
                    >
                      Continue →
                    </button>
                  </div>
                )}
              </div>
            )}
            {currentStep === 1 && (
              <div className="space-y-6">
                <div className="text-center sm:text-left">
                  <h3 className="text-2xl font-bold text-white mb-2">🚀 Telegram Setup</h3>
                  <p className="text-gray-400">
                    Configure your Telegram bot to receive real-time research alerts with high-accuracy signals.
                  </p>
                </div>
                <div className="grid gap-6 sm:grid-cols-1">
                  <div className="space-y-3">
                    <label className="block text-sm font-semibold text-gray-200">
                      📱 Telegram Bot Token
                    </label>
                    <input
                      type="password"
                      className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all duration-300 shadow-inner hover:bg-white/10"
                      value={telegramBotToken}
                      onChange={(e) => setTelegramBotToken(e.target.value)}
                      placeholder="Enter your Telegram bot token (e.g., 123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11)"
                    />
                    <p className="text-xs text-gray-400 flex items-center gap-2">
                      <span className="text-blue-400">💡</span>
                      Create a bot with @BotFather on Telegram and get your token
                    </p>
                  </div>
                  <div className="space-y-3">
                    <label className="block text-sm font-semibold text-gray-200">
                      👤 Telegram Chat ID
                    </label>
                    <input
                      type="text"
                      className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all duration-300 shadow-inner hover:bg-white/10"
                      value={telegramChatId}
                      onChange={(e) => setTelegramChatId(e.target.value)}
                      placeholder="Enter your chat ID (e.g., 123456789)"
                    />
                    <p className="text-xs text-gray-400 flex items-center gap-2">
                      <span className="text-green-400">💡</span>
                      Send /start to your bot, then use @userinfobot or check bot logs
                    </p>
                  </div>
                </div>
                <div className="flex flex-col sm:flex-row gap-4">
                  <button
                    onClick={testTelegramConnection}
                    disabled={testingTelegram || !telegramBotToken.trim() || !telegramChatId.trim()}
                    className="w-full flex-1 px-6 py-3 bg-gradient-to-r from-blue-500 to-blue-600 text-white font-semibold rounded-xl hover:from-blue-600 hover:to-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-slate-900 transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg hover:scale-[1.01]"
                  >
                    {testingTelegram ? (
                      <span className="flex items-center justify-center gap-2">
                        <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                        Sending Test Message...
                      </span>
                    ) : (
                      <span className="flex items-center justify-center gap-2">
                        📤 Send Test Message
                      </span>
                    )}
                  </button>
                </div>
                <div className="flex justify-end pt-4 border-t border-white/10">
                  <button
                    onClick={nextStep}
                    disabled={!canProceedToStep2}
                    className="w-full sm:w-auto px-8 py-3 bg-gradient-to-r from-purple-500 to-pink-500 text-white font-semibold rounded-xl hover:from-purple-600 hover:to-pink-600 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2 focus:ring-offset-slate-900 transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg hover:scale-[1.01]"
                  >
                    Continue →
                  </button>
                </div>
              </div>
            )}
            {currentStep === 2 && (
              <div className="space-y-6">
                <div className="text-center sm:text-left">
                  <h3 className="text-2xl font-bold text-white mb-2">⏰ Research Frequency</h3>
                  <p className="text-gray-400">
                    Choose how often the system should run deep research analysis in the background.
                  </p>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                  {[
                    { value: 1, label: '1M' },
                    { value: 3, label: '3M' },
                    { value: 5, label: '5M' },
                    { value: 10, label: '10M' },
                    { value: 15, label: '15M' },
                    { value: 30, label: '30M' },
                    { value: 45, label: '45M' },
                    { value: 60, label: '1H' }
                  ].map(({ value, label }) => (
                    <label
                      key={value}
                      className={`relative flex items-center justify-center p-4 rounded-xl border-2 cursor-pointer transition-all duration-300 hover:scale-[1.02] transform-gpu ${researchFrequency === value
                        ? 'border-purple-500 bg-gradient-to-r from-purple-500/20 to-pink-500/20 text-white shadow-lg ring-2 ring-purple-500/50'
                        : 'border-slate-600/50 bg-slate-800/30 text-gray-300 hover:border-purple-500/70 hover:bg-slate-700/50'
                        }`}
                    >
                      <input
                        type="radio"
                        name="frequency"
                        value={value}
                        checked={researchFrequency === value}
                        onChange={(e) => setResearchFrequency(parseInt(e.target.value))}
                        className="sr-only"
                      />
                      <div className="text-center">
                        <span className="text-lg font-bold block">
                          {label}
                        </span>
                      </div>
                      {researchFrequency === value && (
                        <div className="absolute -top-1 -right-1 w-5 h-5 bg-gradient-to-r from-purple-500 to-pink-500 rounded-full flex items-center justify-center flex-shrink-0">
                          <span className="text-white text-xs">✓</span>
                        </div>
                      )}
                    </label>
                  ))}
                </div>
                <div className="flex justify-between pt-4 border-t border-white/10">
                  <button
                    onClick={prevStep}
                    className="w-full sm:w-auto px-8 py-3 bg-slate-700/50 text-gray-300 font-semibold rounded-xl hover:bg-slate-600/70 focus:outline-none focus:ring-2 focus:ring-slate-500 focus:ring-offset-2 focus:ring-offset-slate-900 transition-all duration-300 shadow-lg hover:scale-[1.01]"
                  >
                    ← Back
                  </button>
                  <button
                    onClick={nextStep}
                    className="w-full sm:w-auto px-8 py-3 bg-gradient-to-r from-purple-500 to-pink-500 text-white font-semibold rounded-xl hover:from-purple-600 hover:to-pink-600 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2 focus:ring-offset-slate-900 transition-all duration-300 shadow-lg hover:scale-[1.01]"
                  >
                    Continue →
                  </button>
                </div>
              </div>
            )}
            {currentStep === 3 && (
              <div className="space-y-6">
                <div className="text-center sm:text-left">
                  <h3 className="text-2xl font-bold text-white mb-2">🎯 Accuracy Trigger</h3>
                  <p className="text-gray-400">
                    Set the minimum predicted accuracy (in %) required for the system to generate a research alert.
                  </p>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {[
                    { value: 60, label: '60%+', desc: 'High Volume Signals (High Risk)' },
                    { value: 70, label: '70%+', desc: 'Balanced Performance (Medium Risk)' },
                    { value: 80, label: '80%+', desc: 'Conservative Trading (Low Risk)' },
                    { value: 90, label: '90%+', desc: 'Maximum Reliability (Very Low Risk)' }
                  ].map(({ value, label, desc }) => (
                    <label
                      key={value}
                      className={`block p-4 rounded-xl border-2 cursor-pointer transition-all duration-300 hover:scale-[1.02] transform-gpu ${accuracyTrigger >= value && accuracyTrigger < value + 10
                        ? 'border-purple-500 bg-gradient-to-r from-purple-500/20 to-pink-500/20 text-white shadow-lg ring-2 ring-purple-500/50'
                        : 'border-slate-600/50 bg-slate-800/30 text-gray-300 hover:border-purple-500/70 hover:bg-slate-700/50'
                        }`}
                    >
                      <input
                        type="radio"
                        name="accuracy"
                        value={value}
                        checked={accuracyTrigger >= value && accuracyTrigger < value + 10}
                        onChange={() => setAccuracyTrigger(value)}
                        className="sr-only"
                      />
                      <div className="flex justify-between items-center">
                        <span className="text-lg font-bold">{label}</span>
                        {accuracyTrigger >= value && accuracyTrigger < value + 10 && (
                          <div className="w-5 h-5 bg-gradient-to-r from-purple-500 to-pink-500 rounded-full flex items-center justify-center flex-shrink-0">
                            <span className="text-white text-xs">✓</span>
                          </div>
                        )}
                      </div>
                      <p className="text-sm text-gray-400 mt-1">{desc}</p>
                    </label>
                  ))}
                </div>
                <div className="space-y-3">
                  <label className="block text-sm font-semibold text-gray-200">
                    Current Accuracy Trigger: <span className="text-purple-400">{accuracyTrigger}%</span>
                  </label>
                  <input
                    type="range"
                    min="60"
                    max="99"
                    step="1"
                    value={accuracyTrigger}
                    onChange={(e) => setAccuracyTrigger(parseInt(e.target.value))}
                    className="w-full h-2 bg-purple-900/50 rounded-lg appearance-none cursor-pointer transition-all duration-300 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:bg-purple-500 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:shadow-lg"
                  />
                  <div className="flex justify-between text-xs text-gray-400">
                    <span>60% (High Volume)</span>
                    <span>99% (Max Reliability)</span>
                  </div>
                </div>
                <div className="bg-orange-500/10 border border-orange-500/20 rounded-xl p-4">
                  <p className="text-sm text-orange-200">
                    <span className="font-semibold">⚠️ Warning:</span> Lowering the trigger below 70% can significantly increase the volume of alerts and the chance of false signals.
                  </p>
                </div>
                <div className="flex justify-between pt-4 border-t border-white/10">
                  <button
                    onClick={prevStep}
                    className="w-full sm:w-auto px-8 py-3 bg-slate-700/50 text-gray-300 font-semibold rounded-xl hover:bg-slate-600/70 focus:outline-none focus:ring-2 focus:ring-slate-500 focus:ring-offset-2 focus:ring-offset-slate-900 transition-all duration-300 shadow-lg hover:scale-[1.01]"
                  >
                    ← Back
                  </button>
                  <button
                    onClick={nextStep}
                    className="w-full sm:w-auto px-8 py-3 bg-gradient-to-r from-purple-500 to-pink-500 text-white font-semibold rounded-xl hover:from-purple-600 hover:to-pink-600 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2 focus:ring-offset-slate-900 transition-all duration-300 shadow-lg hover:scale-[1.01]"
                  >
                    Continue →
                  </button>
                </div>
              </div>
            )}
            {currentStep === 4 && (
              <div className="space-y-6">
                <div className="text-center sm:text-left">
                  <h3 className="text-2xl font-bold text-white mb-2">✅ Review & Save</h3>
                  <p className="text-gray-400">
                    Confirm your background research and notification settings.
                  </p>
                </div>
                <div className="bg-slate-800/30 rounded-xl p-6 border border-slate-600/30 space-y-4">
                  <div className="flex justify-between items-center pb-2 border-b border-white/5">
                    <span className="text-lg font-semibold text-white">Feature Status:</span>
                    <span className={`font-bold text-lg ${bgResearchEnabled ? 'text-green-400' : 'text-red-400'}`}>
                      {bgResearchEnabled ? 'Enabled' : 'Disabled'}
                    </span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <p className="text-sm font-medium text-gray-400">Research Frequency</p>
                      <span className="text-white font-semibold">{researchFrequency} Minutes</span>
                    </div>
                    <div className="space-y-1">
                      <p className="text-sm font-medium text-gray-400">Accuracy Trigger</p>
                      <span className="text-white font-semibold">{accuracyTrigger}%+</span>
                    </div>
                    <div className="space-y-1">
                      <p className="text-sm font-medium text-gray-400">Telegram Bot Token</p>
                      <span className="text-white font-semibold">{telegramBotToken ? 'Configured' : 'Missing'}</span>
                    </div>
                    <div className="space-y-1">
                      <p className="text-sm font-medium text-gray-400">Telegram Chat ID</p>
                      <span className="text-white font-semibold">{telegramChatId || 'Missing'}</span>
                    </div>
                  </div>
                </div>
                <div className="flex justify-between pt-4 border-t border-white/10">
                  <button
                    onClick={prevStep}
                    className="w-full sm:w-auto px-8 py-3 bg-slate-700/50 text-gray-300 font-semibold rounded-xl hover:bg-slate-600/70 focus:outline-none focus:ring-2 focus:ring-slate-500 focus:ring-offset-2 focus:ring-offset-slate-900 transition-all duration-300 shadow-lg hover:scale-[1.01]"
                  >
                    ← Back
                  </button>
                  <button
                    onClick={saveBackgroundResearchSettings}
                    disabled={savingSettings || (bgResearchEnabled && (!telegramBotToken || !telegramChatId))}
                    className="w-full sm:w-auto px-8 py-3 bg-gradient-to-r from-purple-500 to-pink-500 text-white font-semibold rounded-xl hover:from-purple-600 hover:to-pink-600 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2 focus:ring-offset-slate-900 transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg hover:scale-[1.01]"
                  >
                    {savingSettings ? 'Saving...' : 'Save All Settings'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
      {/* Toast Notification */}
      {toast && <Toast message={toast.message} type={toast.type} />}
    </div>
  );
};
