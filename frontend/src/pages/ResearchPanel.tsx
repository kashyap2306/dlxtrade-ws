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
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../config/firebase';
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

interface AnalysisReportItem {
  id: string;
  symbol: string;
  price: number | null;
  longSignals: number;
  accuracy: number;
  timestamp: string;
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

      <main className="min-h-screen relative">
        <div className="max-w-7xl mx-auto px-2 sm:px-2 md:px-6 lg:px-8 xl:px-12 py-6 sm:py-8 lg:py-12">
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
                        <div className={`font-semibold text-lg ${
                          liveData.signal === 'BUY' ? 'text-green-400' :
                          liveData.signal === 'SELL' ? 'text-red-400' :
                          'text-slate-400'
                        }`}>
                          {liveData.signal}
                        </div>
                      </div>
                      <div>
                        <div className="text-sm text-slate-400">Accuracy</div>
                        <div className={`font-semibold text-lg ${
                          liveData.accuracy >= 0.85 ? 'text-green-400' :
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
                  <div className="w-16 h-16 rounded-full bg-gradient-to-r from-purple-500/20 to-cyan-500/20 flex items-center justify-center mx-auto mb-4">
                    <div className="w-8 h-8 border-4 border-purple-500/30 border-t-purple-500 rounded-full animate-spin"></div>
                  </div>
                  <h3 className="text-2xl font-bold bg-gradient-to-r from-purple-400 to-cyan-400 bg-clip-text text-transparent">
                    Running Deep Research...
                  </h3>
                  <p className="text-slate-400 mt-2">Analyzing market data and generating insights</p>
                </div>

                <div className="space-y-4 max-w-2xl mx-auto">
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
                        <p className={`font-medium ${
                          progressItem.status === 'success' ? 'text-emerald-300' :
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
                      {/* SIGNAL PANEL */}
                      <div className="relative bg-gradient-to-br from-slate-900/90 via-slate-800/90 to-slate-900/90 backdrop-blur-xl border border-slate-700/50 rounded-2xl p-4 sm:p-6 shadow-2xl shadow-slate-900/50 overflow-hidden">
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

                          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                            {/* Signal */}
                            <div className="bg-slate-800/50 backdrop-blur-sm border border-slate-600/30 rounded-xl p-4">
                              <div className="text-sm text-slate-400 mb-2">Signal</div>
                              <div className={`text-2xl font-bold ${
                                result.result?.signal === 'BUY' ? 'text-green-400' :
                                result.result?.signal === 'SELL' ? 'text-red-400' :
                                'text-slate-400'
                              }`}>
                                {result.result?.signal || 'HOLD'}
                              </div>
                            </div>

                            {/* Accuracy */}
                            <div className="bg-slate-800/50 backdrop-blur-sm border border-slate-600/30 rounded-xl p-4">
                              <div className="text-sm text-slate-400 mb-2">Accuracy</div>
                              <div className={`text-2xl font-bold ${
                                ((result.result?.accuracy || 0) * 100) >= 70 ? 'text-green-400' :
                                ((result.result?.accuracy || 0) * 100) >= 50 ? 'text-yellow-400' :
                                'text-red-400'
                              }`}>
                                {result.result?.accuracy ? (result.result.accuracy * 100).toFixed(1) : 0}%
                              </div>
                            </div>

                            {/* Current Price */}
                            <div className="bg-slate-800/50 backdrop-blur-sm border border-slate-600/30 rounded-xl p-4">
                              <div className="text-sm text-slate-400 mb-2">Current Price</div>
                              <div className="text-xl font-bold text-white">
                                ${result.result?.raw?.marketData?.price ? result.result.raw.marketData.price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : 'N/A'}
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
                      </div>

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

                          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                            {/* RSI */}
                            {result.result?.indicators?.rsi && (
                              <div className="bg-slate-800/50 backdrop-blur-sm border border-slate-600/30 rounded-xl p-4 hover:bg-slate-800/70 transition-all duration-200">
                                <div className="flex items-center justify-between mb-2">
                                  <span className="text-sm font-medium text-slate-300">RSI</span>
                                  <span className={`px-2 py-1 rounded text-xs font-medium ${
                                    (result.result?.indicators?.rsi?.value || 0) > 70 ? 'bg-red-500/20 text-red-400' :
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
                                  <span className={`px-2 py-1 rounded text-xs font-medium ${
                                    (result.result?.indicators?.ma50?.value || 0) > (result.result?.raw?.marketData?.price || 0) ? 'bg-red-500/20 text-red-400' : 'bg-green-500/20 text-green-400'
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
                                  <span className={`px-2 py-1 rounded text-xs font-medium ${
                                    (result.result?.indicators?.ma200?.value || 0) > (result.result?.raw?.marketData?.price || 0) ? 'bg-red-500/20 text-red-400' : 'bg-green-500/20 text-green-400'
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
                                  <span className={`px-2 py-1 rounded text-xs font-medium ${
                                    (result.result?.indicators?.ema20?.value || 0) > (result.result?.raw?.marketData?.price || 0) ? 'bg-red-500/20 text-red-400' : 'bg-green-500/20 text-green-400'
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
                                  <span className={`px-2 py-1 rounded text-xs font-medium ${
                                    (result.result?.indicators?.ema50?.value || 0) > (result.result?.raw?.marketData?.price || 0) ? 'bg-red-500/20 text-red-400' : 'bg-green-500/20 text-green-400'
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
                                  <span className={`px-2 py-1 rounded text-xs font-medium ${
                                    (result.result?.indicators?.macd?.value || 0) > 0 ? 'bg-green-500/20 text-green-400' :
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
                                  <span className={`px-2 py-1 rounded text-xs font-medium ${
                                    result.result?.indicators?.vwap?.signal === 'bullish' ? 'bg-green-500/20 text-green-400' :
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
                                  <span className={`px-2 py-1 rounded text-xs font-medium ${
                                    (result.result?.indicators?.atr?.atrPct || 0) > 3 ? 'bg-red-500/20 text-red-400' :
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
                                  <span className="text-sm font-medium text-slate-300">Volume</span>
                                  <span className={`px-2 py-1 rounded text-xs font-medium ${
                                    (result.result?.indicators?.volume?.score || 0) > 50 ? 'bg-green-500/20 text-green-400' :
                                    (result.result?.indicators?.volume?.score || 0) < 30 ? 'bg-red-500/20 text-red-400' :
                                    'bg-yellow-500/20 text-yellow-400'
                                  }`}>
                                    {(result.result?.indicators?.volume?.score || 0) > 50 ? 'High' :
                                     (result.result?.indicators?.volume?.score || 0) < 30 ? 'Low' : 'Moderate'}
                                  </span>
                                </div>
                                <div className="text-xl font-bold text-white">{result.result?.indicators?.volume?.score?.toFixed(0) || 'N/A'}</div>
                                <div className="text-xs text-slate-400 mt-1">Trend: {result.result?.indicators?.volume?.trend || 'N/A'}</div>
                              </div>
                            )}

                            {/* VWAP */}
                            {result.result?.indicators?.vwap && (
                              <div className="bg-slate-800/50 backdrop-blur-sm border border-slate-600/30 rounded-xl p-4 hover:bg-slate-800/70 transition-all duration-200">
                                <div className="flex items-center justify-between mb-2">
                                  <span className="text-sm font-medium text-slate-300">VWAP</span>
                                  <span className={`px-2 py-1 rounded text-xs font-medium ${
                                    result.result?.indicators?.vwap?.signal === 'bullish' ? 'bg-green-500/20 text-green-400' :
                                    result.result?.indicators?.vwap?.signal === 'bearish' ? 'bg-red-500/20 text-red-400' :
                                    'bg-blue-500/20 text-blue-400'
                                  }`}>
                                    {result.result?.indicators?.vwap?.signal === 'bullish' ? 'Bullish' :
                                     result.result?.indicators?.vwap?.signal === 'bearish' ? 'Bearish' : 'Neutral'}
                                  </span>
                                </div>
                                <div className="text-xl font-bold text-white">{result.result?.indicators?.vwap?.signal || 'N/A'}</div>
                                <div className="text-xs text-slate-400 mt-1">Deviation: {result.result?.indicators?.vwap?.deviation?.toFixed(2) || 'N/A'}%</div>
                              </div>
                            )}

                            {/* ATR */}
                            {result.result?.indicators?.atr && (
                              <div className="bg-slate-800/50 backdrop-blur-sm border border-slate-600/30 rounded-xl p-4 hover:bg-slate-800/70 transition-all duration-200">
                                <div className="flex items-center justify-between mb-2">
                                  <span className="text-sm font-medium text-slate-300">ATR</span>
                                  <span className={`px-2 py-1 rounded text-xs font-medium ${
                                    (result.result?.indicators?.atr?.classification || '').toLowerCase() === 'high' ? 'bg-red-500/20 text-red-400' :
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
                                  <span className="text-sm font-medium text-slate-300">Pattern</span>
                                  <span className={`px-2 py-1 rounded text-xs font-medium ${
                                    (result.result?.indicators?.pattern?.confidence || 0) > 70 ? 'bg-green-500/20 text-green-400' :
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
                                  <span className="text-sm font-medium text-slate-300">Momentum</span>
                                  <span className={`px-2 py-1 rounded text-xs font-medium ${
                                    (result.result?.indicators?.momentum?.direction || '').toLowerCase() === 'bullish' ? 'bg-green-500/20 text-green-400' :
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

                      {/* PROVIDER STATUS */}
                      <div className="relative bg-gradient-to-br from-slate-900/90 via-slate-800/90 to-slate-900/90 backdrop-blur-xl border border-slate-700/50 rounded-2xl p-4 sm:p-6 shadow-2xl shadow-slate-900/50 overflow-hidden">
                        <div className="absolute inset-0 bg-gradient-to-br from-violet-500/5 via-purple-500/5 to-pink-500/5"></div>
                        <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-violet-500 via-purple-500 to-pink-500"></div>

                        <div className="relative">
                          <h3 className="text-xl font-bold text-white mb-6 flex items-center gap-2">
                            <svg className="w-5 h-5 text-violet-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                            </svg>
                            Provider Status
                          </h3>

                          <div className="space-y-4">
                            {/* Market Data Provider */}
                            <div className="bg-slate-800/50 backdrop-blur-sm border border-slate-600/30 rounded-xl p-4">
                              <div className="flex items-center justify-between mb-3">
                                <span className="text-lg font-medium text-slate-300">Market Data</span>
                                <span className={`px-3 py-1 rounded-full text-sm font-semibold ${
                                  result.result?.providers?.marketData?.success ? 'bg-green-500/20 text-green-400 border border-green-500/30' : 'bg-red-500/20 text-red-400 border border-red-500/30'
                                }`}>
                                  {result.result?.providers?.marketData?.success ? 'Success' : 'Failed'}
                                </span>
                              </div>
                              {result.result?.providers?.marketData?.success && (
                                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
                                  <div>
                                    <div className="text-slate-400">Price</div>
                                    <div className="font-semibold text-white">
                                      ${result.result?.raw?.marketData?.price ? result.result.raw.marketData.price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : 'N/A'}
                                    </div>
                                  </div>
                                  <div>
                                    <div className="text-slate-400">Trends</div>
                                    <div className="font-semibold text-white">
                                      {result.result?.signal === 'BUY' ? 'Bullish' :
                                       result.result?.signal === 'SELL' ? 'Bearish' : 'Neutral'}
                                    </div>
                                  </div>
                                  <div>
                                    <div className="text-slate-400">Signal</div>
                                    <div className={`font-semibold ${
                                      result.result?.signal === 'BUY' ? 'text-green-400' :
                                      result.result?.signal === 'SELL' ? 'text-red-400' :
                                      'text-slate-400'
                                    }`}>
                                      {result.result?.signal || 'HOLD'}
                                    </div>
                                  </div>
                                </div>
                              )}
                            </div>

                            {/* Metadata Provider */}
                            <div className="bg-slate-800/50 backdrop-blur-sm border border-slate-600/30 rounded-xl p-4">
                              <div className="flex items-center justify-between mb-3">
                                <span className="text-lg font-medium text-slate-300">Metadata</span>
                                <span className={`px-3 py-1 rounded-full text-sm font-semibold ${
                                  result.result?.providers?.metadata?.success ? 'bg-green-500/20 text-green-400 border border-green-500/30' : 'bg-red-500/20 text-red-400 border border-red-500/30'
                                }`}>
                                  {result.result?.providers?.metadata?.success ? 'Success' : 'Failed'}
                                </span>
                              </div>
                              {result.result?.providers?.metadata?.success && (
                                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
                                  <div>
                                    <div className="text-slate-400">Symbol</div>
                                    <div className="font-semibold text-white">{result.symbol || 'N/A'}</div>
                                  </div>
                                  <div>
                                    <div className="text-slate-400">Status</div>
                                    <div className="font-semibold text-green-400">Active</div>
                                  </div>
                                  <div>
                                    <div className="text-slate-400">Provider</div>
                                    <div className="font-semibold text-white">CoinGecko</div>
                                  </div>
                                </div>
                              )}
                            </div>

                            {/* News Provider */}
                            <div className="bg-slate-800/50 backdrop-blur-sm border border-slate-600/30 rounded-xl p-4">
                              <div className="flex items-center justify-between mb-3">
                                <span className="text-lg font-medium text-slate-300">News</span>
                                <span className={`px-3 py-1 rounded-full text-sm font-semibold ${
                                  result.result?.providers?.news?.success ? 'bg-green-500/20 text-green-400 border border-green-500/30' : 'bg-red-500/20 text-red-400 border border-red-500/30'
                                }`}>
                                  {result.result?.providers?.news?.success ? 'Success' : 'Failed'}
                                </span>
                              </div>
                              {result.result?.providers?.news?.success && result.news?.articles && (
                                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
                                  <div>
                                    <div className="text-slate-400">Articles</div>
                                    <div className="font-semibold text-white">{result.news.articles.length}</div>
                                  </div>
                                  <div>
                                    <div className="text-slate-400">Sentiment</div>
                                    <div className="font-semibold text-white">
                                      {result.news.articles.filter((a: any) => a.sentiment === 'positive').length > result.news.articles.filter((a: any) => a.sentiment === 'negative').length ? 'Positive' :
                                       result.news.articles.filter((a: any) => a.sentiment === 'negative').length > result.news.articles.filter((a: any) => a.sentiment === 'positive').length ? 'Negative' : 'Neutral'}
                                    </div>
                                  </div>
                                  <div>
                                    <div className="text-slate-400">Provider</div>
                                    <div className="font-semibold text-white">NewsData</div>
                                  </div>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>

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
                              News Summary
                            </h3>

                            <div className="space-y-4">
                              {result.news.articles.slice(0, 3).map((article: any, index: number) => (
                                <div key={index} className="bg-slate-800/50 backdrop-blur-sm border border-slate-600/30 rounded-xl p-4 hover:bg-slate-800/70 transition-all duration-200">
                                  <div className="flex items-start gap-4">
                                    {/* Sentiment Badge */}
                                    <div className="flex-shrink-0">
                                      <span className={`px-3 py-1 rounded-full text-sm font-semibold ${
                                        article.sentiment === 'positive' ? 'bg-green-500/20 text-green-400 border border-green-500/30' :
                                        article.sentiment === 'negative' ? 'bg-red-500/20 text-red-400 border border-red-500/30' :
                                        'bg-slate-500/20 text-slate-400 border border-slate-500/30'
                                      }`}>
                                        {article.sentiment === 'positive' ? 'Positive' :
                                         article.sentiment === 'negative' ? 'Negative' : 'Neutral'}
                                      </span>
                                    </div>

                                    {/* Article Content */}
                                    <div className="flex-1 min-w-0">
                                      <h4 className="text-lg font-semibold text-white mb-2 line-clamp-2">
                                        {article.title}
                                      </h4>
                                      <div className="flex items-center gap-4 text-sm text-slate-400 mb-3">
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
                                            day: 'numeric',
                                            year: 'numeric'
                                          }) : 'Recent'}
                                        </span>
                                      </div>
                                      <a
                                        href={article.url}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="inline-flex items-center gap-2 text-blue-400 hover:text-blue-300 transition-colors text-sm font-medium"
                                      >
                                        Read full article
                                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                                        </svg>
                                      </a>
                                    </div>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>
                      )}

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
        </div>
      </main>


      {toast && <Toast message={toast.message} type={toast.type} />}
    </div>
  );
}

