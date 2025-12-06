import { useState, useEffect, useCallback } from 'react';
import { useThrottle } from '../hooks/usePerformance';
import { researchApi, settingsApi, adminApi } from '../services/api';
import { wsService } from '../services/ws';
import Toast from '../components/Toast';
import Sidebar from '../components/Sidebar';
import { useError } from '../contexts/ErrorContext';
import { useNotificationContext } from '../contexts/NotificationContext';
import { getApiErrorMessage, suppressConsoleError } from '../utils/errorHandler';
import { useAuth } from '../hooks/useAuth';
import { Link } from 'react-router-dom';
import ProviderCard from '../components/ui/ProviderCard';

interface ResearchLog {
  id: string;
  symbol: string;
  timestamp: string;
  signal: 'BUY' | 'SELL' | 'HOLD';
  accuracy: number;
  orderbookImbalance: number;
  recommendedAction: string;
  microSignals: any;
  researchType?: 'manual' | 'auto';
}

// Coin Image Header Component
function CoinImageHeader({ symbol, price }) {
  return (
    <div className="flex items-center gap-4 mb-2">
      <div className="w-16 h-16 bg-slate-700 rounded-2xl flex items-center justify-center">
        <span className="text-white font-bold">{symbol.slice(0, 3)}</span>
      </div>
      <div>
        <div className="text-4xl font-bold text-white">
          ${price ? price.toLocaleString() : 'N/A'}
        </div>
        <div className="text-sm text-slate-400">{symbol}</div>
      </div>
    </div>
  );
}

// Helper function to get signal color based on indicators
function getSignalColor(indicators, price) {
  let bullishSignals = 0;
  let bearishSignals = 0;

  if (indicators.rsi?.value && indicators.rsi.value < 30) bullishSignals++; else if (indicators.rsi?.value && indicators.rsi.value > 70) bearishSignals++;
  if (indicators.ema20?.value && price && price > indicators.ema20.value) bullishSignals++; else if (indicators.ema20?.value && price && price < indicators.ema20.value) bearishSignals++;
  if (indicators.ma50?.value && price && price > indicators.ma50.value) bullishSignals++; else if (indicators.ma50?.value && price && price < indicators.ma50.value) bearishSignals++;
  if (indicators.volume?.score && indicators.volume.score > 60) bullishSignals++; else if (indicators.volume?.score && indicators.volume.score < 40) bearishSignals++;

  if (bullishSignals > bearishSignals) return 'text-green-400';
  else if (bearishSignals > bullishSignals) return 'text-red-400';
  else return 'text-yellow-400';
}

export default function ResearchPanel() {
  const { user, loading } = useAuth();
  const [logs, setLogs] = useState<ResearchLog[]>([]);
  const [pageLoading, setPageLoading] = useState(false);
  const [selectedSymbol, setSelectedSymbol] = useState('BTCUSDT');
  const [liveData, setLiveData] = useState<any>(null);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [settings, setSettings] = useState<any>(null);
  const [analysisReport, setAnalysisReport] = useState<AnalysisReportItem[]>([]);
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [deepResearchLoading, setDeepResearchLoading] = useState(false);
  const [deepResearchResults, setDeepResearchResults] = useState<any[]>([]);
  const [cooldownSeconds, setCooldownSeconds] = useState(0);
  const [researchProgress, setResearchProgress] = useState<{
    step: string;
    status: 'pending' | 'loading' | 'success' | 'error';
    error?: string;
  }[]>([]);
  const [showMoreAnalysis, setShowMoreAnalysis] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);

  // Deep Research state
  const [top10Coins, setTop10Coins] = useState<any[]>([]);
  const [selectedCoinData, setSelectedCoinData] = useState<any>(null);
  const [selectedCoinSymbol, setSelectedCoinSymbol] = useState<string | null>(null);
  const [coinResearchLoading, setCoinResearchLoading] = useState(false);
  const [top10Loading, setTop10Loading] = useState(false);
  const [autoRefreshEnabled, setAutoRefreshEnabled] = useState(false);
  const [lastRefreshTime, setLastRefreshTime] = useState<Date | null>(null);
  const [mobileSectionsOpen, setMobileSectionsOpen] = useState({
    analysis: true,
    metrics: false,
    news: false,
    images: false,
  });

  // Throttle research results to prevent excessive re-renders
  const throttledDeepResearchResults = useThrottle(deepResearchResults, 200);
  const { showError } = useError();
  const { addNotification } = useNotificationContext();

  // Countdown timer for cooldown
  useEffect(() => {
    if (cooldownSeconds > 0) {
      const timer = setTimeout(() => {
        setCooldownSeconds(cooldownSeconds - 1);
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, [cooldownSeconds]);

  const checkAdmin = async () => {
    if (!user) return;
    try {
      const [{ doc, getDoc }, { db }] = await Promise.all([
        import('firebase/firestore'),
        import('../config/firebase')
      ]);
      const userDoc = await getDoc(doc(db, 'users', user.uid));
      if (userDoc.exists()) {
        const userData: any = userDoc.data();
        setIsAdmin(userData.role === 'admin' || userData.isAdmin === true);
      }
    } catch (error) {
      console.error('Error checking admin role:', error);
    }
  };

  const loadLogs = useCallback(async () => {
    if (!user) return;
    try {
      const response = await researchApi.getLogs({ limit: 100 });
      if (response.data && Array.isArray(response.data)) {
        setLogs(response.data);
      }
    } catch (err: any) {
      suppressConsoleError(err, 'loadLogs');
    }
  }, [user]);

  // Load top 10 coins for deep research
  const loadTop10Coins = useCallback(async () => {
    if (!user?.uid) return;

    setTop10Loading(true);
    try {
      const response = await researchApi.deepResearch.getTop10();
      setTop10Coins(response.data?.coins || []);
    } catch (err: any) {
      console.error('Error loading top 10 coins:', err);
      showError('Failed to load top 10 coins', 'api');
    } finally {
      setTop10Loading(false);
    }
  }, [user?.uid, showError]);

  // Load detailed research for a specific coin
  const loadCoinResearch = useCallback(async (symbol: string) => {
    if (!user?.uid) return;

    setCoinResearchLoading(true);
    setSelectedCoinSymbol(symbol);

    try {
      const response = await researchApi.deepResearch.getCoin(symbol);
      setSelectedCoinData(response.data?.data || null);
      setLastRefreshTime(new Date());
    } catch (err: any) {
      console.error('Error loading coin research:', err);
      showError('Failed to load coin research data', 'api');
      setSelectedCoinData(null);
    } finally {
      setCoinResearchLoading(false);
    }
  }, [user?.uid, showError]);

  // Auto-refresh functionality
  useEffect(() => {
    if (!autoRefreshEnabled || !selectedCoinSymbol) return;

    const interval = setInterval(() => {
      loadCoinResearch(selectedCoinSymbol);
    }, 30000); // 30 seconds

    return () => clearInterval(interval);
  }, [autoRefreshEnabled, selectedCoinSymbol, loadCoinResearch]);

  // Load top 10 coins on component mount
  useEffect(() => {
    loadTop10Coins();
  }, [loadTop10Coins]);

  const loadSettings = useCallback(async () => {
    try {
      const response = await settingsApi.load();
      setSettings(response.data);
    } catch (err: any) {
      suppressConsoleError(err, 'loadSettings');
    }
  }, []);

  const fetchAnalysis = useCallback(async () => {
    if (!user) return;
    setAnalysisLoading(true);
    try {
      // Fetch research logs
      const logsResponse = await researchApi.getLogs({ limit: 50 });
      if (logsResponse.data && Array.isArray(logsResponse.data)) {
        // Filter only auto research (researchType === 'auto' or undefined/not 'manual')
        const autoLogs = logsResponse.data.filter((log: ResearchLog) =>
          log.researchType !== 'manual'
        );

        // Get unique symbols from logs
        const symbols = [...new Set(autoLogs.map(log => log.symbol))];

        // Fetch market data for prices
        let marketData: any[] = [];
        try {
          const marketResponse = await adminApi.getMarketData();
          marketData = marketResponse.data || [];
        } catch (marketErr) {
          console.warn('Failed to fetch market data for prices:', marketErr);
        }

        // Create price map
        const priceMap = new Map<string, number>();
        marketData.forEach((coin: any) => {
          if (coin.symbol && coin.price) {
            priceMap.set(coin.symbol, coin.price);
          }
        });

        // Process logs into analysis report with prices
        const report: AnalysisReportItem[] = autoLogs.map((log: ResearchLog) => ({
          id: log.id,
          symbol: log.symbol,
          price: priceMap.get(log.symbol) || null,
          longSignals: log.signal === 'BUY' ? 1 : 0,
          accuracy: log.accuracy,
          timestamp: log.timestamp,
        }));
        setAnalysisReport(report);
      }
    } catch (err: any) {
      suppressConsoleError(err, 'fetchAnalysis');
    } finally {
      setAnalysisLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (user) {
      checkAdmin();
      loadLogs();
      loadSettings();
      // Don't auto-fetch analysis on page load - only when user requests it
      // fetchAnalysis();
    }
  }, [user, loadLogs, loadSettings]);

  useEffect(() => {
    if (!user) return;

    // Subscribe to live research updates
    const unsubscribe = wsService.subscribe('research', (data: any) => {
      setLiveData(data.data);
      // Add to logs (only if it's auto research)
      if (data.data && data.data.researchType !== 'manual') {
        setLogs((prev) => [data.data, ...prev].slice(0, 100));
      }
    });

    // Auto-refresh analysis every 5 minutes (300000ms) - only if user is on the page
    // Removed auto-refresh to prevent performance issues - user can manually refresh

    return () => {
      unsubscribe();
    };
  }, [user]);

  const canExecute = (accuracy: number): boolean => {
    if (!settings) return false;
    return settings.autoTradeEnabled && accuracy >= (settings.minAccuracyThreshold || 0.85);
  };

  // Run deep research with 10-second processing animation
  const handleDeepResearch = async () => {
    setDeepResearchLoading(true);

    // Initialize progress steps with new messaging
    const steps = [
      { step: 'Checking latest market data…', status: 'pending' as const },
      { step: 'Fetching on-chain metrics…', status: 'pending' as const },
      { step: 'Analyzing whale activity…', status: 'pending' as const },
      { step: 'Evaluating sentiment…', status: 'pending' as const },
      { step: 'Combining indicators…', status: 'pending' as const },
      { step: 'Generating final score…', status: 'pending' as const },
    ];
    setResearchProgress(steps);

    const PROCESSING_DURATION = 10000; // 10 seconds

    // Update progress function
    const updateProgress = (index: number, status: 'loading' | 'success' | 'error', error?: string) => {
      setResearchProgress(prev => {
        const newProgress = [...prev];
        newProgress[index] = { ...newProgress[index], status, error };
        return newProgress;
      });
    };

    // Animate progress steps over 10 seconds
    const stepDelays = [1000, 2000, 3000, 4000, 5000, 6000]; // When each step starts

    try {
      // Start API call immediately (don't wait for animation)
      if (!user?.uid) return null;

      const symbol = "BTCUSDT";

      const payload = {
        uid: user.uid,
        symbols: ["BTCUSDT"],
        type: "manual"
      };

      console.log('FINAL_PAYLOAD', payload);

      const apiCallPromise = researchApi.run({
        symbols: payload.symbols,
      });

      // Animate steps
      for (let i = 0; i < steps.length; i++) {
        setTimeout(() => {
          updateProgress(i, 'loading');
        }, stepDelays[i]);
      }

      // Wait for API call and animation to complete
      const [response] = await Promise.all([
        apiCallPromise,
        new Promise(resolve => setTimeout(resolve, PROCESSING_DURATION))
      ]);

      // Update progress - simplified for clean API
      if (response.data?.results && response.data.results.length > 0) {
        // Mark all steps as successful for clean API
        for (let i = 0; i < steps.length; i++) {
          updateProgress(i, 'success');
        }

        // Add clean results to deep research results array (FREE MODE format)
        const cleanResults = response.data.results.map((result: any) => {
          // Add debugging logs for provider results
          console.log('🔍 DEEP RESEARCH RESULT:', {
            symbol: result.symbol,
            signal: result.signal,
            accuracy: result.accuracy,
            providers: result.result?.providers,
            indicators: result.result?.indicators,
            metadata: result.metadata
          });

          console.log("Frontend received research result:", result);

          return {
            ...result,
            id: `free_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            mode: 'free'
          };
        });
        setDeepResearchResults((prev) => [...cleanResults, ...prev]);

        const topResult = response.data.results[0];
        await addNotification({
          title: 'FREE MODE Deep Research Completed',
          message: `Analyzed ${response.data.totalSymbols} symbol(s). Best: ${topResult.symbol} (${(topResult.result?.accuracy * 100).toFixed(1)}% accuracy, ${topResult.result?.signal})`,
          type: 'success',
        });
      } else {
        showError('No research data received from server. Please try again.', 'api');
        updateProgress(5, 'error', 'No data received');
      }
    } catch (err: any) {
      suppressConsoleError(err, 'deepResearch');
      // Check if it's a cooldown error
      if (err.response?.status === 429 && err.response?.data?.error) {
        showError(err.response.data.message, 'warning');
        // Don't start cooldown timer for cooldown errors
        return;
      }

      const { message, type } = getApiErrorMessage(err);
      showError(message, type);

      // Mark all remaining steps as error
      setResearchProgress(prev => prev.map((p, i) =>
        p.status === 'pending' || p.status === 'loading'
          ? { ...p, status: 'error' as const, error: message }
          : p
      ));
      // Don't start cooldown on error
      return;
    } finally {
      setDeepResearchLoading(false);
    }

    // Start 30-second cooldown after successful research
    setCooldownSeconds(30);
  };

  const showToast = (message: string, type: 'success' | 'error') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  const handleLogout = async () => {
    const { signOut } = await import('firebase/auth');
    const { auth } = await import('../config/firebase');
    await signOut(auth);
    localStorage.removeItem('firebaseToken');
    localStorage.removeItem('firebaseUser');
    window.location.href = '/login';
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 relative overflow-hidden">
      {/* Enhanced animated background */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        {/* Primary gradient orbs */}
        <div className="absolute -top-40 -right-40 w-96 h-96 bg-gradient-to-br from-purple-600/15 to-violet-600/10 rounded-full blur-3xl animate-pulse"></div>
        <div className="absolute -bottom-40 -left-40 w-96 h-96 bg-gradient-to-tr from-cyan-600/15 to-blue-600/10 rounded-full blur-3xl animate-pulse" style={{ animationDelay: '2s' }}></div>
        <div className="hidden lg:block absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-80 h-80 bg-gradient-to-br from-pink-600/8 to-rose-600/8 rounded-full blur-2xl animate-pulse" style={{ animationDelay: '4s' }}></div>

        {/* Secondary accent orbs */}
        <div className="absolute top-1/4 left-1/4 w-64 h-64 bg-gradient-to-br from-indigo-600/8 to-purple-600/6 rounded-full blur-2xl"></div>
        <div className="absolute bottom-1/4 right-1/4 w-64 h-64 bg-gradient-to-br from-emerald-600/8 to-teal-600/6 rounded-full blur-2xl"></div>

        {/* Enhanced grid overlay */}
        <div className="absolute inset-0 bg-[linear-gradient(to_right,#64748b06_1px,transparent_1px),linear-gradient(to_bottom,#64748b06_1px,transparent_1px)] bg-[size:40px_40px]"></div>

        {/* Subtle radial gradient overlay */}
        <div className="absolute inset-0 bg-gradient-radial from-transparent via-slate-900/20 to-slate-950/40"></div>
      </div>

      <Sidebar onLogout={handleLogout} />

      <main className="w-full min-h-screen overflow-x-hidden relative">
        <div className="w-full max-w-full px-0 sm:px-1 md:px-2 lg:px-3 overflow-x-hidden py-6 sm:py-8 lg:py-12">
          {/* Mobile: Enhanced Header */}
          <div className="lg:hidden sticky top-16 z-40 -mx-2 px-4 py-6 bg-slate-900/95 backdrop-blur-xl border-b border-slate-700/60 mb-8 shadow-2xl shadow-slate-900/50">
            {/* Gradient accent line */}
            <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-purple-500 via-cyan-500 to-blue-500"></div>

            <div className="space-y-6 relative">
              <div className="text-center">
                <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-gradient-to-br from-purple-600/20 to-cyan-600/20 mb-4">
                  <svg className="w-6 h-6 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                  </svg>
                </div>
                <h2 className="text-2xl font-bold bg-gradient-to-r from-purple-300 via-cyan-300 to-blue-300 bg-clip-text text-transparent mb-2">
                  Research Panel
                </h2>
                <p className="text-sm text-slate-400 leading-relaxed">
                  Advanced AI-powered market analysis with real-time data
                </p>
              </div>

              <div className="flex gap-3">
                <button
                  onClick={handleDeepResearch}
                  disabled={deepResearchLoading || cooldownSeconds > 0}
                  className="flex-1 px-6 py-4 bg-gradient-to-r from-purple-600 via-violet-600 to-cyan-600 text-white font-semibold rounded-2xl hover:from-purple-500 hover:via-violet-500 hover:to-cyan-500 transition-all duration-300 shadow-xl shadow-purple-500/30 disabled:opacity-50 disabled:cursor-not-allowed transform hover:scale-[1.02] active:scale-98 relative overflow-hidden group"
                >
                  <div className="absolute inset-0 bg-gradient-to-r from-purple-400/20 to-cyan-400/20 opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
                  <div className="relative flex items-center justify-center gap-3">
                    {deepResearchLoading ? (
                      <>
                        <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></span>
                        <span className="text-sm font-medium">Analyzing...</span>
                      </>
                    ) : cooldownSeconds > 0 ? (
                      <>
                        <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></span>
                        <span className="text-sm font-medium">{cooldownSeconds}s</span>
                      </>
                    ) : (
                      <>
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                        </svg>
                        <span className="text-sm font-medium">Run Research</span>
                      </>
                    )}
                  </div>
                </button>
                <button
                  onClick={loadLogs}
                  disabled={loading}
                  className="px-4 py-4 bg-slate-800/60 backdrop-blur-sm border border-slate-600/60 text-slate-300 rounded-2xl hover:bg-slate-700/60 hover:border-slate-500/60 transition-all duration-300 disabled:opacity-50 transform hover:scale-105 active:scale-95 shadow-lg shadow-slate-900/20"
                >
                  {loading ? (
                    <span className="w-5 h-5 border-2 border-slate-400/30 border-t-slate-400 rounded-full animate-spin"></span>
                  ) : (
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                  )}
                </button>
              </div>
            </div>
          </div>

          {/* Desktop Header */}
          <section className="hidden lg:block mb-16">
            <div className="relative">
              {/* Background gradient card */}
              <div className="absolute inset-0 bg-gradient-to-r from-slate-900/40 via-slate-800/40 to-slate-900/40 backdrop-blur-xl rounded-3xl border border-slate-700/50 shadow-2xl shadow-slate-900/30"></div>

              {/* Gradient accent lines */}
              <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-purple-500 via-cyan-500 to-blue-500 rounded-t-3xl"></div>
              <div className="absolute bottom-0 left-0 right-0 h-1 bg-gradient-to-r from-blue-500 via-purple-500 to-cyan-500 rounded-b-3xl"></div>

              <div className="relative p-8 rounded-3xl">
                <div className="flex items-center justify-between">
                  <div className="space-y-4">
                    <div className="flex items-center gap-4">
                      <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-purple-600/20 to-cyan-600/20 flex items-center justify-center">
                        <svg className="w-8 h-8 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                        </svg>
                      </div>
                      <div>
                        <h1 className="text-5xl font-bold bg-gradient-to-r from-purple-300 via-cyan-300 to-blue-300 bg-clip-text text-transparent mb-2">
                          Research Panel
                        </h1>
                        <p className="text-xl text-slate-300 max-w-lg leading-relaxed">
                          Advanced AI-powered market analysis with comprehensive real-time data integration
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-6">
                    <button
                      onClick={loadLogs}
                      disabled={loading}
                      className="px-8 py-4 bg-slate-800/60 backdrop-blur-sm border border-slate-600/60 text-slate-300 rounded-2xl hover:bg-slate-700/60 hover:border-slate-500/60 transition-all duration-300 disabled:opacity-50 flex items-center gap-3 transform hover:scale-105 active:scale-95 shadow-lg shadow-slate-900/20"
                    >
                      {loading ? (
                        <>
                          <span className="w-5 h-5 border-2 border-slate-400/30 border-t-slate-400 rounded-full animate-spin"></span>
                          <span className="font-medium">Loading...</span>
                        </>
                      ) : (
                        <>
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                          </svg>
                          <span className="font-medium">Refresh Data</span>
                        </>
                      )}
                    </button>

                    <button
                      onClick={handleDeepResearch}
                      disabled={deepResearchLoading || cooldownSeconds > 0}
                      className="px-10 py-4 bg-gradient-to-r from-purple-600 via-violet-600 to-cyan-600 text-white font-semibold rounded-2xl hover:from-purple-500 hover:via-violet-500 hover:to-cyan-500 transition-all duration-300 shadow-xl shadow-purple-500/30 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-3 transform hover:scale-[1.02] active:scale-98 relative overflow-hidden group"
                    >
                      <div className="absolute inset-0 bg-gradient-to-r from-purple-400/20 to-cyan-400/20 opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
                      <div className="relative flex items-center gap-3">
                        {deepResearchLoading ? (
                          <>
                            <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></span>
                            <span className="font-medium">Analyzing Markets...</span>
                          </>
                        ) : cooldownSeconds > 0 ? (
                          <>
                            <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></span>
                            <span className="font-medium">Cooldown: {cooldownSeconds}s</span>
                          </>
                        ) : (
                          <>
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                            </svg>
                            <span className="font-medium">Run Deep Research</span>
                          </>
                        )}
                      </div>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </section>
          <div className="space-y-8">
            {/* Live Research Card */}
            {liveData && (
              <div className="relative bg-gradient-to-br from-slate-900/60 via-slate-800/60 to-slate-900/60 backdrop-blur-xl border border-cyan-500/40 rounded-3xl p-8 shadow-2xl shadow-cyan-500/20 hover:shadow-cyan-500/30 transition-all duration-500 overflow-hidden">
                {/* Gradient accent line */}
                <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-cyan-500 via-blue-500 to-purple-500 rounded-t-3xl"></div>

                <div className="flex items-center justify-between mb-6">
                  <div>
                    <h2 className="text-2xl font-bold bg-gradient-to-r from-cyan-400 to-blue-400 bg-clip-text text-transparent mb-1">
                      Live Research
                    </h2>
                    <p className="text-sm text-slate-400 flex items-center gap-2">
                      <span className="w-2 h-2 bg-cyan-400 rounded-full animate-pulse"></span>
                      Real-time market monitoring
                    </p>
                  </div>
                </div>
                <div className="bg-gradient-to-br from-cyan-500/10 via-blue-500/10 to-purple-500/10 border border-cyan-400/30 rounded-2xl p-6 mb-4 backdrop-blur-sm">
                  <div className="flex items-center justify-between mb-4">
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 flex-1">
                      <div>
                        <div className="text-sm text-slate-400">Symbol</div>
                        <div className="font-semibold text-white text-lg">{liveData.symbol}</div>
                      </div>
                      <div>
                        <div className="text-sm text-slate-400">Signal</div>
                        <div className={`font-semibold text-lg ${liveData.signal === 'BUY' ? 'text-green-400' :
                          liveData.signal === 'SELL' ? 'text-red-400' :
                            'text-slate-400'
                          }`}>
                          {liveData.signal}
                        </div>
                      </div>
                      <div>
                        <div className="text-sm text-slate-400">Accuracy</div>
                        <div className={`font-semibold text-lg ${liveData.accuracy >= 0.85 ? 'text-green-400' :
                          liveData.accuracy >= 0.7 ? 'text-yellow-400' :
                            'text-red-400'
                          }`}>
                          {((liveData.accuracy ?? 0) * 100).toFixed(1)}%
                        </div>
                      </div>
                      <div>
                        <div className="text-sm text-slate-400">Imbalance</div>
                        <div className="font-semibold text-white text-lg">
                          {((liveData.orderbookImbalance ?? 0) * 100).toFixed(2)}%
                        </div>
                      </div>
                    </div>
                    <div className="ml-4">
                      {canExecute(liveData.accuracy) && liveData.signal !== 'HOLD' ? (
                        <span className="inline-flex items-center px-4 py-2 rounded-full text-sm font-medium bg-green-500/20 text-green-300 border border-green-400/30 shadow-lg shadow-green-500/10">
                          ✓ Can Execute
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-4 py-2 rounded-full text-sm font-medium bg-yellow-500/20 text-yellow-300 border border-yellow-400/30">
                          ⏸ Will Skip
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="mt-4 pt-4 border-t border-blue-400/20">
                    <div className="text-sm text-slate-400">Recommended Action</div>
                    <div className="font-medium text-white text-lg">{liveData.recommendedAction}</div>
                    {settings && (
                      <div className="mt-3 flex flex-wrap gap-4 text-xs text-slate-400">
                        <span>Strategy: <span className="text-slate-300">{settings.strategy || 'orderbook_imbalance'}</span></span>
                        <span>Threshold: <span className="text-slate-300">{(settings.minAccuracyThreshold || 0.85) * 100}%</span></span>
                        <span>Auto-Trade: <span className="text-slate-300">{settings.autoTradeEnabled ? 'Enabled' : 'Disabled'}</span></span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Deep Research Loading State */}
            {deepResearchLoading && (
              <div className="bg-slate-900/50 backdrop-blur-sm border border-slate-700/50 rounded-2xl p-8 shadow-xl shadow-slate-900/20">
                <div className="text-center mb-8">
                  <div className="w-16 h-16 rounded-full bg-gradient-to-r from-purple-500/20 to-cyan-500/20 flex items-center justify-center mb-4">
                    <div className="w-8 h-8 border-4 border-purple-500/30 border-t-purple-500 rounded-full animate-spin"></div>
                  </div>
                  <h3 className="text-2xl font-bold bg-gradient-to-r from-purple-400 to-cyan-400 bg-clip-text text-transparent">
                    Running Deep Research...
                  </h3>
                  <p className="text-slate-400 mt-2">Analyzing market data and generating insights</p>
                </div>

                <div className="space-y-4 w-full">
                  {researchProgress.map((progressItem, index) => (
                    <div key={index} className="flex items-center gap-4 p-4 rounded-lg bg-slate-800/30 border border-slate-700/30">
                      <div className="flex-shrink-0 w-8 h-8 flex items-center justify-center">
                        {progressItem.status === 'pending' && (
                          <span className="w-3 h-3 bg-slate-500 rounded-full"></span>
                        )}
                        {progressItem.status === 'loading' && (
                          <div className="w-5 h-5 border-2 border-purple-400/30 border-t-purple-400 rounded-full animate-spin"></div>
                        )}
                        {progressItem.status === 'success' && (
                          <span className="text-emerald-400 text-lg">✓</span>
                        )}
                        {progressItem.status === 'error' && (
                          <span className="text-red-400 text-lg">✕</span>
                        )}
                      </div>
                      <div className="flex-1">
                        <p className={`font-medium ${progressItem.status === 'success' ? 'text-emerald-300' :
                          progressItem.status === 'error' ? 'text-red-300' :
                            progressItem.status === 'loading' ? 'text-purple-300' :
                              'text-slate-400'
                          }`}>
                          {progressItem.step}
                        </p>
                        {progressItem.error && (
                          <p className="text-red-400 text-sm mt-1">{progressItem.error}</p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Enhanced Deep Research Report */}
            <div className="relative bg-gradient-to-br from-slate-900/60 via-slate-800/60 to-slate-900/60 backdrop-blur-xl border border-slate-700/60 rounded-3xl p-8 lg:p-10 shadow-2xl shadow-slate-900/40 hover:shadow-slate-900/50 transition-all duration-500 overflow-hidden group">
              {/* Animated gradient borders */}
              <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-purple-500 via-cyan-500 to-blue-500"></div>
              <div className="absolute bottom-0 left-0 right-0 h-1 bg-gradient-to-r from-blue-500 via-purple-500 to-cyan-500"></div>

              {/* Subtle background gradient */}
              <div className="absolute inset-0 bg-gradient-to-br from-purple-500/5 via-transparent to-cyan-500/5 opacity-0 group-hover:opacity-100 transition-opacity duration-500"></div>

              <div className="relative">
                <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-8 mb-10">
                  <div className="space-y-4">
                    <div className="flex items-center gap-4">
                      <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-purple-600/20 to-cyan-600/20 flex items-center justify-center">
                        <svg className="w-7 h-7 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                      </div>
                      <div>
                        <h2 className="text-3xl font-bold bg-gradient-to-r from-purple-300 via-cyan-300 to-blue-300 bg-clip-text text-transparent">
                          Deep Research Report
                        </h2>
                        <p className="text-slate-400 flex items-center gap-2 mt-1">
                          <span className="w-2 h-2 bg-purple-400 rounded-full animate-pulse"></span>
                          <span className="text-sm">AI-powered market analysis results</span>
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Status indicator */}
                  <div className="flex items-center gap-3 px-6 py-3 bg-slate-800/40 backdrop-blur-sm border border-slate-600/40 rounded-2xl">
                    <div className="w-3 h-3 bg-gradient-to-r from-green-400 to-emerald-400 rounded-full animate-pulse"></div>
                    <span className="text-sm text-slate-300 font-medium">Analysis Engine Active</span>
                  </div>
                </div>

                {deepResearchLoading ? (
                  <div className="text-center py-20">
                    <div className="relative mb-8">
                      <div className="w-24 h-24 rounded-full bg-gradient-to-br from-purple-600/20 to-cyan-600/20 flex items-center justify-center mx-auto">
                        <div className="w-16 h-16 border-4 border-purple-500/30 border-t-purple-500 rounded-full animate-spin"></div>
                      </div>
                      <div className="absolute inset-0 w-24 h-24 rounded-full bg-gradient-to-br from-purple-500/10 to-cyan-500/10 mx-auto animate-pulse"></div>
                    </div>
                    <h3 className="text-2xl font-bold bg-gradient-to-r from-purple-300 to-cyan-300 bg-clip-text text-transparent mb-3">
                      Analyzing Markets
                    </h3>
                    <p className="text-slate-400 text-lg">Processing real-time data and generating insights</p>
                    <div className="mt-6 flex justify-center">
                      <div className="px-4 py-2 bg-slate-800/40 backdrop-blur-sm border border-slate-600/40 rounded-full">
                        <span className="text-sm text-slate-300">This may take 10-15 seconds...</span>
                      </div>
                    </div>
                  </div>
                ) : deepResearchResults.length === 0 ? (
                  <div className="text-center py-20">
                    <div className="relative mb-8">
                      <div className="w-24 h-24 rounded-full bg-gradient-to-br from-slate-700/30 to-slate-600/30 flex items-center justify-center mx-auto">
                        <svg className="w-12 h-12 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                      </div>
                      <div className="absolute inset-0 w-24 h-24 rounded-full bg-gradient-to-br from-slate-500/10 to-slate-400/10 mx-auto"></div>
                    </div>
                    <div className="space-y-4">
                      <h3 className="text-2xl font-bold text-slate-300">Ready for Analysis</h3>
                      <p className="text-slate-500 text-lg max-w-lg mx-auto leading-relaxed">
                        Click "Run Deep Research" to generate comprehensive market analysis with real-time data from multiple exchanges and sentiment sources
                      </p>
                      <div className="flex justify-center mt-6">
                        <div className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-purple-500/10 to-cyan-500/10 border border-purple-500/20 rounded-full">
                          <svg className="w-4 h-4 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                          <span className="text-sm text-purple-300">Powered by AI & Real-time APIs</span>
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-6 animate-fade-in">
                    {deepResearchResults.map((result, idx) => (
                      <div key={result.id || idx} className="space-y-6 animate-stagger">
                        {/* PRICE HEADER BANNER */}
                        <div className="bg-slate-800 p-4 rounded">
                          <div>Price Header</div>
                        </div>

                        {/* SIGNAL PANEL - Temporarily commented out due to adjacent JSX elements issue */}
                        {/* <div className="relative bg-gradient-to-br from-slate-900/90 via-slate-800/90 to-slate-900/90 backdrop-blur-xl border border-slate-700/50 rounded-2xl p-4 sm:p-6 shadow-2xl shadow-slate-900/50 overflow-hidden"> */}
                        <div className="absolute inset-0 bg-gradient-to-br from-blue-500/5 via-purple-500/5 to-cyan-500/5"></div>
                        <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-blue-500 via-purple-500 to-cyan-500"></div>

                        <div className="relative">
                          <div className="flex items-center justify-between mb-6">
                            <h3 className="text-xl font-bold text-white flex items-center gap-2">
                              <svg className="w-5 h-5 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                              </svg>
                              Signal Panel
                            </h3>
                            <div className="flex items-center gap-2">
                              <div className="w-3 h-3 bg-green-400 rounded-full animate-pulse"></div>
                              <span className="text-sm text-slate-300">Live Analysis</span>
                            </div>
                          </div>

                          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                            {/* Signal */}
                            <div className="bg-slate-800/50 backdrop-blur-sm border border-slate-600/30 rounded-xl p-4">
                              <div className="text-sm text-slate-400 mb-2">Signal</div>
                              <div className={`text-2xl font-bold ${result.result?.signal === 'BUY' ? 'text-green-400' :
                                result.result?.signal === 'SELL' ? 'text-red-400' :
                                  'text-slate-400'
                                }`}>
                                {result.result?.signal || 'HOLD'}
                              </div>
                            </div>

                            {/* Accuracy */}
                            <div className="bg-slate-800/50 backdrop-blur-sm border border-slate-600/30 rounded-xl p-4">
                              <div className="text-sm text-slate-400 mb-2">Accuracy</div>
                              <div className={`text-2xl font-bold ${((result.result?.accuracy || 0) * 100) >= 70 ? 'text-green-400' :
                                ((result.result?.accuracy || 0) * 100) >= 50 ? 'text-yellow-400' :
                                  'text-red-400'
                                }`}>
                                {result.result?.accuracy ? (result.result.accuracy * 100).toFixed(1) : 0}%
                              </div>
                            </div>


                            {/* Market Regime */}
                            <div className="bg-slate-800/50 backdrop-blur-sm border border-slate-600/30 rounded-xl p-4">
                              <div className="text-sm text-slate-400 mb-2">Market Regime</div>
                              <div className={`text-lg font-bold ${(() => {
                                const indicators = result.result?.indicators || {};
                                let bullishSignals = 0;
                                let bearishSignals = 0;

                                // MACD signal
                                if (indicators.macd?.value > 0) bullishSignals++;
                                else if (indicators.macd?.value < 0) bearishSignals++;

                                // RSI signal
                                if (indicators.rsi?.value && indicators.rsi.value > 70) bearishSignals++;
                                else if (indicators.rsi?.value && indicators.rsi.value < 30) bullishSignals++;

                                // Moving averages
                                const price = result.result?.raw?.marketData?.price || 0;
                                if (indicators.ma50?.value && indicators.ma200?.value) {
                                  if (price > indicators.ma50.value && indicators.ma50.value > indicators.ma200.value) bullishSignals++;
                                  else if (price < indicators.ma200.value) bearishSignals++;
                                }

                                // Volume
                                if (indicators.volume?.score && indicators.volume.score > 60) bullishSignals++;
                                else if (indicators.volume?.score && indicators.volume.score < 40) bearishSignals++;

                                if (bullishSignals > bearishSignals) return 'text-green-400';
                                else if (bearishSignals > bullishSignals) return 'text-red-400';
                                else return 'text-slate-400';
                              })()
                                }`}>
                                {(() => {
                                  const indicators = result.result?.indicators || {};
                                  let bullishSignals = 0;
                                  let bearishSignals = 0;

                                  if (indicators.macd?.value > 0) bullishSignals++;
                                  else if (indicators.macd?.value < 0) bearishSignals++;

                                  if (indicators.rsi?.value && indicators.rsi.value > 70) bearishSignals++;
                                  else if (indicators.rsi?.value && indicators.rsi.value < 30) bullishSignals++;

                                  const price = result.result?.raw?.marketData?.price || 0;
                                  if (indicators.ma50?.value && indicators.ma200?.value) {
                                    if (price > indicators.ma50.value && indicators.ma50.value > indicators.ma200.value) bullishSignals++;
                                    else if (price < indicators.ma200.value) bearishSignals++;
                                  }

                                  if (indicators.volume?.score && indicators.volume.score > 60) bullishSignals++;
                                  else if (indicators.volume?.score && indicators.volume.score < 40) bearishSignals++;

                                  if (bullishSignals > bearishSignals) return 'Bullish';
                                  else if (bearishSignals > bullishSignals) return 'Bearish';
                                  else return 'Neutral';
                                })()}
                              </div>
                            </div>

                            {/* Trend Summary */}
                            <div className="bg-slate-800/50 backdrop-blur-sm border border-slate-600/30 rounded-xl p-4">
                              <div className="text-sm text-slate-400 mb-2">Trend Summary</div>
                              <div className="text-lg font-bold text-white">
                                {result.result?.signal === 'BUY' ? 'Bullish' :
                                  result.result?.signal === 'SELL' ? 'Bearish' : 'Neutral'}
                              </div>
                            </div>
                          </div>
                        </div>


                        {/* SUPPORT and RESISTANCE CARD */}
                        <div className="relative bg-gradient-to-br from-slate-900/90 via-slate-800/90 to-slate-900/90 backdrop-blur-xl border border-slate-700/50 rounded-2xl p-4 sm:p-6 shadow-2xl shadow-slate-900/50 overflow-hidden">
                          <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/5 via-green-500/5 to-teal-500/5"></div>
                          <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-emerald-500 via-green-500 to-teal-500"></div>

                          <div className="relative">
                            <h3 className="text-xl font-bold text-white mb-6 flex items-center gap-2">
                              <svg className="w-5 h-5 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                              </svg>
                              Support & Resistance
                            </h3>

                            <div className="grid grid-cols-2 md:grid-cols-2 gap-6">
                              {/* Resistance Levels */}
                              <div className="space-y-4">
                                <h4 className="text-lg font-semibold text-white mb-4">Resistance Levels</h4>

                                <div className="bg-slate-800/50 backdrop-blur-sm border border-slate-600/30 rounded-xl p-4">
                                  <div className="flex items-center justify-between mb-2">
                                    <span className="text-sm font-medium text-slate-300">Major Resistance</span>
                                    <span className="px-2 py-1 rounded text-xs font-medium bg-red-500/20 text-red-400">
                                      Strong
                                    </span>
                                  </div>
                                  <div className="text-xl font-bold text-white">
                                    ${(() => {
                                      const indicators = result.result?.indicators || {};
                                      const price = result.result?.raw?.marketData?.price || 0;

                                      // Major resistance: highest of recent highs or MA200 if price is below it
                                      if (indicators.ma200?.value && price < indicators.ma200.value) {
                                        return indicators.ma200.value.toFixed(2);
                                      }
                                      // Use MA50 as resistance if price is below it
                                      if (indicators.ma50?.value && price < indicators.ma50.value) {
                                        return indicators.ma50.value.toFixed(2);
                                      }
                                      // Calculate based on ATR for resistance level
                                      if (indicators.atr?.value && price) {
                                        return (price + (indicators.atr.value * 2)).toFixed(2);
                                      }
                                      return 'N/A';
                                    })()}
                                  </div>
                                </div>

                                <div className="bg-slate-800/50 backdrop-blur-sm border border-slate-600/30 rounded-xl p-4">
                                  <div className="flex items-center justify-between mb-2">
                                    <span className="text-sm font-medium text-slate-300">Minor Resistance</span>
                                    <span className="px-2 py-1 rounded text-xs font-medium bg-orange-500/20 text-orange-400">
                                      Moderate
                                    </span>
                                  </div>
                                  <div className="text-xl font-bold text-white">
                                    ${(() => {
                                      const indicators = result.result?.indicators || {};
                                      const price = result.result?.raw?.marketData?.price || 0;

                                      // Minor resistance: EMA20 or MA50 if above current price
                                      if (indicators.ema20?.value && price < indicators.ema20.value) {
                                        return indicators.ema20.value.toFixed(2);
                                      }
                                      if (indicators.ma50?.value && price < indicators.ma50.value) {
                                        return indicators.ma50.value.toFixed(2);
                                      }
                                      // Calculate based on ATR for minor resistance
                                      if (indicators.atr?.value && price) {
                                        return (price + indicators.atr.value).toFixed(2);
                                      }
                                      return 'N/A';
                                    })()}
                                  </div>
                                </div>
                              </div>

                              {/* Support Levels */}
                              <div className="space-y-4">
                                <h4 className="text-lg font-semibold text-white mb-4">Support Levels</h4>

                                <div className="bg-slate-800/50 backdrop-blur-sm border border-slate-600/30 rounded-xl p-4">
                                  <div className="flex items-center justify-between mb-2">
                                    <span className="text-sm font-medium text-slate-300">Major Support</span>
                                    <span className="px-2 py-1 rounded text-xs font-medium bg-green-500/20 text-green-400">
                                      Strong
                                    </span>
                                  </div>
                                  <div className="text-xl font-bold text-white">
                                    ${(() => {
                                      const indicators = result.result?.indicators || {};
                                      const price = result.result?.raw?.marketData?.price || 0;

                                      // Major support: lowest of recent lows or MA200 if price is above it
                                      if (indicators.ma200?.value && price > indicators.ma200.value) {
                                        return indicators.ma200.value.toFixed(2);
                                      }
                                      // Use MA50 as support if price is above it
                                      if (indicators.ma50?.value && price > indicators.ma50.value) {
                                        return indicators.ma50.value.toFixed(2);
                                      }
                                      // Calculate based on ATR for support level
                                      if (indicators.atr?.value && price) {
                                        return (price - (indicators.atr.value * 2)).toFixed(2);
                                      }
                                      return 'N/A';
                                    })()}
                                  </div>
                                </div>

                                <div className="bg-slate-800/50 backdrop-blur-sm border border-slate-600/30 rounded-xl p-4">
                                  <div className="flex items-center justify-between mb-2">
                                    <span className="text-sm font-medium text-slate-300">Minor Support</span>
                                    <span className="px-2 py-1 rounded text-xs font-medium bg-blue-500/20 text-blue-400">
                                      Moderate
                                    </span>
                                  </div>
                                  <div className="text-xl font-bold text-white">
                                    ${(() => {
                                      const indicators = result.result?.indicators || {};
                                      const price = result.result?.raw?.marketData?.price || 0;

                                      // Minor support: EMA20 or MA50 if below current price
                                      if (indicators.ema20?.value && price > indicators.ema20.value) {
                                        return indicators.ema20.value.toFixed(2);
                                      }
                                      if (indicators.ma50?.value && price > indicators.ma50.value) {
                                        return indicators.ma50.value.toFixed(2);
                                      }
                                      // Calculate based on ATR for minor support
                                      if (indicators.atr?.value && price) {
                                        return (price - indicators.atr.value).toFixed(2);
                                      }
                                      return 'N/A';
                                    })()}
                                  </div>
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>

                        {/* AUTO-TRADE READINESS CARD */}
                        {settings?.autoTradeEnabled && (
                          <div className="relative bg-gradient-to-br from-slate-900/90 via-slate-800/90 to-slate-900/90 backdrop-blur-xl border border-slate-700/50 rounded-2xl p-4 sm:p-6 shadow-2xl shadow-slate-900/50 overflow-hidden">
                            <div className="absolute inset-0 bg-gradient-to-br from-rose-500/5 via-pink-500/5 to-purple-500/5"></div>
                            <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-rose-500 via-pink-500 to-purple-500"></div>

                            <div className="relative">
                              <div className="flex items-center justify-between mb-6">
                                <h3 className="text-xl font-bold text-white flex items-center gap-2">
                                  <svg className="w-5 h-5 text-rose-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                                  </svg>
                                  Auto-Trade Readiness
                                </h3>
                                <div className="flex items-center gap-2">
                                  <div className="w-3 h-3 bg-green-400 rounded-full animate-pulse"></div>
                                  <span className="text-sm text-slate-300">Active</span>
                                </div>
                              </div>

                              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                                {/* Status */}
                                <div className="bg-slate-800/50 backdrop-blur-sm border border-slate-600/30 rounded-xl p-4">
                                  <div className="text-sm text-slate-400 mb-2">Auto-Trade Status</div>
                                  <div className="text-lg font-bold text-green-400">Enabled</div>
                                  <div className="text-xs text-slate-400 mt-1">System is active</div>
                                </div>

                                {/* Next Evaluation */}
                                <div className="bg-slate-800/50 backdrop-blur-sm border border-slate-600/30 rounded-xl p-4">
                                  <div className="text-sm text-slate-400 mb-2">Next Evaluation</div>
                                  <div className="text-lg font-bold text-white">Every 5 min</div>
                                  <div className="text-xs text-slate-400 mt-1">Continuous monitoring</div>
                                </div>

                                {/* Accuracy Threshold */}
                                <div className="bg-slate-800/50 backdrop-blur-sm border border-slate-600/30 rounded-xl p-4">
                                  <div className="text-sm text-slate-400 mb-2">Accuracy Threshold</div>
                                  <div className={`text-lg font-bold ${(settings.minAccuracyThreshold || 0.85) >= 0.75 ? 'text-green-400' :
                                    (settings.minAccuracyThreshold || 0.85) >= 0.65 ? 'text-yellow-400' : 'text-red-400'
                                    }`}>
                                    {(settings.minAccuracyThreshold || 0.85) * 100}%
                                  </div>
                                  <div className="text-xs text-slate-400 mt-1">Minimum for execution</div>
                                </div>

                                {/* Current Eligibility */}
                                <div className="bg-slate-800/50 backdrop-blur-sm border border-slate-600/30 rounded-xl p-4">
                                  <div className="text-sm text-slate-400 mb-2">Current Eligibility</div>
                                  <div className={`text-lg font-bold ${((result.result?.accuracy || 0) * 100) >= ((settings.minAccuracyThreshold || 0.85) * 100) ? 'text-green-400' : 'text-red-400'
                                    }`}>
                                    {((result.result?.accuracy || 0) * 100) >= ((settings.minAccuracyThreshold || 0.85) * 100) ? 'Eligible' : 'Not Eligible'}
                                  </div>
                                  <div className="text-xs text-slate-400 mt-1">
                                    Current: {result.result?.accuracy ? (result.result.accuracy * 100).toFixed(0) : 0}%
                                  </div>
                                </div>
                              </div>

                              {/* Trade Execution Condition */}
                              <div className="mt-6 bg-slate-800/30 backdrop-blur-sm border border-slate-600/30 rounded-xl p-4">
                                <div className="flex items-center justify-between mb-3">
                                  <h4 className="text-sm font-semibold text-slate-300">Trade Execution Condition</h4>
                                  <div className={`px-3 py-1 rounded-full text-xs font-semibold ${((result.result?.accuracy || 0) * 100) >= ((settings.minAccuracyThreshold || 0.85) * 100) ? 'bg-green-500/20 text-green-400 border border-green-500/30' : 'bg-red-500/20 text-red-400 border border-red-500/30'
                                    }`}>
                                    {((result.result?.accuracy || 0) * 100) >= ((settings.minAccuracyThreshold || 0.85) * 100) ? '✓ Ready to Execute' : '⏸ Below Threshold'}
                                  </div>
                                </div>
                                <div className="text-sm text-slate-400">
                                  Auto-trading will {((result.result?.accuracy || 0) * 100) >= ((settings.minAccuracyThreshold || 0.85) * 100) ?
                                    'execute trades when signals are generated' : 'skip trades until accuracy improves'}.
                                  Next evaluation in approximately 5 minutes.
                                </div>
                              </div>

                              {/* Warnings */}
                              {(!result.result?.providers?.marketData?.success ||
                                !result.result?.providers?.metadata?.success ||
                                !result.result?.providers?.news?.success) && (
                                  <div className="mt-4 p-3 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
                                    <div className="flex items-center gap-2 text-yellow-400 text-sm">
                                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z" />
                                      </svg>
                                      <span>Some data providers are unavailable. Auto-trading may be limited.</span>
                                    </div>
                                  </div>
                                )}
                            </div>
                          </div>
                        )}

                        {/* INDICATORS PANEL */}
                        <div className="relative bg-gradient-to-br from-slate-900/90 via-slate-800/90 to-slate-900/90 backdrop-blur-xl border border-slate-700/50 rounded-2xl p-4 sm:p-6 shadow-2xl shadow-slate-900/50 overflow-hidden">
                          {/* Animated background */}
                          <div className="absolute inset-0 bg-gradient-to-br from-blue-500/5 via-indigo-500/5 to-purple-500/5"></div>
                          <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-blue-500 via-indigo-500 to-purple-500"></div>

                          <div className="relative">
                            <h3 className="text-xl font-bold text-white mb-6 flex items-center gap-2">
                              <svg className="w-5 h-5 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                              </svg>
                              Technical Indicators
                            </h3>

                            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-3 gap-4">
                              {/* RSI */}
                              {result.result?.indicators?.rsi && (
                                <div className="bg-slate-800/50 backdrop-blur-sm border border-slate-600/30 rounded-xl p-4 hover:bg-slate-800/70 transition-all duration-200">
                                  <div className="flex items-center justify-between mb-2">
                                    <span className="text-sm font-medium text-slate-300">RSI</span>
                                    <span className={`px-2 py-1 rounded text-xs font-medium ${(result.result?.indicators?.rsi?.value || 0) > 70 ? 'bg-red-500/20 text-red-400' :
                                      (result.result?.indicators?.rsi?.value || 0) < 30 ? 'bg-green-500/20 text-green-400' :
                                        'bg-blue-500/20 text-blue-400'
                                      }`}>
                                      {(result.result?.indicators?.rsi?.value || 0) > 70 ? 'Overbought' :
                                        (result.result?.indicators?.rsi?.value || 0) < 30 ? 'Oversold' :
                                          'Neutral'}
                                    </span>
                                  </div>
                                  <div className="text-2xl font-bold text-white">{result.result?.indicators?.rsi?.value?.toFixed(1) || 'N/A'}</div>
                                </div>
                              )}

                              {/* SMA50 */}
                              {result.result?.indicators?.ma50 && (
                                <div className="bg-slate-800/50 backdrop-blur-sm border border-slate-600/30 rounded-xl p-4 hover:bg-slate-800/70 transition-all duration-200">
                                  <div className="flex items-center justify-between mb-2">
                                    <span className="text-sm font-medium text-slate-300">SMA50</span>
                                    <span className={`px-2 py-1 rounded text-xs font-medium ${(result.result?.indicators?.ma50?.value || 0) > (result.result?.raw?.marketData?.price || 0) ? 'bg-red-500/20 text-red-400' : 'bg-green-500/20 text-green-400'
                                      }`}>
                                      {(result.result?.indicators?.ma50?.value || 0) > (result.result?.raw?.marketData?.price || 0) ? 'Resistance' : 'Support'}
                                    </span>
                                  </div>
                                  <div className="text-lg font-bold text-white">${result.result?.indicators?.ma50?.value?.toFixed(2) || 'N/A'}</div>
                                </div>
                              )}

                              {/* SMA200 */}
                              {result.result?.indicators?.ma200 && (
                                <div className="bg-slate-800/50 backdrop-blur-sm border border-slate-600/30 rounded-xl p-4 hover:bg-slate-800/70 transition-all duration-200">
                                  <div className="flex items-center justify-between mb-2">
                                    <span className="text-sm font-medium text-slate-300">SMA200</span>
                                    <span className={`px-2 py-1 rounded text-xs font-medium ${(result.result?.indicators?.ma200?.value || 0) > (result.result?.raw?.marketData?.price || 0) ? 'bg-red-500/20 text-red-400' : 'bg-green-500/20 text-green-400'
                                      }`}>
                                      {(result.result?.indicators?.ma200?.value || 0) > (result.result?.raw?.marketData?.price || 0) ? 'Resistance' : 'Support'}
                                    </span>
                                  </div>
                                  <div className="text-lg font-bold text-white">${result.result?.indicators?.ma200?.value?.toFixed(2) || 'N/A'}</div>
                                </div>
                              )}

                              {/* EMA20 */}
                              {result.result?.indicators?.ema20 && (
                                <div className="bg-slate-800/50 backdrop-blur-sm border border-slate-600/30 rounded-xl p-4 hover:bg-slate-800/70 transition-all duration-200">
                                  <div className="flex items-center justify-between mb-2">
                                    <span className="text-sm font-medium text-slate-300">EMA20</span>
                                    <span className={`px-2 py-1 rounded text-xs font-medium ${(result.result?.indicators?.ema20?.value || 0) > (result.result?.raw?.marketData?.price || 0) ? 'bg-red-500/20 text-red-400' : 'bg-green-500/20 text-green-400'
                                      }`}>
                                      {(result.result?.indicators?.ema20?.value || 0) > (result.result?.raw?.marketData?.price || 0) ? 'Resistance' : 'Support'}
                                    </span>
                                  </div>
                                  <div className="text-lg font-bold text-white">${result.result?.indicators?.ema20?.value?.toFixed(2) || 'N/A'}</div>
                                </div>
                              )}

                              {/* EMA50 - Note: may not be available, using ema20 as fallback or skip */}
                              {result.result?.indicators?.ema50 && (
                                <div className="bg-slate-800/50 backdrop-blur-sm border border-slate-600/30 rounded-xl p-4 hover:bg-slate-800/70 transition-all duration-200">
                                  <div className="flex items-center justify-between mb-2">
                                    <span className="text-sm font-medium text-slate-300">EMA50</span>
                                    <span className={`px-2 py-1 rounded text-xs font-medium ${(result.result?.indicators?.ema50?.value || 0) > (result.result?.raw?.marketData?.price || 0) ? 'bg-red-500/20 text-red-400' : 'bg-green-500/20 text-green-400'
                                      }`}>
                                      {(result.result?.indicators?.ema50?.value || 0) > (result.result?.raw?.marketData?.price || 0) ? 'Resistance' : 'Support'}
                                    </span>
                                  </div>
                                  <div className="text-lg font-bold text-white">${result.result?.indicators?.ema50?.value?.toFixed(2) || 'N/A'}</div>
                                </div>
                              )}

                              {/* MACD */}
                              {result.result?.indicators?.macd && (
                                <div className="bg-slate-800/50 backdrop-blur-sm border border-slate-600/30 rounded-xl p-4 hover:bg-slate-800/70 transition-all duration-200">
                                  <div className="flex items-center justify-between mb-2">
                                    <span className="text-sm font-medium text-slate-300">MACD</span>
                                    <span className={`px-2 py-1 rounded text-xs font-medium ${(result.result?.indicators?.macd?.value || 0) > 0 ? 'bg-green-500/20 text-green-400' :
                                      (result.result?.indicators?.macd?.value || 0) < 0 ? 'bg-red-500/20 text-red-400' :
                                        'bg-slate-500/20 text-slate-400'
                                      }`}>
                                      {(result.result?.indicators?.macd?.value || 0) > 0 ? 'Bullish' :
                                        (result.result?.indicators?.macd?.value || 0) < 0 ? 'Bearish' :
                                          'Neutral'}
                                    </span>
                                  </div>
                                  <div className="text-lg font-bold text-white">{(result.result?.indicators?.macd?.value || 0).toFixed(4)}</div>
                                </div>
                              )}

                              {/* VWAP */}
                              {result.result?.indicators?.vwap && (
                                <div className="bg-slate-800/50 backdrop-blur-sm border border-slate-600/30 rounded-xl p-4 hover:bg-slate-800/70 transition-all duration-200">
                                  <div className="flex items-center justify-between mb-2">
                                    <span className="text-sm font-medium text-slate-300">VWAP</span>
                                    <span className={`px-2 py-1 rounded text-xs font-medium ${result.result?.indicators?.vwap?.signal === 'bullish' ? 'bg-green-500/20 text-green-400' :
                                      result.result?.indicators?.vwap?.signal === 'bearish' ? 'bg-red-500/20 text-red-400' :
                                        'bg-blue-500/20 text-blue-400'
                                      }`}>
                                      {result.result?.indicators?.vwap?.signal === 'bullish' ? 'Bullish' :
                                        result.result?.indicators?.vwap?.signal === 'bearish' ? 'Bearish' :
                                          'Neutral'}
                                    </span>
                                  </div>
                                  <div className="text-lg font-bold text-white">
                                    {result.result?.indicators?.vwap?.signal || 'N/A'}
                                  </div>
                                </div>
                              )}

                              {/* ATR (Volatility Score) */}
                              {result.result?.indicators?.atr && (
                                <div className="bg-slate-800/50 backdrop-blur-sm border border-slate-600/30 rounded-xl p-4 hover:bg-slate-800/70 transition-all duration-200">
                                  <div className="flex items-center justify-between mb-2">
                                    <span className="text-sm font-medium text-slate-300">Volatility</span>
                                    <span className={`px-2 py-1 rounded text-xs font-medium ${(result.result?.indicators?.atr?.atrPct || 0) > 3 ? 'bg-red-500/20 text-red-400' :
                                      (result.result?.indicators?.atr?.atrPct || 0) > 1.5 ? 'bg-yellow-500/20 text-yellow-400' :
                                        'bg-green-500/20 text-green-400'
                                      }`}>
                                      {(result.result?.indicators?.atr?.atrPct || 0) > 3 ? 'High' :
                                        (result.result?.indicators?.atr?.atrPct || 0) > 1.5 ? 'Moderate' : 'Low'}
                                    </span>
                                  </div>
                                  <div className="text-lg font-bold text-white">{result.result?.indicators?.atr?.atrPct?.toFixed(2) || 'N/A'}%</div>
                                </div>
                              )}

                              {/* Support/Resistance - derived from indicators */}
                              <div className="bg-slate-800/50 backdrop-blur-sm border border-slate-600/30 rounded-xl p-4 hover:bg-slate-800/70 transition-all duration-200">
                                <div className="flex items-center justify-between mb-2">
                                  <span className="text-sm font-medium text-slate-300">Support/Resistance</span>
                                  <span className="px-2 py-1 rounded text-xs font-medium bg-slate-500/20 text-slate-400">
                                    Level
                                  </span>
                                </div>
                                <div className="text-sm text-white">
                                  Near Key {result.result?.indicators?.ma50?.value && result.result?.indicators?.ma200?.value ?
                                    ((result.result?.indicators?.ma50?.value || 0) > (result.result?.raw?.marketData?.price || 0) ||
                                      (result.result?.indicators?.ma200?.value || 0) > (result.result?.raw?.marketData?.price || 0)) ? 'Resistance' : 'Support'
                                    : 'Levels'}
                                </div>
                              </div>

                              {/* Volume */}
                              {result.result?.indicators?.volume && (
                                <div className="bg-slate-800/50 backdrop-blur-sm border border-slate-600/30 rounded-xl p-4 hover:bg-slate-800/70 transition-all duration-200">
                                  <div className="flex items-center justify-between mb-2">
                                    <span className="text-sm font-medium text-slate-300">Volume Score</span>
                                    <span className={`px-2 py-1 rounded text-xs font-medium ${(result.result?.indicators?.volume?.score || 0) > 50 ? 'bg-green-500/20 text-green-400' :
                                      (result.result?.indicators?.volume?.score || 0) < 30 ? 'bg-red-500/20 text-red-400' :
                                        'bg-yellow-500/20 text-yellow-400'
                                      }`}>
                                      {(result.result?.indicators?.volume?.score || 0) > 50 ? 'High' :
                                        (result.result?.indicators?.volume?.score || 0) < 30 ? 'Low' : 'Moderate'}
                                    </span>
                                  </div>
                                  <div className="text-xl font-bold text-white">{result.result?.indicators?.volume?.score?.toFixed(0) || 'N/A'}</div>
                                  <div className="text-xs text-slate-400 mt-1">Volume Strength Indicator</div>
                                </div>
                              )}

                              {/* VWAP */}
                              {result.result?.indicators?.vwap && (
                                <div className="bg-slate-800/50 backdrop-blur-sm border border-slate-600/30 rounded-xl p-4 hover:bg-slate-800/70 transition-all duration-200">
                                  <div className="flex items-center justify-between mb-2">
                                    <span className="text-sm font-medium text-slate-300">VWAP</span>
                                    <span className={`px-2 py-1 rounded text-xs font-medium ${result.result?.indicators?.vwap?.signal === 'bullish' ? 'bg-green-500/20 text-green-400' :
                                      result.result?.indicators?.vwap?.signal === 'bearish' ? 'bg-red-500/20 text-red-400' :
                                        'bg-blue-500/20 text-blue-400'
                                      }`}>
                                      {result.result?.indicators?.vwap?.signal === 'bullish' ? 'Bullish' :
                                        result.result?.indicators?.vwap?.signal === 'bearish' ? 'Bearish' : 'Neutral'}
                                    </span>
                                  </div>
                                  <div className="text-xl font-bold text-white">{result.result?.indicators?.vwap?.signal || 'N/A'}</div>
                                  <div className="text-xs text-slate-400 mt-1">VWAP Deviation Indicator</div>
                                </div>
                              )}

                              {/* ATR */}
                              {result.result?.indicators?.atr && (
                                <div className="bg-slate-800/50 backdrop-blur-sm border border-slate-600/30 rounded-xl p-4 hover:bg-slate-800/70 transition-all duration-200">
                                  <div className="flex items-center justify-between mb-2">
                                    <span className="text-sm font-medium text-slate-300">ATR Level</span>
                                    <span className={`px-2 py-1 rounded text-xs font-medium ${(result.result?.indicators?.atr?.classification || '').toLowerCase() === 'high' ? 'bg-red-500/20 text-red-400' :
                                      (result.result?.indicators?.atr?.classification || '').toLowerCase() === 'low' ? 'bg-green-500/20 text-green-400' :
                                        'bg-yellow-500/20 text-yellow-400'
                                      }`}>
                                      {result.result?.indicators?.atr?.classification || 'Moderate'}
                                    </span>
                                  </div>
                                  <div className="text-xl font-bold text-white">{result.result?.indicators?.atr?.value?.toFixed(4) || 'N/A'}</div>
                                  <div className="text-xs text-slate-400 mt-1">Average True Range</div>
                                </div>
                              )}

                              {/* Pattern */}
                              {result.result?.indicators?.pattern && (
                                <div className="bg-slate-800/50 backdrop-blur-sm border border-slate-600/30 rounded-xl p-4 hover:bg-slate-800/70 transition-all duration-200">
                                  <div className="flex items-center justify-between mb-2">
                                    <span className="text-sm font-medium text-slate-300">Pattern Confidence</span>
                                    <span className={`px-2 py-1 rounded text-xs font-medium ${(result.result?.indicators?.pattern?.confidence || 0) > 70 ? 'bg-green-500/20 text-green-400' :
                                      (result.result?.indicators?.pattern?.confidence || 0) > 40 ? 'bg-yellow-500/20 text-yellow-400' :
                                        'bg-red-500/20 text-red-400'
                                      }`}>
                                      {(result.result?.indicators?.pattern?.confidence || 0) > 70 ? 'Strong' :
                                        (result.result?.indicators?.pattern?.confidence || 0) > 40 ? 'Moderate' : 'Weak'}
                                    </span>
                                  </div>
                                  <div className="text-lg font-bold text-white">{result.result?.indicators?.pattern?.pattern || 'N/A'}</div>
                                  <div className="text-xs text-slate-400 mt-1">Confidence: {result.result?.indicators?.pattern?.confidence?.toFixed(1) || 'N/A'}%</div>
                                </div>
                              )}

                              {/* Momentum */}
                              {result.result?.indicators?.momentum && (
                                <div className="bg-slate-800/50 backdrop-blur-sm border border-slate-600/30 rounded-xl p-4 hover:bg-slate-800/70 transition-all duration-200">
                                  <div className="flex items-center justify-between mb-2">
                                    <span className="text-sm font-medium text-slate-300">Momentum Score</span>
                                    <span className={`px-2 py-1 rounded text-xs font-medium ${(result.result?.indicators?.momentum?.direction || '').toLowerCase() === 'bullish' ? 'bg-green-500/20 text-green-400' :
                                      (result.result?.indicators?.momentum?.direction || '').toLowerCase() === 'bearish' ? 'bg-red-500/20 text-red-400' :
                                        'bg-slate-500/20 text-slate-400'
                                      }`}>
                                      {result.result?.indicators?.momentum?.direction || 'Neutral'}
                                    </span>
                                  </div>
                                  <div className="text-xl font-bold text-white">{result.result?.indicators?.momentum?.score?.toFixed(1) || 'N/A'}</div>
                                  <div className="text-xs text-slate-400 mt-1">Momentum Score</div>
                                </div>
                              )}
                            </div>

                            {!result.result?.indicators && (
                              <div className="text-center py-8">
                                <p className="text-slate-400">No indicators available</p>
                              </div>
                            )}
                          </div>
                        </div>

                        {/* AI FINAL VERDICT */}
                        <div className="relative bg-gradient-to-br from-slate-900/90 via-slate-800/90 to-slate-900/90 backdrop-blur-xl border border-slate-700/50 rounded-2xl p-6 shadow-2xl shadow-slate-900/50 overflow-hidden">
                          <div className={`absolute inset-0 ${result.result?.signal === 'BUY' ? 'bg-gradient-to-br from-green-500/10 via-emerald-500/5 to-teal-500/10' :
                            result.result?.signal === 'SELL' ? 'bg-gradient-to-br from-red-500/10 via-rose-500/5 to-pink-500/10' :
                              'bg-gradient-to-br from-yellow-500/10 via-amber-500/5 to-orange-500/10'
                            }`}></div>
                          <div className={`absolute top-0 left-0 right-0 h-1 ${result.result?.signal === 'BUY' ? 'bg-gradient-to-r from-green-500 via-emerald-500 to-teal-500' :
                            result.result?.signal === 'SELL' ? 'bg-gradient-to-r from-red-500 via-rose-500 to-pink-500' :
                              'bg-gradient-to-r from-yellow-500 via-amber-500 to-orange-500'
                            }`}></div>

                          <div className="relative">
                            <div className="flex items-center justify-between mb-4">
                              <h3 className="text-xl font-bold text-white flex items-center gap-2">
                                <svg className="w-5 h-5 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                                </svg>
                                AI Final Verdict
                              </h3>
                              <div className="flex items-center gap-2">
                                <div className={`w-3 h-3 rounded-full animate-pulse ${result.result?.signal === 'BUY' ? 'bg-green-400' :
                                  result.result?.signal === 'SELL' ? 'bg-red-400' :
                                    'bg-yellow-400'
                                  }`}></div>
                                <span className="text-sm text-slate-300">Analysis Complete</span>
                              </div>
                            </div>

                            <div className="space-y-4">
                              {/* Verdict & Confidence */}
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-4">
                                  <div className={`text-4xl font-bold ${result.result?.signal === 'BUY' ? 'text-green-400' :
                                    result.result?.signal === 'SELL' ? 'text-red-400' :
                                      'text-yellow-400'
                                    }`}>
                                    {result.result?.signal || 'HOLD'}
                                  </div>
                                  <div className="text-center">
                                    <div className="text-sm text-slate-400">Confidence</div>
                                    <div className={`text-2xl font-bold ${((result.result?.accuracy || 0) * 100) >= 70 ? 'text-green-400' :
                                      ((result.result?.accuracy || 0) * 100) >= 50 ? 'text-yellow-400' :
                                        'text-red-400'
                                      }`}>
                                      {result.result?.accuracy ? (result.result.accuracy * 100).toFixed(0) : 0}%
                                    </div>
                                  </div>
                                </div>
                              </div>

                              {/* Why Section */}
                              <div className="bg-slate-800/50 backdrop-blur-sm border border-slate-600/30 rounded-xl p-4">
                                <div className="text-sm font-medium text-slate-300 mb-2">Why?</div>
                                <div className="text-sm text-slate-400 leading-relaxed">
                                  {(() => {
                                    const signal = result.result?.signal;
                                    const indicators = result.result?.indicators || {};
                                    const news = result.news?.articles || [];
                                    const reasons = [];

                                    // Indicator-based reasons
                                    if (indicators.macd?.value > 0 && signal === 'BUY') reasons.push('MACD shows bullish momentum');
                                    if (indicators.macd?.value < 0 && signal === 'SELL') reasons.push('MACD indicates bearish momentum');

                                    if (indicators.rsi?.value < 30 && signal === 'BUY') reasons.push('RSI suggests oversold conditions');
                                    if (indicators.rsi?.value > 70 && signal === 'SELL') reasons.push('RSI indicates overbought conditions');

                                    const price = result.result?.raw?.marketData?.price || 0;
                                    if (indicators.ma50?.value && price > indicators.ma50.value && signal === 'BUY') reasons.push('Price above key moving averages');
                                    if (indicators.ma50?.value && price < indicators.ma50.value && signal === 'SELL') reasons.push('Price below key moving averages');

                                    // News sentiment reasons
                                    const positiveArticles = news.filter((a: any) => a.sentiment === 'positive').length;
                                    const negativeArticles = news.filter((a: any) => a.sentiment === 'negative').length;

                                    if (positiveArticles > negativeArticles && signal === 'BUY') reasons.push('Positive news sentiment supports bullish outlook');
                                    if (negativeArticles > positiveArticles && signal === 'SELL') reasons.push('Negative news sentiment aligns with bearish signal');

                                    // Volume reasons
                                    if (indicators.volume?.score && indicators.volume.score > 60 && signal === 'BUY') reasons.push('Strong volume confirms upward momentum');
                                    if (indicators.volume?.score && indicators.volume.score < 40 && signal === 'SELL') reasons.push('Low volume suggests continued downward pressure');

                                    return reasons.length > 0 ? reasons.slice(0, 3).join('. ') + '.' : 'Signal based on comprehensive technical analysis.';
                                  })()}
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>

                        {/* MARKET SENTIMENT GAUGE */}
                        {result.news?.articles && result.news.articles.length > 0 && (
                          <div className="relative bg-gradient-to-br from-slate-900/90 via-slate-800/90 to-slate-900/90 backdrop-blur-xl border border-slate-700/50 rounded-2xl p-6 shadow-2xl shadow-slate-900/50 overflow-hidden">
                            <div className="absolute inset-0 bg-gradient-to-br from-cyan-500/5 via-blue-500/5 to-indigo-500/5"></div>
                            <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-cyan-500 via-blue-500 to-indigo-500"></div>

                            <div className="relative">
                              <div className="flex items-center justify-between mb-6">
                                <h3 className="text-xl font-bold text-white flex items-center gap-2">
                                  <svg className="w-5 h-5 text-cyan-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                                  </svg>
                                  Market Sentiment Gauge
                                </h3>
                                <div className="text-right">
                                  <div className="text-sm text-slate-400">Articles Analyzed</div>
                                  <div className="text-lg font-bold text-white">{result.news.articles.length}</div>
                                </div>
                              </div>

                              {/* Sentiment Counts */}
                              <div className="grid grid-cols-3 gap-4 mb-6">
                                <div className="text-center">
                                  <div className="text-2xl font-bold text-green-400">{result.news.articles.filter((article: any) => article.sentiment === 'positive').length}</div>
                                  <div className="text-sm text-slate-400">Positive</div>
                                </div>
                                <div className="text-center">
                                  <div className="text-2xl font-bold text-slate-400">{result.news.articles.filter((article: any) => article.sentiment === 'neutral').length}</div>
                                  <div className="text-sm text-slate-400">Neutral</div>
                                </div>
                                <div className="text-center">
                                  <div className="text-2xl font-bold text-red-400">{result.news.articles.filter((article: any) => article.sentiment === 'negative').length}</div>
                                  <div className="text-sm text-slate-400">Negative</div>
                                </div>
                              </div>

                              {/* Sentiment Gauge */}
                              <div className="space-y-4">
                                <div className="flex justify-between text-sm text-slate-400">
                                  <span>Fear</span>
                                  <span>Neutral</span>
                                  <span>Greed</span>
                                </div>

                                {/* Gauge Bar */}
                                <div className="relative">
                                  <div className="w-full h-4 bg-gradient-to-r from-red-500 via-yellow-500 to-green-500 rounded-full overflow-hidden">
                                    <div className="absolute inset-0 bg-slate-900/30 rounded-full"></div>
                                  </div>

                                  {/* Pointer */}
                                  <div
                                    className="absolute top-0 w-1 h-4 bg-white rounded-full shadow-lg transform -translate-x-0.5 transition-all duration-500"
                                    style={{
                                      left: `${(() => {
                                        const articles = result.news.articles;
                                        const positive = articles.filter((a: any) => a.sentiment === 'positive').length;
                                        const negative = articles.filter((a: any) => a.sentiment === 'negative').length;
                                        const total = articles.length;

                                        if (total === 0) return '50';

                                        const score = (positive - negative) / total; // -1 to 1
                                        return ((score + 1) / 2) * 100; // 0 to 100
                                      })()}%`
                                    }}
                                  ></div>
                                </div>

                                {/* Current Sentiment Value */}
                                <div className="text-center">
                                  <div className="text-lg font-bold text-white mb-1">
                                    {(() => {
                                      const articles = result.news.articles;
                                      const positive = articles.filter((a: any) => a.sentiment === 'positive').length;
                                      const negative = articles.filter((a: any) => a.sentiment === 'negative').length;
                                      const total = articles.length;

                                      if (total === 0) return 'Neutral';

                                      const score = (positive - negative) / total;
                                      if (score > 0.3) return 'Greed';
                                      else if (score < -0.3) return 'Fear';
                                      else return 'Neutral';
                                    })()}
                                  </div>
                                  <div className={`text-sm ${(() => {
                                    const articles = result.news.articles;
                                    const positive = articles.filter((a: any) => a.sentiment === 'positive').length;
                                    const negative = articles.filter((a: any) => a.sentiment === 'negative').length;
                                    const total = articles.length;

                                    if (total === 0) return 'text-slate-400';

                                    const score = (positive - negative) / total;
                                    if (score > 0.3) return 'text-green-400';
                                    else if (score < -0.3) return 'text-red-400';
                                    else return 'text-yellow-400';
                                  })()
                                    }`}>
                                    Sentiment Score: {(() => {
                                      const articles = result.news.articles;
                                      const positive = articles.filter((a: any) => a.sentiment === 'positive').length;
                                      const negative = articles.filter((a: any) => a.sentiment === 'negative').length;
                                      const total = articles.length;

                                      if (total === 0) return '0.00';

                                      const score = (positive - negative) / total;
                                      return score.toFixed(2);
                                    })()}
                                  </div>
                                </div>
                              </div>
                            </div>
                          </div>
                        )}

                        {/* PROBABILITY DISTRIBUTION */}
                        <div className="relative bg-gradient-to-br from-slate-900/90 via-slate-800/90 to-slate-900/90 backdrop-blur-xl border border-slate-700/50 rounded-2xl p-6 shadow-2xl shadow-slate-900/50 overflow-hidden">
                          <div className="absolute inset-0 bg-gradient-to-br from-violet-500/5 via-purple-500/5 to-pink-500/5"></div>
                          <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-violet-500 via-purple-500 to-pink-500"></div>

                          <div className="relative">
                            <div className="flex items-center justify-between mb-6">
                              <h3 className="text-xl font-bold text-white flex items-center gap-2">
                                <svg className="w-5 h-5 text-violet-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                                </svg>
                                Probability Distribution
                              </h3>
                              <div className="text-right">
                                <div className="text-sm text-slate-400">Based on Technical Analysis</div>
                                <div className="text-sm text-violet-400 font-medium">AI Calculated</div>
                              </div>
                            </div>

                            <div className="space-y-4">
                              {(() => {
                                const indicators = result.result?.indicators || {};
                                const price = result.result?.raw?.marketData?.price || 0;

                                // Calculate probabilities based on indicators
                                let uptrendScore = 0;
                                let downtrendScore = 0;
                                let totalIndicators = 0;

                                // MACD contribution
                                if (indicators.macd?.value !== undefined) {
                                  totalIndicators++;
                                  if (indicators.macd.value > 0) uptrendScore++;
                                  else if (indicators.macd.value < 0) downtrendScore++;
                                }

                                // RSI contribution
                                if (indicators.rsi?.value !== undefined) {
                                  totalIndicators++;
                                  if (indicators.rsi.value < 30) uptrendScore++;
                                  else if (indicators.rsi.value > 70) downtrendScore++;
                                }

                                // Moving averages contribution
                                if (indicators.ema20?.value && indicators.ma50?.value && indicators.ma200?.value) {
                                  totalIndicators++;
                                  const maAlignment = (price > indicators.ema20.value ? 1 : 0) +
                                    (indicators.ema20.value > indicators.ma50.value ? 1 : 0) +
                                    (indicators.ma50.value > indicators.ma200.value ? 1 : 0);

                                  if (maAlignment >= 2) uptrendScore++;
                                  else if (maAlignment <= 1) downtrendScore++;
                                }

                                // Volume contribution
                                if (indicators.volume?.score !== undefined) {
                                  totalIndicators++;
                                  if (indicators.volume.score > 60) uptrendScore++;
                                  else if (indicators.volume.score < 40) downtrendScore++;
                                }

                                // Momentum contribution
                                if (indicators.momentum?.direction) {
                                  totalIndicators++;
                                  if (indicators.momentum.direction.toLowerCase() === 'bullish') uptrendScore++;
                                  else if (indicators.momentum.direction.toLowerCase() === 'bearish') downtrendScore++;
                                }

                                // Calculate probabilities
                                const totalScore = uptrendScore + downtrendScore;
                                let uptrendProb = 0;
                                let downtrendProb = 0;
                                let sidewaysProb = 100;

                                if (totalScore > 0) {
                                  uptrendProb = (uptrendScore / totalScore) * 70; // Max 70% for uptrend
                                  downtrendProb = (downtrendScore / totalScore) * 70; // Max 70% for downtrend
                                  sidewaysProb = 100 - uptrendProb - downtrendProb;
                                }

                                return { uptrendProb, downtrendProb, sidewaysProb };
                              })().uptrendProb !== undefined && (
                                  <>
                                    {/* Uptrend Probability */}
                                    <div className="bg-slate-800/50 backdrop-blur-sm border border-slate-600/30 rounded-xl p-4">
                                      <div className="flex items-center justify-between mb-2">
                                        <div className="flex items-center gap-3">
                                          <div className="w-4 h-4 rounded-full bg-green-500"></div>
                                          <span className="text-lg font-medium text-slate-300">Uptrend Probability</span>
                                        </div>
                                        <span className="text-2xl font-bold text-green-400">
                                          {(() => {
                                            const indicators = result.result?.indicators || {};
                                            const price = result.result?.raw?.marketData?.price || 0;

                                            let uptrendScore = 0;
                                            let downtrendScore = 0;
                                            let totalIndicators = 0;

                                            if (indicators.macd?.value !== undefined) {
                                              totalIndicators++;
                                              if (indicators.macd.value > 0) uptrendScore++;
                                              else if (indicators.macd.value < 0) downtrendScore++;
                                            }

                                            if (indicators.rsi?.value !== undefined) {
                                              totalIndicators++;
                                              if (indicators.rsi.value < 30) uptrendScore++;
                                              else if (indicators.rsi.value > 70) downtrendScore++;
                                            }

                                            if (indicators.ema20?.value && indicators.ma50?.value && indicators.ma200?.value) {
                                              totalIndicators++;
                                              const maAlignment = (price > indicators.ema20.value ? 1 : 0) +
                                                (indicators.ema20.value > indicators.ma50.value ? 1 : 0) +
                                                (indicators.ma50.value > indicators.ma200.value ? 1 : 0);

                                              if (maAlignment >= 2) uptrendScore++;
                                              else if (maAlignment <= 1) downtrendScore++;
                                            }

                                            if (indicators.volume?.score !== undefined) {
                                              totalIndicators++;
                                              if (indicators.volume.score > 60) uptrendScore++;
                                              else if (indicators.volume.score < 40) downtrendScore++;
                                            }

                                            if (indicators.momentum?.direction) {
                                              totalIndicators++;
                                              if (indicators.momentum.direction.toLowerCase() === 'bullish') uptrendScore++;
                                              else if (indicators.momentum.direction.toLowerCase() === 'bearish') downtrendScore++;
                                            }

                                            const totalScore = uptrendScore + downtrendScore;
                                            if (totalScore === 0) return '0';

                                            return Math.round((uptrendScore / totalScore) * 70);
                                          })()}%
                                        </span>
                                      </div>
                                      <div className="w-full bg-slate-700 rounded-full h-2">
                                        <div
                                          className="bg-green-500 h-2 rounded-full transition-all duration-500"
                                          style={{
                                            width: `${(() => {
                                              const indicators = result.result?.indicators || {};
                                              const price = result.result?.raw?.marketData?.price || 0;

                                              let uptrendScore = 0;
                                              let downtrendScore = 0;
                                              let totalIndicators = 0;

                                              if (indicators.macd?.value !== undefined) {
                                                totalIndicators++;
                                                if (indicators.macd.value > 0) uptrendScore++;
                                                else if (indicators.macd.value < 0) downtrendScore++;
                                              }

                                              if (indicators.rsi?.value !== undefined) {
                                                totalIndicators++;
                                                if (indicators.rsi.value < 30) uptrendScore++;
                                                else if (indicators.rsi.value > 70) downtrendScore++;
                                              }

                                              if (indicators.ema20?.value && indicators.ma50?.value && indicators.ma200?.value) {
                                                totalIndicators++;
                                                const maAlignment = (price > indicators.ema20.value ? 1 : 0) +
                                                  (indicators.ema20.value > indicators.ma50.value ? 1 : 0) +
                                                  (indicators.ma50.value > indicators.ma200.value ? 1 : 0);

                                                if (maAlignment >= 2) uptrendScore++;
                                                else if (maAlignment <= 1) downtrendScore++;
                                              }

                                              if (indicators.volume?.score !== undefined) {
                                                totalIndicators++;
                                                if (indicators.volume.score > 60) uptrendScore++;
                                                else if (indicators.volume.score < 40) downtrendScore++;
                                              }

                                              if (indicators.momentum?.direction) {
                                                totalIndicators++;
                                                if (indicators.momentum.direction.toLowerCase() === 'bullish') uptrendScore++;
                                                else if (indicators.momentum.direction.toLowerCase() === 'bearish') downtrendScore++;
                                              }

                                              const totalScore = uptrendScore + downtrendScore;
                                              if (totalScore === 0) return '0';

                                              return (uptrendScore / totalScore) * 100;
                                            })()}%`
                                          }}
                                        ></div>
                                      </div>
                                    </div>

                                    {/* Downtrend Probability */}
                                    <div className="bg-slate-800/50 backdrop-blur-sm border border-slate-600/30 rounded-xl p-4">
                                      <div className="flex items-center justify-between mb-2">
                                        <div className="flex items-center gap-3">
                                          <div className="w-4 h-4 rounded-full bg-red-500"></div>
                                          <span className="text-lg font-medium text-slate-300">Downtrend Probability</span>
                                        </div>
                                        <span className="text-2xl font-bold text-red-400">
                                          {(() => {
                                            const indicators = result.result?.indicators || {};
                                            const price = result.result?.raw?.marketData?.price || 0;

                                            let uptrendScore = 0;
                                            let downtrendScore = 0;
                                            let totalIndicators = 0;

                                            if (indicators.macd?.value !== undefined) {
                                              totalIndicators++;
                                              if (indicators.macd.value > 0) uptrendScore++;
                                              else if (indicators.macd.value < 0) downtrendScore++;
                                            }

                                            if (indicators.rsi?.value !== undefined) {
                                              totalIndicators++;
                                              if (indicators.rsi.value < 30) uptrendScore++;
                                              else if (indicators.rsi.value > 70) downtrendScore++;
                                            }

                                            if (indicators.ema20?.value && indicators.ma50?.value && indicators.ma200?.value) {
                                              totalIndicators++;
                                              const maAlignment = (price > indicators.ema20.value ? 1 : 0) +
                                                (indicators.ema20.value > indicators.ma50.value ? 1 : 0) +
                                                (indicators.ma50.value > indicators.ma200.value ? 1 : 0);

                                              if (maAlignment >= 2) uptrendScore++;
                                              else if (maAlignment <= 1) downtrendScore++;
                                            }

                                            if (indicators.volume?.score !== undefined) {
                                              totalIndicators++;
                                              if (indicators.volume.score > 60) uptrendScore++;
                                              else if (indicators.volume.score < 40) downtrendScore++;
                                            }

                                            if (indicators.momentum?.direction) {
                                              totalIndicators++;
                                              if (indicators.momentum.direction.toLowerCase() === 'bullish') uptrendScore++;
                                              else if (indicators.momentum.direction.toLowerCase() === 'bearish') downtrendScore++;
                                            }

                                            const totalScore = uptrendScore + downtrendScore;
                                            if (totalScore === 0) return '0';

                                            return Math.round((downtrendScore / totalScore) * 70);
                                          })()}%
                                        </span>
                                      </div>
                                      <div className="w-full bg-slate-700 rounded-full h-2">
                                        <div
                                          className="bg-red-500 h-2 rounded-full transition-all duration-500"
                                          style={{
                                            width: `${(() => {
                                              const indicators = result.result?.indicators || {};
                                              const price = result.result?.raw?.marketData?.price || 0;

                                              let uptrendScore = 0;
                                              let downtrendScore = 0;
                                              let totalIndicators = 0;

                                              if (indicators.macd?.value !== undefined) {
                                                totalIndicators++;
                                                if (indicators.macd.value > 0) uptrendScore++;
                                                else if (indicators.macd.value < 0) downtrendScore++;
                                              }

                                              if (indicators.rsi?.value !== undefined) {
                                                totalIndicators++;
                                                if (indicators.rsi.value < 30) uptrendScore++;
                                                else if (indicators.rsi.value > 70) downtrendScore++;
                                              }

                                              if (indicators.ema20?.value && indicators.ma50?.value && indicators.ma200?.value) {
                                                totalIndicators++;
                                                const maAlignment = (price > indicators.ema20.value ? 1 : 0) +
                                                  (indicators.ema20.value > indicators.ma50.value ? 1 : 0) +
                                                  (indicators.ma50.value > indicators.ma200.value ? 1 : 0);

                                                if (maAlignment >= 2) uptrendScore++;
                                                else if (maAlignment <= 1) downtrendScore++;
                                              }

                                              if (indicators.volume?.score !== undefined) {
                                                totalIndicators++;
                                                if (indicators.volume.score > 60) uptrendScore++;
                                                else if (indicators.volume.score < 40) downtrendScore++;
                                              }

                                              if (indicators.momentum?.direction) {
                                                totalIndicators++;
                                                if (indicators.momentum.direction.toLowerCase() === 'bullish') uptrendScore++;
                                                else if (indicators.momentum.direction.toLowerCase() === 'bearish') downtrendScore++;
                                              }

                                              const totalScore = uptrendScore + downtrendScore;
                                              if (totalScore === 0) return '0';

                                              return (downtrendScore / totalScore) * 100;
                                            })()}%`
                                          }}
                                        ></div>
                                      </div>
                                    </div>

                                    {/* Sideways Probability */}
                                    <div className="bg-slate-800/50 backdrop-blur-sm border border-slate-600/30 rounded-xl p-4">
                                      <div className="flex items-center justify-between mb-2">
                                        <div className="flex items-center gap-3">
                                          <div className="w-4 h-4 rounded-full bg-slate-500"></div>
                                          <span className="text-lg font-medium text-slate-300">Sideways Probability</span>
                                        </div>
                                        <span className="text-2xl font-bold text-slate-400">
                                          {(() => {
                                            const indicators = result.result?.indicators || {};
                                            const price = result.result?.raw?.marketData?.price || 0;

                                            let uptrendScore = 0;
                                            let downtrendScore = 0;
                                            let totalIndicators = 0;

                                            if (indicators.macd?.value !== undefined) {
                                              totalIndicators++;
                                              if (indicators.macd.value > 0) uptrendScore++;
                                              else if (indicators.macd.value < 0) downtrendScore++;
                                            }

                                            if (indicators.rsi?.value !== undefined) {
                                              totalIndicators++;
                                              if (indicators.rsi.value < 30) uptrendScore++;
                                              else if (indicators.rsi.value > 70) downtrendScore++;
                                            }

                                            if (indicators.ema20?.value && indicators.ma50?.value && indicators.ma200?.value) {
                                              totalIndicators++;
                                              const maAlignment = (price > indicators.ema20.value ? 1 : 0) +
                                                (indicators.ema20.value > indicators.ma50.value ? 1 : 0) +
                                                (indicators.ma50.value > indicators.ma200.value ? 1 : 0);

                                              if (maAlignment >= 2) uptrendScore++;
                                              else if (maAlignment <= 1) downtrendScore++;
                                            }

                                            if (indicators.volume?.score !== undefined) {
                                              totalIndicators++;
                                              if (indicators.volume.score > 60) uptrendScore++;
                                              else if (indicators.volume.score < 40) downtrendScore++;
                                            }

                                            if (indicators.momentum?.direction) {
                                              totalIndicators++;
                                              if (indicators.momentum.direction.toLowerCase() === 'bullish') uptrendScore++;
                                              else if (indicators.momentum.direction.toLowerCase() === 'bearish') downtrendScore++;
                                            }

                                            const totalScore = uptrendScore + downtrendScore;
                                            if (totalScore === 0) return '100';

                                            const uptrendProb = (uptrendScore / totalScore) * 70;
                                            const downtrendProb = (downtrendScore / totalScore) * 70;
                                            return Math.round(100 - uptrendProb - downtrendProb);
                                          })()}%
                                        </span>
                                      </div>
                                      <div className="w-full bg-slate-700 rounded-full h-2">
                                        <div
                                          className="bg-slate-500 h-2 rounded-full transition-all duration-500"
                                          style={{
                                            width: `${(() => {
                                              const indicators = result.result?.indicators || {};
                                              const price = result.result?.raw?.marketData?.price || 0;

                                              let uptrendScore = 0;
                                              let downtrendScore = 0;
                                              let totalIndicators = 0;

                                              if (indicators.macd?.value !== undefined) {
                                                totalIndicators++;
                                                if (indicators.macd.value > 0) uptrendScore++;
                                                else if (indicators.macd.value < 0) downtrendScore++;
                                              }

                                              if (indicators.rsi?.value !== undefined) {
                                                totalIndicators++;
                                                if (indicators.rsi.value < 30) uptrendScore++;
                                                else if (indicators.rsi.value > 70) downtrendScore++;
                                              }

                                              if (indicators.ema20?.value && indicators.ma50?.value && indicators.ma200?.value) {
                                                totalIndicators++;
                                                const maAlignment = (price > indicators.ema20.value ? 1 : 0) +
                                                  (indicators.ema20.value > indicators.ma50.value ? 1 : 0) +
                                                  (indicators.ma50.value > indicators.ma200.value ? 1 : 0);

                                                if (maAlignment >= 2) uptrendScore++;
                                                else if (maAlignment <= 1) downtrendScore++;
                                              }

                                              if (indicators.volume?.score !== undefined) {
                                                totalIndicators++;
                                                if (indicators.volume.score > 60) uptrendScore++;
                                                else if (indicators.volume.score < 40) downtrendScore++;
                                              }

                                              if (indicators.momentum?.direction) {
                                                totalIndicators++;
                                                if (indicators.momentum.direction.toLowerCase() === 'bullish') uptrendScore++;
                                                else if (indicators.momentum.direction.toLowerCase() === 'bearish') downtrendScore++;
                                              }

                                              const totalScore = uptrendScore + downtrendScore;
                                              if (totalScore === 0) return '100';

                                              const uptrendProb = (uptrendScore / totalScore) * 70;
                                              const downtrendProb = (downtrendScore / totalScore) * 70;
                                              return 100 - uptrendProb - downtrendProb;
                                            })()}%`
                                          }}
                                        ></div>
                                      </div>
                                    </div>
                                  </>
                                )}
                            </div>
                          </div>
                        </div>

                        {/* PRICE ACTION SNAPSHOT */}
                        <div className="relative bg-gradient-to-br from-slate-900/90 via-slate-800/90 to-slate-900/90 backdrop-blur-xl border border-slate-700/50 rounded-2xl p-6 shadow-2xl shadow-slate-900/50 overflow-hidden">
                          <div className="absolute inset-0 bg-gradient-to-br from-orange-500/5 via-amber-500/5 to-yellow-500/5"></div>
                          <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-orange-500 via-amber-500 to-yellow-500"></div>

                          <div className="relative">
                            <div className="flex items-center justify-between mb-6">
                              <h3 className="text-xl font-bold text-white flex items-center gap-2">
                                <svg className="w-5 h-5 text-orange-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                                </svg>
                                Price Action Snapshot
                              </h3>
                              <div className="text-right">
                                <div className="text-sm text-slate-400">Current Price</div>
                                <div className="text-lg font-bold text-white">
                                  ${result.result?.raw?.marketData?.price ? result.result.raw.marketData.price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : 'N/A'}
                                </div>
                              </div>
                            </div>

                            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                              {/* Price vs MA20 */}
                              <div className="bg-slate-800/50 backdrop-blur-sm border border-slate-600/30 rounded-xl p-4 text-center">
                                <div className="text-sm text-slate-400 mb-2">vs EMA20</div>
                                <div className={`text-lg font-bold flex items-center justify-center gap-1 ${(() => {
                                  const price = result.result?.raw?.marketData?.price || 0;
                                  const ema20 = result.result?.indicators?.ema20?.value || 0;
                                  return price > ema20 ? 'text-green-400' : 'text-red-400';
                                })()
                                  }`}>
                                  {(() => {
                                    const price = result.result?.raw?.marketData?.price || 0;
                                    const ema20 = result.result?.indicators?.ema20?.value || 0;
                                    if (price > ema20) {
                                      return (
                                        <>
                                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 10l7-7m0 0l7 7m-7-7v18" />
                                          </svg>
                                          Above
                                        </>
                                      );
                                    } else {
                                      return (
                                        <>
                                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
                                          </svg>
                                          Below
                                        </>
                                      );
                                    }
                                  })()}
                                </div>
                              </div>

                              {/* Price vs MA50 */}
                              <div className="bg-slate-800/50 backdrop-blur-sm border border-slate-600/30 rounded-xl p-4 text-center">
                                <div className="text-sm text-slate-400 mb-2">vs SMA50</div>
                                <div className={`text-lg font-bold flex items-center justify-center gap-1 ${(() => {
                                  const price = result.result?.raw?.marketData?.price || 0;
                                  const ma50 = result.result?.indicators?.ma50?.value || 0;
                                  return price > ma50 ? 'text-green-400' : 'text-red-400';
                                })()
                                  }`}>
                                  {(() => {
                                    const price = result.result?.raw?.marketData?.price || 0;
                                    const ma50 = result.result?.indicators?.ma50?.value || 0;
                                    if (price > ma50) {
                                      return (
                                        <>
                                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 10l7-7m0 0l7 7m-7-7v18" />
                                          </svg>
                                          Above
                                        </>
                                      );
                                    } else {
                                      return (
                                        <>
                                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
                                          </svg>
                                          Below
                                        </>
                                      );
                                    }
                                  })()}
                                </div>
                              </div>

                              {/* Price vs MA200 */}
                              <div className="bg-slate-800/50 backdrop-blur-sm border border-slate-600/30 rounded-xl p-4 text-center">
                                <div className="text-sm text-slate-400 mb-2">vs SMA200</div>
                                <div className={`text-lg font-bold flex items-center justify-center gap-1 ${(() => {
                                  const price = result.result?.raw?.marketData?.price || 0;
                                  const ma200 = result.result?.indicators?.ma200?.value || 0;
                                  return price > ma200 ? 'text-green-400' : 'text-red-400';
                                })()
                                  }`}>
                                  {(() => {
                                    const price = result.result?.raw?.marketData?.price || 0;
                                    const ma200 = result.result?.indicators?.ma200?.value || 0;
                                    if (price > ma200) {
                                      return (
                                        <>
                                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 10l7-7m0 0l7 7m-7-7v18" />
                                          </svg>
                                          Above
                                        </>
                                      );
                                    } else {
                                      return (
                                        <>
                                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
                                          </svg>
                                          Below
                                        </>
                                      );
                                    }
                                  })()}
                                </div>
                              </div>

                              {/* Momentum State */}
                              <div className="bg-slate-800/50 backdrop-blur-sm border border-slate-600/30 rounded-xl p-4 text-center">
                                <div className="text-sm text-slate-400 mb-2">Momentum</div>
                                <div className={`text-lg font-bold ${(() => {
                                  const momentum = result.result?.indicators?.momentum?.direction || 'neutral';
                                  if (momentum.toLowerCase() === 'bullish') return 'text-green-400';
                                  else if (momentum.toLowerCase() === 'bearish') return 'text-red-400';
                                  else return 'text-slate-400';
                                })()
                                  }`}>
                                  {result.result?.indicators?.momentum?.direction || 'Neutral'}
                                </div>
                              </div>

                              {/* Volume Trend */}
                              <div className="bg-slate-800/50 backdrop-blur-sm border border-slate-600/30 rounded-xl p-4 text-center">
                                <div className="text-sm text-slate-400 mb-2">Volume</div>
                                <div className={`text-lg font-bold ${(() => {
                                  const volumeScore = result.result?.indicators?.volume?.score || 0;
                                  if (volumeScore > 60) return 'text-green-400';
                                  else if (volumeScore < 40) return 'text-red-400';
                                  else return 'text-yellow-400';
                                })()
                                  }`}>
                                  {(() => {
                                    const volumeScore = result.result?.indicators?.volume?.score || 0;
                                    if (volumeScore > 60) return 'High';
                                    else if (volumeScore < 40) return 'Low';
                                    else return 'Moderate';
                                  })()}
                                </div>
                              </div>

                              {/* Volatility Level */}
                              <div className="bg-slate-800/50 backdrop-blur-sm border border-slate-600/30 rounded-xl p-4 text-center">
                                <div className="text-sm text-slate-400 mb-2">Volatility</div>
                                <div className={`text-lg font-bold ${(() => {
                                  const atrClass = result.result?.indicators?.atr?.classification || 'moderate';
                                  if (atrClass.toLowerCase() === 'high') return 'text-red-400';
                                  else if (atrClass.toLowerCase() === 'low') return 'text-green-400';
                                  else return 'text-yellow-400';
                                })()
                                  }`}>
                                  {result.result?.indicators?.atr?.classification || 'Moderate'}
                                </div>
                              </div>

                              {/* MACD Signal */}
                              <div className="bg-slate-800/50 backdrop-blur-sm border border-slate-600/30 rounded-xl p-4 text-center">
                                <div className="text-sm text-slate-400 mb-2">MACD</div>
                                <div className={`text-lg font-bold ${(() => {
                                  const macdValue = result.result?.indicators?.macd?.value || 0;
                                  return macdValue > 0 ? 'text-green-400' : 'text-red-400';
                                })()
                                  }`}>
                                  {(() => {
                                    const macdValue = result.result?.indicators?.macd?.value || 0;
                                    return macdValue > 0 ? 'Bullish' : 'Bearish';
                                  })()}
                                </div>
                              </div>

                              {/* RSI Status */}
                              <div className="bg-slate-800/50 backdrop-blur-sm border border-slate-600/30 rounded-xl p-4 text-center">
                                <div className="text-sm text-slate-400 mb-2">RSI Status</div>
                                <div className={`text-lg font-bold ${(() => {
                                  const rsiValue = result.result?.indicators?.rsi?.value || 50;
                                  if (rsiValue > 70) return 'text-red-400';
                                  else if (rsiValue < 30) return 'text-green-400';
                                  else return 'text-slate-400';
                                })()
                                  }`}>
                                  {(() => {
                                    const rsiValue = result.result?.indicators?.rsi?.value || 50;
                                    if (rsiValue > 70) return 'Overbought';
                                    else if (rsiValue < 30) return 'Oversold';
                                    else return 'Neutral';
                                  })()}
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>

                        {/* NEWS IMPACT SUMMARY */}
                        {result.news?.articles && result.news.articles.length > 0 && (
                          <div className="relative bg-gradient-to-br from-slate-900/90 via-slate-800/90 to-slate-900/90 backdrop-blur-xl border border-slate-700/50 rounded-2xl p-6 shadow-2xl shadow-slate-900/50 overflow-hidden">
                            <div className="absolute inset-0 bg-gradient-to-br from-teal-500/5 via-cyan-500/5 to-blue-500/5"></div>
                            <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-teal-500 via-cyan-500 to-blue-500"></div>

                            <div className="relative">
                              <div className="flex items-center justify-between mb-6">
                                <h3 className="text-xl font-bold text-white flex items-center gap-2">
                                  <svg className="w-5 h-5 text-teal-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v1m2 13a2 2 0 01-2-2V7m2 13a2 2 0 002-2V9a2 2 0 00-2-2h-2m-4-3H9M7 16h6M7 8h6v4H7V8z" />
                                  </svg>
                                  News Impact Summary
                                </h3>
                                <div className={`px-4 py-2 rounded-full text-sm font-semibold ${(() => {
                                  const articles = result.news.articles;
                                  const positive = articles.filter((a: any) => a.sentiment === 'positive').length;
                                  const negative = articles.filter((a: any) => a.sentiment === 'negative').length;
                                  const total = articles.length;

                                  if (total === 0) return 'bg-slate-500/20 text-slate-400';

                                  const score = (positive - negative) / total;
                                  if (score > 0.2) return 'bg-green-500/20 text-green-400 border border-green-500/30';
                                  else if (score < -0.2) return 'bg-red-500/20 text-red-400 border border-red-500/30';
                                  else return 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30';
                                })()
                                  }`}>
                                  {(() => {
                                    const articles = result.news.articles;
                                    const positive = articles.filter((a: any) => a.sentiment === 'positive').length;
                                    const negative = articles.filter((a: any) => a.sentiment === 'negative').length;
                                    const total = articles.length;

                                    if (total === 0) return 'Neutral Impact';

                                    const score = (positive - negative) / total;
                                    if (score > 0.2) return 'Bullish Impact';
                                    else if (score < -0.2) return 'Bearish Impact';
                                    else return 'Neutral Impact';
                                  })()}
                                </div>
                              </div>

                              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                                {/* Impact Analysis */}
                                <div className="bg-slate-800/50 backdrop-blur-sm border border-slate-600/30 rounded-xl p-4">
                                  <div className="text-sm text-slate-400 mb-3">Sentiment Analysis</div>
                                  <div className="space-y-3">
                                    <div className="flex items-center justify-between">
                                      <span className="text-sm text-slate-300">Overall Sentiment</span>
                                      <span className={`text-sm font-semibold ${(() => {
                                        const articles = result.news.articles;
                                        const positive = articles.filter((a: any) => a.sentiment === 'positive').length;
                                        const negative = articles.filter((a: any) => a.sentiment === 'negative').length;
                                        const total = articles.length;

                                        if (total === 0) return 'text-slate-400';

                                        const score = (positive - negative) / total;
                                        if (score > 0.2) return 'text-green-400';
                                        else if (score < -0.2) return 'text-red-400';
                                        else return 'text-yellow-400';
                                      })()
                                        }`}>
                                        {(() => {
                                          const articles = result.news.articles;
                                          const positive = articles.filter((a: any) => a.sentiment === 'positive').length;
                                          const negative = articles.filter((a: any) => a.sentiment === 'negative').length;
                                          const total = articles.length;

                                          if (total === 0) return 'Neutral';

                                          const score = (positive - negative) / total;
                                          if (score > 0.3) return 'Strongly Positive';
                                          else if (score > 0.1) return 'Moderately Positive';
                                          else if (score < -0.3) return 'Strongly Negative';
                                          else if (score < -0.1) return 'Moderately Negative';
                                          else return 'Neutral';
                                        })()}
                                      </span>
                                    </div>
                                    <div className="flex items-center justify-between">
                                      <span className="text-sm text-slate-300">Articles Count</span>
                                      <span className="text-sm font-semibold text-white">{result.news.articles.length}</span>
                                    </div>
                                    <div className="flex items-center justify-between">
                                      <span className="text-sm text-slate-300">Positive Articles</span>
                                      <span className="text-sm font-semibold text-green-400">
                                        {result.news.articles.filter((a: any) => a.sentiment === 'positive').length}
                                      </span>
                                    </div>
                                    <div className="flex items-center justify-between">
                                      <span className="text-sm text-slate-300">Negative Articles</span>
                                      <span className="text-sm font-semibold text-red-400">
                                        {result.news.articles.filter((a: any) => a.sentiment === 'negative').length}
                                      </span>
                                    </div>
                                  </div>
                                </div>

                                {/* Top Headlines */}
                                <div className="bg-slate-800/50 backdrop-blur-sm border border-slate-600/30 rounded-xl p-4">
                                  <div className="text-sm text-slate-400 mb-3">Recent Headlines</div>
                                  <div className="space-y-3">
                                    {result.news.articles.slice(0, 3).map((article: any, index: number) => (
                                      <div key={index} className="flex items-start gap-3">
                                        <span className={`flex-shrink-0 w-2 h-2 rounded-full mt-2 ${article.sentiment === 'positive' ? 'bg-green-400' :
                                          article.sentiment === 'negative' ? 'bg-red-400' : 'bg-slate-400'
                                          }`}></span>
                                        <div className="flex-1 min-w-0">
                                          <p className="text-sm text-white line-clamp-2 leading-tight">
                                            {article.title}
                                          </p>
                                          <div className="flex items-center gap-2 mt-1">
                                            <span className="text-xs text-slate-400">{article.source}</span>
                                            <span className={`text-xs px-2 py-0.5 rounded ${article.sentiment === 'positive' ? 'bg-green-500/20 text-green-400' :
                                              article.sentiment === 'negative' ? 'bg-red-500/20 text-red-400' :
                                                'bg-slate-500/20 text-slate-400'
                                              }`}>
                                              {article.sentiment}
                                            </span>
                                          </div>
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              </div>
                            </div>
                          </div>
                        )}

                        {/* MARKET REGIME CARD */}
                        <div className="relative bg-gradient-to-br from-slate-900/90 via-slate-800/90 to-slate-900/90 backdrop-blur-xl border border-slate-700/50 rounded-2xl p-4 sm:p-6 shadow-2xl shadow-slate-900/50 overflow-hidden">
                          <div className="absolute inset-0 bg-gradient-to-br from-indigo-500/5 via-blue-500/5 to-purple-500/5"></div>
                          <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-indigo-500 via-blue-500 to-purple-500"></div>

                          <div className="relative">
                            <h3 className="text-xl font-bold text-white mb-6 flex items-center gap-2">
                              <svg className="w-5 h-5 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 12l3-3 3 3 4-4M8 21l4-4 4 4M3 4h18M4 4h16v12a1 1 0 01-1 1H5a1 1 0 01-1-1V4z" />
                              </svg>
                              Market Regime
                            </h3>

                            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                              {/* Trend 1h */}
                              <div className="bg-slate-800/50 backdrop-blur-sm border border-slate-600/30 rounded-xl p-4">
                                <div className="text-sm text-slate-400 mb-2">Trend 1h</div>
                                <div className={`text-lg font-bold ${(() => {
                                  // Derive from short-term indicators like EMA20 vs price
                                  const indicators = result.result?.indicators || {};
                                  const price = result.result?.raw?.marketData?.price || 0;
                                  if (indicators.ema20?.value) {
                                    return price > indicators.ema20.value ? 'text-green-400' : 'text-red-400';
                                  }
                                  return 'text-slate-400';
                                })()
                                  }`}>
                                  {(() => {
                                    const indicators = result.result?.indicators || {};
                                    const price = result.result?.raw?.marketData?.price || 0;
                                    if (indicators.ema20?.value) {
                                      return price > indicators.ema20.value ? 'Bullish' : 'Bearish';
                                    }
                                    return 'Neutral';
                                  })()}
                                </div>
                              </div>

                              {/* Trend 1d */}
                              <div className="bg-slate-800/50 backdrop-blur-sm border border-slate-600/30 rounded-xl p-4">
                                <div className="text-sm text-slate-400 mb-2">Trend 1d</div>
                                <div className={`text-lg font-bold ${(() => {
                                  // Derive from daily indicators like MA50 vs price
                                  const indicators = result.result?.indicators || {};
                                  const price = result.result?.raw?.marketData?.price || 0;
                                  if (indicators.ma50?.value) {
                                    return price > indicators.ma50.value ? 'text-green-400' : 'text-red-400';
                                  }
                                  return 'text-slate-400';
                                })()
                                  }`}>
                                  {(() => {
                                    const indicators = result.result?.indicators || {};
                                    const price = result.result?.raw?.marketData?.price || 0;
                                    if (indicators.ma50?.value) {
                                      return price > indicators.ma50.value ? 'Bullish' : 'Bearish';
                                    }
                                    return 'Neutral';
                                  })()}
                                </div>
                              </div>

                              {/* Confirmation Signal */}
                              <div className="bg-slate-800/50 backdrop-blur-sm border border-slate-600/30 rounded-xl p-4">
                                <div className="text-sm text-slate-400 mb-2">Confirmation Signal</div>
                                <div className={`text-lg font-bold ${result.result?.signal === 'BUY' ? 'text-green-400' :
                                  result.result?.signal === 'SELL' ? 'text-red-400' :
                                    'text-slate-400'
                                  }`}>
                                  {result.result?.signal || 'HOLD'}
                                </div>
                              </div>

                              {/* Overall Regime */}
                              <div className="bg-slate-800/50 backdrop-blur-sm border border-slate-600/30 rounded-xl p-4">
                                <div className="text-sm text-slate-400 mb-2">Overall Regime</div>
                                <div className={`text-lg font-bold ${(() => {
                                  const indicators = result.result?.indicators || {};
                                  let bullishCount = 0;
                                  let bearishCount = 0;
                                  const price = result.result?.raw?.marketData?.price || 0;

                                  // Check multiple indicators
                                  if (indicators.macd?.value > 0) bullishCount++; else if (indicators.macd?.value < 0) bearishCount++;
                                  if (indicators.rsi?.value && indicators.rsi.value < 30) bullishCount++; else if (indicators.rsi?.value && indicators.rsi.value > 70) bearishCount++;
                                  if (indicators.ema20?.value && price > indicators.ema20.value) bullishCount++; else if (indicators.ema20?.value && price < indicators.ema20.value) bearishCount++;
                                  if (indicators.ma50?.value && price > indicators.ma50.value) bullishCount++; else if (indicators.ma50?.value && price < indicators.ma50.value) bearishCount++;
                                  if (indicators.volume?.score && indicators.volume.score > 60) bullishCount++; else if (indicators.volume?.score && indicators.volume.score < 40) bearishCount++;

                                  const total = bullishCount + bearishCount;
                                  if (total === 0) return 'text-slate-400';

                                  const bullishRatio = bullishCount / total;

                                  if (bullishRatio >= 0.8) return 'text-green-400';
                                  else if (bullishRatio >= 0.6) return 'text-emerald-400';
                                  else if (bullishRatio <= 0.2) return 'text-red-400';
                                  else if (bullishRatio <= 0.4) return 'text-red-300';
                                  else return 'text-slate-400';
                                })()
                                  }`}>
                                  {(() => {
                                    const indicators = result.result?.indicators || {};
                                    let bullishCount = 0;
                                    let bearishCount = 0;
                                    const price = result.result?.raw?.marketData?.price || 0;

                                    if (indicators.macd?.value > 0) bullishCount++; else if (indicators.macd?.value < 0) bearishCount++;
                                    if (indicators.rsi?.value && indicators.rsi.value < 30) bullishCount++; else if (indicators.rsi?.value && indicators.rsi.value > 70) bearishCount++;
                                    if (indicators.ema20?.value && price > indicators.ema20.value) bullishCount++; else if (indicators.ema20?.value && price < indicators.ema20.value) bearishCount++;
                                    if (indicators.ma50?.value && price > indicators.ma50.value) bullishCount++; else if (indicators.ma50?.value && price < indicators.ma50.value) bearishCount++;
                                    if (indicators.volume?.score && indicators.volume.score > 60) bullishCount++; else if (indicators.volume?.score && indicators.volume.score < 40) bearishCount++;

                                    const total = bullishCount + bearishCount;
                                    if (total === 0) return 'Neutral';

                                    const bullishRatio = bullishCount / total;

                                    if (bullishRatio >= 0.8) return 'Strong Bullish';
                                    else if (bullishRatio >= 0.6) return 'Weak Bullish';
                                    else if (bullishRatio <= 0.2) return 'Strong Bearish';
                                    else if (bullishRatio <= 0.4) return 'Weak Bearish';
                                    else return 'Neutral';
                                  })()}
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>

                        {/* NEWS SECTION */}
                        {result.news?.articles && result.news.articles.length > 0 && (
                          <div className="relative bg-gradient-to-br from-slate-900/90 via-slate-800/90 to-slate-900/90 backdrop-blur-xl border border-slate-700/50 rounded-2xl p-4 sm:p-6 shadow-2xl shadow-slate-900/50 overflow-hidden">
                            <div className="absolute inset-0 bg-gradient-to-br from-green-500/5 via-emerald-500/5 to-teal-500/5"></div>
                            <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-green-500 via-emerald-500 to-teal-500"></div>

                            <div className="relative">
                              <div className="flex items-center justify-between mb-6">
                                <h3 className="text-xl font-bold text-white flex items-center gap-2">
                                  <svg className="w-5 h-5 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v1m2 13a2 2 0 01-2-2V7m2 13a2 2 0 002-2V9a2 2 0 00-2-2h-2m-4-3H9M7 16h6M7 8h6v4H7V8z" />
                                  </svg>
                                  News Feed
                                </h3>
                                <div className="text-right">
                                  <div className="text-sm text-slate-400">{result.news.articles.length} Articles</div>
                                  <div className="text-xs text-green-400">Latest Updates</div>
                                </div>
                              </div>

                              <div className="space-y-3">
                                {result.news.articles.map((article: any, index: number) => (
                                  <div
                                    key={index}
                                    onClick={() => window.open(article.url, '_blank')}
                                    className="bg-slate-800/50 backdrop-blur-sm border border-slate-600/30 rounded-xl p-4 hover:bg-slate-800/70 hover:border-slate-500/50 transition-all duration-200 cursor-pointer group"
                                  >
                                    <div className="flex items-start gap-4">
                                      {/* Sentiment Badge */}
                                      <div className="flex-shrink-0 mt-1">
                                        <span className={`px-2 py-1 rounded-full text-xs font-semibold ${article.sentiment === 'positive' ? 'bg-green-500/20 text-green-400 border border-green-500/30' :
                                          article.sentiment === 'negative' ? 'bg-red-500/20 text-red-400 border border-red-500/30' :
                                            'bg-slate-500/20 text-slate-400 border border-slate-500/30'
                                          }`}>
                                          {article.sentiment === 'positive' ? 'Bullish' :
                                            article.sentiment === 'negative' ? 'Bearish' : 'Neutral'}
                                        </span>
                                      </div>

                                      {/* Article Content */}
                                      <div className="flex-1 min-w-0">
                                        <h4 className="text-white font-medium line-clamp-2 mb-2 group-hover:text-blue-400 transition-colors">
                                          {article.title}
                                        </h4>

                                        <div className="flex items-center justify-between text-sm text-slate-400">
                                          <div className="flex items-center gap-3">
                                            <span className="flex items-center gap-1">
                                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v1m2 13a2 2 0 01-2-2V7m2 13a2 2 0 002-2V9a2 2 0 00-2-2h-2m-4-3H9M7 16h6M7 8h6v4H7V8z" />
                                              </svg>
                                              {article.source}
                                            </span>
                                            <span className="flex items-center gap-1">
                                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                                              </svg>
                                              {article.publishedAt ? new Date(article.publishedAt).toLocaleDateString('en-US', {
                                                month: 'short',
                                                day: 'numeric'
                                              }) : 'Recent'}
                                            </span>
                                          </div>

                                          <div className="opacity-0 group-hover:opacity-100 transition-opacity">
                                            <svg className="w-4 h-4 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                                            </svg>
                                          </div>
                                        </div>
                                      </div>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          </div>
                        )}

                        {/* RISK ASSESSMENT CARD */}
                        <div className="relative bg-gradient-to-br from-slate-900/90 via-slate-800/90 to-slate-900/90 backdrop-blur-xl border border-slate-700/50 rounded-2xl p-4 sm:p-6 shadow-2xl shadow-slate-900/50 overflow-hidden">
                          <div className="absolute inset-0 bg-gradient-to-br from-amber-500/5 via-yellow-500/5 to-orange-500/5"></div>
                          <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-amber-500 via-yellow-500 to-orange-500"></div>

                          <div className="relative">
                            <h3 className="text-xl font-bold text-white mb-6 flex items-center gap-2">
                              <svg className="w-5 h-5 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z" />
                              </svg>
                              Risk Assessment
                            </h3>

                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                              {/* Risk Level */}
                              <div className="bg-slate-800/50 backdrop-blur-sm border border-slate-600/30 rounded-xl p-4">
                                <div className="text-sm text-slate-400 mb-2">Risk Level</div>
                                <div className={`text-2xl font-bold mb-3 ${(() => {
                                  const indicators = result.result?.indicators || {};
                                  let riskFactors = 0;
                                  let totalFactors = 0;

                                  // ATR classification (High = High risk)
                                  if (indicators.atr?.classification?.toLowerCase() === 'high') riskFactors += 2;
                                  else if (indicators.atr?.classification?.toLowerCase() === 'moderate') riskFactors += 1;
                                  if (indicators.atr) totalFactors += 2;

                                  // Volume (Low volume = High risk)
                                  if (indicators.volume?.score && indicators.volume.score < 40) riskFactors += 2;
                                  else if (indicators.volume?.score && indicators.volume.score < 60) riskFactors += 1;
                                  if (indicators.volume) totalFactors += 2;

                                  // Momentum (Bearish = Higher risk)
                                  if (indicators.momentum?.direction?.toLowerCase() === 'bearish') riskFactors += 1;
                                  if (indicators.momentum) totalFactors += 1;

                                  // MACD (Bearish signal = Higher risk)
                                  if (indicators.macd?.value < 0) riskFactors += 1;
                                  if (indicators.macd) totalFactors += 1;

                                  const riskScore = totalFactors > 0 ? (riskFactors / totalFactors) * 100 : 0;

                                  if (riskScore >= 70) return 'text-red-400';
                                  else if (riskScore >= 40) return 'text-yellow-400';
                                  else return 'text-green-400';
                                })()
                                  }`}>
                                  {(() => {
                                    const indicators = result.result?.indicators || {};
                                    let riskFactors = 0;
                                    let totalFactors = 0;

                                    if (indicators.atr?.classification?.toLowerCase() === 'high') riskFactors += 2;
                                    else if (indicators.atr?.classification?.toLowerCase() === 'moderate') riskFactors += 1;
                                    if (indicators.atr) totalFactors += 2;

                                    if (indicators.volume?.score && indicators.volume.score < 40) riskFactors += 2;
                                    else if (indicators.volume?.score && indicators.volume.score < 60) riskFactors += 1;
                                    if (indicators.volume) totalFactors += 2;

                                    if (indicators.momentum?.direction?.toLowerCase() === 'bearish') riskFactors += 1;
                                    if (indicators.momentum) totalFactors += 1;

                                    if (indicators.macd?.value < 0) riskFactors += 1;
                                    if (indicators.macd) totalFactors += 1;

                                    const riskScore = totalFactors > 0 ? (riskFactors / totalFactors) * 100 : 0;

                                    if (riskScore >= 70) return 'High';
                                    else if (riskScore >= 40) return 'Medium';
                                    else return 'Low';
                                  })()}
                                </div>
                                <div className="text-sm text-slate-400">
                                  Based on volatility, volume, and momentum indicators
                                </div>
                              </div>

                              {/* Risk Factors */}
                              <div className="bg-slate-800/50 backdrop-blur-sm border border-slate-600/30 rounded-xl p-4">
                                <div className="text-sm text-slate-400 mb-3">Risk Factors</div>
                                <div className="space-y-2">
                                  {(() => {
                                    const indicators = result.result?.indicators || {};
                                    const factors = [];

                                    if (indicators.atr?.classification) {
                                      factors.push({
                                        text: `Volatility: ${indicators.atr.classification}`,
                                        color: indicators.atr.classification.toLowerCase() === 'high' ? 'text-red-400' :
                                          indicators.atr.classification.toLowerCase() === 'moderate' ? 'text-yellow-400' : 'text-green-400'
                                      });
                                    }

                                    if (indicators.volume?.score !== undefined) {
                                      const volText = indicators.volume.score < 40 ? 'Low Volume' :
                                        indicators.volume.score < 60 ? 'Moderate Volume' : 'High Volume';
                                      factors.push({
                                        text: volText,
                                        color: indicators.volume.score < 40 ? 'text-red-400' :
                                          indicators.volume.score < 60 ? 'text-yellow-400' : 'text-green-400'
                                      });
                                    }

                                    if (indicators.momentum?.direction) {
                                      factors.push({
                                        text: `Momentum: ${indicators.momentum.direction}`,
                                        color: indicators.momentum.direction.toLowerCase() === 'bullish' ? 'text-green-400' :
                                          indicators.momentum.direction.toLowerCase() === 'bearish' ? 'text-red-400' : 'text-slate-400'
                                      });
                                    }

                                    if (indicators.macd?.value !== undefined) {
                                      const macdSignal = indicators.macd.value > 0 ? 'Bullish' : 'Bearish';
                                      factors.push({
                                        text: `MACD: ${macdSignal}`,
                                        color: indicators.macd.value > 0 ? 'text-green-400' : 'text-red-400'
                                      });
                                    }

                                    return factors.slice(0, 4).map((factor, idx) => (
                                      <div key={idx} className="flex items-center gap-2">
                                        <span className="w-2 h-2 bg-slate-500 rounded-full"></span>
                                        <span className={`text-sm ${factor.color}`}>{factor.text}</span>
                                      </div>
                                    ));
                                  })()}
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>

                        {/* PROVIDER STATUS */}
                        <div className="w-full bg-gradient-to-br from-slate-900/60 to-slate-800/40 rounded-2xl p-3 sm:p-4 md:p-5 shadow-xl overflow-hidden">
                          <h3 className="text-lg font-semibold text-white mb-4">Provider Status</h3>
                          <div className="space-y-2">
                            <div className="flex items-center justify-between py-2">
                              <span className="text-slate-300">Market Data</span>
                              <span className={`text-sm font-medium ${result.result?.providers?.marketData?.success ? 'text-green-400' : 'text-red-400'}`}>
                                {result.result?.providers?.marketData?.success ? 'Success' : 'Failed'}
                              </span>
                            </div>
                            <div className="flex items-center justify-between py-2">
                              <span className="text-slate-300">Metadata</span>
                              <span className={`text-sm font-medium ${result.result?.providers?.metadata?.success ? 'text-green-400' : 'text-red-400'}`}>
                                {result.result?.providers?.metadata?.success ? 'Success' : 'Failed'}
                              </span>
                            </div>
                            <div className="flex items-center justify-between py-2">
                              <span className="text-slate-300">News</span>
                              <span className={`text-sm font-medium ${result.result?.providers?.news?.success ? 'text-green-400' : 'text-red-400'}`}>
                                {result.result?.providers?.news?.success ? 'Success' : 'Failed'}
                              </span>
                            </div>
                          </div>
                        </div>

                        {/* NEWS SENTIMENT BREAKDOWN */}
                        {result.news?.articles && result.news.articles.length > 0 && (
                          <div className="relative bg-gradient-to-br from-slate-900/90 via-slate-800/90 to-slate-900/90 backdrop-blur-xl border border-slate-700/50 rounded-2xl p-4 sm:p-6 shadow-2xl shadow-slate-900/50 overflow-hidden">
                            <div className="absolute inset-0 bg-gradient-to-br from-cyan-500/5 via-blue-500/5 to-indigo-500/5"></div>
                            <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-cyan-500 via-blue-500 to-indigo-500"></div>

                            <div className="relative">
                              <h3 className="text-xl font-bold text-white mb-6 flex items-center gap-2">
                                <svg className="w-5 h-5 text-cyan-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                </svg>
                                News Sentiment Analysis
                              </h3>

                              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                                {/* Sentiment Counts */}
                                <div className="bg-slate-800/50 backdrop-blur-sm border border-slate-600/30 rounded-xl p-4">
                                  <div className="text-sm text-slate-400 mb-3">Article Sentiment Distribution</div>
                                  <div className="space-y-3">
                                    <div className="flex items-center justify-between">
                                      <div className="flex items-center gap-2">
                                        <div className="w-3 h-3 bg-green-500 rounded-full"></div>
                                        <span className="text-sm text-slate-300">Positive</span>
                                      </div>
                                      <span className="text-lg font-bold text-green-400">
                                        {result.news.articles.filter((article: any) => article.sentiment === 'positive').length}
                                      </span>
                                    </div>
                                    <div className="flex items-center justify-between">
                                      <div className="flex items-center gap-2">
                                        <div className="w-3 h-3 bg-slate-500 rounded-full"></div>
                                        <span className="text-sm text-slate-300">Neutral</span>
                                      </div>
                                      <span className="text-lg font-bold text-slate-400">
                                        {result.news.articles.filter((article: any) => article.sentiment === 'neutral').length}
                                      </span>
                                    </div>
                                    <div className="flex items-center justify-between">
                                      <div className="flex items-center gap-2">
                                        <div className="w-3 h-3 bg-red-500 rounded-full"></div>
                                        <span className="text-sm text-slate-300">Negative</span>
                                      </div>
                                      <span className="text-lg font-bold text-red-400">
                                        {result.news.articles.filter((article: any) => article.sentiment === 'negative').length}
                                      </span>
                                    </div>
                                  </div>
                                </div>

                                {/* Overall Sentiment Score */}
                                <div className="bg-slate-800/50 backdrop-blur-sm border border-slate-600/30 rounded-xl p-4">
                                  <div className="text-sm text-slate-400 mb-3">Overall Sentiment Score</div>
                                  <div className={`text-3xl font-bold mb-2 ${(() => {
                                    const articles = result.news.articles;
                                    const positive = articles.filter((a: any) => a.sentiment === 'positive').length;
                                    const negative = articles.filter((a: any) => a.sentiment === 'negative').length;
                                    const total = articles.length;

                                    if (total === 0) return 'text-slate-400';

                                    const score = (positive - negative) / total; // Range: -1 to 1

                                    if (score > 0.2) return 'text-green-400';
                                    else if (score < -0.2) return 'text-red-400';
                                    else return 'text-yellow-400';
                                  })()
                                    }`}>
                                    {(() => {
                                      const articles = result.news.articles;
                                      const positive = articles.filter((a: any) => a.sentiment === 'positive').length;
                                      const negative = articles.filter((a: any) => a.sentiment === 'negative').length;
                                      const total = articles.length;

                                      if (total === 0) return '0.00';

                                      const score = (positive - negative) / total; // Range: -1 to 1
                                      return score.toFixed(2);
                                    })()}
                                  </div>
                                  <div className="text-sm text-slate-400">
                                    Range: -1.0 (Bearish) to +1.0 (Bullish)
                                  </div>

                                  {/* Sentiment Bar */}
                                  <div className="mt-4">
                                    <div className="w-full bg-slate-700 rounded-full h-2">
                                      <div
                                        className={`h-2 rounded-full ${(() => {
                                          const articles = result.news.articles;
                                          const positive = articles.filter((a: any) => a.sentiment === 'positive').length;
                                          const negative = articles.filter((a: any) => a.sentiment === 'negative').length;
                                          const total = articles.length;

                                          if (total === 0) return 'bg-slate-500';

                                          const score = (positive - negative) / total;
                                          const percentage = ((score + 1) / 2) * 100; // Convert -1..1 to 0..100

                                          return score > 0 ? 'bg-green-500' : score < 0 ? 'bg-red-500' : 'bg-yellow-500';
                                        })()
                                          }`}
                                        style={{
                                          width: `${(() => {
                                            const articles = result.news.articles;
                                            const positive = articles.filter((a: any) => a.sentiment === 'positive').length;
                                            const negative = articles.filter((a: any) => a.sentiment === 'negative').length;
                                            const total = articles.length;

                                            if (total === 0) return '50';

                                            const score = (positive - negative) / total;
                                            return Math.abs(score) * 100; // 0-100% based on strength
                                          })()}%`,
                                          marginLeft: (() => {
                                            const articles = result.news.articles;
                                            const positive = articles.filter((a: any) => a.sentiment === 'positive').length;
                                            const negative = articles.filter((a: any) => a.sentiment === 'negative').length;
                                            const total = articles.length;

                                            if (total === 0) return '0';

                                            const score = (positive - negative) / total;
                                            if (score >= 0) return '0';
                                            return `${Math.abs(score) * 100}%`;
                                          })()
                                        }}
                                      ></div>
                                    </div>
                                    <div className="flex justify-between text-xs text-slate-400 mt-1">
                                      <span>Bearish</span>
                                      <span>Neutral</span>
                                      <span>Bullish</span>
                                    </div>
                                  </div>
                                </div>
                              </div>
                            </div>
                          </div>
                        )}

                        {/* NEWS SUMMARY PANEL */}
                        {result.news?.articles && result.news.articles.length > 0 && (
                          <div className="relative bg-gradient-to-br from-slate-900/90 via-slate-800/90 to-slate-900/90 backdrop-blur-xl border border-slate-700/50 rounded-2xl p-4 sm:p-6 shadow-2xl shadow-slate-900/50 overflow-hidden">
                            <div className="absolute inset-0 bg-gradient-to-br from-green-500/5 via-emerald-500/5 to-teal-500/5"></div>
                            <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-green-500 via-emerald-500 to-teal-500"></div>

                            <div className="relative">
                              <h3 className="text-xl font-bold text-white mb-6 flex items-center gap-2">
                                <svg className="w-5 h-5 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v1m2 13a2 2 0 01-2-2V7m2 13a2 2 0 002-2V9a2 2 0 00-2-2h-2m-4-3H9M7 16h6M7 8h6v4H7V8z" />
                                </svg>
                                Top News Articles
                              </h3>

                              <div className="space-y-4">
                                {result.news.articles.slice(0, 3).map((article: any, index: number) => (
                                  <div key={index} className="bg-slate-800/50 backdrop-blur-sm border border-slate-600/30 rounded-xl p-4 hover:bg-slate-800/70 transition-all duration-200">
                                    <div className="flex items-start gap-4">
                                      {/* Sentiment Badge */}
                                      <div className="flex-shrink-0">
                                        <span className={`px-3 py-1 rounded-full text-sm font-semibold ${article.sentiment === 'positive' ? 'bg-green-500/20 text-green-400 border border-green-500/30' :
                                          article.sentiment === 'negative' ? 'bg-red-500/20 text-red-400 border border-red-500/30' :
                                            'bg-slate-500/20 text-slate-400 border border-slate-500/30'
                                          }`}>
                                          {article.sentiment === 'positive' ? 'Positive' :
                                            article.sentiment === 'negative' ? 'Negative' : 'Neutral'}
                                        </span>
                                      </div>

                                      {/* Article Content */}
                                      <div className="flex-1 min-w-0">
                                        <a
                                          href={article.url}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          className="text-lg font-semibold text-white hover:text-blue-400 transition-colors line-clamp-2 block mb-2"
                                        >
                                          {article.title}
                                        </a>
                                        <div className="flex items-center gap-4 text-sm text-slate-400">
                                          <span className="flex items-center gap-1">
                                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v1m2 13a2 2 0 01-2-2V7m2 13a2 2 0 002-2V9a2 2 0 00-2-2h-2m-4-3H9M7 16h6M7 8h6v4H7V8z" />
                                            </svg>
                                            {article.source}
                                          </span>
                                          <span className="flex items-center gap-1">
                                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                                            </svg>
                                            {article.publishedAt ? new Date(article.publishedAt).toLocaleDateString('en-US', {
                                              month: 'short',
                                              day: 'numeric'
                                            }) : 'Recent'}
                                          </span>
                                        </div>
                                      </div>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          </div>
                        )}

                        {/* AI COMMENTARY BOX */}
                        <div className="relative bg-gradient-to-br from-slate-900/90 via-slate-800/90 to-slate-900/90 backdrop-blur-xl border border-slate-700/50 rounded-2xl p-6 shadow-2xl shadow-slate-900/50 overflow-hidden">
                          <div className="absolute inset-0 bg-gradient-to-br from-indigo-500/5 via-purple-500/5 to-pink-500/5"></div>
                          <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500"></div>

                          <div className="relative">
                            <div className="flex items-center justify-between mb-6">
                              <h3 className="text-xl font-bold text-white flex items-center gap-2">
                                <svg className="w-5 h-5 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-4l-4 4-4-4z" />
                                </svg>
                                AI Market Commentary
                              </h3>
                              <div className="flex items-center gap-2">
                                <div className="w-3 h-3 bg-indigo-400 rounded-full animate-pulse"></div>
                                <span className="text-sm text-slate-300">AI Generated</span>
                              </div>
                            </div>

                            <div className="bg-slate-800/50 backdrop-blur-sm border border-slate-600/30 rounded-xl p-6">
                              <div className="text-slate-300 leading-relaxed">
                                {(() => {
                                  const signal = result.result?.signal;
                                  const indicators = result.result?.indicators || {};
                                  const price = result.result?.raw?.marketData?.price || 0;
                                  const news = result.news?.articles || [];

                                  let commentary = '';

                                  // Price position commentary
                                  const priceVsMA50 = price > (indicators.ma50?.value || 0);
                                  const priceVsMA200 = price > (indicators.ma200?.value || 0);

                                  if (priceVsMA50 && priceVsMA200) {
                                    commentary += `Price is currently trading above both key moving averages (SMA50: $${indicators.ma50?.value?.toFixed(2) || 'N/A'}, SMA200: $${indicators.ma200?.value?.toFixed(2) || 'N/A'}), indicating strong upward momentum. `;
                                  } else if (!priceVsMA200) {
                                    commentary += `Price remains below the 200-day moving average ($${indicators.ma200?.value?.toFixed(2) || 'N/A'}), suggesting a longer-term downtrend despite recent movements. `;
                                  } else {
                                    commentary += `Price shows mixed signals against moving averages, with position above SMA50 but below SMA200. `;
                                  }

                                  // Momentum commentary
                                  if (indicators.momentum?.direction?.toLowerCase() === 'bullish') {
                                    commentary += 'Momentum indicators show bullish strength, supporting upward price movement. ';
                                  } else if (indicators.momentum?.direction?.toLowerCase() === 'bearish') {
                                    commentary += 'Momentum indicators suggest bearish pressure, which may lead to downward movement. ';
                                  } else {
                                    commentary += 'Momentum appears neutral with no clear directional bias. ';
                                  }

                                  // RSI commentary
                                  const rsi = indicators.rsi?.value || 50;
                                  if (rsi > 70) {
                                    commentary += `RSI at ${rsi.toFixed(1)} indicates overbought conditions, suggesting a potential pullback. `;
                                  } else if (rsi < 30) {
                                    commentary += `RSI at ${rsi.toFixed(1)} shows oversold conditions, potentially signaling a bounce. `;
                                  } else {
                                    commentary += `RSI at ${rsi.toFixed(1)} remains in neutral territory. `;
                                  }

                                  // Volume commentary
                                  const volumeScore = indicators.volume?.score || 0;
                                  if (volumeScore > 60) {
                                    commentary += 'High volume confirms the strength of current price movements. ';
                                  } else if (volumeScore < 40) {
                                    commentary += 'Low volume suggests weak conviction in current price action. ';
                                  }

                                  // News sentiment commentary
                                  if (news.length > 0) {
                                    const positive = news.filter((a: any) => a.sentiment === 'positive').length;
                                    const negative = news.filter((a: any) => a.sentiment === 'negative').length;
                                    const score = (positive - negative) / news.length;

                                    if (score > 0.2) {
                                      commentary += 'Market sentiment from recent news appears predominantly positive, which could support upward price movement. ';
                                    } else if (score < -0.2) {
                                      commentary += 'Recent news sentiment is largely negative, potentially creating downward pressure on price. ';
                                    } else {
                                      commentary += 'News sentiment remains mixed and relatively neutral. ';
                                    }
                                  }

                                  // Final recommendation
                                  if (signal === 'BUY') {
                                    commentary += `Overall analysis suggests a BUY signal with ${((result.result?.accuracy || 0) * 100).toFixed(0)}% confidence. `;
                                  } else if (signal === 'SELL') {
                                    commentary += `Overall analysis suggests a SELL signal with ${((result.result?.accuracy || 0) * 100).toFixed(0)}% confidence. `;
                                  } else {
                                    commentary += `Analysis indicates a HOLD position with ${((result.result?.accuracy || 0) * 100).toFixed(0)}% confidence until clearer signals emerge. `;
                                  }

                                  return commentary;
                                })()}
                              </div>
                            </div>
                          </div>
                        </div>

                        {/* RAW DATA TOGGLE */}
                        <div className="relative bg-gradient-to-br from-slate-900/90 via-slate-800/90 to-slate-900/90 backdrop-blur-xl border border-slate-700/50 rounded-2xl p-4 sm:p-6 shadow-2xl shadow-slate-900/50 overflow-hidden">
                          <div className="absolute inset-0 bg-gradient-to-br from-gray-500/5 via-slate-500/5 to-gray-500/5"></div>
                          <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-gray-500 via-slate-500 to-gray-500"></div>

                          <div className="relative">
                            <details className="group">
                              <summary className="flex items-center justify-between cursor-pointer text-sm font-medium text-slate-300 hover:text-white transition-colors" aria-label="Toggle raw data display">
                                <span className="flex items-center gap-2">
                                  <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                                  </svg>
                                  Show Raw Data
                                </span>
                                <svg className="w-4 h-4 transition-transform group-open:rotate-180" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                </svg>
                              </summary>
                              <div className="mt-4 p-4 bg-slate-800/50 rounded-lg border border-slate-600/30 max-h-96 overflow-auto">
                                <pre className="text-xs text-slate-300 whitespace-pre-wrap break-all">
                                  {JSON.stringify({
                                    providers: result.result?.providers,
                                    indicators: result.result?.indicators,
                                    metadata: result.metadata,
                                    news: result.news,
                                    signals: {
                                      signal: result.result?.signal,
                                      accuracy: result.result?.accuracy,
                                      price: result.result?.raw?.marketData?.price
                                    },
                                    raw: result.result?.raw
                                  }, null, 2)}
                                </pre>
                              </div>
                            </details>
                          </div>
                        </div>

                        {/* FREE MODE Analysis v1.5 */}
                        <div className="bg-gradient-to-br from-purple-500/10 to-pink-500/10 rounded-lg p-4 border border-purple-500/30">
                          <h4 className="text-sm font-semibold text-purple-300 mb-2">FREE MODE Analysis v1.5</h4>
                          <div className="text-sm text-gray-200">
                            Analysis completed using CryptoCompare market data, CoinGecko metadata, and NewsData sentiment with comprehensive backup provider support.
                          </div>
                        </div>

                        {result.error && (
                          <div className="mt-4 p-3 bg-red-500/20 border border-red-500/50 rounded-lg">
                            <p className="text-sm text-red-300">Error: {result.error}</p>
                          </div>
                        )}
                      </div>

                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div >

        {/* Deep Research Section */}
        <section className="mb-16">
          <div className="relative">
            {/* Background gradient card */}
            <div className="absolute inset-0 bg-gradient-to-r from-slate-900/40 via-slate-800/40 to-slate-900/40 backdrop-blur-xl rounded-3xl border border-slate-700/50 shadow-2xl shadow-slate-900/30"></div>

            {/* Gradient accent lines */}
            <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-purple-500 via-cyan-500 to-blue-500 rounded-t-3xl"></div>
            <div className="absolute bottom-0 left-0 right-0 h-1 bg-gradient-to-r from-blue-500 via-purple-500 to-cyan-500 rounded-b-3xl"></div>

            <div className="relative p-8 rounded-3xl">
              <div className="flex items-center justify-between mb-8">
                <div>
                  <h2 className="text-3xl font-bold bg-gradient-to-r from-purple-300 via-cyan-300 to-blue-300 bg-clip-text text-transparent mb-2">
                    Deep Research
                  </h2>
                  <p className="text-slate-300">Comprehensive market analysis with real-time data and provider failover</p>
                </div>
                {selectedCoinSymbol && (
                  <div className="flex items-center gap-4">
                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        id="autoRefresh"
                        checked={autoRefreshEnabled}
                        onChange={(e) => setAutoRefreshEnabled(e.target.checked)}
                        className="w-4 h-4 text-purple-600 bg-slate-700 border-slate-600 rounded focus:ring-purple-500"
                      />
                      <label htmlFor="autoRefresh" className="text-sm text-slate-300">
                        Auto-refresh (30s)
                      </label>
                    </div>
                    {lastRefreshTime && (
                      <span className="text-xs text-slate-400">
                        Last updated: {lastRefreshTime.toLocaleTimeString()}
                      </span>
                    )}
                  </div>
                )}
              </div>

                  {/* Top 10 Coins Selector */}
              <div className="mb-8">
                <h3 className="text-xl font-semibold text-white mb-4">Top 10 Coins by Market Cap</h3>
                {top10Loading ? (
                  <div className="flex items-center justify-center py-8">
                    <div className="w-8 h-8 border-4 border-purple-500/30 border-t-purple-500 rounded-full animate-spin"></div>
                    <span className="ml-3 text-slate-400">Loading top coins...</span>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 sm:gap-4">
                    {top10Coins.map((coin) => (
                      <button
                        key={coin.symbol}
                        onClick={() => loadCoinResearch(coin.symbol)}
                        disabled={coinResearchLoading}
                        className={`p-4 bg-slate-800/50 backdrop-blur-sm border rounded-xl hover:bg-slate-700/50 transition-all duration-300 ${
                          selectedCoinSymbol === coin.symbol
                            ? 'border-purple-500 bg-purple-500/10'
                            : 'border-slate-600/30 hover:border-slate-500/60'
                        } ${coinResearchLoading ? 'opacity-50 cursor-not-allowed' : 'transform hover:scale-105'}`}
                      >
                        <div className="flex flex-col items-center text-center">
                          {coin.thumbnail && (
                            <img
                              src={coin.thumbnail}
                              alt={coin.name}
                              className="w-8 h-8 rounded-full mb-2"
                              onError={(e) => {
                                e.currentTarget.style.display = 'none';
                              }}
                            />
                          )}
                          <span className="text-sm font-medium text-white">{coin.symbol.replace('USDT', '')}</span>
                          <span className="text-xs text-slate-400 truncate w-full">{coin.name}</span>
                          <div className={`text-xs mt-1 ${coin.price_change_percentage_24h >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                            {coin.price_change_percentage_24h >= 0 ? '+' : ''}{coin.price_change_percentage_24h?.toFixed(2)}%
                          </div>
                          <div className="text-xs text-slate-300 mt-1">
                            ${coin.current_price?.toLocaleString()}
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Coin Research Display */}
              {selectedCoinSymbol && (
                <div className="space-y-6">
                  {coinResearchLoading ? (
                    <div className="bg-slate-800/50 backdrop-blur-sm border border-slate-600/30 rounded-xl p-8">
                      <div className="text-center">
                        <div className="w-12 h-12 border-4 border-purple-500/30 border-t-purple-500 rounded-full animate-spin mx-auto mb-4"></div>
                        <h3 className="text-xl font-semibold text-white mb-2">Analyzing {selectedCoinSymbol.replace('USDT', '')}</h3>
                        <p className="text-slate-400">Fetching comprehensive market data...</p>
                      </div>
                    </div>
                  ) : selectedCoinData ? (
                    <div className="space-y-4 lg:space-y-6">
                      {/* Mobile: Accordion Sections */}
                      <div className="lg:hidden space-y-4">
                        {/* Coin Header - Always visible */}
                        <div className="bg-slate-800/50 backdrop-blur-sm border border-slate-600/30 rounded-xl p-4">
                          <div className="flex items-center gap-3 mb-3">
                            {selectedCoinData.coinImages?.[0] && (
                              <img
                                src={selectedCoinData.coinImages[0]}
                                alt={selectedCoinSymbol}
                                className="w-10 h-10 rounded-full"
                                onError={(e) => {
                                  e.currentTarget.style.display = 'none';
                                }}
                              />
                            )}
                            <div>
                              <h3 className="text-xl font-bold text-white">{selectedCoinSymbol.replace('USDT', '')}</h3>
                              <p className="text-slate-400 text-sm">{selectedCoinData.metadata?.description?.substring(0, 80)}...</p>
                            </div>
                          </div>
                          <div className="grid grid-cols-2 gap-4">
                            <div>
                              <span className="text-xs text-slate-400">Price</span>
                              <div className="text-lg font-bold text-white">
                                ${selectedCoinData.marketData?.currentPrice?.toLocaleString() || 'N/A'}
                              </div>
                            </div>
                            <div>
                              <span className="text-xs text-slate-400">24h Change</span>
                              <div className={`text-sm font-semibold ${
                                selectedCoinData.marketData?.priceChangePercent24h >= 0 ? 'text-green-400' : 'text-red-400'
                              }`}>
                                {selectedCoinData.marketData?.priceChangePercent24h >= 0 ? '+' : ''}
                                {selectedCoinData.marketData?.priceChangePercent24h?.toFixed(2)}%
                              </div>
                            </div>
                          </div>
                          {/* Provider badges */}
                          <div className="flex gap-2 mt-3 flex-wrap">
                            {selectedCoinData.providerUsage?.marketData?.provider && (
                              <span className="px-2 py-1 bg-blue-500/20 text-blue-300 text-xs rounded-full">
                                Market: {selectedCoinData.providerUsage.marketData.provider}
                              </span>
                            )}
                            {selectedCoinData.providerUsage?.metadata?.provider && (
                              <span className="px-2 py-1 bg-green-500/20 text-green-300 text-xs rounded-full">
                                Metadata: {selectedCoinData.providerUsage.metadata.provider}
                              </span>
                            )}
                            {selectedCoinData.providerUsage?.news?.provider && (
                              <span className="px-2 py-1 bg-purple-500/20 text-purple-300 text-xs rounded-full">
                                News: {selectedCoinData.providerUsage.news.provider}
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Analysis Section */}
                        <div className="bg-slate-800/50 backdrop-blur-sm border border-slate-600/30 rounded-xl">
                          <button
                            onClick={() => setMobileSectionsOpen(prev => ({ ...prev, analysis: !prev.analysis }))}
                            className="w-full p-4 flex items-center justify-between text-left"
                          >
                            <h4 className="text-lg font-semibold text-white">Analysis Summary</h4>
                            <svg
                              className={`w-5 h-5 text-slate-400 transition-transform ${mobileSectionsOpen.analysis ? 'rotate-180' : ''}`}
                              fill="none"
                              stroke="currentColor"
                              viewBox="0 0 24 24"
                            >
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                            </svg>
                          </button>
                          {mobileSectionsOpen.analysis && (
                            <div className="px-4 pb-4 space-y-3">
                              <div className="flex justify-between">
                                <span className="text-slate-400">RSI</span>
                                <span className={`font-semibold ${
                                  selectedCoinData.analysisSummary?.rsi >= 70 ? 'text-red-400' :
                                  selectedCoinData.analysisSummary?.rsi <= 30 ? 'text-green-400' :
                                  'text-yellow-400'
                                }`}>
                                  {selectedCoinData.analysisSummary?.rsi?.toFixed(1)}
                                </span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-slate-400">MA Signal</span>
                                <span className={`font-semibold ${
                                  selectedCoinData.analysisSummary?.maSignal === 'bullish' ? 'text-green-400' :
                                  selectedCoinData.analysisSummary?.maSignal === 'bearish' ? 'text-red-400' :
                                  'text-slate-400'
                                }`}>
                                  {selectedCoinData.analysisSummary?.maSignal}
                                </span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-slate-400">Volatility</span>
                                <span className="font-semibold text-white">
                                  {selectedCoinData.analysisSummary?.volatility}
                                </span>
                              </div>
                              <div className="mt-3 p-3 bg-slate-700/50 rounded-lg">
                                <p className="text-sm text-slate-300">
                                  {selectedCoinData.analysisSummary?.summary}
                                </p>
                              </div>
                            </div>
                          )}
                        </div>

                        {/* Images Section */}
                        <div className="bg-slate-800/50 backdrop-blur-sm border border-slate-600/30 rounded-xl">
                          <button
                            onClick={() => setMobileSectionsOpen(prev => ({ ...prev, images: !prev.images }))}
                            className="w-full p-4 flex items-center justify-between text-left"
                          >
                            <h4 className="text-lg font-semibold text-white">Images & Charts</h4>
                            <svg
                              className={`w-5 h-5 text-slate-400 transition-transform ${mobileSectionsOpen.images ? 'rotate-180' : ''}`}
                              fill="none"
                              stroke="currentColor"
                              viewBox="0 0 24 24"
                            >
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                            </svg>
                          </button>
                          {mobileSectionsOpen.images && (
                            <div className="px-4 pb-4">
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                {selectedCoinData.coinImages?.slice(0, 4).map((image, index) => (
                                  <div key={index} className="bg-slate-700/50 rounded-lg p-2">
                                    <img
                                      src={image}
                                      alt={`${selectedCoinSymbol} ${index === 0 ? 'logo' : 'chart'}`}
                                      className="w-full h-24 object-cover rounded"
                                      onError={(e) => {
                                        e.currentTarget.src = `https://via.placeholder.com/200x150/6366f1/ffffff?text=${selectedCoinSymbol}`;
                                      }}
                                    />
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>

                        {/* News Section */}
                        <div className="bg-slate-800/50 backdrop-blur-sm border border-slate-600/30 rounded-xl">
                          <button
                            onClick={() => setMobileSectionsOpen(prev => ({ ...prev, news: !prev.news }))}
                            className="w-full p-4 flex items-center justify-between text-left"
                          >
                            <h4 className="text-lg font-semibold text-white">Recent News</h4>
                            <svg
                              className={`w-5 h-5 text-slate-400 transition-transform ${mobileSectionsOpen.news ? 'rotate-180' : ''}`}
                              fill="none"
                              stroke="currentColor"
                              viewBox="0 0 24 24"
                            >
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                            </svg>
                          </button>
                          {mobileSectionsOpen.news && (
                            <div className="px-4 pb-4">
                              <div className="space-y-3 max-h-64 overflow-y-auto">
                                {selectedCoinData.news?.length > 0 ? (
                                  selectedCoinData.news.slice(0, 5).map((newsItem, index) => (
                                    <div key={index} className="border-b border-slate-600/30 pb-3 last:border-b-0">
                                      <h5 className="text-sm font-medium text-white mb-1">{newsItem.title}</h5>
                                      <div className="flex items-center justify-between text-xs text-slate-400 mb-2">
                                        <span>{newsItem.source}</span>
                                        <span>{new Date(newsItem.published_at).toLocaleDateString()}</span>
                                      </div>
                                      <p className="text-xs text-slate-300 mb-2">{newsItem.summary?.substring(0, 100)}...</p>
                                      <a
                                        href={newsItem.url}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="text-xs text-purple-400 hover:text-purple-300"
                                      >
                                        Read more →
                                      </a>
                                    </div>
                                  ))
                                ) : (
                                  <p className="text-slate-400 text-sm">No recent news available</p>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Desktop: Grid Layout */}
                      <div className="hidden lg:grid lg:grid-cols-3 gap-6">
                        {/* Left Column - Charts & Images */}
                        <div className="lg:col-span-2 space-y-6">
                        {/* Header */}
                        <div className="bg-slate-800/50 backdrop-blur-sm border border-slate-600/30 rounded-xl p-6">
                          <div className="flex items-center gap-4 mb-4">
                            {selectedCoinData.coinImages?.[0] && (
                              <img
                                src={selectedCoinData.coinImages[0]}
                                alt={selectedCoinSymbol}
                                className="w-12 h-12 rounded-full"
                                onError={(e) => {
                                  e.currentTarget.style.display = 'none';
                                }}
                              />
                            )}
                            <div>
                              <h3 className="text-2xl font-bold text-white">{selectedCoinSymbol.replace('USDT', '')}</h3>
                              <p className="text-slate-400">{selectedCoinData.metadata?.description?.substring(0, 100)}...</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-6">
                            <div>
                              <span className="text-sm text-slate-400">Price</span>
                              <div className="text-2xl font-bold text-white">
                                ${selectedCoinData.marketData?.currentPrice?.toLocaleString() || 'N/A'}
                              </div>
                            </div>
                            <div>
                              <span className="text-sm text-slate-400">24h Change</span>
                              <div className={`text-xl font-semibold ${
                                selectedCoinData.marketData?.priceChangePercent24h >= 0 ? 'text-green-400' : 'text-red-400'
                              }`}>
                                {selectedCoinData.marketData?.priceChangePercent24h >= 0 ? '+' : ''}
                                {selectedCoinData.marketData?.priceChangePercent24h?.toFixed(2)}%
                              </div>
                            </div>
                            {/* Provider badges */}
                            <div className="flex gap-2">
                              {selectedCoinData.providerUsage?.marketData?.provider && (
                                <span className="px-2 py-1 bg-blue-500/20 text-blue-300 text-xs rounded-full">
                                  {selectedCoinData.providerUsage.marketData.provider}
                                </span>
                              )}
                              {selectedCoinData.providerUsage?.metadata?.provider && (
                                <span className="px-2 py-1 bg-green-500/20 text-green-300 text-xs rounded-full">
                                  {selectedCoinData.providerUsage.metadata.provider}
                                </span>
                              )}
                              {selectedCoinData.providerUsage?.news?.provider && (
                                <span className="px-2 py-1 bg-purple-500/20 text-purple-300 text-xs rounded-full">
                                  {selectedCoinData.providerUsage.news.provider}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>

                        {/* Images */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          {selectedCoinData.coinImages?.slice(0, 4).map((image, index) => (
                            <div key={index} className="bg-slate-800/50 backdrop-blur-sm border border-slate-600/30 rounded-xl p-4">
                              <img
                                src={image}
                                alt={`${selectedCoinSymbol} ${index === 0 ? 'logo' : 'chart'}`}
                                className="w-full h-32 object-cover rounded-lg"
                                onError={(e) => {
                                  e.currentTarget.src = `https://via.placeholder.com/300x200/6366f1/ffffff?text=${selectedCoinSymbol}`;
                                }}
                              />
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Right Column - Analysis & News */}
                      <div className="space-y-6">
                        {/* Analysis Summary */}
                        <div className="bg-slate-800/50 backdrop-blur-sm border border-slate-600/30 rounded-xl p-6">
                          <h4 className="text-lg font-semibold text-white mb-4">Analysis Summary</h4>
                          <div className="space-y-3">
                            <div className="flex justify-between">
                              <span className="text-slate-400">RSI</span>
                              <span className={`font-semibold ${
                                selectedCoinData.analysisSummary?.rsi >= 70 ? 'text-red-400' :
                                selectedCoinData.analysisSummary?.rsi <= 30 ? 'text-green-400' :
                                'text-yellow-400'
                              }`}>
                                {selectedCoinData.analysisSummary?.rsi?.toFixed(1)}
                              </span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-slate-400">MA Signal</span>
                              <span className={`font-semibold ${
                                selectedCoinData.analysisSummary?.maSignal === 'bullish' ? 'text-green-400' :
                                selectedCoinData.analysisSummary?.maSignal === 'bearish' ? 'text-red-400' :
                                'text-slate-400'
                              }`}>
                                {selectedCoinData.analysisSummary?.maSignal}
                              </span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-slate-400">Volatility</span>
                              <span className="font-semibold text-white">
                                {selectedCoinData.analysisSummary?.volatility}
                              </span>
                            </div>
                          </div>
                          <div className="mt-4 p-3 bg-slate-700/50 rounded-lg">
                            <p className="text-sm text-slate-300">
                              {selectedCoinData.analysisSummary?.summary}
                            </p>
                          </div>
                        </div>

                        {/* News Feed */}
                        <div className="bg-slate-800/50 backdrop-blur-sm border border-slate-600/30 rounded-xl p-6">
                          <h4 className="text-lg font-semibold text-white mb-4">Recent News</h4>
                          <div className="space-y-3 max-h-96 overflow-y-auto">
                            {selectedCoinData.news?.length > 0 ? (
                              selectedCoinData.news.slice(0, 5).map((newsItem, index) => (
                                <div key={index} className="border-b border-slate-600/30 pb-3 last:border-b-0">
                                  <h5 className="text-sm font-medium text-white mb-1">{newsItem.title}</h5>
                                  <div className="flex items-center justify-between text-xs text-slate-400 mb-2">
                                    <span>{newsItem.source}</span>
                                    <span>{new Date(newsItem.published_at).toLocaleDateString()}</span>
                                  </div>
                                  <p className="text-xs text-slate-300 mb-2">{newsItem.summary?.substring(0, 100)}...</p>
                                  <a
                                    href={newsItem.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-xs text-purple-400 hover:text-purple-300"
                                  >
                                    Read more →
                                  </a>
                                </div>
                              ))
                            ) : (
                              <p className="text-slate-400 text-sm">No recent news available</p>
                            )}
                          </div>
                        </div>
                      </div>
                      </div>
                    </div>
                  ) : (
                    <div className="bg-slate-800/50 backdrop-blur-sm border border-slate-600/30 rounded-xl p-8 text-center">
                      <p className="text-slate-400">Select a coin to view detailed research</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </section>
      </main >


      {toast && <Toast message={toast.message} type={toast.type} />
      }
    </div >
  );
}