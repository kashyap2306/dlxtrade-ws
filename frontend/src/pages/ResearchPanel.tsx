import { useState, useEffect, useCallback } from 'react';
import { useThrottle } from '../hooks/usePerformance';
import { researchApi, settingsApi, adminApi } from '../services/api';
import { wsService } from '../services/ws';
import Toast from '../components/Toast';
import { useError } from '../contexts/ErrorContext';
import { useNotificationContext } from '../contexts/NotificationContext';
import { getApiErrorMessage, suppressConsoleError } from '../utils/errorHandler';
import { useAuth } from '../hooks/useAuth';

// Import extracted components
import ResearchPanelHeader from './ResearchPanelHeader';
import TopCoinsGrid from './TopCoinsGrid';
import LiveResearchCard from './LiveResearchCard';
import DeepResearchResults from './DeepResearchResults';
import CoinResearchSection from './CoinResearchSection';
import { ResearchLog, AnalysisReportItem } from './ResearchPanelTypes';
import { canExecute } from './ResearchPanelUtils';

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

  // Deep Research state
  const [topCoins, setTopCoins] = useState<any[]>([]);
  const [showAll, setShowAll] = useState(false);
  const [selectedCoinData, setSelectedCoinData] = useState<any>(null);
  const [selectedCoinSymbol, setSelectedCoinSymbol] = useState<string | null>(null);
  const [coinResearchLoading, setCoinResearchLoading] = useState(false);
  const [topCoinsLoading, setTopCoinsLoading] = useState(false);
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
  const loadTopCoins = useCallback(async () => {
    if (!user?.uid) return;

    setTopCoinsLoading(true);
    try {
      const response = await researchApi.deepResearch.getTop50();
      const coins = Array.isArray(response.data)
        ? response.data
        : response.data?.coins || response.data?.data || [];
      console.log("Top50 coins loaded:", coins);
      setTopCoins(coins);
    } catch (err: any) {
      console.error('Error loading top 50 coins:', err);
      showError('Failed to load top coins', 'api');
    } finally {
      setTopCoinsLoading(false);
    }
  }, [user?.uid, showError]);

  // Load detailed research for a specific coin
  const loadCoinResearch = useCallback(async (symbol: string) => {
    if (!user?.uid) return;

    setCoinResearchLoading(true);
    setSelectedCoinSymbol(symbol);
    setSelectedSymbol(symbol); // Also update the main selected symbol for deep research

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
    loadTopCoins();
  }, [loadTopCoins]);

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

    try {
      // Simulate progress updates
      for (let i = 0; i < steps.length; i++) {
        setResearchProgress(prev => prev.map((step, idx) =>
          idx === i ? { ...step, status: 'loading' as const } :
          idx < i ? { ...step, status: 'success' as const } :
          step
        ));

        // Wait between steps
        await new Promise(resolve => setTimeout(resolve, 1000));
      }

      const response = await researchApi.run({
        symbol: selectedSymbol,
        uid: user?.uid
      });

      if (response.data) {
        const result = {
          id: Date.now().toString(),
          result: response.data,
          news: response.data.news || { articles: [] },
          metadata: response.data.metadata || {},
        };

        setDeepResearchResults(prev => [result, ...prev]);
        setCooldownSeconds(10); // 10 second cooldown

        // Update progress to success
        setResearchProgress(prev => prev.map(step => ({ ...step, status: 'success' as const })));

        addNotification({
          type: 'success',
          title: 'Deep Research Complete',
          message: `Analysis completed for ${selectedSymbol}`
        });
      }
    } catch (err: any) {
      console.error('Deep research error:', err);

      // Update progress to show error
      setResearchProgress(prev => prev.map(step => ({ ...step, status: 'error' as const, error: err.message })));

      showError('Failed to run deep research', 'api');
    } finally {
      setDeepResearchLoading(false);
    }
  };

  const handleSelectCoin = useCallback(async (symbol: string) => {
    setSelectedSymbol(symbol);
    await loadCoinResearch(symbol);
    // Automatically trigger deep research for the selected coin
    setTimeout(() => handleDeepResearch(), 500); // Small delay to ensure coin data is loaded
  }, [loadCoinResearch]);


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

      <main className="w-full min-h-screen overflow-x-hidden relative">
        <div className="w-full max-w-full px-0 sm:px-1 md:px-2 lg:px-3 overflow-x-hidden py-6 sm:py-8 lg:py-12">
          {/* Header */}
          <ResearchPanelHeader
            loading={loading}
            deepResearchLoading={deepResearchLoading}
            cooldownSeconds={cooldownSeconds}
            onLoadLogs={loadLogs}
            onHandleDeepResearch={handleDeepResearch}
          />

          {/* Top 50 Coins Grid */}
          <TopCoinsGrid
            topCoins={topCoins}
            onSelectCoin={handleSelectCoin}
          />

          <div className="space-y-8">
            {/* Live Research Card */}
            <LiveResearchCard
              liveData={liveData}
              settings={settings}
            />

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

            {/* Deep Research Results */}
            <DeepResearchResults
              deepResearchLoading={deepResearchLoading}
              deepResearchResults={deepResearchResults}
              settings={settings}
            />

            {/* Coin Research Section */}
            <CoinResearchSection
              selectedCoinSymbol={selectedCoinSymbol}
              coinResearchLoading={coinResearchLoading}
              selectedCoinData={selectedCoinData}
              mobileSectionsOpen={mobileSectionsOpen}
              setMobileSectionsOpen={setMobileSectionsOpen}
            />
                            </div>
                          </div>
      </main>

      {toast && <Toast message={toast.message} type={toast.type} />}
                              </div>
  );
}