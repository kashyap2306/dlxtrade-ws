import { useState, useEffect } from 'react';
import { researchApi, settingsApi } from '../services/api';
import { wsService } from '../services/ws';
import Toast from '../components/Toast';
import Sidebar from '../components/Sidebar';
import Header from '../components/Header';
import { useError } from '../contexts/ErrorContext';
import { useNotificationContext } from '../contexts/NotificationContext';
import { getApiErrorMessage, suppressConsoleError } from '../utils/errorHandler';
import { useAuth } from '../hooks/useAuth';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../config/firebase';

interface ResearchLog {
  id: string;
  symbol: string;
  timestamp: string;
  signal: 'BUY' | 'SELL' | 'HOLD';
  accuracy: number;
  orderbookImbalance: number;
  recommendedAction: string;
  microSignals: any;
}

interface ManualResearchResult {
  symbol: string;
  accuracy: number;
  price: number;
  trend: string;
  suggestion: 'BUY' | 'SELL';
  reasoning: string;
  indicators?: {
    rsi: number;
    trendStrength: number;
    volume: number;
    priceChangePercent: number;
  };
  entryPrice: number;
  exitPrice: number;
  takeProfit: number;
  stopLoss: number;
  trendDirection: 'UP' | 'DOWN' | 'SIDEWAYS';
  totalAnalyzed?: number;
  candidatesFound?: number;
  exchange?: string;
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
  const [logs, setLogs] = useState<ResearchLog[]>([]);
  const [loading, setLoading] = useState(false);
  const [liveData, setLiveData] = useState<any>(null);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [settings, setSettings] = useState<any>(null);
  const [manualResearchLoading, setManualResearchLoading] = useState(false);
  const [manualResearchResult, setManualResearchResult] = useState<ManualResearchResult | null>(null);
  const [analysisReport, setAnalysisReport] = useState<AnalysisReportItem[]>([]);
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [deepResearchLoading, setDeepResearchLoading] = useState(false);
  const [deepResearchResults, setDeepResearchResults] = useState<any[]>([]);
  const [researchProgress, setResearchProgress] = useState<{
    step: string;
    status: 'pending' | 'loading' | 'success' | 'error';
    error?: string;
  }[]>([]);
  const { showError } = useError();
  const { addNotification } = useNotificationContext();
  const { user } = useAuth();
  
  // Define isAdmin properly
  const isAdmin = user?.role === 'admin' || (user as any)?.isAdmin === true;

  useEffect(() => {
    loadLogs();
    loadSettings();
    fetchAnalysis();
    
    // Subscribe to live research updates
    const unsubscribe = wsService.subscribe('research', (data: any) => {
      setLiveData(data.data);
      // Add to logs
      setLogs((prev) => [data.data, ...prev].slice(0, 100));
    });

    // Auto-refresh analysis every 5 minutes (300000ms)
    const analysisInterval = setInterval(() => {
      fetchAnalysis();
    }, 300000);

    return () => {
      unsubscribe();
      clearInterval(analysisInterval);
    };
  }, []);

  const loadSettings = async () => {
    try {
      const response = await settingsApi.load();
      console.log('Research settings API response:', response.data);
      setSettings(response.data);
    } catch (err: any) {
      suppressConsoleError(err, 'loadSettings');
    }
  };

  const canExecute = (accuracy: number): boolean => {
    if (!settings) return false;
    return settings.autoTradeEnabled && accuracy >= (settings.minAccuracyThreshold || 0.85);
  };

  const loadLogs = async () => {
    setLoading(true);
    try {
      const response = await researchApi.getLogs({ limit: 100 });
      console.log('Research logs API response:', response.data);
      setLogs(response.data);
    } catch (err: any) {
      suppressConsoleError(err, 'loadLogs');
      const { message, type } = getApiErrorMessage(err);
      showError(message, type);
    } finally {
      setLoading(false);
    }
  };

  const fetchAnalysis = async () => {
    setAnalysisLoading(true);
    try {
      const response = await researchApi.getLogs({ limit: 50 });
      const logsData = response.data || [];
      
      // Group by symbol and aggregate data
      const symbolMap = new Map<string, {
        symbol: string;
        buyCount: number;
        latestLog: ResearchLog;
        price: number | null;
      }>();

      // First pass: count all BUY signals per symbol and find latest log
      logsData.forEach((log: ResearchLog) => {
        const existing = symbolMap.get(log.symbol);
        
        // Extract price from microSignals or use null
        let price: number | null = null;
        if (log.microSignals && typeof log.microSignals === 'object') {
          price = (log.microSignals as any).price || (log.microSignals as any).currentPrice || null;
        }
        
        if (!existing) {
          // First occurrence of this symbol
          symbolMap.set(log.symbol, {
            symbol: log.symbol,
            buyCount: log.signal === 'BUY' ? 1 : 0,
            latestLog: log,
            price: price,
          });
        } else {
          // Update buy count
          if (log.signal === 'BUY') {
            existing.buyCount += 1;
          }
          // Update latest log if this one is newer
          if (new Date(log.timestamp) > new Date(existing.latestLog.timestamp)) {
            existing.latestLog = log;
            if (price !== null) {
              existing.price = price;
            }
          } else if (price !== null && existing.price === null) {
            // Use price from older log if latest doesn't have it
            existing.price = price;
          }
        }
      });

      // Convert to analysis report items
      const reportItems: AnalysisReportItem[] = Array.from(symbolMap.values())
        .map((item) => ({
          id: item.latestLog.id || `analysis-${item.symbol}`,
          symbol: item.symbol,
          price: item.price,
          longSignals: item.buyCount,
          accuracy: item.latestLog.accuracy || 0,
          timestamp: item.latestLog.timestamp,
        }))
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
        .slice(0, 20); // Limit to top 20

      setAnalysisReport(reportItems);
    } catch (err: any) {
      suppressConsoleError(err, 'fetchAnalysis');
      // Don't show error toast for analysis, just log it
      console.error('Error fetching analysis report:', err);
    } finally {
      setAnalysisLoading(false);
    }
  };

  // Run deep research instantly with step-by-step progress
  const handleDeepResearch = async () => {
    setDeepResearchLoading(true);
    setDeepResearchResults([]);
    
    // Initialize progress steps
    const steps = [
      { step: 'Fetching CryptoQuant data…', status: 'pending' as const },
      { step: 'Fetching LunarCrush data…', status: 'pending' as const },
      { step: 'Fetching CoinAPI Market Data…', status: 'pending' as const },
      { step: 'Fetching CoinAPI Exchange Rates…', status: 'pending' as const },
      { step: 'Fetching CoinAPI Flat Files…', status: 'pending' as const },
      { step: 'Calculating Indicators…', status: 'pending' as const },
      { step: 'Generating AI Decision…', status: 'pending' as const },
    ];
    setResearchProgress(steps);
    
    try {
      // Update progress as we go (simulated - actual progress comes from backend)
      const updateProgress = (index: number, status: 'loading' | 'success' | 'error', error?: string) => {
        setResearchProgress(prev => {
          const newProgress = [...prev];
          newProgress[index] = { ...newProgress[index], status, error };
          return newProgress;
        });
      };
      
      // Mark first step as loading
      updateProgress(0, 'loading');
      
      const response = await researchApi.run({ symbol: 'BTCUSDT' });
      
      // Simulate progress updates based on response
      setTimeout(() => updateProgress(0, 'success'), 500);
      setTimeout(() => updateProgress(1, 'loading'), 600);
      setTimeout(() => updateProgress(1, 'success'), 1000);
      setTimeout(() => updateProgress(2, 'loading'), 1100);
      setTimeout(() => updateProgress(2, 'success'), 1500);
      setTimeout(() => updateProgress(3, 'loading'), 1600);
      setTimeout(() => updateProgress(3, 'success'), 2000);
      setTimeout(() => updateProgress(4, 'loading'), 2100);
      setTimeout(() => updateProgress(4, 'success'), 2500);
      setTimeout(() => updateProgress(5, 'loading'), 2600);
      setTimeout(() => updateProgress(5, 'success'), 3000);
      setTimeout(() => updateProgress(6, 'loading'), 3100);
      setTimeout(() => updateProgress(6, 'success'), 3500);
      
      if (response.data.success && response.data.results) {
        setDeepResearchResults(response.data.results);
        showToast(`Deep research completed for ${response.data.totalAnalyzed} symbol(s)`, 'success');
        
        await addNotification({
          title: 'Deep Research Completed',
          message: `Analyzed ${response.data.totalAnalyzed} symbol(s) using CryptoQuant + LunarCrush + CoinAPI`,
          type: 'success',
        });
      } else {
        showError('No research data received from server. Please try again.', 'api');
        updateProgress(6, 'error', 'No data received');
      }
    } catch (err: any) {
      suppressConsoleError(err, 'deepResearch');
      const { message, type } = getApiErrorMessage(err);
      showError(message, type);
      
      // Mark all remaining steps as error
      setResearchProgress(prev => prev.map((p, i) => 
        p.status === 'pending' || p.status === 'loading' 
          ? { ...p, status: 'error' as const, error: message }
          : p
      ));
    } finally {
      setDeepResearchLoading(false);
    }
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
    <div className="min-h-screen bg-gradient-to-br from-[#0a0f1c] via-[#101726] to-[#0a0f1c] pb-20 lg:pb-0 relative overflow-hidden">
      {/* Modern animated background with grid pattern */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        {/* Animated gradient orbs */}
        <div className="absolute -top-40 -right-40 w-96 h-96 bg-purple-500/30 rounded-full mix-blend-screen filter blur-3xl animate-blob"></div>
        <div className="absolute -bottom-40 -left-40 w-96 h-96 bg-cyan-500/30 rounded-full mix-blend-screen filter blur-3xl animate-blob animation-delay-2000"></div>
        <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-pink-500/20 rounded-full mix-blend-screen filter blur-3xl animate-blob animation-delay-4000"></div>
        
        {/* Grid pattern overlay */}
        <div className="absolute inset-0 bg-[linear-gradient(to_right,#80808012_1px,transparent_1px),linear-gradient(to_bottom,#80808012_1px,transparent_1px)] bg-[size:24px_24px] opacity-40"></div>
        
        {/* Glowing lines effect */}
        <div className="absolute top-0 left-1/4 w-px h-full bg-gradient-to-b from-transparent via-purple-500/20 to-transparent"></div>
        <div className="absolute top-0 right-1/4 w-px h-full bg-gradient-to-b from-transparent via-cyan-500/20 to-transparent"></div>
      </div>

      <Sidebar onLogout={handleLogout} />

      <main className="min-h-screen">
        <div className="max-w-7xl mx-auto py-4 sm:py-8 px-4 sm:px-6 lg:px-8 pt-20 lg:pt-8">
          {/* Mobile: Sticky Research Header */}
          <div className="lg:hidden sticky top-16 z-40 -mx-4 px-4 py-4 bg-black/40 backdrop-blur-2xl border-b border-purple-500/30 shadow-lg shadow-purple-500/10 mb-6">
            <h2 className="text-lg font-bold bg-gradient-to-r from-purple-400 to-cyan-400 bg-clip-text text-transparent mb-3">
              Research Request
            </h2>
            <div className="flex gap-2">
              <button
                onClick={handleDeepResearch}
                disabled={deepResearchLoading}
                className="flex-1 px-4 py-3 bg-gradient-to-r from-purple-600 via-pink-600 to-cyan-600 text-white font-semibold rounded-xl hover:from-purple-500 hover:via-pink-500 hover:to-cyan-500 transition-all duration-300 shadow-lg shadow-purple-500/40 hover:shadow-purple-500/60 disabled:opacity-50 disabled:cursor-not-allowed text-sm transform hover:scale-[1.02] active:scale-[0.98]"
              >
                {deepResearchLoading ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></span>
                    Running Deep Research...
                  </span>
                ) : (
                  'Run Deep Research'
                )}
              </button>
              <button 
                onClick={loadLogs} 
                className="px-4 py-3 bg-black/30 backdrop-blur-sm border border-purple-500/40 text-gray-200 rounded-xl hover:bg-purple-500/20 hover:border-purple-400/60 transition-all duration-300 disabled:opacity-50 text-sm transform hover:scale-105 active:scale-95" 
                disabled={loading}
              >
                {loading ? (
                  <span className="w-4 h-4 border-2 border-purple-400/30 border-t-purple-400 rounded-full animate-spin inline-block"></span>
                ) : (
                  '↻'
                )}
              </button>
            </div>
          </div>

          {/* Desktop Header */}
          <div className="hidden lg:block mb-6 sm:mb-8">
            <Header
              title="Research Panel"
              subtitle="Run instant deep research with full exchange API data"
              onMenuToggle={() => {
                const toggle = (window as any).__sidebarToggle;
                if (toggle) toggle();
              }}
              menuOpen={(window as any).__sidebarOpen || false}
            >
              <div className="flex flex-col sm:flex-row gap-3 w-full sm:w-auto">
                <button
                  onClick={handleDeepResearch}
                  disabled={deepResearchLoading}
                  className="btn-mobile-full px-6 py-3 bg-gradient-to-r from-purple-600 via-pink-600 to-cyan-600 text-white font-semibold rounded-xl hover:from-purple-500 hover:via-pink-500 hover:to-cyan-500 transition-all duration-300 shadow-lg shadow-purple-500/40 hover:shadow-purple-500/60 disabled:opacity-50 disabled:cursor-not-allowed transform hover:scale-[1.02] active:scale-[0.98] flex items-center justify-center gap-2"
                >
                  {deepResearchLoading ? (
                    <>
                      <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></span>
                      Running Deep Research...
                    </>
                  ) : (
                    <>
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                      </svg>
                      Run Deep Research
                    </>
                  )}
                </button>
                <button 
                  onClick={loadLogs} 
                  className="btn-mobile-full px-6 py-3 bg-black/30 backdrop-blur-sm border border-purple-500/40 text-gray-200 rounded-xl hover:bg-purple-500/20 hover:border-purple-400/60 transition-all duration-300 disabled:opacity-50 flex items-center justify-center gap-2 transform hover:scale-105 active:scale-95" 
                  disabled={loading}
                >
                  {loading ? (
                    <>
                      <span className="w-4 h-4 border-2 border-purple-400/30 border-t-purple-400 rounded-full animate-spin"></span>
                      Loading...
                    </>
                  ) : (
                    <>
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                      </svg>
                      Refresh
                    </>
                  )}
                </button>
              </div>
            </Header>
          </div>

          {/* Mobile Header (simplified) */}
          <div className="lg:hidden mb-6">
            <Header
              title="Research Panel"
              subtitle="Analyze market signals"
              onMenuToggle={() => {
                const toggle = (window as any).__sidebarToggle;
                if (toggle) toggle();
              }}
              menuOpen={(window as any).__sidebarOpen || false}
            />
          </div>
          <div className="space-y-6">
            {/* Analysis Report Section */}
            <div className="relative bg-black/30 backdrop-blur-xl border border-purple-500/30 rounded-2xl p-6 shadow-2xl shadow-purple-500/10 hover:shadow-purple-500/20 transition-all duration-300 overflow-hidden">
              {/* Gradient accent line */}
              <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-purple-500 via-pink-500 to-cyan-500"></div>
              
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
                <div>
                  <h2 className="text-xl sm:text-2xl font-bold bg-gradient-to-r from-purple-400 via-pink-400 to-cyan-400 bg-clip-text text-transparent mb-1">
                    Live Analysis Report
                  </h2>
                  <p className="text-xs sm:text-sm text-gray-400 flex items-center gap-2">
                    <span className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></span>
                    Updated every 5 minutes
                  </p>
                </div>
                <button
                  onClick={fetchAnalysis}
                  disabled={analysisLoading}
                  className="px-4 py-2 text-xs sm:text-sm bg-black/40 backdrop-blur-sm border border-purple-500/40 text-gray-200 rounded-xl hover:bg-purple-500/20 hover:border-purple-400/60 transition-all duration-300 disabled:opacity-50 flex items-center justify-center gap-2 transform hover:scale-105 active:scale-95 self-start sm:self-auto"
                >
                  {analysisLoading ? (
                    <>
                      <span className="w-3 h-3 border-2 border-purple-400/30 border-t-purple-400 rounded-full animate-spin"></span>
                      Loading...
                    </>
                  ) : (
                    <>
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                      </svg>
                      Refresh
                    </>
                  )}
                </button>
              </div>

              {/* Desktop Table View */}
              <div className="hidden md:block overflow-x-auto rounded-xl border border-purple-500/20 bg-black/20">
                <table className="min-w-full divide-y divide-purple-500/10">
                  <thead className="bg-gradient-to-r from-purple-900/30 to-pink-900/30">
                    <tr>
                      <th className="px-6 py-4 text-left text-xs font-bold text-purple-300 uppercase tracking-wider">SR</th>
                      <th className="px-6 py-4 text-left text-xs font-bold text-purple-300 uppercase tracking-wider">Coin</th>
                      <th className="px-6 py-4 text-left text-xs font-bold text-purple-300 uppercase tracking-wider">Price</th>
                      <th className="px-6 py-4 text-left text-xs font-bold text-purple-300 uppercase tracking-wider">Long Signals</th>
                      <th className="px-6 py-4 text-left text-xs font-bold text-purple-300 uppercase tracking-wider">Accuracy</th>
                      <th className="px-6 py-4 text-left text-xs font-bold text-purple-300 uppercase tracking-wider">Date & Time</th>
                    </tr>
                  </thead>
                  <tbody className="bg-black/10 divide-y divide-purple-500/10">
                    {analysisReport.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="px-6 py-12 text-center">
                          <div className="flex flex-col items-center gap-3">
                            <div className="w-12 h-12 rounded-full bg-purple-500/10 flex items-center justify-center">
                              <svg className="w-6 h-6 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                              </svg>
                            </div>
                            <p className="text-gray-400 text-sm">
                              {analysisLoading ? 'Loading analysis...' : 'No recent analysis available.'}
                            </p>
                          </div>
                        </td>
                      </tr>
                    ) : (
                      analysisReport.map((item, index) => (
                        <tr 
                          key={item.id} 
                          className="hover:bg-gradient-to-r hover:from-purple-500/10 hover:to-pink-500/10 transition-all duration-200 group border-l-2 border-transparent hover:border-purple-500/50"
                        >
                          <td className="px-6 py-4 text-sm text-gray-300 font-semibold">
                            <span className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-purple-500/10 text-purple-300 group-hover:bg-purple-500/20 transition-colors">
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

              {/* Mobile Card View */}
              <div className="md:hidden space-y-3">
                {analysisReport.length === 0 ? (
                  <div className="text-center py-12">
                    <div className="w-16 h-16 rounded-full bg-purple-500/10 flex items-center justify-center mx-auto mb-4">
                      <svg className="w-8 h-8 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                    </div>
                    <p className="text-gray-400 text-sm">
                      {analysisLoading ? 'Loading analysis...' : 'No recent analysis available.'}
                    </p>
                  </div>
                ) : (
                  analysisReport.map((item, index) => (
                    <div 
                      key={item.id} 
                      className="relative bg-black/40 backdrop-blur-sm border border-purple-500/30 rounded-xl p-4 space-y-3 hover:border-purple-400/50 transition-all duration-300 overflow-hidden group"
                    >
                      {/* Gradient accent */}
                      <div className="absolute top-0 left-0 w-1 h-full bg-gradient-to-b from-purple-500 to-pink-500 opacity-0 group-hover:opacity-100 transition-opacity"></div>
                      
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <span className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-purple-500/20 text-purple-300 font-bold text-xs">
                            #{index + 1}
                          </span>
                          <div className="flex items-center gap-2">
                            <div className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse"></div>
                            <span className="text-base font-bold text-white">{item.symbol}</span>
                          </div>
                        </div>
                        <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold ${
                          item.longSignals > 0 
                            ? 'bg-gradient-to-r from-green-500/20 to-emerald-500/20 text-green-300 border border-green-400/40' 
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
                      </div>
                      <div className="grid grid-cols-2 gap-3 text-sm">
                        <div className="bg-black/30 rounded-lg p-2.5 border border-purple-500/10">
                          <div className="text-xs text-gray-400 mb-1">Price</div>
                          <div className="text-white font-semibold">
                            {item.price !== null ? `$${item.price.toFixed(2)}` : 'N/A'}
                          </div>
                        </div>
                        <div className={`rounded-lg p-2.5 border ${
                          item.accuracy >= 0.85 ? 'bg-green-500/10 border-green-400/30' :
                          item.accuracy >= 0.7 ? 'bg-yellow-500/10 border-yellow-400/30' :
                          'bg-red-500/10 border-red-400/30'
                        }`}>
                          <div className="text-xs text-gray-400 mb-1">Accuracy</div>
                          <div className={`font-bold ${
                            item.accuracy >= 0.85 ? 'text-green-400' :
                            item.accuracy >= 0.7 ? 'text-yellow-400' :
                            'text-red-400'
                          }`}>
                            {(item.accuracy * 100).toFixed(2)}%
                            {item.accuracy >= 0.85 && <span className="ml-1">⭐</span>}
                          </div>
                        </div>
                        <div className="col-span-2 bg-black/30 rounded-lg p-2.5 border border-purple-500/10">
                          <div className="text-xs text-gray-400 mb-1">Time</div>
                          <div className="text-white text-xs font-mono">
                            {new Date(item.timestamp).toLocaleString()}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Manual Deep Research Loading */}
            {manualResearchLoading && (
              <div className="relative bg-black/30 backdrop-blur-xl border border-purple-500/30 rounded-2xl p-8 sm:p-12 shadow-2xl shadow-purple-500/20 overflow-hidden">
                {/* Gradient accent line */}
                <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-purple-500 via-pink-500 to-cyan-500"></div>
                
                <div className="flex flex-col items-center justify-center py-12">
                  <div className="relative w-24 h-24 mb-8">
                    {/* Outer glow */}
                    <div className="absolute inset-0 border-4 border-purple-500/20 rounded-full"></div>
                    {/* Spinning rings */}
                    <div className="absolute inset-0 border-4 border-transparent border-t-purple-500 rounded-full animate-spin"></div>
                    <div className="absolute inset-0 border-4 border-transparent border-r-pink-500 rounded-full animate-spin" style={{ animationDelay: '0.15s' }}></div>
                    <div className="absolute inset-0 border-4 border-transparent border-b-cyan-500 rounded-full animate-spin" style={{ animationDelay: '0.3s' }}></div>
                    {/* Center pulse */}
                    <div className="absolute inset-4 bg-gradient-to-br from-purple-500/30 to-pink-500/30 rounded-full animate-pulse"></div>
                  </div>
                  <h3 className="text-2xl sm:text-3xl font-bold bg-gradient-to-r from-purple-400 via-pink-400 to-cyan-400 bg-clip-text text-transparent mb-3">
                    Analyzing 100+ markets...
                  </h3>
                  <p className="text-sm text-gray-400 text-center mb-6">This may take 10-20 seconds</p>
                  <div className="w-full max-w-md bg-black/40 rounded-full h-3 overflow-hidden border border-purple-500/30">
                    <div className="h-full bg-gradient-to-r from-purple-500 via-pink-500 to-cyan-500 rounded-full animate-pulse shadow-lg shadow-purple-500/50" style={{ width: '60%' }}></div>
                  </div>
                </div>
              </div>
            )}

            {/* Manual Deep Research Result */}
            {manualResearchResult && !manualResearchLoading && (
              <div className="relative bg-black/30 backdrop-blur-xl border border-purple-500/30 rounded-2xl p-6 sm:p-8 shadow-2xl shadow-purple-500/20 hover:shadow-purple-500/30 transition-all duration-300 overflow-hidden animate-fade-in">
                {/* Gradient accent line */}
                <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-purple-500 via-pink-500 to-cyan-500"></div>
                
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
                  <h2 className="text-2xl sm:text-3xl font-bold bg-gradient-to-r from-purple-400 via-pink-400 to-cyan-400 bg-clip-text text-transparent">
                    Deep Research Result
                  </h2>
                  {manualResearchResult.exchange && (
                    <span className="inline-flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-purple-500/20 to-pink-500/20 text-purple-300 rounded-xl border border-purple-400/40 text-sm font-semibold backdrop-blur-sm">
                      <span className="w-2 h-2 bg-purple-400 rounded-full animate-pulse"></span>
                      {manualResearchResult.exchange.toUpperCase()}
                    </span>
                  )}
                </div>
                
                {/* Main Result Card */}
                <div className="relative bg-gradient-to-br from-purple-900/40 via-pink-900/30 to-cyan-900/30 rounded-2xl p-6 sm:p-8 mb-6 border border-purple-500/40 shadow-xl overflow-hidden">
                  {/* Animated background pattern */}
                  <div className="absolute inset-0 opacity-10">
                    <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,rgba(139,92,246,0.3),transparent_50%)]"></div>
                  </div>
                  <div className="relative z-10">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
                    <div>
                      <div className="text-xs sm:text-sm text-gray-400 mb-1">Coin</div>
                      <div className="text-2xl sm:text-3xl font-bold text-purple-400 break-words">
                        {manualResearchResult.symbol || 'N/A'}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs sm:text-sm text-gray-400 mb-1">Accuracy</div>
                      <div className={`text-2xl sm:text-3xl font-bold ${
                        (manualResearchResult.accuracy ?? 0) >= 0.85 ? 'text-green-400' : 
                        (manualResearchResult.accuracy ?? 0) >= 0.7 ? 'text-yellow-400' : 
                        'text-red-400'
                      }`}>
                        {((manualResearchResult.accuracy ?? 0) * 100).toFixed(2)}%
                      </div>
                    </div>
                  </div>
                  
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
                    <div>
                      <div className="text-xs sm:text-sm text-gray-400 mb-1">Current Price</div>
                      <div className="text-lg sm:text-xl font-bold text-white">
                        ${((manualResearchResult.price ?? 0)).toFixed(2)}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs sm:text-sm text-gray-400 mb-1">Trend</div>
                      <div className={`text-lg sm:text-xl font-bold ${
                        manualResearchResult.trend?.includes('up') ? 'text-green-400' :
                        manualResearchResult.trend?.includes('down') ? 'text-red-400' :
                        'text-yellow-400'
                      }`}>
                        {manualResearchResult.trend || 'sideways'}
                      </div>
                    </div>
                  </div>
                  
                  <div className="mb-4">
                    <div className="text-xs sm:text-sm text-gray-400 mb-2">Suggested Action</div>
                    <div className={`inline-flex items-center px-4 py-2 rounded-lg font-bold text-lg ${
                      manualResearchResult.suggestion === 'BUY' 
                        ? 'bg-green-500/20 text-green-300 border border-green-400/30' 
                        : 'bg-red-500/20 text-red-300 border border-red-400/30'
                    }`}>
                      {manualResearchResult.suggestion || 'HOLD'}
                    </div>
                  </div>
                  
                  <div className="bg-black/40 backdrop-blur-sm rounded-xl p-4 sm:p-5 border border-purple-500/30 shadow-lg">
                    <div className="text-xs sm:text-sm text-purple-300 font-semibold mb-3 flex items-center gap-2">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                      </svg>
                      Reasoning
                    </div>
                    <div className="text-sm sm:text-base text-gray-200 leading-relaxed break-words">
                      {manualResearchResult.reasoning || 'Analysis completed'}
                    </div>
                  </div>
                  </div>
                </div>

                {/* Indicators */}
                  {manualResearchResult.indicators && (
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4 mb-6">
                    <div className="bg-black/40 backdrop-blur-sm rounded-xl p-4 border border-purple-500/30 hover:border-purple-400/50 transition-all duration-300 shadow-lg hover:shadow-purple-500/20">
                      <div className="text-xs text-gray-400 mb-1">RSI</div>
                      <div className="text-lg font-bold text-white">
                        {(manualResearchResult.indicators.rsi ?? 50).toFixed(1)}
                      </div>
                    </div>
                    <div className="bg-slate-900/50 rounded-lg p-3 border border-purple-500/20">
                      <div className="text-xs text-gray-400 mb-1">Price Change</div>
                      <div className={`text-lg font-bold ${
                        (manualResearchResult.indicators.priceChangePercent ?? 0) >= 0 ? 'text-green-400' : 'text-red-400'
                      }`}>
                        {((manualResearchResult.indicators.priceChangePercent ?? 0)).toFixed(2)}%
                      </div>
                    </div>
                    <div className="bg-slate-900/50 rounded-lg p-3 border border-purple-500/20">
                      <div className="text-xs text-gray-400 mb-1">Volume</div>
                      <div className="text-lg font-bold text-white">
                        ${((manualResearchResult.indicators.volume ?? 0) / 1000000).toFixed(1)}M
                      </div>
                    </div>
                    <div className="bg-slate-900/50 rounded-lg p-3 border border-purple-500/20">
                      <div className="text-xs text-gray-400 mb-1">Trend Strength</div>
                      <div className={`text-lg font-bold ${
                        (manualResearchResult.indicators.trendStrength ?? 0) > 0 ? 'text-green-400' : 'text-red-400'
                      }`}>
                        {((manualResearchResult.indicators.trendStrength ?? 0)).toFixed(1)}%
                      </div>
                    </div>
                    {(manualResearchResult.indicators.socialScore !== undefined || manualResearchResult.indicators.socialSentiment !== undefined) && (
                      <div className="bg-slate-900/50 rounded-lg p-3 border border-purple-500/20">
                        <div className="text-xs text-gray-400 mb-1">Social Sentiment</div>
                        <div className={`text-lg font-bold ${
                          (manualResearchResult.indicators.socialSentiment ?? 0) > 0 ? 'text-green-400' : 'text-red-400'
                        }`}>
                          {((manualResearchResult.indicators.socialSentiment ?? 0) * 100).toFixed(1)}%
                        </div>
                        {manualResearchResult.indicators.socialScore !== undefined && (
                          <div className="text-xs text-gray-500 mt-1">
                            Score: {manualResearchResult.indicators.socialScore.toFixed(0)}
                          </div>
                        )}
                      </div>
                    )}
                    {manualResearchResult.indicators.onChainFlow !== undefined && (
                      <div className="bg-slate-900/50 rounded-lg p-3 border border-purple-500/20">
                        <div className="text-xs text-gray-400 mb-1">On-chain Flow</div>
                        <div className={`text-lg font-bold ${
                          (manualResearchResult.indicators.onChainFlow ?? 0) > 0 ? 'text-green-400' : 'text-red-400'
                        }`}>
                          ${((manualResearchResult.indicators.onChainFlow ?? 0) / 1000000).toFixed(2)}M
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Trading Details */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="bg-black/40 backdrop-blur-sm rounded-xl p-5 border border-purple-500/30 hover:border-purple-400/50 transition-all duration-300 shadow-lg">
                    <div className="text-xs sm:text-sm text-purple-300 font-semibold mb-2">Entry Price</div>
                    <div className="text-2xl sm:text-3xl font-bold text-white">
                      ${((manualResearchResult.entryPrice ?? 0)).toFixed(2)}
                    </div>
                  </div>
                  <div className="bg-black/40 backdrop-blur-sm rounded-xl p-5 border border-green-500/40 hover:border-green-400/60 transition-all duration-300 shadow-lg shadow-green-500/10">
                    <div className="text-xs sm:text-sm text-green-300 font-semibold mb-2">Take Profit</div>
                    <div className="text-2xl sm:text-3xl font-bold text-green-400">
                      ${((manualResearchResult.takeProfit ?? 0)).toFixed(2)}
                    </div>
                  </div>
                  <div className="bg-black/40 backdrop-blur-sm rounded-xl p-5 border border-red-500/40 hover:border-red-400/60 transition-all duration-300 shadow-lg shadow-red-500/10">
                    <div className="text-xs sm:text-sm text-red-300 font-semibold mb-2">Stop Loss</div>
                    <div className="text-2xl sm:text-3xl font-bold text-red-400">
                      ${((manualResearchResult.stopLoss ?? 0)).toFixed(2)}
                    </div>
                  </div>
                  <div className="bg-black/40 backdrop-blur-sm rounded-xl p-5 border border-purple-500/30 hover:border-purple-400/50 transition-all duration-300 shadow-lg">
                    <div className="text-xs sm:text-sm text-purple-300 font-semibold mb-2">Exit Price</div>
                    <div className="text-2xl sm:text-3xl font-bold text-white">
                      ${((manualResearchResult.exitPrice ?? 0)).toFixed(2)}
                    </div>
                  </div>
                </div>

                {/* Analysis Summary */}
                {(manualResearchResult.totalAnalyzed || manualResearchResult.candidatesFound) && (
                  <div className="mt-4 pt-4 border-t border-purple-500/20 text-xs text-gray-400 text-center">
                    Analyzed {manualResearchResult.totalAnalyzed ?? 0} markets, found {manualResearchResult.candidatesFound ?? 0} candidates
                  </div>
                )}
              </div>
            )}

            {/* Deep Research Loading State with Step-by-Step Progress */}
            {deepResearchLoading && (
              <div className="relative bg-black/30 backdrop-blur-xl border border-purple-500/30 rounded-2xl p-8 shadow-2xl shadow-purple-500/10">
                <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-purple-500 via-pink-500 to-cyan-500 animate-pulse"></div>
                
                <div className="space-y-4">
                  <h3 className="text-xl font-bold bg-gradient-to-r from-purple-400 to-cyan-400 bg-clip-text text-transparent mb-4 text-center">
                    Running Deep Research...
                  </h3>
                  
                  <div className="space-y-3">
                    {researchProgress.map((progressItem, index) => (
                      <div key={index} className="flex items-center gap-3 p-3 rounded-lg bg-black/20 border border-purple-500/20">
                        <div className="flex-shrink-0 w-6 h-6 flex items-center justify-center">
                          {progressItem.status === 'pending' && (
                            <span className="w-2 h-2 bg-gray-500 rounded-full"></span>
                          )}
                          {progressItem.status === 'loading' && (
                            <div className="w-4 h-4 border-2 border-purple-500/30 border-t-purple-500 rounded-full animate-spin"></div>
                          )}
                          {progressItem.status === 'success' && (
                            <span className="text-green-400 text-lg">✔</span>
                          )}
                          {progressItem.status === 'error' && (
                            <span className="text-red-400 text-lg">❌</span>
                          )}
                        </div>
                        <div className="flex-1">
                          <p className={`text-sm ${
                            progressItem.status === 'success' ? 'text-green-300' :
                            progressItem.status === 'error' ? 'text-red-300' :
                            progressItem.status === 'loading' ? 'text-purple-300' :
                            'text-gray-400'
                          }`}>
                            {progressItem.step}
                          </p>
                          {progressItem.error && (
                            <p className="text-xs text-red-400 mt-1">{progressItem.error}</p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Deep Research Results with Raw API Outputs */}
            {!deepResearchLoading && deepResearchResults.length > 0 && (
              <div className="relative bg-black/30 backdrop-blur-xl border border-purple-500/30 rounded-2xl p-6 shadow-2xl shadow-purple-500/10 hover:shadow-purple-500/20 transition-all duration-300 overflow-hidden">
                <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-purple-500 via-pink-500 to-cyan-500"></div>
                
                <div className="mb-6">
                  <h2 className="text-xl sm:text-2xl font-bold bg-gradient-to-r from-purple-400 via-pink-400 to-cyan-400 bg-clip-text text-transparent mb-1">
                    Deep Research Results
                  </h2>
                  <p className="text-xs sm:text-sm text-gray-400">
                    Full exchange API data and AI analysis
                  </p>
                </div>

                <div className="space-y-6">
                  {deepResearchResults.map((result, idx) => (
                    <div key={idx} className="bg-black/40 backdrop-blur-sm rounded-xl p-5 border border-purple-500/30">
                      <div className="mb-4">
                        <h3 className="text-lg font-bold text-white mb-2">{result.symbol}</h3>
                        <p className="text-xs text-gray-400">
                          Exchange: <span className="text-purple-300 font-semibold">
                            {result.exchange && result.exchange !== 'N/A' && result.exchange !== 'unknown' 
                              ? result.exchange.toUpperCase() 
                              : 'Unknown'}
                          </span>
                          {result.requestId && <span className="ml-2 text-gray-500">| Request ID: {result.requestId}</span>}
                        </p>
                      </div>

                      {/* Final Analysis (new format) */}
                      {result.finalAnalysis && (
                        <div className="mb-4 p-4 bg-gradient-to-r from-purple-900/40 to-pink-900/40 rounded-lg border border-purple-500/30">
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-sm font-semibold text-purple-300">Final Analysis</span>
                            <span className={`px-3 py-1 rounded-lg text-sm font-bold ${
                              result.finalAnalysis.signal === 'LONG' ? 'bg-green-500/20 text-green-300 border border-green-400/30' :
                              result.finalAnalysis.signal === 'SHORT' ? 'bg-red-500/20 text-red-300 border border-red-400/30' :
                              'bg-gray-500/20 text-gray-300 border border-gray-400/30'
                            }`}>
                              {result.finalAnalysis.signal}
                            </span>
                          </div>
                          <div className="text-sm text-gray-300 mb-2">
                            Confidence: <span className="font-bold text-purple-400">{result.finalAnalysis.confidencePercent}%</span>
                          </div>
                          <div className="text-xs text-gray-400">
                            {result.finalAnalysis.reasoning}
                          </div>
                        </div>
                      )}

                      {/* Technical Indicators (support both old and new format) */}
                      {(result.indicators || result.technicalIndicators) && (
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-4">
                          <div className="bg-black/30 rounded-lg p-3 border border-purple-500/20">
                            <div className="text-xs text-gray-400 mb-1">RSI</div>
                            <div className="text-lg font-bold text-white">{(result.indicators || result.technicalIndicators)?.rsi?.toFixed(2) || 'N/A'}</div>
                          </div>
                          <div className="bg-black/30 rounded-lg p-3 border border-purple-500/20">
                            <div className="text-xs text-gray-400 mb-1">MA50</div>
                            <div className="text-lg font-bold text-white">${(result.indicators || result.technicalIndicators)?.ma50?.toFixed(2) || 'N/A'}</div>
                          </div>
                          <div className="bg-black/30 rounded-lg p-3 border border-purple-500/20">
                            <div className="text-xs text-gray-400 mb-1">MA200</div>
                            <div className="text-lg font-bold text-white">${(result.indicators || result.technicalIndicators)?.ma200?.toFixed(2) || 'N/A'}</div>
                          </div>
                          <div className="bg-black/30 rounded-lg p-3 border border-purple-500/20">
                            <div className="text-xs text-gray-400 mb-1">MACD</div>
                            <div className="text-lg font-bold text-white">{((result.indicators || result.technicalIndicators)?.macd?.macd || 0).toFixed(4)}</div>
                          </div>
                        </div>
                      )}

                      {/* Raw API Calls (new format) */}
                      {result.apiCalls && (
                        <div className="mb-4">
                          <h4 className="text-sm font-semibold text-purple-300 mb-3">Raw API Outputs</h4>
                          <div className="space-y-3">
                            {/* Price API */}
                            <details className="bg-black/20 rounded-lg border border-purple-500/20">
                              <summary className="px-3 py-2 cursor-pointer text-sm text-gray-300 hover:text-white">
                                Price API {result.apiCalls.price?.success ? '✅' : '❌'} {result.apiCalls.price?.latency ? `(${result.apiCalls.price.latency}ms)` : ''}
                              </summary>
                              <div className="px-3 pb-3 text-xs font-mono text-gray-400 overflow-x-auto">
                                <pre>{JSON.stringify(result.apiCalls.price?.data || result.apiCalls.price?.error || 'No data', null, 2)}</pre>
                              </div>
                            </details>

                            {/* Orderbook API */}
                            <details className="bg-black/20 rounded-lg border border-purple-500/20">
                              <summary className="px-3 py-2 cursor-pointer text-sm text-gray-300 hover:text-white">
                                Orderbook API {result.apiCalls.orderbook?.success ? '✅' : '❌'} {result.apiCalls.orderbook?.latency ? `(${result.apiCalls.orderbook.latency}ms)` : ''}
                              </summary>
                              <div className="px-3 pb-3 text-xs font-mono text-gray-400 overflow-x-auto max-h-60 overflow-y-auto">
                                <pre>{JSON.stringify(result.apiCalls.orderbook?.data || result.apiCalls.orderbook?.error || 'No data', null, 2)}</pre>
                              </div>
                            </details>

                            {/* Kline API */}
                            <details className="bg-black/20 rounded-lg border border-purple-500/20">
                              <summary className="px-3 py-2 cursor-pointer text-sm text-gray-300 hover:text-white">
                                Kline API {result.apiCalls.kline?.success ? '✅' : '❌'} {result.apiCalls.kline?.latency ? `(${result.apiCalls.kline.latency}ms)` : ''}
                              </summary>
                              <div className="px-3 pb-3 text-xs font-mono text-gray-400 overflow-x-auto max-h-60 overflow-y-auto">
                                <pre>{JSON.stringify(result.apiCalls.kline?.data || result.apiCalls.kline?.error || 'No data', null, 2)}</pre>
                              </div>
                            </details>

                            {/* Trades API */}
                            {result.apiCalls.trades && (
                              <details className="bg-black/20 rounded-lg border border-purple-500/20">
                                <summary className="px-3 py-2 cursor-pointer text-sm text-gray-300 hover:text-white">
                                  Trades API {result.apiCalls.trades?.success ? '✅' : '❌'} {result.apiCalls.trades?.latency ? `(${result.apiCalls.trades.latency}ms)` : ''}
                                </summary>
                                <div className="px-3 pb-3 text-xs font-mono text-gray-400 overflow-x-auto max-h-60 overflow-y-auto">
                                  <pre>{JSON.stringify(result.apiCalls.trades?.data || result.apiCalls.trades?.error || 'No data', null, 2)}</pre>
                                </div>
                              </details>
                            )}

                            {/* Funding Rate API */}
                            {result.apiCalls.funding && (
                              <details className="bg-black/20 rounded-lg border border-purple-500/20">
                                <summary className="px-3 py-2 cursor-pointer text-sm text-gray-300 hover:text-white">
                                  Funding Rate API {result.apiCalls.funding?.success ? '✅' : '❌'} {result.apiCalls.funding?.latency ? `(${result.apiCalls.funding.latency}ms)` : ''}
                                </summary>
                                <div className="px-3 pb-3 text-xs font-mono text-gray-400 overflow-x-auto">
                                  <pre>{JSON.stringify(result.apiCalls.funding?.data || result.apiCalls.funding?.error || 'No data', null, 2)}</pre>
                                </div>
                              </details>
                            )}
                          </div>
                        </div>
                      )}

                      {/* Raw API Data (old format - backward compatibility) */}
                      {!result.apiCalls && result.rawApiData && (
                        <div className="mb-4">
                          <h4 className="text-sm font-semibold text-purple-300 mb-3">Raw API Outputs</h4>
                          <div className="space-y-3">
                            {result.rawApiData.orderbook && (
                              <details className="bg-black/30 rounded-lg p-3 border border-purple-500/20">
                                <summary className="text-xs text-gray-400 cursor-pointer hover:text-white">Orderbook Data</summary>
                                <pre className="mt-2 text-xs text-gray-300 overflow-x-auto max-h-40 overflow-y-auto">
                                  {JSON.stringify(result.rawApiData.orderbook, null, 2)}
                                </pre>
                              </details>
                            )}
                            {result.rawApiData.ticker && (
                              <details className="bg-black/30 rounded-lg p-3 border border-purple-500/20">
                                <summary className="text-xs text-gray-400 cursor-pointer hover:text-white">Ticker Data</summary>
                                <pre className="mt-2 text-xs text-gray-300 overflow-x-auto max-h-40 overflow-y-auto">
                                  {JSON.stringify(result.rawApiData.ticker, null, 2)}
                                </pre>
                              </details>
                            )}
                            {result.rawApiData.klines && Array.isArray(result.rawApiData.klines) && (
                              <details className="bg-black/30 rounded-lg p-3 border border-purple-500/20">
                                <summary className="text-xs text-gray-400 cursor-pointer hover:text-white">Klines Data ({result.rawApiData.klines.length} candles)</summary>
                                <pre className="mt-2 text-xs text-gray-300 overflow-x-auto max-h-40 overflow-y-auto">
                                  {JSON.stringify(result.rawApiData.klines.slice(0, 5), null, 2)}
                                  {result.rawApiData.klines.length > 5 && '\n... (showing first 5 of ' + result.rawApiData.klines.length + ' candles)'}
                                </pre>
                              </details>
                            )}
                          </div>
                        </div>
                      )}

                      {/* AI Analysis (old format - backward compatibility) */}
                      {!result.finalAnalysis && result.analysis && (
                        <div className="bg-gradient-to-br from-purple-500/10 to-pink-500/10 rounded-lg p-4 border border-purple-500/30">
                          <h4 className="text-sm font-semibold text-purple-300 mb-2">AI Combined Analysis</h4>
                          <div className="text-sm text-gray-200">
                            {result.analysis.reasoning || result.analysis.signal || 'Analysis completed'}
                          </div>
                        </div>
                      )}

                      {result.error && (
                        <div className="mt-4 p-3 bg-red-500/20 border border-red-500/50 rounded-lg">
                          <p className="text-sm text-red-300">Error: {result.error}</p>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

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

            {/* Research Timeline */}
            <div className="relative bg-black/30 backdrop-blur-xl border border-purple-500/30 rounded-2xl p-6 shadow-2xl shadow-purple-500/10 hover:shadow-purple-500/20 transition-all duration-300 overflow-hidden">
              {/* Gradient accent line */}
              <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-purple-500 via-pink-500 to-cyan-500"></div>
              
              <h2 className="text-xl sm:text-2xl font-bold bg-gradient-to-r from-purple-400 via-pink-400 to-cyan-400 bg-clip-text text-transparent mb-6">
                Research Timeline
              </h2>
              {/* Desktop Table View */}
              <div className="hidden md:block overflow-x-auto rounded-xl border border-purple-500/20 bg-black/20">
                <table className="min-w-full divide-y divide-purple-500/10">
                  <thead className="bg-gradient-to-r from-purple-900/30 to-pink-900/30">
                    <tr>
                      <th className="px-6 py-4 text-left text-xs font-bold text-purple-300 uppercase tracking-wider">Time</th>
                      <th className="px-6 py-4 text-left text-xs font-bold text-purple-300 uppercase tracking-wider">Symbol</th>
                      <th className="px-6 py-4 text-left text-xs font-bold text-purple-300 uppercase tracking-wider">Signal</th>
                      <th className="px-6 py-4 text-left text-xs font-bold text-purple-300 uppercase tracking-wider">Accuracy</th>
                      <th className="px-6 py-4 text-left text-xs font-bold text-purple-300 uppercase tracking-wider">Imbalance</th>
                      <th className="px-6 py-4 text-left text-xs font-bold text-purple-300 uppercase tracking-wider">Action</th>
                    </tr>
                  </thead>
                  <tbody className="bg-black/10 divide-y divide-purple-500/10">
                    {logs.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="px-6 py-12 text-center">
                          <div className="flex flex-col items-center gap-3">
                            <div className="w-12 h-12 rounded-full bg-purple-500/10 flex items-center justify-center">
                              <svg className="w-6 h-6 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                              </svg>
                            </div>
                            <p className="text-gray-400 text-sm">No research logs yet</p>
                          </div>
                        </td>
                      </tr>
                    ) : (
                      logs.map((log) => (
                        <tr 
                          key={log.id} 
                          className="hover:bg-gradient-to-r hover:from-purple-500/10 hover:to-pink-500/10 transition-all duration-200 group border-l-2 border-transparent hover:border-purple-500/50"
                        >
                          <td className="px-6 py-4 text-xs text-gray-300 font-mono">
                            {new Date(log.timestamp).toLocaleString()}
                          </td>
                          <td className="px-6 py-4">
                            <div className="flex items-center gap-2">
                              <div className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse"></div>
                              <span className="text-sm font-bold text-white">{log.symbol}</span>
                            </div>
                          </td>
                          <td className="px-6 py-4">
                            <span className={`inline-flex items-center px-3 py-1.5 rounded-lg text-xs font-semibold ${
                              log.signal === 'BUY' 
                                ? 'bg-gradient-to-r from-green-500/20 to-emerald-500/20 text-green-300 border border-green-400/40' 
                                : log.signal === 'SELL'
                                ? 'bg-gradient-to-r from-red-500/20 to-rose-500/20 text-red-300 border border-red-400/40'
                                : 'bg-gray-500/10 text-gray-400 border border-gray-500/20'
                            }`}>
                              {log.signal}
                            </span>
                          </td>
                          <td className={`px-6 py-4 text-sm font-bold ${
                            log.accuracy >= 0.85 ? 'text-green-400' :
                            log.accuracy >= 0.7 ? 'text-yellow-400' :
                            'text-red-400'
                          }`}>
                            {((log.accuracy ?? 0) * 100).toFixed(1)}%
                            {log.accuracy >= 0.85 && <span className="ml-1 text-xs">⭐</span>}
                          </td>
                          <td className="px-6 py-4 text-sm text-gray-200 font-medium">
                            {((log.orderbookImbalance ?? 0) * 100).toFixed(2)}%
                          </td>
                          <td className="px-6 py-4 text-xs text-gray-300 break-words font-medium">{log.recommendedAction}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
              
              {/* Mobile Card View */}
              <div className="md:hidden space-y-3">
                {logs.length === 0 ? (
                  <div className="text-center py-12">
                    <div className="w-16 h-16 rounded-full bg-purple-500/10 flex items-center justify-center mx-auto mb-4">
                      <svg className="w-8 h-8 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                    </div>
                    <p className="text-gray-400 text-sm">No research logs yet</p>
                  </div>
                ) : (
                  logs.map((log) => (
                    <div 
                      key={log.id} 
                      className="relative bg-black/40 backdrop-blur-sm border border-purple-500/30 rounded-xl p-4 space-y-3 hover:border-purple-400/50 transition-all duration-300 overflow-hidden group"
                    >
                      {/* Gradient accent */}
                      <div className="absolute top-0 left-0 w-1 h-full bg-gradient-to-b from-purple-500 to-pink-500 opacity-0 group-hover:opacity-100 transition-opacity"></div>
                      
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse"></div>
                          <span className="text-base font-bold text-white">{log.symbol}</span>
                        </div>
                        <span className={`inline-flex items-center px-3 py-1.5 rounded-lg text-xs font-semibold ${
                          log.signal === 'BUY' 
                            ? 'bg-gradient-to-r from-green-500/20 to-emerald-500/20 text-green-300 border border-green-400/40' 
                            : log.signal === 'SELL'
                            ? 'bg-gradient-to-r from-red-500/20 to-rose-500/20 text-red-300 border border-red-400/40'
                            : 'bg-gray-500/10 text-gray-400 border border-gray-500/20'
                        }`}>
                          {log.signal}
                        </span>
                      </div>
                      <div className="grid grid-cols-2 gap-3 text-sm">
                        <div className={`rounded-lg p-2.5 border ${
                          log.accuracy >= 0.85 ? 'bg-green-500/10 border-green-400/30' :
                          log.accuracy >= 0.7 ? 'bg-yellow-500/10 border-yellow-400/30' :
                          'bg-red-500/10 border-red-400/30'
                        }`}>
                          <div className="text-xs text-gray-400 mb-1">Accuracy</div>
                          <div className={`font-bold ${
                            log.accuracy >= 0.85 ? 'text-green-400' :
                            log.accuracy >= 0.7 ? 'text-yellow-400' :
                            'text-red-400'
                          }`}>
                            {((log.accuracy ?? 0) * 100).toFixed(1)}%
                            {log.accuracy >= 0.85 && <span className="ml-1 text-xs">⭐</span>}
                          </div>
                        </div>
                        <div className="bg-black/30 rounded-lg p-2.5 border border-purple-500/10">
                          <div className="text-xs text-gray-400 mb-1">Imbalance</div>
                          <div className="text-white font-semibold">{((log.orderbookImbalance ?? 0) * 100).toFixed(2)}%</div>
                        </div>
                        <div className="col-span-2 bg-black/30 rounded-lg p-2.5 border border-purple-500/10">
                          <div className="text-xs text-gray-400 mb-1">Time</div>
                          <div className="text-white text-xs font-mono">{new Date(log.timestamp).toLocaleString()}</div>
                        </div>
                        <div className="col-span-2 bg-black/30 rounded-lg p-2.5 border border-purple-500/10">
                          <div className="text-xs text-gray-400 mb-1">Action</div>
                          <div className="text-white text-sm break-words font-medium">{log.recommendedAction}</div>
                        </div>
                      </div>
                    </div>
                  ))
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
