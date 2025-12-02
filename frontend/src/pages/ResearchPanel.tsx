import { useState, useEffect, useCallback, useMemo } from 'react';
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
import { formatPrice, formatVolume, formatPercentage, formatMarketCap } from '../utils/numberFormatters';

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
            providers: result.providers,
            indicators: result.indicators,
            metadata: result.metadata
          });

          console.log("Frontend received research result:", result);

          return {
            ...result,
            id: `free_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            // Map FREE MODE response to existing UI format (result is now direct, not nested)
            signal: result.signal || 'HOLD',
            accuracy: result.accuracy || 0,
            price: result.raw?.binance?.price || 0,
            volume24h: result.raw?.binance?.volume24h || 0,
            high24h: result.raw?.binance?.high24h || 0,
            low24h: result.raw?.binance?.low24h || 0,
            marketCap: result.metadata?.supply?.circulating || 0,
            vwapDeviation: 0, // Not available in FREE MODE
            indicators: result.indicators || {},
            metadata: result.metadata || {},
            news: result.news || [],
            raw: result.raw || {},
            providers: result.providers || {}, // Add providers info to result
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
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 relative overflow-hidden">
      {/* Subtle animated background */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-80 h-80 bg-purple-500/10 rounded-full blur-3xl"></div>
        <div className="absolute -bottom-40 -left-40 w-80 h-80 bg-cyan-500/10 rounded-full blur-3xl"></div>
        <div className="hidden lg:block absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-64 h-64 bg-pink-500/5 rounded-full blur-2xl"></div>

        {/* Subtle grid overlay */}
        <div className="absolute inset-0 bg-[linear-gradient(to_right,#64748b08_1px,transparent_1px),linear-gradient(to_bottom,#64748b08_1px,transparent_1px)] bg-[size:32px_32px]"></div>
      </div>

      <Sidebar onLogout={handleLogout} />

      <main className="min-h-screen">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 lg:py-8">
          {/* Mobile: Clean Header */}
          <div className="lg:hidden sticky top-16 z-40 -mx-4 px-4 py-6 bg-slate-900/95 backdrop-blur-md border-b border-slate-700/50 mb-8">
            <div className="space-y-4">
              <div>
                <h2 className="text-xl font-bold bg-gradient-to-r from-purple-400 to-cyan-400 bg-clip-text text-transparent">
                  Research Panel
                </h2>
                <p className="text-sm text-slate-400 mt-1">
                  Run instant deep research with full exchange API data
                </p>
              </div>
              <div className="flex gap-3">
                <button
                  onClick={handleDeepResearch}
                  disabled={deepResearchLoading || cooldownSeconds > 0}
                  className="flex-1 px-5 py-3 bg-gradient-to-r from-purple-600 to-cyan-600 text-white font-semibold rounded-xl hover:from-purple-500 hover:to-cyan-500 transition-all duration-300 shadow-lg shadow-purple-500/25 disabled:opacity-50 disabled:cursor-not-allowed transform hover:scale-[1.02] active:scale-98"
                >
                  {deepResearchLoading ? (
                    <span className="flex items-center justify-center gap-2">
                      <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></span>
                      <span className="text-sm">Running Research...</span>
                    </span>
                  ) : cooldownSeconds > 0 ? (
                    <span className="flex items-center justify-center gap-2">
                      <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></span>
                      <span className="text-sm">Cooldown: {cooldownSeconds}s</span>
                    </span>
                  ) : (
                    <span className="flex items-center gap-2">
                      <span className="text-sm">⚡ Run Deep Research</span>
                    </span>
                  )}
                </button>
                <button
                  onClick={loadLogs}
                  disabled={loading}
                  className="px-4 py-3 bg-slate-800/50 border border-slate-600/50 text-slate-300 rounded-xl hover:bg-slate-700/50 hover:border-slate-500/50 transition-all duration-300 disabled:opacity-50 transform hover:scale-105 active:scale-95"
                >
                  {loading ? (
                    <span className="w-4 h-4 border-2 border-slate-400/30 border-t-slate-400 rounded-full animate-spin"></span>
                  ) : (
                    <span className="text-lg">↻</span>
                  )}
                </button>
              </div>
            </div>
          </div>

          {/* Desktop Header */}
          <section className="hidden lg:block mb-12">
            <div className="flex items-center justify-between">
              <div className="space-y-3">
                <h1 className="text-4xl font-bold bg-gradient-to-r from-purple-300 via-pink-300 to-cyan-300 bg-clip-text text-transparent">
                  Research Panel
                </h1>
                <p className="text-lg text-slate-300 max-w-md">
                  Run instant deep research with full exchange API data
                </p>
              </div>
              <div className="flex items-center gap-4">
                <button
                  onClick={loadLogs}
                  disabled={loading}
                  className="px-6 py-3 bg-slate-800/50 border border-slate-600/50 text-slate-300 rounded-xl hover:bg-slate-700/50 hover:border-slate-500/50 transition-all duration-300 disabled:opacity-50 flex items-center gap-2 transform hover:scale-105 active:scale-95"
                >
                  {loading ? (
                    <>
                      <span className="w-4 h-4 border-2 border-slate-400/30 border-t-slate-400 rounded-full animate-spin"></span>
                      <span>Loading...</span>
                    </>
                  ) : (
                    <>
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                      </svg>
                      <span>Refresh</span>
                    </>
                  )}
                </button>
                <button
                  onClick={handleDeepResearch}
                  disabled={deepResearchLoading || cooldownSeconds > 0}
                  className="px-8 py-3 bg-gradient-to-r from-purple-600 to-cyan-600 text-white font-semibold rounded-xl hover:from-purple-500 hover:to-cyan-500 transition-all duration-300 shadow-lg shadow-purple-500/25 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 transform hover:scale-[1.02] active:scale-98"
                >
                  {deepResearchLoading ? (
                    <>
                      <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></span>
                      <span>Running Research...</span>
                    </>
                  ) : cooldownSeconds > 0 ? (
                    <>
                      <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></span>
                      <span>Cooldown: {cooldownSeconds}s</span>
                    </>
                  ) : (
                    <>
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                      </svg>
                      <span>Run Deep Research</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </section>
          <div className="space-y-8">
            {/* Analysis Report Section */}
            <div className="bg-slate-900/50 backdrop-blur-sm border border-slate-700/50 rounded-2xl p-8 shadow-xl shadow-slate-900/20 hover:shadow-slate-900/30 transition-all duration-300">
              {/* Subtle accent line */}
              <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-slate-400/30 to-transparent"></div>

              <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6 mb-8">
                <div className="space-y-2">
                  <h2 className="text-2xl font-bold bg-gradient-to-r from-purple-400 to-cyan-400 bg-clip-text text-transparent">
                    Live Analysis Report
                  </h2>
                  <p className="text-sm text-slate-400 flex items-center gap-2">
                    <span className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></span>
                    Updated every 5 minutes
                  </p>
                </div>
                <button
                  onClick={fetchAnalysis}
                  disabled={analysisLoading}
                  className="px-6 py-3 bg-slate-800/50 border border-slate-600/50 text-slate-300 rounded-xl hover:bg-slate-700/50 hover:border-slate-500/50 transition-all duration-300 disabled:opacity-50 flex items-center gap-2 transform hover:scale-105 active:scale-95"
                >
                  {analysisLoading ? (
                    <>
                      <span className="w-4 h-4 border-2 border-slate-400/30 border-t-slate-400 rounded-full animate-spin"></span>
                      <span>Loading...</span>
                    </>
                  ) : (
                    <>
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                      </svg>
                      <span>Refresh</span>
                    </>
                  )}
                </button>
              </div>

              {/* Desktop Table View */}
              <div className="hidden lg:block overflow-x-auto rounded-xl border border-slate-700/50 bg-slate-800/30">
                <table className="min-w-full divide-y divide-slate-700/30">
                  <thead className="bg-slate-800/50">
                    <tr>
                      <th className="px-6 py-4 text-left text-xs font-semibold text-slate-300 uppercase tracking-wide">#</th>
                      <th className="px-6 py-4 text-left text-xs font-semibold text-slate-300 uppercase tracking-wide">Symbol</th>
                      <th className="px-6 py-4 text-left text-xs font-semibold text-slate-300 uppercase tracking-wide">Price</th>
                      <th className="px-6 py-4 text-left text-xs font-semibold text-slate-300 uppercase tracking-wide">Signals</th>
                      <th className="px-6 py-4 text-left text-xs font-semibold text-slate-300 uppercase tracking-wide">Accuracy</th>
                      <th className="px-6 py-4 text-left text-xs font-semibold text-slate-300 uppercase tracking-wide">Timestamp</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-700/20">
                    {analysisReport.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="px-6 py-16 text-center">
                          <div className="flex flex-col items-center gap-4">
                            <div className="w-16 h-16 rounded-full bg-slate-800/50 flex items-center justify-center">
                              <svg className="w-8 h-8 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                              </svg>
                            </div>
                            <div className="space-y-2">
                              <p className="text-slate-300 font-medium">
                                {analysisLoading ? 'Loading analysis...' : 'No recent analysis available'}
                              </p>
                              <p className="text-slate-500 text-sm">
                                Analysis reports will appear here after running research
                              </p>
                            </div>
                          </div>
                        </td>
                      </tr>
                    ) : (
                      (showMoreAnalysis ? analysisReport : analysisReport.slice(0, 3)).map((item, index) => (
                        <tr
                          key={item.id}
                          className="hover:bg-slate-800/30 transition-all duration-200 group"
                        >
                          <td className="px-6 py-4 text-sm text-slate-300 font-medium">
                            <span className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-slate-700/50 text-slate-400 group-hover:bg-slate-600/50 transition-colors">
                              {index + 1}
                            </span>
                          </td>
                          <td className="px-6 py-4">
                            <div className="flex items-center gap-2">
                              <div className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse"></div>
                              <span className="text-sm font-bold text-white group-hover:text-cyan-300 transition-colors">
                                {item.symbol}
                              </span>
                            </div>
                          </td>
                          <td className="px-6 py-4 text-sm font-medium text-gray-200">
                            {item.price !== null ? (
                              <span className="text-white">${item.price.toFixed(2)}</span>
                            ) : (
                              <span className="text-gray-500">N/A</span>
                            )}
                          </td>
                          <td className="px-6 py-4 text-sm">
                            <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                              item.longSignals > 0 
                                ? 'bg-gradient-to-r from-green-500/20 to-emerald-500/20 text-green-300 border border-green-400/40 shadow-lg shadow-green-500/10' 
                                : 'bg-gray-500/10 text-gray-400 border border-gray-500/20'
                            }`}>
                              {item.longSignals > 0 ? (
                                <>
                                  <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
                                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                                  </svg>
                                  {item.longSignals}
                                </>
                              ) : (
                                '—'
                              )}
                            </span>
                          </td>
                          <td className={`px-6 py-4 text-sm font-bold ${
                            item.accuracy >= 0.85 ? 'text-green-400' :
                            item.accuracy >= 0.7 ? 'text-yellow-400' :
                            'text-red-400'
                          }`}>
                            <div className="flex items-center gap-2">
                              <span>{(item.accuracy * 100).toFixed(2)}%</span>
                              {item.accuracy >= 0.85 && (
                                <span className="text-xs">⭐</span>
                              )}
                            </div>
                          </td>
                          <td className="px-6 py-4 text-xs text-gray-400 font-mono">
                            {new Date(item.timestamp).toLocaleString()}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              {/* View More Button */}
              {analysisReport.length > 3 && (
                <div className="mt-4 flex justify-center">
                  <button
                    onClick={() => setShowMoreAnalysis(!showMoreAnalysis)}
                    className="px-6 py-2 bg-black/40 backdrop-blur-sm border border-purple-500/40 text-gray-200 rounded-xl hover:bg-purple-500/20 hover:border-purple-400/60 transition-all duration-300 flex items-center justify-center gap-2 transform hover:scale-105 active:scale-95"
                  >
                    {showMoreAnalysis ? (
                      <>
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                        </svg>
                        Show Less
                      </>
                    ) : (
                      <>
                        View More ({analysisReport.length - 3} more)
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      </>
                    )}
                  </button>
                </div>
              )}

              {/* Mobile Card View */}
              <div className="lg:hidden space-y-4">
                {analysisReport.length === 0 ? (
                  <div className="text-center py-16">
                    <div className="w-20 h-20 rounded-full bg-slate-800/50 flex items-center justify-center mx-auto mb-6">
                      <svg className="w-10 h-10 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                    </div>
                    <div className="space-y-2">
                      <p className="text-slate-300 font-medium text-lg">
                        {analysisLoading ? 'Loading analysis...' : 'No analysis available'}
                      </p>
                      <p className="text-slate-500 text-sm max-w-xs mx-auto">
                        Analysis reports will appear here after running research
                      </p>
                    </div>
                  </div>
                ) : (
                  (showMoreAnalysis ? analysisReport : analysisReport.slice(0, 3)).map((item, index) => (
                    <div
                      key={item.id}
                      className="bg-slate-800/40 border border-slate-700/50 rounded-xl p-5 space-y-4 hover:border-slate-600/50 transition-all duration-300 hover:shadow-lg hover:shadow-slate-900/20"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <span className="inline-flex items-center justify-center w-10 h-10 rounded-lg bg-slate-700/50 text-slate-300 font-bold text-sm">
                            #{index + 1}
                          </span>
                          <div className="space-y-1">
                            <div className="flex items-center gap-2">
                              <span className="text-lg font-bold text-white">{item.symbol}</span>
                              <div className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse"></div>
                            </div>
                          </div>
                        </div>
                        <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium ${
                          item.longSignals > 0
                            ? 'bg-emerald-500/10 text-emerald-300 border border-emerald-500/30'
                            : 'bg-slate-700/50 text-slate-400 border border-slate-600/30'
                        }`}>
                          {item.longSignals > 0 ? (
                            <>
                              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                              </svg>
                              {item.longSignals} signals
                            </>
                          ) : (
                            'No signals'
                          )}
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-4">
                        <div className="bg-slate-900/50 rounded-lg p-3 border border-slate-700/30">
                          <div className="text-xs text-slate-400 font-medium mb-1">Price</div>
                          <div className="text-white font-semibold text-base">
                            {item.price !== null ? `$${item.price.toFixed(2)}` : 'N/A'}
                          </div>
                        </div>
                        <div className={`rounded-lg p-3 border ${
                          item.accuracy >= 0.85 ? 'bg-emerald-500/10 border-emerald-500/30' :
                          item.accuracy >= 0.7 ? 'bg-amber-500/10 border-amber-500/30' :
                          'bg-red-500/10 border-red-500/30'
                        }`}>
                          <div className="text-xs text-slate-400 font-medium mb-1">Accuracy</div>
                          <div className={`font-bold text-base ${
                            item.accuracy >= 0.85 ? 'text-emerald-400' :
                            item.accuracy >= 0.7 ? 'text-amber-400' :
                            'text-red-400'
                          }`}>
                            {(item.accuracy * 100).toFixed(1)}%
                            {item.accuracy >= 0.85 && <span className="ml-1">⭐</span>}
                          </div>
                        </div>
                      </div>

                      <div className="bg-slate-900/50 rounded-lg p-3 border border-slate-700/30">
                        <div className="text-xs text-slate-400 font-medium mb-1">Last Updated</div>
                        <div className="text-white text-sm font-mono">
                          {new Date(item.timestamp).toLocaleString()}
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>

              {/* View More Button (Mobile) */}
              {analysisReport.length > 3 && (
                <div className="mt-6 flex justify-center">
                  <button
                    onClick={() => setShowMoreAnalysis(!showMoreAnalysis)}
                    className="px-8 py-3 bg-slate-800/50 border border-slate-600/50 text-slate-300 rounded-xl hover:bg-slate-700/50 hover:border-slate-500/50 transition-all duration-300 flex items-center gap-2 transform hover:scale-105 active:scale-95 font-medium"
                  >
                    {showMoreAnalysis ? (
                      <>
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                        </svg>
                        Show Less
                      </>
                    ) : (
                      <>
                        View More ({analysisReport.length - 3} more)
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      </>
                    )}
                  </button>
                </div>
              )}
            </div>

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

            {/* Deep Research Report */}
            <div className="bg-slate-900/50 backdrop-blur-sm border border-slate-700/50 rounded-2xl p-8 shadow-xl shadow-slate-900/20 hover:shadow-slate-900/30 transition-all duration-300">
              <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6 mb-8">
                <div className="space-y-2">
                  <h2 className="text-2xl font-bold bg-gradient-to-r from-purple-400 to-cyan-400 bg-clip-text text-transparent">
                    Deep Research Report
                  </h2>
                  <p className="text-sm text-slate-400 flex items-center gap-2">
                    <span className="w-2 h-2 bg-purple-400 rounded-full animate-pulse"></span>
                    Manual deep research results only
                  </p>
                </div>
              </div>

              {deepResearchLoading ? (
                <div className="text-center py-16">
                  <div className="w-20 h-20 rounded-full bg-slate-800/50 flex items-center justify-center mx-auto mb-6">
                    <div className="w-10 h-10 border-4 border-purple-500/30 border-t-purple-500 rounded-full animate-spin"></div>
                  </div>
                  <p className="text-slate-300 font-medium text-lg">Running deep research...</p>
                  <p className="text-slate-500 text-sm mt-2">This may take a few moments</p>
                </div>
              ) : deepResearchResults.length === 0 ? (
                <div className="text-center py-16">
                  <div className="w-20 h-20 rounded-full bg-slate-800/50 flex items-center justify-center mx-auto mb-6">
                    <svg className="w-10 h-10 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                  </div>
                  <div className="space-y-2">
                    <p className="text-slate-300 font-medium text-lg">No research results yet</p>
                    <p className="text-slate-500 text-sm max-w-md mx-auto">
                      Run deep research to generate comprehensive analysis reports with market data and insights
                    </p>
                  </div>
                </div>
              ) : (
                <div className="space-y-8 animate-fade-in">
                  {deepResearchResults.map((result, idx) => (
                    <div key={result.id || idx} className="space-y-6 animate-stagger">
                      {/* SYMBOL HEADER + PRICE CARD */}
                      <div className="relative bg-gradient-to-br from-slate-900/90 via-slate-800/90 to-slate-900/90 backdrop-blur-xl border border-slate-700/50 rounded-2xl p-6 shadow-2xl shadow-slate-900/50 overflow-hidden">
                        {/* Animated background */}
                        <div className="absolute inset-0 bg-gradient-to-br from-blue-500/5 via-purple-500/5 to-cyan-500/5"></div>
                        <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-slate-400/20 to-transparent"></div>

                        <div className="relative flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
                          {/* Symbol Info */}
                          <div className="flex items-center gap-4">
                            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-orange-400 to-orange-600 flex items-center justify-center shadow-lg">
                              <span className="text-white font-bold text-lg">
                                {result.symbol?.replace('USDT', '').substring(0, 2) || 'COIN'}
                              </span>
                            </div>
                            <div>
                              <h1 className="text-2xl font-bold text-white mb-1">{result.symbol || 'BTCUSDT'}</h1>
                              <div className="flex items-center gap-2 text-sm text-slate-400">
                                <span>Exchange: MULTI</span>
                                {result.requestId && <span>• ID: {result.requestId.slice(-8)}</span>}
                              </div>
                            </div>
                          </div>

                          {/* Price Card */}
                          <div className="flex flex-col sm:flex-row gap-4 lg:gap-6">
                            <div className="bg-slate-800/50 backdrop-blur-sm border border-slate-600/30 rounded-xl p-4 min-w-[200px]">
                              <div className="text-xs text-slate-400 mb-1">Current Price</div>
                              <div className="text-2xl font-bold text-white">
                                ${result.price ? result.price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : 'N/A'}
                              </div>
                              <div className={`text-sm font-medium ${(result.raw?.binance?.priceChangePercent24h || 0) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                                {(result.raw?.binance?.priceChangePercent24h || 0) >= 0 ? '+' : ''}{(result.raw?.binance?.priceChangePercent24h || 0).toFixed(2)}% (24h)
                              </div>
                            </div>

                            <div className="bg-slate-800/50 backdrop-blur-sm border border-slate-600/30 rounded-xl p-4 min-w-[150px]">
                              <div className="text-xs text-slate-400 mb-1">24h Range</div>
                              <div className="text-sm text-white">
                                <span className="text-red-400">${result.low24h ? result.low24h.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : 'N/A'}</span>
                                <span className="mx-2 text-slate-500">-</span>
                                <span className="text-green-400">${result.high24h ? result.high24h.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : 'N/A'}</span>
                              </div>
                            </div>

                            <div className="bg-slate-800/50 backdrop-blur-sm border border-slate-600/30 rounded-xl p-4 min-w-[150px]">
                              <div className="text-xs text-slate-400 mb-1">24h Volume</div>
                              <div className="text-sm font-bold text-white">
                                {result.volume24h ? `$${(result.volume24h / 1000000).toFixed(1)}M` : 'N/A'}
                              </div>
                            </div>
                          </div>
                        </div>

                        {/* Timestamp */}
                        <div className="absolute top-4 right-4 text-xs text-slate-500 font-mono">
                          {result.timestamp ? new Date(result.timestamp).toLocaleString('en-US', {
                            month: 'short',
                            day: '2-digit',
                            year: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                            second: '2-digit'
                          }) : 'Just now'}
                        </div>
                      </div>

                      {/* FINAL ANALYSIS CARD */}
                      <div className="relative bg-gradient-to-br from-slate-900/90 via-slate-800/90 to-slate-900/90 backdrop-blur-xl border border-slate-700/50 rounded-2xl p-6 shadow-2xl shadow-slate-900/50 overflow-hidden">
                        {/* Animated background */}
                        <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/5 via-blue-500/5 to-purple-500/5"></div>
                        <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-emerald-500 via-blue-500 to-purple-500"></div>

                        <div className="relative">
                          <div className="flex items-center justify-between mb-6">
                            <h3 className="text-xl font-bold text-white flex items-center gap-2">
                              <svg className="w-5 h-5 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                              </svg>
                              Final Analysis
                            </h3>

                            {/* Signal Badge */}
                            <div className={`px-6 py-3 rounded-xl font-bold text-lg shadow-lg ${
                              result.signal === 'BUY'
                                ? 'bg-gradient-to-r from-emerald-500 to-green-600 text-white shadow-emerald-500/30'
                                : result.signal === 'SELL'
                                ? 'bg-gradient-to-r from-red-500 to-rose-600 text-white shadow-red-500/30'
                                : 'bg-gradient-to-r from-amber-500 to-yellow-600 text-white shadow-amber-500/30'
                            }`}>
                              {result.signal || 'HOLD'}
                            </div>
                          </div>

                          {/* Confidence Meter */}
                          <div className="mb-6">
                            <div className="flex justify-between items-center mb-2">
                              <span className="text-sm font-medium text-slate-300">Confidence Level</span>
                              <span className="text-lg font-bold text-white">{result.accuracy ? (result.accuracy * 100).toFixed(1) : 0}%</span>
                            </div>
                            <div className="w-full bg-slate-700/50 rounded-full h-3 overflow-hidden">
                              <div
                                className={`h-full rounded-full transition-all duration-1000 ease-out ${
                                  ((result.accuracy || 0) * 100) >= 80 ? 'bg-gradient-to-r from-emerald-500 to-green-500' :
                                  ((result.accuracy || 0) * 100) >= 60 ? 'bg-gradient-to-r from-blue-500 to-cyan-500' :
                                  ((result.accuracy || 0) * 100) >= 40 ? 'bg-gradient-to-r from-amber-500 to-yellow-500' :
                                  'bg-gradient-to-r from-red-500 to-rose-500'
                                }`}
                                style={{ width: `${(result.accuracy || 0) * 100}%` }}
                              ></div>
                            </div>
                          </div>

                          {/* Analysis Reasoning */}
                          <details className="group">
                            <summary className="flex items-center justify-between cursor-pointer text-sm font-medium text-slate-300 hover:text-white transition-colors">
                              <span>Analysis Reasoning</span>
                              <svg className="w-4 h-4 transition-transform group-open:rotate-180" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                              </svg>
                            </summary>
                            <div className="mt-3 p-4 bg-slate-800/50 rounded-lg border border-slate-600/30">
                              <p className="text-sm text-slate-300 leading-relaxed">
                                FREE MODE Deep Research v1.5 completed with comprehensive technical indicators from multiple free data providers.
                              </p>
                            </div>
                          </details>
                        </div>
                      </div>

                      {/* INDICATORS GRID */}
                      <div className="relative bg-gradient-to-br from-slate-900/90 via-slate-800/90 to-slate-900/90 backdrop-blur-xl border border-slate-700/50 rounded-2xl p-6 shadow-2xl shadow-slate-900/50 overflow-hidden">
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

                          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                            {/* RSI */}
                            <div className="bg-slate-800/50 backdrop-blur-sm border border-slate-600/30 rounded-xl p-4 hover:bg-slate-800/70 transition-all duration-200">
                              <div className="flex items-center justify-between mb-2">
                                <span className="text-xs font-medium text-slate-400">RSI (14)</span>
                                <div className={`w-2 h-2 rounded-full ${
                                  (result.indicators?.rsi?.value || 0) > 70 ? 'bg-red-500' :
                                  (result.indicators?.rsi?.value || 0) < 30 ? 'bg-green-500' :
                                  'bg-blue-500'
                                }`}></div>
                              </div>
                              <div className="text-2xl font-bold text-white mb-2">{result.indicators?.rsi?.value?.toFixed(1) || '50.0'}</div>
                              <div className="w-full bg-slate-700/50 rounded-full h-1.5">
                                <div
                                  className={`h-full rounded-full transition-all duration-500 ${
                                    (result.indicators?.rsi?.value || 0) > 70 ? 'bg-gradient-to-r from-red-500 to-red-600' :
                                    (result.indicators?.rsi?.value || 0) < 30 ? 'bg-gradient-to-r from-green-500 to-green-600' :
                                    'bg-gradient-to-r from-blue-500 to-blue-600'
                                  }`}
                                  style={{ width: `${Math.min(100, Math.max(0, result.indicators?.rsi?.value || 50))}%` }}
                                ></div>
                              </div>
                              <div className="text-xs text-slate-400 mt-1">
                                {(result.indicators?.rsi?.value || 0) > 70 ? 'Overbought' :
                                 (result.indicators?.rsi?.value || 0) < 30 ? 'Oversold' :
                                 'Neutral'}
                              </div>
                            </div>

                            {/* MA50 */}
                            <div className="bg-slate-800/50 backdrop-blur-sm border border-slate-600/30 rounded-xl p-4 hover:bg-slate-800/70 transition-all duration-200">
                              <div className="flex items-center justify-between mb-2">
                                <span className="text-xs font-medium text-slate-400">SMA50</span>
                                <svg className={`w-3 h-3 ${
                                  (result.indicators?.sma?.sma50 || 0) > (result.raw?.binance?.price || 0) ? 'text-red-400' : 'text-green-400'
                                }`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                    d={(result.indicators?.sma?.sma50 || 0) > (result.raw?.binance?.price || 0) ? "M5 15l7-7 7 7" : "M19 9l-7 7-7-7"} />
                                </svg>
                              </div>
                              <div className="text-lg font-bold text-white">${result.indicators?.sma?.sma50?.toFixed(2) || 'N/A'}</div>
                              <div className={`text-xs mt-1 ${
                                (result.indicators?.sma?.sma50 || 0) > (result.raw?.binance?.price || 0) ? 'text-red-400' : 'text-green-400'
                              }`}>
                                {(result.indicators?.sma?.sma50 || 0) > (result.raw?.binance?.price || 0) ? 'Resistance' : 'Support'}
                              </div>
                            </div>

                            {/* SMA200 */}
                            <div className="bg-slate-800/50 backdrop-blur-sm border border-slate-600/30 rounded-xl p-4 hover:bg-slate-800/70 transition-all duration-200">
                              <div className="flex items-center justify-between mb-2">
                                <span className="text-xs font-medium text-slate-400">SMA200</span>
                                <svg className={`w-3 h-3 ${
                                  (result.indicators?.sma?.sma200 || 0) > (result.raw?.binance?.price || 0) ? 'text-red-400' : 'text-green-400'
                                }`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                    d={(result.indicators?.sma?.sma200 || 0) > (result.raw?.binance?.price || 0) ? "M5 15l7-7 7 7" : "M19 9l-7 7-7-7"} />
                                </svg>
                              </div>
                              <div className="text-lg font-bold text-white">${result.indicators?.sma?.sma200?.toFixed(2) || 'N/A'}</div>
                              <div className={`text-xs mt-1 ${
                                (result.indicators?.sma?.sma200 || 0) > (result.raw?.binance?.price || 0) ? 'text-red-400' : 'text-green-400'
                              }`}>
                                {(result.indicators?.sma?.sma200 || 0) > (result.raw?.binance?.price || 0) ? 'Resistance' : 'Support'}
                              </div>
                            </div>

                            {/* EMA50 */}
                            <div className="bg-slate-800/50 backdrop-blur-sm border border-slate-600/30 rounded-xl p-4 hover:bg-slate-800/70 transition-all duration-200">
                              <div className="flex items-center justify-between mb-2">
                                <span className="text-xs font-medium text-slate-400">EMA50</span>
                                <svg className={`w-3 h-3 ${
                                  (result.indicators?.ema?.ema50 || 0) > (result.raw?.binance?.price || 0) ? 'text-red-400' : 'text-green-400'
                                }`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                    d={(result.indicators?.ema?.ema50 || 0) > (result.raw?.binance?.price || 0) ? "M5 15l7-7 7 7" : "M19 9l-7 7-7-7"} />
                                </svg>
                              </div>
                              <div className="text-lg font-bold text-white">${result.indicators?.ema?.ema50?.toFixed(2) || 'N/A'}</div>
                              <div className={`text-xs mt-1 ${
                                (result.indicators?.ema?.ema50 || 0) > (result.raw?.binance?.price || 0) ? 'text-red-400' : 'text-green-400'
                              }`}>
                                {(result.indicators?.ema?.ema50 || 0) > (result.raw?.binance?.price || 0) ? 'Resistance' : 'Support'}
                              </div>
                            </div>

                            {/* EMA200 */}
                            <div className="bg-slate-800/50 backdrop-blur-sm border border-slate-600/30 rounded-xl p-4 hover:bg-slate-800/70 transition-all duration-200">
                              <div className="flex items-center justify-between mb-2">
                                <span className="text-xs font-medium text-slate-400">EMA200</span>
                                <svg className={`w-3 h-3 ${
                                  (result.indicators?.ema?.ema200 || 0) > (result.raw?.binance?.price || 0) ? 'text-red-400' : 'text-green-400'
                                }`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                    d={(result.indicators?.ema?.ema200 || 0) > (result.raw?.binance?.price || 0) ? "M5 15l7-7 7 7" : "M19 9l-7 7-7-7"} />
                                </svg>
                              </div>
                              <div className="text-lg font-bold text-white">${result.indicators?.ema?.ema200?.toFixed(2) || 'N/A'}</div>
                              <div className={`text-xs mt-1 ${
                                (result.indicators?.ema?.ema200 || 0) > (result.raw?.binance?.price || 0) ? 'text-red-400' : 'text-green-400'
                              }`}>
                                {(result.indicators?.ema?.ema200 || 0) > (result.raw?.binance?.price || 0) ? 'Resistance' : 'Support'}
                              </div>
                            </div>

                            {/* MACD */}
                            <div className="bg-slate-800/50 backdrop-blur-sm border border-slate-600/30 rounded-xl p-4 hover:bg-slate-800/70 transition-all duration-200">
                              <div className="flex items-center justify-between mb-2">
                                <span className="text-xs font-medium text-slate-400">MACD</span>
                                <div className={`w-2 h-2 rounded-full ${
                                  (result.indicators?.macd?.value || 0) > 0 ? 'bg-green-500' :
                                  (result.indicators?.macd?.value || 0) < 0 ? 'bg-red-500' :
                                  'bg-slate-500'
                                }`}></div>
                              </div>
                              <div className="text-lg font-bold text-white">{(result.indicators?.macd?.value || 0).toFixed(4)}</div>
                              <div className={`text-xs mt-1 ${
                                (result.indicators?.macd?.value || 0) > 0 ? 'text-green-400' :
                                (result.indicators?.macd?.value || 0) < 0 ? 'text-red-400' :
                                'text-slate-400'
                              }`}>
                                {(result.indicators?.macd?.value || 0) > 0 ? 'Bullish' :
                                 (result.indicators?.macd?.value || 0) < 0 ? 'Bearish' :
                                 'Neutral'}
                              </div>
                            </div>

                            {/* VWAP */}
                            <div className="bg-slate-800/50 backdrop-blur-sm border border-slate-600/30 rounded-xl p-4 hover:bg-slate-800/70 transition-all duration-200 md:col-span-2">
                              <div className="flex items-center justify-between mb-2">
                                <span className="text-xs font-medium text-slate-400">VWAP</span>
                                <span className={`px-2 py-1 rounded text-xs font-medium ${
                                  (result.indicators?.vwap?.signal === 'bullish') ? 'bg-green-500/20 text-green-400' :
                                  (result.indicators?.vwap?.signal === 'bearish') ? 'bg-red-500/20 text-red-400' :
                                  'bg-blue-500/20 text-blue-400'
                                }`}>
                                  {result.indicators?.vwap?.signal === 'bullish' ? 'Bullish' :
                                   result.indicators?.vwap?.signal === 'bearish' ? 'Bearish' :
                                   'Neutral'}
                                </span>
                              </div>
                              <div className="text-lg font-bold text-white">
                                Signal: {result.indicators?.vwap?.signal || 'N/A'}
                              </div>
                              <div className="text-sm text-slate-400 mt-1">
                                Deviation: {result.indicators?.vwap?.deviation?.toFixed(4) || 'N/A'}
                              </div>
                            </div>

                            {/* ATR Volatility */}
                            <div className="bg-slate-800/50 backdrop-blur-sm border border-slate-600/30 rounded-xl p-4 hover:bg-slate-800/70 transition-all duration-200 md:col-span-2">
                              <div className="flex items-center justify-between mb-2">
                                <span className="text-xs font-medium text-slate-400">ATR Volatility</span>
                                <span className={`px-2 py-1 rounded text-xs font-medium ${
                                  (result.indicators?.atr?.value || 0) > 3 ? 'bg-red-500/20 text-red-400' :
                                  (result.indicators?.atr?.value || 0) > 1.5 ? 'bg-amber-500/20 text-amber-400' :
                                  'bg-green-500/20 text-green-400'
                                }`}>
                                  {(result.indicators?.atr?.value || 0) > 3 ? 'High Volatility' :
                                   (result.indicators?.atr?.value || 0) > 1.5 ? 'Medium Volatility' :
                                   'Low Volatility'}
                                </span>
                              </div>
                              <div className="text-lg font-bold text-white">
                                {result.indicators?.atr?.value?.toFixed(2) || 'N/A'}
                              </div>
                              <div className="w-full bg-slate-700/50 rounded-full h-1.5 mt-2">
                                <div
                                  className={`h-full rounded-full transition-all duration-500 ${
                                    (result.indicators?.atr?.value || 0) > 3 ? 'bg-gradient-to-r from-red-500 to-red-600' :
                                    (result.indicators?.atr?.value || 0) > 1.5 ? 'bg-gradient-to-r from-amber-500 to-amber-600' :
                                    'bg-gradient-to-r from-green-500 to-green-600'
                                  }`}
                                  style={{ width: `${Math.min(100, (result.indicators?.atr?.value || 0) * 10)}%` }}
                                ></div>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* RAW API OUTPUT SECTION */}
                      <div className="relative bg-gradient-to-br from-slate-900/90 via-slate-800/90 to-slate-900/90 backdrop-blur-xl border border-slate-700/50 rounded-2xl p-6 shadow-2xl shadow-slate-900/50 overflow-hidden">
                        {/* Animated background */}
                        <div className="absolute inset-0 bg-gradient-to-br from-violet-500/5 via-purple-500/5 to-pink-500/5"></div>
                        <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-violet-500 via-purple-500 to-pink-500"></div>

                        <div className="relative">
                          <h3 className="text-xl font-bold text-white mb-6 flex items-center gap-2">
                            <svg className="w-5 h-5 text-violet-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                            </svg>
                            API Data Sources
                          </h3>

                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {/* Binance Public API */}
                            <ProviderCard
                              icon={<span className="text-orange-400 font-bold text-sm">B</span>}
                              name="Binance Public"
                              description="Price & Orderbook"
                              status={result.providers?.binance?.success ? 'Success' : 'Failed'}
                              latencyMs={result.providers?.binance?.latency || 0}
                              jsonData={result.providers?.binance?.data || {}}
                            />

                            {/* CryptoCompare API */}
                            <ProviderCard
                              icon={<span className="text-blue-400 font-bold text-sm">🟦</span>}
                              name="CryptoCompare"
                              description="OHLC Candles"
                              status={result.providers?.cryptocompare?.success ? 'Success' : 'Failed'}
                              latencyMs={result.providers?.cryptocompare?.latency || 0}
                              jsonData={result.providers?.cryptocompare?.data || {}}
                            >
                              <div className="space-y-2">
                                {result.raw?.cryptocompare && (
                                  <>
                                    <div className="flex justify-between items-center">
                                      <span className="text-sm text-slate-400">1h Trend:</span>
                                      <span className={`text-sm font-medium ${
                                        result.raw.cryptocompare.trend1h === 'bullish' ? 'text-green-400' :
                                        result.raw.cryptocompare.trend1h === 'bearish' ? 'text-red-400' : 'text-slate-400'
                                      }`}>
                                        {result.raw.cryptocompare.trend1h || 'neutral'}
                                      </span>
                                    </div>
                                    <div className="flex justify-between items-center">
                                      <span className="text-sm text-slate-400">1d Trend:</span>
                                      <span className={`text-sm font-medium ${
                                        result.raw.cryptocompare.trend1d === 'bullish' ? 'text-green-400' :
                                        result.raw.cryptocompare.trend1d === 'bearish' ? 'text-red-400' : 'text-slate-400'
                                      }`}>
                                        {result.raw.cryptocompare.trend1d || 'neutral'}
                                      </span>
                                    </div>
                                    <div className="flex justify-between items-center">
                                      <span className="text-sm text-slate-400">Confirmation:</span>
                                      <span className={`text-sm font-medium ${
                                        result.raw.cryptocompare.confirmationSignal === 'bullish' ? 'text-green-400' :
                                        result.raw.cryptocompare.confirmationSignal === 'bearish' ? 'text-red-400' : 'text-slate-400'
                                      }`}>
                                        {result.raw.cryptocompare.confirmationSignal || 'neutral'}
                                      </span>
                                    </div>
                                  </>
                                )}
                              </div>
                            </ProviderCard>

                            {/* CoinMarketCap API */}
                            <ProviderCard
                              icon={<span className="text-cyan-400 font-bold text-sm">🪙</span>}
                              name="CoinMarketCap"
                              description="Market Data"
                              status={result.providers?.cmc?.success ? 'Success' : 'Failed'}
                              latencyMs={result.providers?.cmc?.latency || 0}
                              jsonData={result.providers?.cmc?.data || {}}
                            >
                              <div className="space-y-2">
                                {result.metadata && (
                                  <>
                                    <div className="flex justify-between items-center">
                                      <span className="text-sm text-slate-400">Name:</span>
                                      <span className="text-sm font-medium text-white">
                                        {result.metadata.name || 'N/A'}
                                      </span>
                                    </div>
                                    <div className="flex justify-between items-center">
                                      <span className="text-sm text-slate-400">Category:</span>
                                      <span className="text-sm font-medium text-white">
                                        {result.metadata.category || 'N/A'}
                                      </span>
                                    </div>
                                    <div className="flex justify-between items-center">
                                      <span className="text-sm text-slate-400">Rank:</span>
                                      <span className="text-sm font-medium text-white">
                                        #{result.metadata.rank || 'N/A'}
                                      </span>
                                    </div>
                                    <div className="flex justify-between items-center">
                                      <span className="text-sm text-slate-400">Supply:</span>
                                      <span className="text-sm font-medium text-white">
                                        {formatMarketCap(result.metadata.supply?.circulating || 0)}
                                      </span>
                                    </div>
                                  </>
                                )}
                              </div>
                            </ProviderCard>

                            {/* Crypto News */}
                            <ProviderCard
                              icon={<span className="text-green-400 font-bold text-sm">📰</span>}
                              name="Crypto News"
                              description="Latest Articles"
                              status={result.providers?.news?.success ? 'Success' : 'Failed'}
                              latencyMs={result.providers?.news?.latency || 0}
                              sentiment={result.providers?.news?.data?.sentimentScore}
                              articles={result.news?.articles || []}
                              jsonData={result.providers?.news?.data || {}}
                            >
                              {(!result.raw?.news || !result.news?.articles?.length) && (
                                <div className="text-center py-4">
                                  <p className="text-sm text-slate-400">No recent news found (normal for some assets)</p>
                                </div>
                              )}
                            </ProviderCard>

                            {/* Provider Status Summary */}
                            <ProviderCard
                              icon={<span className="text-blue-400 font-bold text-sm">📊</span>}
                              name="Provider Status"
                              description="Data Sources Used"
                              status={result.providers ? 'Success' : 'Failed'}
                              latencyMs={0}
                              jsonData={{
                                binance: result.providers?.binance?.success ? `Success (${result.providers.binance.latency}ms)` : `Failed: ${result.providers?.binance?.error || 'Unknown error'}`,
                                cryptocompare: result.providers?.cryptocompare?.success ? `Success (${result.providers.cryptocompare.latency}ms)` : `Failed: ${result.providers?.cryptocompare?.error || 'Unknown error'}`,
                                cmc: result.providers?.cmc?.success ? `Success (${result.providers.cmc.latency}ms)` : `Failed: ${result.providers?.cmc?.error || 'Unknown error'}`,
                                news: result.providers?.news?.success ? `Success (${result.providers.news.latency}ms)` : `Failed: ${result.providers?.news?.error || 'Unknown error'}`
                              }}
                            >
                              <div className="space-y-2">
                                <div className="flex justify-between items-center py-1">
                                  <span className="text-sm text-slate-300">Binance (Primary)</span>
                                  <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                                    result.providers?.binance?.success ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'
                                  }`}>
                                    {result.providers?.binance?.success ? `${result.providers.binance.latency}ms` : `Failed: ${result.providers?.binance?.error || 'Unknown'}`}
                                  </span>
                                </div>
                                <div className="flex justify-between items-center py-1">
                                  <span className="text-sm text-slate-300">CryptoCompare</span>
                                  <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                                    result.providers?.cryptocompare?.success ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'
                                  }`}>
                                    {result.providers?.cryptocompare?.success ? `${result.providers.cryptocompare.latency}ms` : `Failed: ${result.providers?.cryptocompare?.error || 'Unknown'}`}
                                  </span>
                                </div>
                                <div className="flex justify-between items-center py-1">
                                  <span className="text-sm text-slate-300">CoinMarketCap</span>
                                  <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                                    result.providers?.cmc?.success ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'
                                  }`}>
                                    {result.providers?.cmc?.success ? `${result.providers.cmc.latency}ms` : `Failed: ${result.providers?.cmc?.error || 'Unknown'}`}
                                  </span>
                                </div>
                                <div className="flex justify-between items-center py-1">
                                  <span className="text-sm text-slate-300">News Data</span>
                                  <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                                    result.providers?.news?.success ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'
                                  }`}>
                                    {result.providers?.news?.success ? `${result.providers.news.latency}ms` : `Failed: ${result.providers?.news?.error || 'Unknown'}`}
                                  </span>
                                </div>
                              </div>
                            </ProviderCard>

                            {/* Raw JSON Viewer */}
                            <ProviderCard
                              icon={<span className="text-purple-400 font-bold text-sm">🔧</span>}
                              name="Raw Data"
                              description="Complete Backend Response"
                              status="Success"
                              latencyMs={0}
                              jsonData={{
                                providers: result.providers,
                                indicators: result.indicators,
                                metadata: result.metadata,
                                news: result.news,
                                signals: {
                                  signal: result.signal,
                                  accuracy: result.accuracy,
                                  price: result.price
                                }
                              }}
                            />
                          </div>
                        </div>
                      </div>

                      {/* DEEP ANALYSIS SECTION */}
                      <div className="relative bg-gradient-to-br from-slate-900/90 via-slate-800/90 to-slate-900/90 backdrop-blur-xl border border-slate-700/50 rounded-2xl p-6 shadow-2xl shadow-slate-900/50 overflow-hidden">
                        {/* Animated background */}
                        <div className="absolute inset-0 bg-gradient-to-br from-rose-500/5 via-pink-500/5 to-purple-500/5"></div>
                        <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-rose-500 via-pink-500 to-purple-500"></div>

                        <div className="relative">
                          <h3 className="text-xl font-bold text-white mb-6 flex items-center gap-2">
                            <svg className="w-5 h-5 text-rose-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                            </svg>
                            Deep Technical Analysis
                          </h3>

                          <div className="space-y-4">
                            {/* RSI Analysis */}
                            <details className="group bg-slate-800/50 backdrop-blur-sm border border-slate-600/30 rounded-xl overflow-hidden hover:bg-slate-800/70 transition-all duration-200">
                              <summary className="flex items-center justify-between p-4 cursor-pointer">
                                <div className="flex items-center gap-3">
                                  <div className={`w-3 h-3 rounded-full ${
                                    (result.indicators?.rsi?.value || 0) > 70 ? 'bg-red-500' :
                                    (result.indicators?.rsi?.value || 0) < 30 ? 'bg-green-500' :
                                    'bg-blue-500'
                                  }`}></div>
                                  <span className="text-sm font-medium text-white">RSI Analysis</span>
                                  <span className="text-lg font-bold text-white">{result.indicators?.rsi?.value?.toFixed(1) || '50.0'}</span>
                                </div>
                                <div className="flex items-center gap-2">
                                  <span className={`px-2 py-1 rounded text-xs font-medium ${
                                    (result.indicators?.rsi?.value || 0) > 70 ? 'bg-red-500/20 text-red-400' :
                                    (result.indicators?.rsi?.value || 0) < 30 ? 'bg-green-500/20 text-green-400' :
                                    'bg-blue-500/20 text-blue-400'
                                  }`}>
                                    {(result.indicators?.rsi?.value || 0) > 70 ? 'Overbought' :
                                     (result.indicators?.rsi?.value || 0) < 30 ? 'Oversold' :
                                     'Neutral'}
                                  </span>
                                  <svg className="w-4 h-4 text-slate-400 transition-transform group-open:rotate-180" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                  </svg>
                                </div>
                              </summary>
                              <div className="px-4 pb-4 border-t border-slate-600/20">
                                <div className="grid grid-cols-2 gap-4 mt-3">
                                  <div className="bg-slate-900/50 rounded-lg p-3">
                                    <div className="text-xs text-slate-400 mb-1">Value</div>
                                    <div className="text-lg font-bold text-white">{result.indicators?.rsi?.value?.toFixed(2) || 'N/A'}</div>
                                  </div>
                                  <div className="bg-slate-900/50 rounded-lg p-3">
                                    <div className="text-xs text-slate-400 mb-1">Strength</div>
                                    <div className="text-lg font-bold text-white">{result.indicators?.rsi?.strength?.toFixed(2) || 'N/A'}</div>
                                  </div>
                                </div>
                                <div className="mt-3 text-xs text-slate-400">
                                  RSI measures price momentum on a scale of 0-100. Values above 70 indicate overbought conditions, below 30 indicate oversold conditions.
                                </div>
                              </div>
                            </details>

                            {/* Volume Analysis */}
                            <details className="group bg-slate-800/50 backdrop-blur-sm border border-slate-600/30 rounded-xl overflow-hidden hover:bg-slate-800/70 transition-all duration-200">
                              <summary className="flex items-center justify-between p-4 cursor-pointer">
                                <div className="flex items-center gap-3">
                                  <svg className="w-4 h-4 text-cyan-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 12l3-3 3 3 4-4M8 21l4-4 4 4M3 4h18M4 4h16v12a1 1 0 01-1 1H5a1 1 0 01-1-1V4z" />
                                  </svg>
                                  <span className="text-sm font-medium text-white">Volume Analysis</span>
                                </div>
                                <div className="flex items-center gap-2">
                                  <span className={`px-2 py-1 rounded text-xs font-medium ${
                                    (result.indicators?.volume?.score || 0) > 0.6 ? 'bg-green-500/20 text-green-400' :
                                    (result.indicators?.volume?.score || 0) < 0.4 ? 'bg-red-500/20 text-red-400' :
                                    'bg-amber-500/20 text-amber-400'
                                  }`}>
                                    {result.indicators?.volume?.trend || 'neutral'}
                                  </span>
                                  <svg className="w-4 h-4 text-slate-400 transition-transform group-open:rotate-180" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                  </svg>
                                </div>
                              </summary>
                              <div className="px-4 pb-4 border-t border-slate-600/20">
                                <div className="grid grid-cols-2 gap-4 mt-3">
                                  <div className="bg-slate-900/50 rounded-lg p-3">
                                    <div className="text-xs text-slate-400 mb-1">Volume Score</div>
                                    <div className="text-lg font-bold text-white">{((result.indicators?.volume?.score || 0) * 100).toFixed(0)}%</div>
                                  </div>
                                  <div className="bg-slate-900/50 rounded-lg p-3">
                                    <div className="text-xs text-slate-400 mb-1">Trend</div>
                                    <div className="text-lg font-bold text-white capitalize">{result.indicators?.volume?.trend || 'Neutral'}</div>
                                  </div>
                                </div>
                              </div>
                            </details>

                            {/* Momentum Analysis */}
                            <details className="group bg-slate-800/50 backdrop-blur-sm border border-slate-600/30 rounded-xl overflow-hidden hover:bg-slate-800/70 transition-all duration-200">
                              <summary className="flex items-center justify-between p-4 cursor-pointer">
                                <div className="flex items-center gap-3">
                                  <svg className="w-4 h-4 text-yellow-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                                  </svg>
                                  <span className="text-sm font-medium text-white">Momentum Analysis</span>
                                </div>
                                <div className="flex items-center gap-2">
                                  <span className={`px-2 py-1 rounded text-xs font-medium ${
                                    result.deepAnalysis?.momentum?.direction === 'bullish' ? 'bg-green-500/20 text-green-400' :
                                    result.deepAnalysis?.momentum?.direction === 'bearish' ? 'bg-red-500/20 text-red-400' :
                                    'bg-slate-500/20 text-slate-400'
                                  }`}>
                                    {result.deepAnalysis?.momentum?.direction || 'neutral'}
                                  </span>
                                  <svg className="w-4 h-4 text-slate-400 transition-transform group-open:rotate-180" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                  </svg>
                                </div>
                              </summary>
                              <div className="px-4 pb-4 border-t border-slate-600/20">
                                <div className="grid grid-cols-2 gap-4 mt-3">
                                  <div className="bg-slate-900/50 rounded-lg p-3">
                                    <div className="text-xs text-slate-400 mb-1">Momentum Score</div>
                                    <div className="text-lg font-bold text-white">{((result.deepAnalysis?.momentum?.score || 0) * 100).toFixed(0)}%</div>
                                  </div>
                                  <div className="bg-slate-900/50 rounded-lg p-3">
                                    <div className="text-xs text-slate-400 mb-1">Direction</div>
                                    <div className="text-lg font-bold text-white capitalize">{result.deepAnalysis?.momentum?.direction || 'Neutral'}</div>
                                  </div>
                                </div>
                              </div>
                            </details>

                            {/* Trend Analysis */}
                            <details className="group bg-slate-800/50 backdrop-blur-sm border border-slate-600/30 rounded-xl overflow-hidden hover:bg-slate-800/70 transition-all duration-200">
                              <summary className="flex items-center justify-between p-4 cursor-pointer">
                                <div className="flex items-center gap-3">
                                  <svg className="w-4 h-4 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                                  </svg>
                                  <span className="text-sm font-medium text-white">Trend Analysis</span>
                                </div>
                                <div className="flex items-center gap-2">
                                  <div className="flex gap-1">
                                    <span className={`px-2 py-1 rounded text-xs font-medium ${
                                      result.deepAnalysis?.trend?.emaTrend === 'bullish' ? 'bg-green-500/20 text-green-400' :
                                      result.deepAnalysis?.trend?.emaTrend === 'bearish' ? 'bg-red-500/20 text-red-400' :
                                      'bg-slate-500/20 text-slate-400'
                                    }`}>
                                      EMA: {result.deepAnalysis?.trend?.emaTrend || 'neutral'}
                                    </span>
                                    <span className={`px-2 py-1 rounded text-xs font-medium ${
                                      result.deepAnalysis?.trend?.smaTrend === 'bullish' ? 'bg-green-500/20 text-green-400' :
                                      result.deepAnalysis?.trend?.smaTrend === 'bearish' ? 'bg-red-500/20 text-red-400' :
                                      'bg-slate-500/20 text-slate-400'
                                    }`}>
                                      SMA: {result.deepAnalysis?.trend?.smaTrend || 'neutral'}
                                    </span>
                                  </div>
                                  <svg className="w-4 h-4 text-slate-400 transition-transform group-open:rotate-180" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                  </svg>
                                </div>
                              </summary>
                              <div className="px-4 pb-4 border-t border-slate-600/20">
                                <div className="grid grid-cols-2 gap-4 mt-3">
                                  <div className="bg-slate-900/50 rounded-lg p-3">
                                    <div className="text-xs text-slate-400 mb-1">EMA Trend</div>
                                    <div className="text-sm font-bold text-white capitalize">{result.deepAnalysis?.trend?.emaTrend || 'Neutral'}</div>
                                  </div>
                                  <div className="bg-slate-900/50 rounded-lg p-3">
                                    <div className="text-xs text-slate-400 mb-1">SMA Trend</div>
                                    <div className="text-sm font-bold text-white capitalize">{result.deepAnalysis?.trend?.smaTrend || 'Neutral'}</div>
                                  </div>
                                </div>
                              </div>
                            </details>

                            {/* Support & Resistance */}
                            <details className="group bg-slate-800/50 backdrop-blur-sm border border-slate-600/30 rounded-xl overflow-hidden hover:bg-slate-800/70 transition-all duration-200">
                              <summary className="flex items-center justify-between p-4 cursor-pointer">
                                <div className="flex items-center gap-3">
                                  <svg className="w-4 h-4 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                                  </svg>
                                  <span className="text-sm font-medium text-white">Support & Resistance</span>
                                </div>
                                <div className="flex items-center gap-2">
                                  <span className={`px-2 py-1 rounded text-xs font-medium ${
                                    result.deepAnalysis?.supportResistance?.nearSupport ? 'bg-green-500/20 text-green-400' :
                                    result.deepAnalysis?.supportResistance?.nearResistance ? 'bg-red-500/20 text-red-400' :
                                    'bg-slate-500/20 text-slate-400'
                                  }`}>
                                    {result.deepAnalysis?.supportResistance?.nearSupport ? 'Near Support' :
                                     result.deepAnalysis?.supportResistance?.nearResistance ? 'Near Resistance' :
                                     'No Key Levels'}
                                  </span>
                                  <svg className="w-4 h-4 text-slate-400 transition-transform group-open:rotate-180" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                  </svg>
                                </div>
                              </summary>
                              <div className="px-4 pb-4 border-t border-slate-600/20">
                                <div className="grid grid-cols-2 gap-4 mt-3">
                                  <div className="bg-slate-900/50 rounded-lg p-3">
                                    <div className="text-xs text-slate-400 mb-1">Near Support</div>
                                    <div className={`text-sm font-bold ${result.deepAnalysis?.supportResistance?.nearSupport ? 'text-green-400' : 'text-slate-400'}`}>
                                      {result.deepAnalysis?.supportResistance?.nearSupport ? 'Yes' : 'No'}
                                    </div>
                                  </div>
                                  <div className="bg-slate-900/50 rounded-lg p-3">
                                    <div className="text-xs text-slate-400 mb-1">Near Resistance</div>
                                    <div className={`text-sm font-bold ${result.deepAnalysis?.supportResistance?.nearResistance ? 'text-red-400' : 'text-slate-400'}`}>
                                      {result.deepAnalysis?.supportResistance?.nearResistance ? 'Yes' : 'No'}
                                    </div>
                                  </div>
                                </div>
                                <div className="mt-3 text-xs text-slate-400">
                                  Support levels provide buying opportunities, resistance levels provide selling opportunities.
                                </div>
                              </div>
                            </details>

                            {/* Price Action Patterns */}
                            <details className="group bg-slate-800/50 backdrop-blur-sm border border-slate-600/30 rounded-xl overflow-hidden hover:bg-slate-800/70 transition-all duration-200">
                              <summary className="flex items-center justify-between p-4 cursor-pointer">
                                <div className="flex items-center gap-3">
                                  <svg className="w-4 h-4 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 100 4m0-4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 100 4m0-4v2m0-6V4" />
                                  </svg>
                                  <span className="text-sm font-medium text-white">Price Action Patterns</span>
                                </div>
                                <div className="flex items-center gap-2">
                                  <span className={`px-2 py-1 rounded text-xs font-medium ${
                                    (result.deepAnalysis?.priceAction?.confidence || 0) > 0.7 ? 'bg-emerald-500/20 text-emerald-400' :
                                    (result.deepAnalysis?.priceAction?.confidence || 0) > 0.5 ? 'bg-blue-500/20 text-blue-400' :
                                    'bg-slate-500/20 text-slate-400'
                                  }`}>
                                    {result.deepAnalysis?.priceAction?.pattern || 'none'}
                                  </span>
                                  <svg className="w-4 h-4 text-slate-400 transition-transform group-open:rotate-180" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                  </svg>
                                </div>
                              </summary>
                              <div className="px-4 pb-4 border-t border-slate-600/20">
                                <div className="grid grid-cols-2 gap-4 mt-3">
                                  <div className="bg-slate-900/50 rounded-lg p-3">
                                    <div className="text-xs text-slate-400 mb-1">Pattern</div>
                                    <div className="text-sm font-bold text-white capitalize">{result.deepAnalysis?.priceAction?.pattern || 'None'}</div>
                                  </div>
                                  <div className="bg-slate-900/50 rounded-lg p-3">
                                    <div className="text-xs text-slate-400 mb-1">Confidence</div>
                                    <div className="text-sm font-bold text-white">{((result.deepAnalysis?.priceAction?.confidence || 0) * 100).toFixed(0)}%</div>
                                  </div>
                                </div>
                              </div>
                            </details>

                            {/* VWAP Analysis */}
                            <details className="group bg-slate-800/50 backdrop-blur-sm border border-slate-600/30 rounded-xl overflow-hidden hover:bg-slate-800/70 transition-all duration-200">
                              <summary className="flex items-center justify-between p-4 cursor-pointer">
                                <div className="flex items-center gap-3">
                                  <svg className="w-4 h-4 text-cyan-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 8v8m-4-5v5m-4-2v2m-2 4h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                                  </svg>
                                  <span className="text-sm font-medium text-white">VWAP Analysis</span>
                                </div>
                                <div className="flex items-center gap-2">
                                  <span className={`px-2 py-1 rounded text-xs font-medium ${
                                    (result.deepAnalysis?.vwap?.deviationPct || 0) < -0.5 ? 'bg-green-500/20 text-green-400' :
                                    (result.deepAnalysis?.vwap?.deviationPct || 0) > 0.5 ? 'bg-red-500/20 text-red-400' :
                                    'bg-blue-500/20 text-blue-400'
                                  }`}>
                                    {(result.deepAnalysis?.vwap?.deviationPct || 0) < -0.5 ? 'Below VWAP' :
                                     (result.deepAnalysis?.vwap?.deviationPct || 0) > 0.5 ? 'Above VWAP' :
                                     'At VWAP'}
                                  </span>
                                  <svg className="w-4 h-4 text-slate-400 transition-transform group-open:rotate-180" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                  </svg>
                                </div>
                              </summary>
                              <div className="px-4 pb-4 border-t border-slate-600/20">
                                <div className="mt-3 bg-slate-900/50 rounded-lg p-3">
                                  <div className="text-xs text-slate-400 mb-2">Price Deviation from VWAP</div>
                                  <div className="flex items-center gap-4">
                                    <div className="text-2xl font-bold text-white">
                                      {result.result?.indicators?.vwap?.deviationPct?.toFixed(2) || 'N/A'}%
                                    </div>
                                    <div className={`px-3 py-1 rounded-lg text-sm font-medium ${
                                      (result.deepAnalysis?.vwap?.deviationPct || 0) < -0.5 ? 'bg-green-500/20 text-green-400' :
                                      (result.deepAnalysis?.vwap?.deviationPct || 0) > 0.5 ? 'bg-red-500/20 text-red-400' :
                                      'bg-blue-500/20 text-blue-400'
                                    }`}>
                                      {result.deepAnalysis?.vwap?.signal || 'neutral'}
                                    </div>
                                  </div>
                                </div>
                              </div>
                            </details>

                            {/* Trading Signals */}
                            <details className="group bg-slate-800/50 backdrop-blur-sm border border-slate-600/30 rounded-xl overflow-hidden hover:bg-slate-800/70 transition-all duration-200">
                              <summary className="flex items-center justify-between p-4 cursor-pointer">
                                <div className="flex items-center gap-3">
                                  <svg className="w-4 h-4 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 3.055A9.001 9.001 0 1020.945 13H11V3.055z" />
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.488 9H15V3.512A9.025 9.025 0 0120.488 9z" />
                                  </svg>
                                  <span className="text-sm font-medium text-white">Trading Signals</span>
                                  <span className="px-2 py-1 bg-slate-700/50 rounded text-xs text-slate-300">
                                    {result.deepAnalysis?.signals?.length || 0} signals
                                  </span>
                                </div>
                                <svg className="w-4 h-4 text-slate-400 transition-transform group-open:rotate-180" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                </svg>
                              </summary>
                              <div className="px-4 pb-4 border-t border-slate-600/20">
                                <div className="space-y-2 mt-3 max-h-48 overflow-y-auto">
                                  {result.deepAnalysis?.signals && result.deepAnalysis.signals.length > 0 ? (
                                    result.deepAnalysis.signals.slice(0, 5).map((signal: any, index: number) => (
                                      <div key={index} className="flex items-center justify-between bg-slate-900/50 rounded-lg p-3">
                                        <div className="flex items-center gap-3">
                                          <span className="text-xs font-medium text-slate-400 w-16">{signal.name}</span>
                                          <span className={`px-2 py-1 rounded text-xs font-medium ${
                                            signal.action === 'BUY' ? 'bg-green-500/20 text-green-400' :
                                            signal.action === 'SELL' ? 'bg-red-500/20 text-red-400' :
                                            'bg-slate-500/20 text-slate-400'
                                          }`}>
                                            {signal.action}
                                          </span>
                                        </div>
                                        <span className="text-sm font-bold text-white">
                                          {(signal.score * 100).toFixed(0)}%
                                        </span>
                                      </div>
                                    ))
                                  ) : (
                                    <div className="text-center text-slate-400 py-4">
                                      No trading signals generated
                                    </div>
                                  )}
                                </div>
                              </div>
                            </details>
                          </div>
                        </div>
                      </div>


                      {/* FREE MODE Analysis v1.5 */}
                      <div className="bg-gradient-to-br from-purple-500/10 to-pink-500/10 rounded-lg p-4 border border-purple-500/30">
                        <h4 className="text-sm font-semibold text-purple-300 mb-2">FREE MODE Analysis v1.5</h4>
                        <div className="text-sm text-gray-200">
                          Analysis completed using Binance primary with Bybit/OKX/KuCoin backups, CryptoCompare trends, CMC metadata, and NewsData sentiment.
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

            {/* Live Research Card */}
            {liveData && (
              <div className="relative bg-black/30 backdrop-blur-xl border border-cyan-500/30 rounded-2xl p-6 shadow-2xl shadow-cyan-500/10 hover:shadow-cyan-500/20 transition-all duration-300 overflow-hidden">
                {/* Gradient accent line */}
                <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-cyan-500 via-blue-500 to-purple-500"></div>
                
                <div className="flex items-center justify-between mb-6">
                  <div>
                    <h2 className="text-xl sm:text-2xl font-bold bg-gradient-to-r from-cyan-400 to-blue-400 bg-clip-text text-transparent mb-1">
                      Live Research
                    </h2>
                    <p className="text-xs text-gray-400 flex items-center gap-2">
                      <span className="w-2 h-2 bg-cyan-400 rounded-full animate-pulse"></span>
                      Real-time updates
                    </p>
                  </div>
                </div>
                <div className="bg-gradient-to-br from-cyan-500/10 via-blue-500/10 to-purple-500/10 border border-cyan-400/30 rounded-xl p-5 mb-4 backdrop-blur-sm">
                  <div className="flex items-center justify-between mb-4">
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 flex-1">
                      <div>
                        <div className="text-sm text-gray-400">Symbol</div>
                        <div className="font-semibold text-white">{liveData.symbol}</div>
                      </div>
                      <div>
                        <div className="text-sm text-gray-400">Signal</div>
                        <div className={`font-semibold ${
                          liveData.signal === 'BUY' ? 'text-green-400' :
                          liveData.signal === 'SELL' ? 'text-red-400' :
                          'text-gray-400'
                        }`}>
                          {liveData.signal}
                        </div>
                      </div>
                      <div>
                        <div className="text-sm text-gray-400">Accuracy</div>
                        <div className={`font-semibold ${
                          liveData.accuracy >= 0.85 ? 'text-green-400' :
                          liveData.accuracy >= 0.7 ? 'text-yellow-400' :
                          'text-red-400'
                        }`}>
                          {((liveData.accuracy ?? 0) * 100).toFixed(1)}%
                        </div>
                      </div>
                      <div>
                        <div className="text-sm text-gray-400">Imbalance</div>
                        <div className="font-semibold text-white">
                          {((liveData.orderbookImbalance ?? 0) * 100).toFixed(2)}%
                        </div>
                      </div>
                    </div>
                    <div className="ml-4">
                      {canExecute(liveData.accuracy) && liveData.signal !== 'HOLD' ? (
                        <span className="inline-flex items-center px-3 py-1.5 rounded-full text-sm font-medium bg-green-500/20 text-green-300 border border-green-400/30">
                          ✓ Can Execute
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-3 py-1.5 rounded-full text-sm font-medium bg-yellow-500/20 text-yellow-300 border border-yellow-400/30">
                          ⏸ Will Skip
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="mt-4 pt-4 border-t border-blue-400/20">
                    <div className="text-sm text-gray-400">Action</div>
                    <div className="font-medium text-white">{liveData.recommendedAction}</div>
                    {settings && (
                      <div className="mt-2 text-xs text-gray-400">
                        Strategy: {settings.strategy || 'orderbook_imbalance'} | 
                        Threshold: {(settings.minAccuracyThreshold || 0.85) * 100}% | 
                        Auto-Trade: {settings.autoTradeEnabled ? 'Enabled' : 'Disabled'}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

          </div>
        </div>
      </main>


      {toast && <Toast message={toast.message} type={toast.type} />}
    </div>
  );
}
