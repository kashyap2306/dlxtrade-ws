import { useState, useEffect, useCallback, useMemo } from 'react';
import { researchApi, settingsApi } from '../services/api';
import { wsService } from '../services/ws';
import Toast from '../components/Toast';
import Sidebar from '../components/Sidebar';
import { useError } from '../contexts/ErrorContext';
import { useNotificationContext } from '../contexts/NotificationContext';
import { getApiErrorMessage, suppressConsoleError } from '../utils/errorHandler';
import { useAuth } from '../hooks/useAuth';
import { useUnlockedAgents } from '../hooks/useUnlockedAgents';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../config/firebase';
import { Link } from 'react-router-dom';

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
  const [logs, setLogs] = useState<ResearchLog[]>([]);
  const [loading, setLoading] = useState(false);
  const [liveData, setLiveData] = useState<any>(null);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [settings, setSettings] = useState<any>(null);
  const [analysisReport, setAnalysisReport] = useState<AnalysisReportItem[]>([]);
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [deepResearchLoading, setDeepResearchLoading] = useState(false);
  const [deepResearchResults, setDeepResearchResults] = useState<any[]>([]);
  const [researchProgress, setResearchProgress] = useState<{
    step: string;
    status: 'pending' | 'loading' | 'success' | 'error';
    error?: string;
  }[]>([]);
  const [showMoreAnalysis, setShowMoreAnalysis] = useState(false);
  const { showError } = useError();
  const { unlockedAgents, loading: agentsLoading, hasPremiumAgent } = useUnlockedAgents();
  const { addNotification } = useNotificationContext();
  const { user } = useAuth();
  const [isAdmin, setIsAdmin] = useState(false);

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
      const response = await researchApi.getLogs({ limit: 50 });
      if (response.data && Array.isArray(response.data)) {
        // Filter only auto research (researchType === 'auto' or undefined/not 'manual')
        const autoLogs = response.data.filter((log: ResearchLog) => 
          log.researchType !== 'manual'
        );
        // Process logs into analysis report
        const report: AnalysisReportItem[] = autoLogs.map((log: ResearchLog) => ({
          id: log.id,
          symbol: log.symbol,
          price: null,
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
    // Check if user has unlocked agents
    if (unlockedAgents.length === 0) {
      setToast({
        message: 'Agent locked — unlock agent in /agents to request admin approval',
        type: 'error'
      });
      return;
    }

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
      const apiCallPromise = researchApi.run({ symbol: 'BTCUSDT' });
      
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
      
      // Update progress based on actual response data
      if (response.data?.results && response.data.results.length > 0) {
        const result = response.data.results[0];
        
        // Update progress based on available data
        if (result.cryptoQuant && !result.cryptoQuant.error) {
          updateProgress(1, 'success'); // on-chain metrics
        } else if (result.cryptoQuant?.error) {
          updateProgress(1, 'error', result.cryptoQuant.error);
        }
        
        
        if (result.coinApi?.marketData && !result.coinApi.marketData.error) {
          updateProgress(0, 'success'); // market data
        } else if (result.coinApi?.marketData?.error) {
          updateProgress(0, 'error', result.coinApi.marketData.error);
        }
        
        // Whale activity (from CryptoQuant)
        if (result.cryptoQuant && !result.cryptoQuant.error && result.cryptoQuant.whaleTransactions) {
          updateProgress(2, 'success');
        } else {
          updateProgress(2, 'success'); // Mark as success even if no whale data
        }
        
        if (result.indicators) {
          updateProgress(4, 'success'); // combining indicators
        }
        
        if (result.finalAnalysis) {
          updateProgress(5, 'success'); // final score
        }
      } else {
        // Fallback: mark all as success if we got a response
        for (let i = 0; i < steps.length; i++) {
          updateProgress(i, 'success');
        }
      }
      
      if (response.data?.success && response.data.results) {
        // Add results to deep research results array (newest first)
        const resultsWithTimestamp = response.data.results.map((result: any) => ({
          ...result,
          timestamp: new Date().toISOString(),
          id: `deep_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        }));
        setDeepResearchResults((prev) => [...resultsWithTimestamp, ...prev]);
        
        const result = response.data.results[0];
        await addNotification({
          title: 'Deep Research Completed',
          message: `Analyzed ${response.data.totalAnalyzed || response.data.results.length} symbol(s) with ${result?.finalAnalysis?.confidencePercent || 0}% accuracy`,
          type: 'success',
        });
      } else if (response.data?.results && response.data.results.length > 0) {
        // Partial success
        const resultsWithTimestamp = response.data.results.map((result: any) => ({
          ...result,
          timestamp: new Date().toISOString(),
          id: `deep_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        }));
        setDeepResearchResults((prev) => [...resultsWithTimestamp, ...prev]);
        showToast('Deep research completed with some API errors', 'success');
      } else {
        showError('No research data received from server. Please try again.', 'api');
        updateProgress(5, 'error', 'No data received');
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

      {/* Premium Agent Lock Banner */}
      {!hasPremiumAgent && !agentsLoading && (
        <div className="fixed top-16 left-0 right-0 z-50 bg-gradient-to-r from-red-900/90 to-orange-900/90 backdrop-blur-md border-b border-red-500/50 shadow-lg">
          <div className="max-w-7xl mx-auto px-4 py-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-6 h-6 rounded-full bg-red-500 flex items-center justify-center">
                  <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                  </svg>
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-white">Premium Agent Locked</h3>
                  <p className="text-xs text-red-200">Unlock Premium Trading Agent to access Deep Research and Auto Trade.</p>
                </div>
              </div>
              <Link
                to="/agents"
                className="px-4 py-2 bg-white/10 hover:bg-white/20 text-white text-sm font-medium rounded-lg border border-white/20 transition-all duration-200 hover:border-white/40"
              >
                Unlock Premium Agent
              </Link>
            </div>
          </div>
        </div>
      )}

      <main className="min-h-screen">
        <div className="max-w-7xl mx-auto py-4 sm:py-8 px-4 sm:px-6 lg:px-8">
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
          <section className="hidden lg:block mb-6 sm:mb-8">
            <div className="space-y-2">
              <h1 className="text-3xl sm:text-4xl font-bold bg-gradient-to-r from-purple-300 via-pink-300 to-cyan-300 bg-clip-text text-transparent">
                Research Panel
              </h1>
              <p className="text-sm sm:text-base text-gray-300">
                Run instant deep research with full exchange API data
              </p>
            </div>
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
          </section>
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
                      (showMoreAnalysis ? analysisReport : analysisReport.slice(0, 3)).map((item, index) => (
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
                  (showMoreAnalysis ? analysisReport : analysisReport.slice(0, 3)).map((item, index) => (
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

              {/* View More Button (Mobile) */}
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
            </div>

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

            {/* Deep Research Report */}
            <div className="relative bg-black/30 backdrop-blur-xl border border-purple-500/30 rounded-2xl p-6 shadow-2xl shadow-purple-500/10 hover:shadow-purple-500/20 transition-all duration-300 overflow-hidden">
              {/* Gradient accent line */}
              <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-purple-500 via-pink-500 to-cyan-500"></div>
              
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
                <div>
                  <h2 className="text-xl sm:text-2xl font-bold bg-gradient-to-r from-purple-400 via-pink-400 to-cyan-400 bg-clip-text text-transparent mb-1">
                    Deep Research Report
                  </h2>
                  <p className="text-xs sm:text-sm text-gray-400 flex items-center gap-2">
                    <span className="w-2 h-2 bg-purple-400 rounded-full animate-pulse"></span>
                    Manual deep research results only
                  </p>
                </div>
              </div>

              {deepResearchLoading ? (
                <div className="text-center py-12">
                  <div className="w-16 h-16 rounded-full bg-purple-500/10 flex items-center justify-center mx-auto mb-4">
                    <span className="w-8 h-8 border-4 border-purple-500/30 border-t-purple-500 rounded-full animate-spin"></span>
                  </div>
                  <p className="text-gray-400 text-sm">Running deep research...</p>
                </div>
              ) : deepResearchResults.length === 0 ? (
                <div className="text-center py-12">
                  <div className="w-16 h-16 rounded-full bg-purple-500/10 flex items-center justify-center mx-auto mb-4">
                    <svg className="w-8 h-8 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                  </div>
                  <p className="text-gray-400 text-sm">No deep research results yet. Run deep research to see results here.</p>
                </div>
              ) : (
                <div className="space-y-6">
                  {deepResearchResults.map((result, idx) => (
                    <div key={result.id || idx} className="bg-black/40 backdrop-blur-sm rounded-xl p-5 border border-purple-500/30">
                      <div className="mb-4">
                        <div className="flex items-center justify-between mb-2">
                          <h3 className="text-lg font-bold text-white">{result.symbol}</h3>
                          {result.timestamp && (
                            <span className="text-xs text-gray-400 font-mono">
                              {new Date(result.timestamp).toLocaleString()}
                            </span>
                          )}
                        </div>
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
