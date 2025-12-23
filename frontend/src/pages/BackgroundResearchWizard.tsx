import React, { useState, useEffect } from 'react';
import { settingsApi, researchApi } from '../services/api';
import { useAuth } from '../hooks/useAuth';
import Toast from '../components/Toast';
import { LoadingState } from '../components/LoadingState';
import {
  BeakerIcon,
  ChatBubbleLeftRightIcon,
  ClockIcon,
  SignalIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon,
  ChevronRightIcon,
  CheckIcon,
  BoltIcon,
  PowerIcon,
  ArrowPathIcon,
  ShieldCheckIcon,
  CpuChipIcon,
  XMarkIcon
} from '@heroicons/react/24/outline';

interface BackgroundResearchWizardProps {
  handleLogout: () => void;
}

// Background Research Wizard Component
export const BackgroundResearchWizard: React.FC<BackgroundResearchWizardProps> = ({ handleLogout }) => {
  const { user } = useAuth();
  const [bgResearchEnabled, setBgResearchEnabled] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [telegramBotToken, setTelegramBotToken] = useState('');
  const [telegramChatId, setTelegramChatId] = useState('');
  const [researchFrequency, setResearchFrequency] = useState(5);
  const [accuracyTrigger, setAccuracyTrigger] = useState({ min: 75, max: 100 });
  const [testingTelegram, setTestingTelegram] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [loadingSettings, setLoadingSettings] = useState(true);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [isManageMode, setIsManageMode] = useState(false);
  const [diagnostic, setDiagnostic] = useState<any>(null);
  const [showDisableConfirm, setShowDisableConfirm] = useState(false);
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [canStartDeepResearch, setCanStartDeepResearch] = useState(false);
  const [showStartConfirm, setShowStartConfirm] = useState(false);
  const [startingEngine, setStartingEngine] = useState(false);

  // Helper to show toast inside this component
  const showToast = (message: string, type: 'success' | 'error') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  // Load existing settings on component mount
  useEffect(() => {
    loadBackgroundResearchSettings();
  }, []);

  // Load diagnostic when enabled
  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (bgResearchEnabled) {
      loadDiagnostic();
      // Refresh diagnostic every 30 seconds when enabled
      interval = setInterval(loadDiagnostic, 30000);
    }
    return () => clearInterval(interval);
  }, [bgResearchEnabled]);

  const loadBackgroundResearchSettings = async () => {
    try {
      setLoadingSettings(true);
      const response = await settingsApi.backgroundResearch.getSettings();
      const data = response.data;
      const enabled = data.backgroundResearchEnabled || false;
      setBgResearchEnabled(enabled);
      setTelegramBotToken(data.telegramBotToken || '');
      setTelegramChatId(data.telegramChatId || '');
      setResearchFrequency(data.researchFrequencyMinutes || 5);

      if (typeof data.accuracyTrigger === 'number') {
        setAccuracyTrigger({ min: data.accuracyTrigger, max: 100 });
      } else if (data.accuracyTrigger && typeof data.accuracyTrigger === 'object') {
        setAccuracyTrigger(data.accuracyTrigger);
      } else {
        setAccuracyTrigger({ min: 75, max: 100 });
      }

      if (enabled && data.telegramBotToken && data.telegramChatId) {
        setIsManageMode(true);
      }
    } catch (error: any) {
      if (error.response?.status === 401) {
        handleLogout();
        return;
      }
    } finally {
      setLoadingSettings(false);
    }
  };

  const testTelegramConnection = async () => {
    if (!telegramBotToken.trim() || !telegramChatId.trim()) {
      showToast('Please fill in both Bot Token and Chat ID', 'error');
      return;
    }

    const botTokenRegex = /^\d+:[A-Za-z0-9_-]+$/;
    if (!botTokenRegex.test(telegramBotToken.trim())) {
      showToast('Invalid bot token format.', 'error');
      return;
    }

    const chatIdRegex = /^(@[A-Za-z0-9_]+|-\d+|\d+)$/;
    if (!chatIdRegex.test(telegramChatId.trim())) {
      showToast('Invalid chat ID format.', 'error');
      return;
    }

    setTestingTelegram(true);
    try {
      const response = await settingsApi.backgroundResearch.test({ botToken: telegramBotToken, chatId: telegramChatId });
      if (response.data.success && !response.data.warning) {
        showToast(response.data.message || 'Telegram integration working.', 'success');
      } else if (response.data.warning) {
        showToast(response.data.message || 'Test completed with warning.', 'error');
      } else {
        showToast(response.data.message || 'Telegram test completed', response.data.success ? 'success' : 'error');
      }
    } catch (error: any) {
      if (error.response?.status === 401) {
        handleLogout();
        return;
      }
      showToast(error.response?.data?.error || 'Telegram test failed', 'error');
    } finally {
      setTestingTelegram(false);
    }
  };

  const saveBackgroundResearchSettings = async (existingResearchResponse?: any) => {
    console.log('[WIZARD][FINAL] saveBackgroundResearchSettings called', { hasExistingResponse: !!existingResearchResponse });
    console.log('[WIZARD][FINAL] Function state check:', { 
      user: user?.uid, 
      savingSettings, 
      telegramBotToken: !!telegramBotToken,
      telegramChatId: !!telegramChatId
    });
    
    if (!user?.uid) {
      console.error('[WIZARD][FINAL] No user UID - authentication required');
      showToast('Authentication required', 'error');
      return;
    }

    console.log('[WIZARD][FINAL] Starting activation sequence for user:', user.uid);
    const testSymbol = 'BTCUSDT';
    
    try {
      // CRITICAL: Sequence must be:
      // a) Trigger deep research API first (or use existing response if provided)
      // b) Await success/completion
      // c) ONLY THEN enable background research
      // d) Save settings
      
      let researchResponse = existingResearchResponse;
      
      if (!researchResponse) {
        // Only call API if not already called inline
        showToast('Starting deep research activation test...', 'success');
        
        // Step 1: Trigger deep research using the SAME API as manual research
        // This ensures Telegram alert is sent unconditionally (source='manual' rule)
        console.log('[WIZARD][FINAL] CALLING researchApi.run (not using existing response)');
        console.log('[WIZARD][FINAL] API call parameters:', {
          mode: 'manual',
          source: 'manual',
          symbols: [testSymbol],
          uid: user.uid,
          timeframe: ['5M', '15M']
        });
        
        researchResponse = await researchApi.run({
          mode: 'manual',
          source: 'manual',
          symbols: [testSymbol], // Default symbol for activation test
          uid: user.uid,
          timeframe: ['5M', '15M']
        });
        
        console.log('[WIZARD][FINAL] Research API response received:', researchResponse);
      } else {
        console.log('[WIZARD][FINAL] Using existing research response from inline call');
        showToast('Research started! Waiting for completion...', 'success');
      }
      
      // Check if research was accepted
      if (researchResponse?.data?.error || researchResponse?.data?.blocked) {
        console.error('[WIZARD][FINAL] Research API rejected:', researchResponse.data);
        throw new Error(researchResponse.data?.message || researchResponse.data?.error || 'Failed to start deep research');
      }
      
      console.log('[WIZARD][FINAL] ✅ Research API call succeeded - research started');

      // Step 2: Wait for research to actually complete before enabling background research
      showToast('Waiting for research to complete...', 'success');
      
      const POLL_INTERVAL = 3000; // 3 seconds
      const MAX_ATTEMPTS = 20; // 60 seconds max
      let researchCompleted = false;

      for (let attempts = 0; attempts < MAX_ATTEMPTS; attempts++) {
        try {
          const pollResponse = await researchApi.deepResearch.getCoin(testSymbol);
          const data = pollResponse.data;

          // Check if research is complete (isFinal === true)
          const isFinal = !!(data.isFinal || data.data?.isFinal || data.result?.isFinal);
          
          if (isFinal) {
            researchCompleted = true;
            break; // Research completed successfully
          }

          // Wait before next poll
          await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL));
        } catch (pollErr: any) {
          // Handle blocked state
          if (pollErr?.response?.status === 403 || pollErr?.response?.data?.blocked === true) {
            throw new Error(pollErr?.response?.data?.message || 'Research blocked - API keys required');
          }
          // Continue polling on other errors
          await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL));
        }
      }

      // CRITICAL: Only enable background research if research completed successfully
      if (!researchCompleted) {
        throw new Error('Research timed out - please try again');
      }

      // Step 3: Research completed successfully - Telegram alert was sent (source='manual' rule)
      // Now enable background alerts only after research completion
      showToast('Research completed! Enabling background alerts...', 'success');
      
      const settingsData: any = {
        backgroundResearchEnabled: true,
        telegramBackgroundResearchEnabled: true,
        telegramBotToken: telegramBotToken,
        telegramChatId: telegramChatId,
        researchFrequencyMinutes: researchFrequency,
        accuracyTrigger: accuracyTrigger,
      };

      // Step 4: Save settings and enable background research
      const response = await settingsApi.backgroundResearch.saveSettings(settingsData);

      // Check if user can start Deep Research
      const canStart = response.data?.canStartDeepResearch === true;
      setCanStartDeepResearch(canStart);

      if (response.data?.diagnostic) {
        setDiagnostic(response.data.diagnostic);
        setIsManageMode(true); // Switch to Dashboard/Step 5 view on success
        showToast('Deep Research activated! Telegram test alert sent successfully.', 'success');
      } else {
        // Fallback manual update if diagnostic missing from response
        setIsManageMode(true);
        loadDiagnostic(); // Fetch fresh status
        showToast('Deep Research activated! Telegram test alert sent successfully.', 'success');
      }
    } catch (error: any) {
      console.error('[WIZARD] Activation failed:', error);
      console.error('[WIZARD] Error details:', {
        message: error?.message,
        response: error?.response?.data,
        status: error?.response?.status
      });
      
      if (error.response?.status === 401) {
        handleLogout();
        return;
      }
      const errorMessage = error?.response?.data?.message || error?.message || 'Failed to activate Deep Research';
      showToast(errorMessage, 'error');
      // CRITICAL: Do NOT enable background alerts if research failed
      // User must fix the issue and try again
    } finally {
      setSavingSettings(false);
      console.log('[WIZARD] Activation sequence completed');
    }
  };

  const loadDiagnostic = async () => {
    try {
      const response = await settingsApi.backgroundResearch.getDiagnostic();
      if (response.data?.diagnostic) {
        setDiagnostic(response.data.diagnostic);
        // Update canStartDeepResearch based on diagnostic readiness
        const readiness = response.data.diagnostic?.readiness;
        if (readiness) {
          setCanStartDeepResearch(readiness.verdict === 'READY' && response.data.diagnostic?.engineState !== 'RUNNING');
        }
      }
    } catch (error: any) {
      console.error('Failed to load diagnostic:', error);
    }
  };

  const startDeepResearch = async () => {
    if (!user?.uid) {
      showToast('Authentication required', 'error');
      return;
    }

    setStartingEngine(true);
    const testSymbol = 'BTCUSDT';
    
    try {
      // CRITICAL: Trigger deep research using the SAME API as manual research
      // This ensures Telegram alert is sent unconditionally (source='manual' rule)
      showToast('Starting deep research activation test...', 'success');
      
      // Fire-and-forget trigger with source='manual' for unconditional Telegram alert
      // This will send a Telegram alert when research completes (activation test)
      const researchResponse = await researchApi.run({
        mode: 'manual',
        source: 'manual',
        symbols: [testSymbol], // Default symbol for activation test
        uid: user.uid,
        timeframe: ['5M', '15M']
      });

      // Check if research was accepted
      if (researchResponse.data?.error || researchResponse.data?.blocked) {
        throw new Error(researchResponse.data?.message || researchResponse.data?.error || 'Failed to start deep research');
      }

      // CRITICAL: Wait for research to actually complete before enabling background research
      // Poll for research completion (similar to ResearchPanel)
      showToast('Waiting for research to complete...', 'success');
      
      const POLL_INTERVAL = 3000; // 3 seconds
      const MAX_ATTEMPTS = 20; // 60 seconds max
      let researchCompleted = false;
      let finalResult: any = null;

      for (let attempts = 0; attempts < MAX_ATTEMPTS; attempts++) {
        try {
          const pollResponse = await researchApi.deepResearch.getCoin(testSymbol);
          const data = pollResponse.data;

          // Check if research is complete (isFinal === true)
          const isFinal = !!(data.isFinal || data.data?.isFinal || data.result?.isFinal);
          
          if (isFinal) {
            researchCompleted = true;
            finalResult = data;
            break; // Research completed successfully
          }

          // Wait before next poll
          await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL));
        } catch (pollErr: any) {
          // Handle blocked state
          if (pollErr?.response?.status === 403 || pollErr?.response?.data?.blocked === true) {
            throw new Error(pollErr?.response?.data?.message || 'Research blocked - API keys required');
          }
          // Continue polling on other errors
          await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL));
        }
      }

      // CRITICAL: Only enable background research if research completed successfully
      if (!researchCompleted) {
        throw new Error('Research timed out - please try again');
      }

      // Research completed successfully - Telegram alert was sent (source='manual' rule)
      // Now enable background alerts only after research completion
      showToast('Research completed! Enabling background alerts...', 'success');
      
      const enableResponse = await settingsApi.backgroundResearch.saveSettings({
        backgroundResearchEnabled: true,
        telegramBackgroundResearchEnabled: true,
        telegramBotToken: telegramBotToken,
        telegramChatId: telegramChatId,
        researchFrequencyMinutes: researchFrequency,
        accuracyTrigger: accuracyTrigger
      });

      if (enableResponse.data?.success !== false) {
        showToast('Deep Research activated! Telegram test alert sent successfully.', 'success');
        setCanStartDeepResearch(false); // Disable button after start
        setIsManageMode(true); // Switch to dashboard view
        // Reload diagnostic to get updated state
        await loadDiagnostic();
      } else {
        showToast(enableResponse.data?.message || 'Failed to enable background alerts', 'error');
      }
    } catch (error: any) {
      if (error.response?.status === 401) {
        handleLogout();
        return;
      }
      const errorMessage = error?.response?.data?.message || error?.message || 'Failed to start Deep Research';
      showToast(errorMessage, 'error');
      // CRITICAL: Do NOT enable background alerts if research failed
      // User must fix the issue and try again
    } finally {
      setStartingEngine(false);
      setShowStartConfirm(false);
    }
  };

  // --- Step Navigation Helpers ---
  const handleEnable = () => {
    setBgResearchEnabled(true);
    setIsManageMode(false);
    setCurrentStep(0);
  };

  const handleDisable = async () => {
    // Revert
    setBgResearchEnabled(false);
    setIsManageMode(false);
    setCurrentStep(0);
    setShowDisableConfirm(false);

    // Save disable state to backend immediately
    try {
      await settingsApi.backgroundResearch.saveSettings({
        backgroundResearchEnabled: false,
      });
      showToast('Background Research disabled.', 'success');
    } catch (e) {
      console.error(e);
    }
  };

  const nextStep = () => setCurrentStep(prev => Math.min(prev + 1, 3));
  const prevStep = () => setCurrentStep(prev => Math.max(prev - 1, 0));

  const canProceedStep1 = telegramBotToken.trim().length > 0 && telegramChatId.trim().length > 0;

  if (loadingSettings) {
    return <div className="flex justify-center py-20"><LoadingState message="Initializing research engine..." /></div>;
  }

  // --- Render Functions ---

  // 0. Intro Card (Not Enabled) - PREMIUM REDESIGN
  if (!bgResearchEnabled) {
    return (
      <div className="relative overflow-hidden bg-gradient-to-br from-[#0f1420] to-[#0a0d14] rounded-2xl border border-white/5 shadow-2xl group">
        {/* Background Decorative Effects */}
        <div className="absolute top-0 right-0 w-96 h-96 bg-purple-600/10 rounded-full blur-[100px] -translate-y-1/2 translate-x-1/2" />
        <div className="absolute bottom-0 left-0 w-64 h-64 bg-blue-600/10 rounded-full blur-[80px] translate-y-1/2 -translate-x-1/4" />

        <div className="relative z-10 flex flex-col items-center justify-center p-8 md:p-12 text-center">
          <div className="w-20 h-20 md:w-24 md:h-24 bg-gradient-to-br from-purple-500/20 to-blue-500/10 rounded-3xl flex items-center justify-center mb-6 md:mb-8 border border-white/10 shadow-lg backdrop-blur-sm group-hover:scale-110 transition-transform duration-500 ease-out">
            <BeakerIcon className="w-10 h-10 md:w-12 md:h-12 text-purple-400 drop-shadow-lg" />
          </div>

          <h3 className="text-2xl md:text-3xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-white to-gray-400 mb-3 md:mb-4 tracking-tight">
            Background Research Engine
          </h3>

          <p className="text-gray-400 max-w-lg mb-8 md:mb-10 text-base md:text-lg leading-relaxed">
            Activate autonomous market surveillance. Our AI relentlessly scans for opportunities, filtering by high-precision confidence scores, and alerts you instantly via Telegram.
          </p>

          <button
            onClick={handleEnable}
            className="group relative px-8 py-3.5 md:px-10 md:py-4 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 rounded-xl text-white font-bold shadow-xl shadow-indigo-900/30 transition-all hover:translate-y-[-2px] overflow-hidden w-full md:w-auto justify-center flex items-center gap-3"
          >
            <div className="absolute inset-0 bg-white/20 translate-y-full group-hover:translate-y-0 transition-transform duration-300" />
            <div className="flex items-center gap-3 relative z-10">
              <BoltIcon className="w-5 h-5" />
              <span>Initialize System</span>
            </div>
          </button>
        </div>
      </div>
    );
  }

  // 5. Dashboard / Manage Mode (Post-Setup) - PROFESSIONAL MONITOR
  if (isManageMode) {
    // Determine engine state: use engineState from diagnostic
    const engineState = diagnostic?.engineState;
    const readiness = diagnostic?.readiness;
    // Use engineState directly, fallback to inferring from readiness if not available
    const isRunning = 
      engineState === 'RUNNING' ||
      (engineState !== 'STOPPED' && 
       readiness?.verdict === 'READY' &&
       readiness?.cryptocompare?.status === 'PASS' &&
       readiness?.coingecko?.status === 'PASS' &&
       readiness?.telegramSetup === 'Connected' &&
       (diagnostic?.nextRunAt || diagnostic?.userScheduled));
    const isAutoTrade = diagnostic?.mode === 'AUTO_TRADE_RESEARCH';
    const hasNextRun = !!diagnostic?.nextRunAt;
    const lastRun = diagnostic?.lastResult?.timestamp ? new Date(diagnostic.lastResult.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : null;

    return (
      <div className="bg-[#0b0e14] border border-white/10 rounded-2xl overflow-hidden shadow-2xl relative">

        {/* Disable Confirmation Modal Overlay */}
        {showDisableConfirm && (
          <div className="absolute inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-6 animate-in fade-in duration-200">
            <div className="bg-[#121b2e] border border-white/10 rounded-2xl p-6 md:p-8 max-w-sm w-full shadow-2xl scale-100 ring-1 ring-white/10">
              <div className="w-14 h-14 md:w-16 md:h-16 bg-red-500/10 rounded-full flex items-center justify-center mb-5 md:mb-6 mx-auto ring-1 ring-red-500/30">
                <PowerIcon className="w-7 h-7 md:w-8 md:h-8 text-red-500" />
              </div>
              <h3 className="text-lg md:text-xl font-bold text-white text-center mb-3">Terminate Research?</h3>
              <p className="text-gray-400 text-center text-sm mb-6 md:mb-8 leading-relaxed">
                Terminating the engine will stop all continuous market analysis and silence Telegram alerts. Are you sure?
              </p>
              <div className="flex flex-col sm:flex-row gap-3">
                <button
                  onClick={() => setShowDisableConfirm(false)}
                  className="flex-1 px-5 py-3 bg-white/5 hover:bg-white/10 rounded-xl text-gray-300 text-sm font-medium transition-colors order-2 sm:order-1"
                >
                  Cancel
                </button>
                <button
                  onClick={handleDisable}
                  className="flex-1 px-5 py-3 bg-red-600 hover:bg-red-500 text-white rounded-xl text-sm font-bold shadow-lg shadow-red-900/20 transition-colors order-1 sm:order-2"
                >
                  Stop Engine
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Diagnostics Popup Modal */}
        {showDiagnostics && (
          <div className="absolute inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-6 animate-in fade-in duration-200">
            <div className="bg-[#121b2e] border border-white/10 rounded-2xl p-6 md:p-8 max-w-md w-full shadow-2xl scale-100 relative ring-1 ring-white/5 max-h-[90vh] overflow-y-auto">
              <button
                onClick={() => setShowDiagnostics(false)}
                className="absolute top-4 right-4 p-2 rounded-full text-gray-500 hover:text-white transition-colors"
              >
                <XMarkIcon className="w-6 h-6" />
              </button>

              <div className="flex items-center gap-3 mb-6">
                <div className="w-12 h-12 bg-blue-500/10 rounded-xl flex items-center justify-center border border-blue-500/20">
                  <CpuChipIcon className="w-6 h-6 text-blue-400" />
                </div>
                <div>
                  <h3 className="text-xl font-bold text-white">System Diagnostics</h3>
                  <p className="text-sm text-gray-400">Deep Research Engine Validation</p>
                </div>
              </div>

              <div className="space-y-4">
                {/* Engine Status */}
                <div className="flex items-center justify-between p-3.5 bg-black/20 rounded-xl border border-white/5">
                  <div className="flex items-center gap-3">
                    {(() => {
                      // Determine engine state: RUNNING if:
                      // - engineState === 'RUNNING' OR
                      // - (readiness === READY AND providers PASS AND telegram CONNECTED AND scheduler active)
                      const engineState = diagnostic?.engineState;
                      const readiness = diagnostic?.readiness;
                      const isRunning = 
                        engineState === 'RUNNING' ||
                        (readiness?.verdict === 'READY' &&
                         readiness?.cryptocompare?.status === 'PASS' &&
                         readiness?.coingecko?.status === 'PASS' &&
                         readiness?.telegramSetup === 'Connected' &&
                         (diagnostic?.nextRunAt || diagnostic?.userScheduled));
                      return (
                        <>
                          <div className={`w-2.5 h-2.5 rounded-full shadow-lg shadow-current ${isRunning ? 'bg-emerald-500' : 'bg-red-500'}`} />
                          <span className="text-sm font-medium text-gray-300">Analysis Engine</span>
                        </>
                      );
                    })()}
                  </div>
                  {(() => {
                    const engineState = diagnostic?.engineState;
                    const readiness = diagnostic?.readiness;
                    const isRunning = 
                      engineState === 'RUNNING' ||
                      (readiness?.verdict === 'READY' &&
                       readiness?.cryptocompare?.status === 'PASS' &&
                       readiness?.coingecko?.status === 'PASS' &&
                       readiness?.telegramSetup === 'Connected' &&
                       (diagnostic?.nextRunAt || diagnostic?.userScheduled));
                    return (
                      <span className={`text-[10px] font-bold px-2 py-1 rounded bg-white/5 tracking-wider ${isRunning ? 'text-emerald-400' : 'text-red-400'}`}>
                        {isRunning ? 'RUNNING' : 'STOPPED'}
                      </span>
                    );
                  })()}
                </div>

                {/* Telegram */}
                <div className="flex items-center justify-between p-3.5 bg-black/20 rounded-xl border border-white/5">
                  <div className="flex items-center gap-3">
                    <div className={`w-2.5 h-2.5 rounded-full shadow-lg shadow-current ${diagnostic?.readiness?.telegramSetup === 'Connected' ? 'bg-emerald-500' : diagnostic?.readiness?.telegramSetup === 'TestFailed' ? 'bg-amber-500' : 'bg-red-500'}`} />
                    <span className="text-sm font-medium text-gray-300">Telegram Setup</span>
                  </div>
                  <span className={`text-[10px] font-bold px-2 py-1 rounded bg-white/5 tracking-wider ${diagnostic?.readiness?.telegramSetup === 'Connected' ? 'text-emerald-400' : diagnostic?.readiness?.telegramSetup === 'TestFailed' ? 'text-amber-400' : 'text-red-400'}`}>
                    {diagnostic?.readiness?.telegramSetup || (telegramBotToken && telegramChatId ? 'CONNECTED' : 'MISSING')}
                  </span>
                </div>

                {/* CryptoCompare */}
                <div className="flex items-center justify-between p-3.5 bg-black/20 rounded-xl border border-white/5">
                  <div className="flex items-center gap-3">
                    {(() => {
                      const ccStatus = typeof diagnostic?.readiness?.cryptocompare === 'object' 
                        ? diagnostic.readiness.cryptocompare.status 
                        : (diagnostic?.readiness?.cryptocompare === 'OK' ? 'PASS' : 'FAIL');
                      const ccConnected = typeof diagnostic?.readiness?.cryptocompare === 'object'
                        ? diagnostic.readiness.cryptocompare.connected
                        : (diagnostic?.readiness?.cryptocompare === 'OK');
                      const isPass = ccStatus === 'PASS' || ccConnected === true;
                      return (
                        <>
                          <div className={`w-2.5 h-2.5 rounded-full shadow-lg shadow-current ${isPass ? 'bg-emerald-500' : 'bg-red-500'}`} />
                          <span className="text-sm font-medium text-gray-300">CryptoCompare</span>
                        </>
                      );
                    })()}
                  </div>
                  {(() => {
                    const ccStatus = typeof diagnostic?.readiness?.cryptocompare === 'object' 
                      ? diagnostic.readiness.cryptocompare.status 
                      : (diagnostic?.readiness?.cryptocompare === 'OK' ? 'PASS' : 'FAIL');
                    const ccConnected = typeof diagnostic?.readiness?.cryptocompare === 'object'
                      ? diagnostic.readiness.cryptocompare.connected
                      : (diagnostic?.readiness?.cryptocompare === 'OK');
                    const isPass = ccStatus === 'PASS' || ccConnected === true;
                    return (
                      <span className={`text-[10px] font-bold px-2 py-1 rounded bg-white/5 tracking-wider ${isPass ? 'text-emerald-400' : 'text-red-400'}`}>
                        {isPass ? 'PASS' : 'FAIL'}
                      </span>
                    );
                  })()}
                </div>

                {/* CoinGecko */}
                <div className="flex items-center justify-between p-3.5 bg-black/20 rounded-xl border border-white/5">
                  <div className="flex items-center gap-3">
                    {(() => {
                      const cgStatus = typeof diagnostic?.readiness?.coingecko === 'object' 
                        ? diagnostic.readiness.coingecko.status 
                        : (diagnostic?.readiness?.coingecko === 'OK' ? 'PASS' : 'FAIL');
                      const cgConnected = typeof diagnostic?.readiness?.coingecko === 'object'
                        ? diagnostic.readiness.coingecko.connected
                        : (diagnostic?.readiness?.coingecko === 'OK');
                      const isPass = cgStatus === 'PASS' || cgConnected === true;
                      return (
                        <>
                          <div className={`w-2.5 h-2.5 rounded-full shadow-lg shadow-current ${isPass ? 'bg-emerald-500' : 'bg-red-500'}`} />
                          <span className="text-sm font-medium text-gray-300">CoinGecko</span>
                        </>
                      );
                    })()}
                  </div>
                  {(() => {
                    const cgStatus = typeof diagnostic?.readiness?.coingecko === 'object' 
                      ? diagnostic.readiness.coingecko.status 
                      : (diagnostic?.readiness?.coingecko === 'OK' ? 'PASS' : 'FAIL');
                    const cgConnected = typeof diagnostic?.readiness?.coingecko === 'object'
                      ? diagnostic.readiness.coingecko.connected
                      : (diagnostic?.readiness?.coingecko === 'OK');
                    const isPass = cgStatus === 'PASS' || cgConnected === true;
                    return (
                      <span className={`text-[10px] font-bold px-2 py-1 rounded bg-white/5 tracking-wider ${isPass ? 'text-emerald-400' : 'text-red-400'}`}>
                        {isPass ? 'PASS' : 'FAIL'}
                      </span>
                    );
                  })()}
                </div>

                {/* Engine State */}
                <div className="flex items-center justify-between p-3.5 bg-black/20 rounded-xl border border-white/5">
                  <div className="flex items-center gap-3">
                    <div className={`w-2.5 h-2.5 rounded-full shadow-lg shadow-current ${diagnostic?.engineState === 'RUNNING' ? 'bg-emerald-500' : 'bg-red-500'}`} />
                    <span className="text-sm font-medium text-gray-300">Engine</span>
                  </div>
                  <span className={`text-[10px] font-bold px-2 py-1 rounded bg-white/5 tracking-wider ${diagnostic?.engineState === 'RUNNING' ? 'text-emerald-400' : 'text-red-400'}`}>
                    {diagnostic?.engineState || 'STOPPED'}
                  </span>
                </div>

                {/* Scheduler */}
                <div className="flex items-center justify-between p-3.5 bg-black/20 rounded-xl border border-white/5">
                  <div className="flex items-center gap-3">
                    <div className={`w-2.5 h-2.5 rounded-full shadow-lg shadow-current ${diagnostic?.nextRunAt ? 'bg-emerald-500' : 'bg-amber-500'}`} />
                    <span className="text-sm font-medium text-gray-300">Scheduler</span>
                  </div>
                  <span className={`text-[10px] font-bold px-2 py-1 rounded bg-white/5 tracking-wider ${diagnostic?.nextRunAt ? 'text-emerald-400' : 'text-amber-400'}`}>
                    {diagnostic?.nextRunAt ? 'ACTIVE' : 'WAITING'}
                  </span>
                </div>
              </div>

              {/* Final Verdict */}
              <div className="mt-6 pt-6 border-t border-white/10">
                <div className="flex items-center gap-3 mb-2">
                  <span className="text-sm font-bold text-gray-400">Readiness Status:</span>
                  {diagnostic?.readiness?.verdict === 'READY' ? (
                    <span className="text-emerald-400 font-bold flex items-center gap-1.5 text-sm">
                      <CheckCircleIcon className="w-5 h-5" /> READY
                    </span>
                  ) : (
                    <span className="text-red-400 font-bold flex items-center gap-1.5 text-sm">
                      <ExclamationTriangleIcon className="w-5 h-5" /> NOT READY
                    </span>
                  )}
                </div>
                <p className="text-xs text-gray-500 leading-relaxed">
                  {diagnostic?.readiness?.verdict === 'READY'
                    ? "All preconditions met. System is ready to start Deep Research."
                    : "System setup is incomplete. Please configure Telegram, CryptoCompare, and CoinGecko."}
                </p>
              </div>

            </div>
          </div>
        )}

        {/* Status Header */}
        <div className="px-5 py-5 md:px-8 md:py-6 border-b border-white/5 bg-[#12161f]">
          <div className="flex flex-col md:flex-row md:justify-between md:items-center gap-4 md:gap-0">

            {/* Left: Status Indicator */}
            <div className="flex items-center gap-4 md:gap-6">
              <div className="relative shrink-0">
                <div className={`w-12 h-12 md:w-14 md:h-14 rounded-2xl flex items-center justify-center border shadow-inner ${isRunning ? 'bg-emerald-500/10 border-emerald-500/20 shadow-emerald-900/10' : 'bg-red-500/10 border-red-500/20 shadow-red-900/10'}`}>
                  <SignalIcon className={`w-6 h-6 md:w-7 md:h-7 ${isRunning ? 'text-emerald-400' : 'text-red-400'}`} />
                </div>
                {isRunning && <div className="absolute -top-1 -right-1 w-3 h-3 md:w-3.5 md:h-3.5 bg-emerald-500 rounded-full border-4 border-[#12161f] animate-pulse"></div>}
              </div>

              <div>
                <div className="flex items-center gap-2 md:gap-3 mb-1">
                  <h3 className="text-lg md:text-xl font-bold text-white tracking-tight">System Status</h3>
                  <span className={`px-2 py-0.5 md:px-2.5 rounded-md text-[10px] md:text-[11px] font-bold uppercase tracking-wider border ${isRunning ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-red-500/10 text-red-400 border-red-500/20'}`}>
                    {isRunning ? 'RUNNING' : 'STOPPED'}
                  </span>
                </div>
                <div className="text-[10px] md:text-xs text-gray-400 flex items-center gap-2 font-mono">
                  {isAutoTrade ? (
                    <span className="text-blue-400 flex items-center gap-1"><CpuChipIcon className="w-3 h-3" /> Auto-Trade Managed</span>
                  ) : (
                    <span className="opacity-70 truncate max-w-[200px] md:max-w-none block">
                      {hasNextRun && diagnostic.nextRunAt
                        ? `NEXT: ${new Date(diagnostic.nextRunAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
                        : 'WAITING FOR INITIALIZATION...'}
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Right: Actions */}
            <div className="flex items-center gap-2 bg-black/20 p-1 rounded-lg border border-white/5 w-full md:w-auto justify-between md:justify-start">
              {/* Spacer text for mobile clarity */}
              <span className="text-xs text-gray-500 font-bold uppercase tracking-wider px-3 md:hidden">Actions</span>

              <div className="flex items-center gap-1">
                <button
                  onClick={() => setIsManageMode(false)}
                  className="p-2.5 text-gray-400 hover:text-white hover:bg-white/10 rounded-md transition-all group relative border border-transparent hover:border-white/10"
                  title="Configure Settings"
                >
                  <ArrowPathIcon className="w-5 h-5 group-hover:rotate-180 transition-transform duration-700 ease-out" />
                </button>

                <button
                  onClick={() => setShowDiagnostics(true)}
                  className="p-3 text-blue-400 hover:text-blue-300 hover:bg-blue-500/10 rounded-md transition-all border border-transparent hover:border-blue-500/20"
                  title="Run Diagnostics"
                >
                  <CpuChipIcon className="w-5 h-5" />
                </button>

                <div className="w-px h-6 bg-white/10 mx-1" />
                <button
                  onClick={() => setShowDisableConfirm(true)}
                  className="p-2.5 text-red-400 hover:text-white hover:bg-red-600 rounded-md transition-all"
                  title="Stop Engine"
                >
                  <PowerIcon className="w-5 h-5" />
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Start Deep Research Button (when preconditions met) */}
        {canStartDeepResearch && diagnostic?.engineState !== 'RUNNING' && (
          <div className="mx-5 md:mx-8 mt-5 md:mt-6 p-5 bg-gradient-to-r from-purple-500/10 to-blue-500/10 border border-purple-500/20 rounded-xl">
            <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
              <div>
                <h4 className="text-lg font-bold text-white mb-1">Ready to Start Deep Research</h4>
                <p className="text-sm text-gray-400">All preconditions are met. Start the engine to begin automated research runs.</p>
              </div>
              <button
                onClick={() => setShowStartConfirm(true)}
                disabled={startingEngine}
                className="px-6 py-3 bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700 text-white font-bold rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 shadow-lg shadow-purple-900/50"
              >
                {startingEngine ? (
                  <>
                    <ArrowPathIcon className="w-5 h-5 animate-spin" />
                    Starting...
                  </>
                ) : (
                  <>
                    <BoltIcon className="w-5 h-5" />
                    Start Deep Research
                  </>
                )}
              </button>
            </div>
          </div>
        )}

        {/* Start Confirmation Dialog */}
        {showStartConfirm && (
          <div className="absolute inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-6 animate-in fade-in duration-200">
            <div className="bg-[#121b2e] border border-white/10 rounded-2xl p-6 md:p-8 max-w-md w-full shadow-2xl">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-12 h-12 bg-purple-500/10 rounded-xl flex items-center justify-center border border-purple-500/20">
                  <BoltIcon className="w-6 h-6 text-purple-400" />
                </div>
                <div>
                  <h3 className="text-xl font-bold text-white">Start Deep Research</h3>
                  <p className="text-sm text-gray-400">Confirm engine start</p>
                </div>
              </div>

              <p className="text-sm text-gray-300 mb-6 leading-relaxed">
                Start background deep research now? This will schedule recurring research runs and send Telegram alerts when triggered. Proceed?
              </p>

              <div className="flex gap-3">
                <button
                  onClick={() => setShowStartConfirm(false)}
                  disabled={startingEngine}
                  className="flex-1 px-4 py-2.5 bg-white/5 hover:bg-white/10 text-gray-300 rounded-lg transition-all disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  onClick={startDeepResearch}
                  disabled={startingEngine}
                  className="flex-1 px-4 py-2.5 bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700 text-white font-bold rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {startingEngine ? (
                    <>
                      <ArrowPathIcon className="w-5 h-5 animate-spin" />
                      Starting...
                    </>
                  ) : (
                    'Confirm & Start'
                  )}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Diagnostic Compact Grid */}
        <div className="p-5 md:p-8 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 md:gap-5 bg-[#0b0e14]">
          {/* Card 1: Telegram Status */}
          <div className="group bg-[#151a25] hover:bg-[#1a202e] border border-white/5 hover:border-white/10 p-4 md:p-5 rounded-2xl flex flex-col justify-between transition-all duration-300">
            <div className="flex justify-between items-start mb-3 md:mb-4">
              <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Alert Channel</span>
              <ChatBubbleLeftRightIcon className="w-5 h-5 text-blue-500/50 group-hover:text-blue-400 transition-colors" />
            </div>
            <div className="flex items-center gap-2.5">
              <div className={`w-2 h-2 rounded-full ring-2 ring-opacity-20 ${telegramBotToken ? 'bg-blue-500 ring-blue-500' : 'bg-red-500 ring-red-500'}`} />
              <span className="text-sm font-semibold text-gray-200">{telegramBotToken ? 'Connected' : 'Offline'}</span>
            </div>
          </div>

          {/* Card 2: Frequency */}
          <div className="group bg-[#151a25] hover:bg-[#1a202e] border border-white/5 hover:border-white/10 p-4 md:p-5 rounded-2xl flex flex-col justify-between transition-all duration-300">
            <div className="flex justify-between items-start mb-3 md:mb-4">
              <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Scan Interval</span>
              <ClockIcon className="w-5 h-5 text-purple-500/50 group-hover:text-purple-400 transition-colors" />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-2xl font-bold text-white tracking-tight">{researchFrequency}</span>
              <span className="text-xs font-medium text-gray-500 uppercase mt-2">Minutes</span>
            </div>
          </div>

          {/* Card 3: Accuracy */}
          <div className="group bg-[#151a25] hover:bg-[#1a202e] border border-white/5 hover:border-white/10 p-4 md:p-5 rounded-2xl flex flex-col justify-between transition-all duration-300">
            <div className="flex justify-between items-start mb-3 md:mb-4">
              <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Precision Threshold</span>
              <ShieldCheckIcon className="w-5 h-5 text-emerald-500/50 group-hover:text-emerald-400 transition-colors" />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-2xl font-bold text-white tracking-tight">{accuracyTrigger.min}%</span>
              <span className="text-xs font-medium text-gray-500 uppercase mt-2">Confidence</span>
            </div>
          </div>

          {/* Card 4 (Pulse) REMOVED as per request */}
        </div>



        {/* Issues List (Only if critical) */}
        {diagnostic?.blockers?.length > 0 && !isAutoTrade && (
          <div className="mx-5 mb-5 md:mx-8 md:mb-8 p-4 bg-red-500/5 border border-red-500/10 rounded-xl flex items-start gap-4">
            <ExclamationTriangleIcon className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
            <div>
              <span className="block text-xs font-bold text-red-400 uppercase tracking-wider mb-1">Configuration Issues Detected</span>
              <div className="text-sm text-red-200/80 leading-relaxed">
                {diagnostic.blockers.join(', ')}
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // --- Wizard Render Logic (Steps 0-4) ---
  const steps = [
    { title: 'Telegram', icon: ChatBubbleLeftRightIcon },
    { title: 'Frequency', icon: ClockIcon },
    { title: 'Accuracy', icon: ShieldCheckIcon },
    { title: 'Review', icon: CheckCircleIcon }
  ];

  return (
    <div className="w-full">
      <div className="bg-[#0b0e14] border border-white/10 rounded-2xl shadow-xl overflow-hidden min-h-[500px] md:min-h-[550px] flex flex-col relative">

        {/* Wizard Header / Steps */}
        <div className="bg-[#12161f] border-b border-white/5 p-4 md:p-8">
          <div className="flex justify-between items-center max-w-3xl mx-auto relative px-2 md:px-4">
            {/* Background Line */}
            <div className="absolute top-1/2 left-0 w-full h-0.5 bg-white/5 -z-10 -translate-y-1/2 rounded-full hidden md:block" />

            {steps.map((s, idx) => {
              const isActive = currentStep === idx;
              const isCompleted = currentStep > idx;
              const Icon = s.icon;

              return (
                <div key={idx} className="flex flex-col items-center relative z-10 bg-[#12161f] px-1 md:px-2">
                  <div className={`w-10 h-10 md:w-12 md:h-12 rounded-2xl flex items-center justify-center transition-all duration-500 border-2 ${isActive ? 'bg-purple-600 border-purple-600 text-white shadow-lg shadow-purple-900/50 scale-105 md:scale-110' :
                    isCompleted ? 'bg-[#0b0e14] border-green-500/50 text-green-500' : 'bg-[#0b0e14] border-white/5 text-gray-600'
                    }`}>
                    {isCompleted ? <CheckIcon className="w-5 h-5 md:w-6 md:h-6" /> : <Icon className="w-4 h-4 md:w-5 md:h-5" />}
                  </div>
                  <span className={`text-[8px] md:text-[10px] uppercase tracking-wider mt-2 md:mt-3 font-bold transition-colors ${isActive ? 'text-white' : 'text-gray-600'}`}>{s.title}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Wizard Content Body */}
        <div className="p-5 md:p-10 flex-1 flex flex-col max-w-3xl mx-auto w-full">

          {/* Step 1: Telegram */}
          {currentStep === 0 && (
            <div className="animate-in fade-in slide-in-from-right-8 duration-500 flex-1 flex flex-col w-full">
              <div className="mb-6 md:mb-8 text-center">
                <h3 className="text-xl md:text-2xl font-bold text-white mb-2">Connect Telegram</h3>
                <p className="text-gray-400 text-sm md:text-base">Link your bot to receive instant trade alerts.</p>
              </div>

              <div className="space-y-4 md:space-y-6 max-w-xl mx-auto w-full">
                <div className="space-y-2">
                  <label className="text-xs font-bold text-gray-500 uppercase tracking-wider ml-1">Bot Token</label>
                  <input
                    type="password"
                    value={telegramBotToken}
                    onChange={(e) => setTelegramBotToken(e.target.value)}
                    className="w-full bg-[#0a0d14] hover:bg-[#0f1218] focus:bg-[#0f1420] appearance-none border border-white/10 rounded-xl px-4 py-3.5 md:py-4 text-white focus:border-purple-500 focus:ring-2 focus:ring-purple-400 outline-none transition-all placeholder-gray-600 font-mono text-xs md:text-sm shadow-inner"
                    placeholder="123456:ABC-DEF..."
                    style={{ colorScheme: 'dark' }}
                  />
                  <div className="flex justify-end">
                    <a href="https://t.me/BotFather" target="_blank" rel="noreferrer" className="text-xs text-purple-400 hover:text-purple-300 hover:underline">Get token from @BotFather</a>
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-bold text-gray-500 uppercase tracking-wider ml-1">Chat ID</label>
                  <div className="flex flex-col md:flex-row gap-3">
                    <input
                      type="text"
                      value={telegramChatId}
                      onChange={(e) => setTelegramChatId(e.target.value)}
                      className="flex-1 bg-[#0a0d14] hover:bg-[#0f1218] focus:bg-[#0f1420] appearance-none border border-white/10 rounded-xl px-4 py-3.5 md:py-4 text-white focus:border-purple-500 focus:ring-2 focus:ring-purple-400 outline-none transition-all placeholder-gray-600 font-mono text-xs md:text-sm shadow-inner"
                      placeholder="@channel or 123456789"
                      style={{ colorScheme: 'dark' }}
                    />
                    <button
                      onClick={testTelegramConnection}
                      disabled={testingTelegram || !telegramBotToken || !telegramChatId}
                      className="px-6 py-3.5 bg-white/5 hover:bg-white/10 border border-white/10 hover:border-white/20 rounded-xl text-gray-300 text-sm font-semibold transition-all disabled:opacity-50 whitespace-nowrap min-w-[100px] md:min-w-[120px]"
                    >
                      {testingTelegram ? 'Testing...' : 'Test'}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Step 2: Frequency */}
          {currentStep === 1 && (
            <div className="animate-in fade-in slide-in-from-right-8 duration-500 flex-1 flex flex-col w-full">
              <div className="mb-6 md:mb-8 text-center">
                <h3 className="text-xl md:text-2xl font-bold text-white mb-2">Scan Frequency</h3>
                <p className="text-gray-400 text-sm md:text-base">How often should we analyze the market?</p>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
                {[1, 3, 5, 10, 15, 30, 60].map(val => (
                  <button
                    key={val}
                    onClick={() => setResearchFrequency(val)}
                    className={`group relative p-4 md:p-6 rounded-2xl border transition-all duration-300 flex flex-col items-center justify-center gap-1 md:gap-2 ${researchFrequency === val
                      ? 'border-purple-500 bg-purple-600/10 text-white shadow-lg shadow-purple-900/20'
                      : 'border-white/5 bg-[#151a25] text-gray-400 hover:border-white/10 hover:bg-[#1c2230]'
                      }`}
                  >
                    <span className={`text-xl md:text-2xl font-bold ${researchFrequency === val ? 'text-white' : 'text-gray-500 group-hover:text-gray-300'}`}>{val}</span>
                    <span className="text-[10px] uppercase tracking-widest font-bold opacity-60">Min</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Step 3: Accuracy */}
          {currentStep === 2 && (
            <div className="animate-in fade-in slide-in-from-right-8 duration-500 flex-1 flex flex-col w-full">
              <div className="mb-6 md:mb-8 text-center">
                <h3 className="text-xl md:text-2xl font-bold text-white mb-2">Accuracy Filter</h3>
                <p className="text-gray-400 text-sm md:text-base">Set minimum confidence to trigger alerts.</p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-5">
                {[
                  { min: 60, max: 100, label: 'Standard', desc: '>60% Confidence', color: 'emerald' },
                  { min: 75, max: 100, label: 'Balanced', desc: '>75% Confidence', color: 'blue' },
                  { min: 85, max: 100, label: 'Precision', desc: '>85% Confidence', color: 'purple' },
                  { min: 90, max: 100, label: 'Elite', desc: '>90% Confidence', color: 'amber' },
                ].map((opt) => {
                  const isSelected = accuracyTrigger.min === opt.min;
                  let borderColor = isSelected ? 'border-emerald-500' : 'border-white/5';
                  let bgColor = isSelected ? 'bg-emerald-500/10' : 'bg-[#151a25]';
                  let textColor = isSelected ? 'text-emerald-400' : 'text-gray-400';

                  if (isSelected) {
                    if (opt.color === 'blue') { borderColor = 'border-blue-500'; bgColor = 'bg-blue-600/10'; textColor = 'text-blue-400'; }
                    if (opt.color === 'purple') { borderColor = 'border-purple-500'; bgColor = 'bg-purple-600/10'; textColor = 'text-purple-400'; }
                    if (opt.color === 'amber') { borderColor = 'border-amber-500'; bgColor = 'bg-amber-600/10'; textColor = 'text-amber-400'; }
                  }

                  return (
                    <button
                      key={opt.min}
                      onClick={() => setAccuracyTrigger({ min: opt.min, max: opt.max })}
                      className={`p-4 md:p-6 rounded-2xl border text-left transition-all duration-300 hover:border-white/10 ${borderColor} ${bgColor}`}
                    >
                      <div className="flex justify-between items-center mb-1">
                        <span className={`text-base md:text-lg font-bold ${textColor}`}>{opt.label}</span>
                        {isSelected && <CheckCircleIcon className={`w-4 h-4 md:w-5 md:h-5 ${textColor}`} />}
                      </div>
                      <div className="text-xs md:text-sm text-gray-500">{opt.desc}</div>
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {/* Step 4: Review */}
          {currentStep === 3 && (
            <div className="animate-in fade-in slide-in-from-right-8 duration-500 flex-1 flex flex-col w-full">
              <div className="mb-6 md:mb-8 text-center">
                <h3 className="text-xl md:text-2xl font-bold text-white mb-2">Final Review</h3>
                <p className="text-gray-400 text-sm md:text-base">Confirm settings to activate the engine.</p>
              </div>

              <div className="bg-[#151a25] border border-white/5 rounded-2xl p-6 md:p-8 space-y-5 md:space-y-6">
                <div className="flex justify-between items-center pb-4 border-b border-white/5">
                  <span className="text-gray-500 text-xs md:text-sm font-medium">Telegram Bot</span>
                  <div className="flex items-center gap-2">
                    <div className={`w-2 h-2 rounded-full ${telegramBotToken ? 'bg-green-500' : 'bg-red-500'}`} />
                    <span className="text-white font-mono text-xs md:text-sm">{telegramBotToken ? 'Configured' : 'Missing'}</span>
                  </div>
                </div>
                <div className="flex justify-between items-center pb-4 border-b border-white/5">
                  <span className="text-gray-500 text-xs md:text-sm font-medium">Target Chat</span>
                  <span className="text-white font-mono text-xs md:text-sm">{telegramChatId || 'N/A'}</span>
                </div>
                <div className="flex justify-between items-center pb-4 border-b border-white/5">
                  <span className="text-gray-500 text-xs md:text-sm font-medium">Scan Frequency</span>
                  <span className="text-purple-400 font-bold text-sm md:text-base">{researchFrequency} Minutes</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-gray-500 text-xs md:text-sm font-medium">Accuracy Filter</span>
                  <span className="text-emerald-400 font-bold text-sm md:text-base">{accuracyTrigger.min}% - {accuracyTrigger.max}%</span>
                </div>
              </div>
            </div>
          )}

          {/* Navigation Buttons */}
          <div className="mt-6 md:mt-10 pt-6 border-t border-white/5 flex justify-between items-center">
            {currentStep > 0 ? (
              <button onClick={prevStep} className="px-4 md:px-6 py-3 text-gray-400 hover:text-white font-medium transition-colors text-sm md:text-base">
                Back
              </button>
            ) : <div />}

            {currentStep < 3 ? (
              <button
                onClick={nextStep}
                disabled={currentStep === 0 && !canProceedStep1}
                className="px-6 md:px-8 py-3 bg-white text-black hover:bg-gray-200 rounded-xl font-bold transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 text-sm md:text-base"
              >
                Next <ChevronRightIcon className="w-4 h-4" />
              </button>
            ) : (
              <button
                onClick={async () => {
                  console.log('[WIZARD][FINAL] BUTTON CLICKED - EXECUTING');
                  console.log('[WIZARD][FINAL] Button state:', { 
                    savingSettings, 
                    currentStep, 
                    user: user?.uid,
                    buttonDisabled: savingSettings
                  });
                  
                  // CRITICAL: Check if button is disabled (should not happen, but verify)
                  if (savingSettings) {
                    console.warn('[WIZARD][FINAL] Button clicked but savingSettings is true - button should be disabled');
                    return;
                  }
                  
                  // FORCE EXECUTION TEST: Call API directly inline FIRST to verify backend receives request
                  if (!user?.uid) {
                    console.error('[WIZARD][FINAL] No user UID - cannot proceed');
                    showToast('Authentication required', 'error');
                    return;
                  }
                  
                  console.log('[WIZARD][FINAL] CALLING researchApi.run');
                  console.log('[WIZARD][FINAL] API call will be made with:', {
                    mode: 'manual',
                    source: 'manual',
                    symbols: ['BTCUSDT'],
                    uid: user.uid,
                    timeframe: ['5M', '15M']
                  });
                  
                  // CRITICAL: Set saving state immediately to prevent double-clicks
                  setSavingSettings(true);
                  
                  try {
                    // INLINE TEST: Call API directly to verify backend receives request
                    // This bypasses saveBackgroundResearchSettings to test if API call itself works
                    console.log('[WIZARD][FINAL] Making inline API call NOW...');
                    const testResponse = await researchApi.run({
                      mode: 'manual',
                      source: 'manual',
                      symbols: ['BTCUSDT'],
                      uid: user.uid,
                      timeframe: ['5M', '15M']
                    });
                    console.log('[WIZARD][FINAL] ✅ INLINE API CALL SUCCESS - backend received request:', testResponse);
                    
                    // If inline test succeeds, proceed with full activation sequence (polling + settings save)
                    // Note: saveBackgroundResearchSettings will skip the API call since we already did it
                    console.log('[WIZARD][FINAL] Inline test passed - now calling saveBackgroundResearchSettings for polling and settings');
                    await saveBackgroundResearchSettings(testResponse);
                  } catch (inlineError: any) {
                    console.error('[WIZARD][FINAL] ❌ INLINE API CALL FAILED:', inlineError);
                    console.error('[WIZARD][FINAL] Error details:', {
                      message: inlineError?.message,
                      response: inlineError?.response?.data,
                      status: inlineError?.response?.status,
                      stack: inlineError?.stack
                    });
                    setSavingSettings(false);
                    showToast(inlineError?.response?.data?.message || inlineError?.message || 'Failed to start research', 'error');
                  }
                }}
                disabled={savingSettings}
                className="px-6 md:px-10 py-3 bg-gradient-to-r from-emerald-500 to-green-500 hover:from-emerald-400 hover:to-green-400 text-white rounded-xl font-bold shadow-lg shadow-green-900/30 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 text-sm md:text-base"
              >
                {savingSettings ? 'Activating...' : 'Activate System'}
              </button>
            )}
          </div>

        </div>
      </div>
      {toast && <Toast message={toast.message} type={toast.type} />}
    </div>
  );
};
