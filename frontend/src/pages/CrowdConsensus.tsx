import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { agentsApi } from '../services/api';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../config/firebase-config';
import { InformationCircleIcon, CheckCircleIcon, ClockIcon } from '@heroicons/react/24/outline';

interface CrowdConsensusTrade {
  id: string;
  pair: 'BTCUSDT' | 'ETHUSDT';
  direction: 'LONG' | 'SHORT';
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  rrRatio: number;
  status: 'OPEN' | 'WIN' | 'LOSS';
  executedAt: Date;
}

interface SkippedTrade {
  id: string;
  pair: 'BTCUSDT' | 'ETHUSDT';
  direction: 'LONG' | 'SHORT';
  reason: 'NO_CONSENSUS' | 'RR_TOO_LOW' | 'ENTRY_LATE' | 'SR_BLOCKED' | 'DAILY_LIMIT_REACHED' | 'EXCHANGE_ERROR' | 'COIN_OUTSIDE_TOP_100';
  timestamp: Date;
}

interface ExchangeConnection {
  connected: boolean;
  exchange?: string;
  message?: string;
}

interface ExchangeBreakdown {
  name: string;
  signal: 'LONG' | 'SHORT' | 'NONE';
  confidence: number;
  positionCount: number;
  contributedToConsensus: boolean;
  positions?: Array<{ pair: string; count: number }>; // Added for expandable details
}

interface ConsensusBreakdown {
  exchanges: ExchangeBreakdown[];
  finalConsensus: 'LONG' | 'SHORT' | 'NONE';
  consensusStrength: number;
  status: 'EXECUTED' | 'SKIPPED' | 'PENDING';
  skipReason?: string;
  timestamp: Date;
}

// Exchange logo/icon mapping (using emoji/text for now - can be replaced with actual logos)
const EXCHANGE_ICONS: Record<string, string> = {
  binance: '🟡',
  bybit: '🟠',
  bitget: '🔵',
  okx: '⚫',
  kucoin: '🟢',
  bingx: '🔴',
  gate: '🟣',
  mexc: '🔵',
  phemex: '🟡',
  coinex: '🟠'
};

const EXCHANGE_COLORS: Record<string, string> = {
  binance: 'from-yellow-500 to-yellow-600',
  bybit: 'from-orange-500 to-orange-600',
  bitget: 'from-blue-500 to-blue-600',
  okx: 'from-gray-700 to-gray-800',
  kucoin: 'from-green-500 to-green-600',
  bingx: 'from-red-500 to-red-600',
  gate: 'from-purple-500 to-purple-600',
  mexc: 'from-blue-400 to-blue-500',
  phemex: 'from-yellow-400 to-yellow-500',
  coinex: 'from-orange-400 to-orange-500'
};

interface ConsensusBreakdown {
  exchanges: ExchangeBreakdown[];
  finalConsensus: 'LONG' | 'SHORT' | 'NONE';
  consensusStrength: number;
  status: 'EXECUTED' | 'SKIPPED' | 'PENDING';
  skipReason?: string;
  timestamp: Date;
  nextScanIn?: number; // Seconds until next 5-minute scan
}

interface AutoTradeStatus {
  autoTradeEnabled: boolean;
  status: 'ACTIVE' | 'INACTIVE';
  lastUpdated?: Date;
  dryRun?: boolean;
}

export default function CrowdConsensus() {
  const { user, authReady } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [trades, setTrades] = useState<CrowdConsensusTrade[]>([]);
  const [skippedTrades, setSkippedTrades] = useState<SkippedTrade[]>([]);
  const [exchangeConnection, setExchangeConnection] = useState<ExchangeConnection>({ connected: false });
  const [autoTradeStatus, setAutoTradeStatus] = useState<AutoTradeStatus>({ autoTradeEnabled: false, status: 'INACTIVE' });
  const [togglingAutoTrade, setTogglingAutoTrade] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [agentAccessChecked, setAgentAccessChecked] = useState(false);
  const [hasAgentAccess, setHasAgentAccess] = useState(false);
  const [scheduler, setScheduler] = useState<any | null>(null);
  const [showExecutionCriteria, setShowExecutionCriteria] = useState(false);
  const [consensusBreakdown, setConsensusBreakdown] = useState<ConsensusBreakdown | null>(null);
  const [expandedExchanges, setExpandedExchanges] = useState<Set<string>>(new Set());
  const [countdown, setCountdown] = useState<number>(300); // 5 minutes default

  // Normalize Firestore timestamp to Date
  const toValidDate = (value: any): Date | null => {
    if (!value) return null;
    if (value instanceof Date) {
      return Number.isFinite(value.getTime()) ? value : null;
    }
    if (typeof value === 'number' || typeof value === 'string') {
      const d = new Date(value);
      return Number.isFinite(d.getTime()) ? d : null;
    }
    if (typeof value?.toDate === 'function') {
      const d = value.toDate();
      return d instanceof Date && Number.isFinite(d.getTime()) ? d : null;
    }
    const seconds = value?.seconds ?? value?._seconds;
    if (typeof seconds === 'number') {
      const d = new Date(seconds * 1000);
      return Number.isFinite(d.getTime()) ? d : null;
    }
    return null;
  };

  // Format skip reason to be more user-friendly
  const formatSkipReason = (reason: string): string => {
    const reasonMap: { [key: string]: string } = {
      'NO_CONSENSUS': 'No consensus - need 2+ exchanges agreeing on same direction',
      'RR_TOO_LOW': 'Risk/Reward ratio below minimum threshold (2.0:1)',
      'ENTRY_LATE': 'Entry timing missed - price moved too far from signal',
      'SR_BLOCKED': 'Take profit blocked by support/resistance level',
      'DAILY_LIMIT_REACHED': 'Daily trade limit reached (5 trades max)',
      'EXCHANGE_ERROR': 'Exchange connection or API error',
      'INSUFFICIENT_BALANCE': 'Insufficient balance for trade',
      'INSUFFICIENT_MARGIN': 'Insufficient margin for position',
      'VALIDATION_FAILED': 'Trade validation failed',
      'AUTO_TRADE_DISABLED': 'Auto trade is disabled',
      'EXCHANGE_NOT_CONNECTED': 'Exchange not connected',
      'COIN_OUTSIDE_TOP_100': 'Coin not in TOP 100 by market cap (HARD RULE)'
    };
    return reasonMap[reason] || reason.replace(/_/g, ' ').toLowerCase();
  };

  // Format countdown timer
  const formatCountdown = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const toggleExchangeExpansion = (exchangeName: string) => {
    setExpandedExchanges(prev => {
      const newSet = new Set(prev);
      if (newSet.has(exchangeName)) {
        newSet.delete(exchangeName);
      } else {
        newSet.add(exchangeName);
      }
      return newSet;
    });
  };

  // Check Firestore approval (users/{uid}.approvedAgents)
  useEffect(() => {
    const checkAgentAccess = async () => {
      if (!user) return;

      try {
        const userDoc = await getDoc(doc(db, 'users', user.uid));
        const approvedAgents: string[] = (userDoc.data() as any)?.approvedAgents || [];
        const hasAccess = Array.isArray(approvedAgents) && approvedAgents.includes('COPY_TRADING_AGENT');
        setHasAgentAccess(hasAccess);
        setAgentAccessChecked(true);
      } catch (error) {
        console.error('Error checking agent access:', error);
        setHasAgentAccess(false);
        setAgentAccessChecked(true);
      }
    };

    checkAgentAccess();
  }, [user]);

  // Load data when prerequisites are met (no exchange config required)
  const pageReady = hasAgentAccess && agentAccessChecked;

  // Countdown timer effect
  useEffect(() => {
    const timer = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) {
          // Reload consensus breakdown when countdown hits 0
          loadConsensusBreakdown();
          return consensusBreakdown?.nextScanIn || 300;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [consensusBreakdown?.nextScanIn]);

  // Update countdown when new consensus data arrives
  useEffect(() => {
    if (consensusBreakdown?.nextScanIn) {
      setCountdown(consensusBreakdown.nextScanIn);
    }
  }, [consensusBreakdown?.nextScanIn]);

  useEffect(() => {
    if (!user || !pageReady) {
      return;
    }

    loadAllData();

    // Set up polling for live updates
    const interval = setInterval(() => {
      if (pageReady) {
        loadAutoTradeStatus();
        loadSchedulerStatus();
        loadTrades();
        loadSkippedTrades();
        loadConsensusBreakdown();
      }
    }, 30000); // Update every 30 seconds

    return () => clearInterval(interval);
  }, [user, pageReady]);

  const loadAllData = async () => {
    if (!pageReady) {
      return;
    }
    setLoading(true);
    try {
      await Promise.all([
        loadAutoTradeStatus(),
        loadSchedulerStatus(),
        loadTrades(),
        loadSkippedTrades(),
        loadExchangeConnection(),
        loadConsensusBreakdown()
      ]);
    } catch (error) {
      console.error('Error loading data:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadExchangeConnection = async () => {
    if (!user) return;

    try {
      const response = await agentsApi.getCrowdConsensusExchangeStatus();
      setExchangeConnection(response.data?.exchangeStatus || { connected: false });
    } catch (error: any) {
      console.error('Error loading exchange connection:', error);
      setExchangeConnection({ connected: false, message: 'Error checking exchange connection' });
    }
  };

  const loadAutoTradeStatus = async () => {
    if (!user) return;

    try {
      const response = await agentsApi.getCrowdConsensusStatus();
      const data = response.data || { autoTradeEnabled: false, status: 'INACTIVE' };

      // Also load settings to get dryRun status
      const settingsResponse = await agentsApi.getCrowdConsensusSettings();
      const settingsPayload = settingsResponse.data || {};
      const settings = (settingsPayload as any)?.settings || settingsPayload || {};

      setAutoTradeStatus({
        ...data,
        dryRun: settings.dryRun || false
      });
    } catch (error: any) {
      console.error('Error loading auto trade status:', error);
      setAutoTradeStatus({ autoTradeEnabled: false, status: 'INACTIVE', dryRun: false });
    }
  };

  const loadTrades = async () => {
    if (!user) return;

    try {
      const response = await agentsApi.getCrowdConsensusSignals(50);
      const signals = response.data?.signals || [];
      const transformedTrades: CrowdConsensusTrade[] = signals.map((signal: any) => ({
        id: signal.id,
        pair: signal.pair,
        direction: signal.direction,
        entryPrice: signal.entryPrice,
        stopLoss: signal.stopLoss,
        takeProfit: signal.takeProfit,
        rrRatio: signal.rrRatio,
        status: signal.status || 'OPEN',
        executedAt: toValidDate(signal.executedAt || signal.timestamp) || new Date()
      }));
      setTrades(transformedTrades);
    } catch (error: any) {
      console.error('Error loading trades:', error);
      if (error.response?.status === 403) {
        setError('Access denied: Crowd Consensus Copy Trade not approved');
      }
    }
  };

  const loadSkippedTrades = async () => {
    if (!user) return;

    try {
      const response = await agentsApi.getCrowdConsensusSkippedTrades(50);
      setSkippedTrades(response.data?.skippedTrades || []);
    } catch (error: any) {
      console.error('Error loading skipped trades:', error);
      setSkippedTrades([]);
    }
  };

  const loadSchedulerStatus = async () => {
    if (!user) return;

    try {
      const response = await agentsApi.getTradingAgentDiagnostics('crowd-consensus', 20);
      setScheduler(response.data?.scheduler || null);
    } catch (error: any) {
      console.error('Error loading scheduler status:', error);
      setScheduler(null);
    }
  };

  const loadConsensusBreakdown = async () => {
    if (!user) return;

    try {
      const response = await agentsApi.getCrowdConsensusExchangeBreakdown();
      setConsensusBreakdown(response.data || null);
    } catch (error: any) {
      console.error('Error loading consensus breakdown:', error);
      setConsensusBreakdown(null);
    }
  };

  const toggleAutoTrade = async () => {
    if (togglingAutoTrade) return;

    setTogglingAutoTrade(true);
    setError(null);

    try {
      // Use current UI state to decide action
      if (autoTradeStatus.autoTradeEnabled) {
        await agentsApi.stopCrowdConsensusAutoTrade();
      } else {
        await agentsApi.startCrowdConsensusAutoTrade();
      }
      
      // CRITICAL: Refetch ALL data from backend after API call
      await loadAutoTradeStatus();
      await loadSchedulerStatus();
      await loadTrades();
      await loadSkippedTrades();
    } catch (error: any) {
      console.error('[CrowdConsensus] Error toggling auto trade:', error);
      setError(error.response?.data?.error || 'Failed to toggle auto trade');
    } finally {
      setTogglingAutoTrade(false);
    }
  };

  // Strict render guards: Wait for auth and agent access check
  if (!authReady || !agentAccessChecked) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-500"></div>
      </div>
    );
  }

  // Check user-agent linkage document directly
  if (!hasAgentAccess) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 flex items-center justify-center">
        <div className="text-center">
          <div className="text-red-400 text-lg mb-4">Access Denied</div>
          <div className="text-gray-400">You don't have access to Crowd Consensus Copy Trade</div>
        </div>
      </div>
    );
  }

  return (
    <ErrorBoundary>
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900">
        <div className="bg-gradient-to-br from-slate-800/70 via-slate-800/50 to-slate-900/70 backdrop-blur-xl border-b border-purple-500/20">
          <div className="container mx-auto px-4 py-6">
            <div className="flex items-center justify-between">
              <h1 className="text-3xl font-bold bg-gradient-to-r from-purple-300 via-pink-300 to-cyan-300 bg-clip-text text-transparent">
                👥 Crowd Consensus Copy Trade
              </h1>
              <div className="flex items-center gap-2">
                <button onClick={loadAllData} className="btn btn-secondary" disabled={loading}>Refresh</button>
                <button onClick={() => navigate('/agents')} className="btn btn-secondary">Back</button>
              </div>
            </div>
          </div>
        </div>

        <div className="container mx-auto px-4 py-6 space-y-6">
          {/* Error Banner */}
          {error && (
            <div className="bg-red-900/20 border border-red-500/30 rounded-xl p-4">
              <div className="text-red-400 text-sm font-medium mb-1">Error</div>
              <div className="text-gray-300 text-sm">{error}</div>
            </div>
          )}

          {/* Exchange Connection Status */}
          <div className="bg-slate-800/40 backdrop-blur-xl border border-purple-500/20 rounded-xl p-6">
            <h2 className="text-xl font-semibold text-white mb-4">Exchange Connection</h2>
            <div className="flex items-center gap-3">
              <div className={`w-3 h-3 rounded-full ${exchangeConnection.connected ? 'bg-green-400' : 'bg-red-400'}`}></div>
              <div>
                <div className="text-white font-medium">
                  {exchangeConnection.connected
                    ? `Connected to ${exchangeConnection.exchange}`
                    : 'Exchange not connected'
                  }
                </div>
                <div className="text-gray-400 text-sm">
                  {exchangeConnection.message || (exchangeConnection.connected ? 'Ready for trading' : 'Go to Settings to connect an exchange')}
                </div>
              </div>
            </div>
          </div>

          {/* Auto Trade Toggle */}
          <div className="bg-slate-800/40 backdrop-blur-xl border border-purple-500/20 rounded-xl p-6">
            <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-xl font-semibold text-white mb-2">Auto Trade</h2>
                  <div className="text-gray-400 text-sm">
                    {autoTradeStatus.autoTradeEnabled
                      ? 'Crowd Consensus auto trading is active'
                      : 'Enable to start Crowd Consensus auto trading'
                    }
                  </div>
                  {autoTradeStatus.dryRun && (
                    <div className="text-yellow-400 text-sm font-medium mt-1">
                      DRY RUN MODE - No real trades executed
                    </div>
                  )}
                  {autoTradeStatus.lastUpdated && (
                    <div className="text-gray-500 text-xs mt-1">
                      Last updated: {new Date(autoTradeStatus.lastUpdated).toLocaleString()}
                    </div>
                  )}
                </div>
              <button
                onClick={toggleAutoTrade}
                disabled={togglingAutoTrade}
                className={`btn ${autoTradeStatus.autoTradeEnabled ? 'btn-danger' : 'btn-success'} ${togglingAutoTrade ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                {togglingAutoTrade ? (
                  <div className="flex items-center gap-2">
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                    {autoTradeStatus.autoTradeEnabled ? 'Stopping...' : 'Starting...'}
                  </div>
                ) : (
                  autoTradeStatus.autoTradeEnabled ? 'Stop Auto Trade' : 'Start Auto Trade'
                )}
              </button>
            </div>
          </div>

          {/* Live Trade History */}
          <div className="bg-slate-800/40 backdrop-blur-xl border border-purple-500/20 rounded-xl p-6">
            <h2 className="text-xl font-semibold text-white mb-4">Live Trade History</h2>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="text-gray-400 border-b border-purple-500/20">
                    <th className="text-left py-2 pr-4 font-medium">Pair</th>
                    <th className="text-left py-2 pr-4 font-medium">Direction</th>
                    <th className="text-left py-2 pr-4 font-medium">Entry Price</th>
                    <th className="text-left py-2 pr-4 font-medium">Stop Loss</th>
                    <th className="text-left py-2 pr-4 font-medium">Take Profit</th>
                    <th className="text-left py-2 pr-4 font-medium">RR</th>
                    <th className="text-left py-2 pr-4 font-medium">Status</th>
                    <th className="text-left py-2 pr-4 font-medium">Timestamp</th>
                  </tr>
                </thead>
                <tbody>
                  {trades.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="py-8 text-center text-gray-400">
                        No executed trades yet
                      </td>
                    </tr>
                  ) : (
                    trades.map((trade) => (
                      <tr key={trade.id} className="border-b border-purple-500/10">
                        <td className="py-2 pr-4 text-white font-medium">{trade.pair}</td>
                        <td className={`py-2 pr-4 font-medium ${trade.direction === 'LONG' ? 'text-green-400' : 'text-red-400'}`}>
                          {trade.direction}
                        </td>
                        <td className="py-2 pr-4 text-gray-300">${trade.entryPrice?.toFixed(2) || '-'}</td>
                        <td className="py-2 pr-4 text-gray-300">${trade.stopLoss?.toFixed(2) || '-'}</td>
                        <td className="py-2 pr-4 text-gray-300">${trade.takeProfit?.toFixed(2) || '-'}</td>
                        <td className="py-2 pr-4 text-green-400 font-medium">
                          {trade.rrRatio ? `${trade.rrRatio.toFixed(1)}:1` : '-'}
                        </td>
                        <td className="py-2 pr-4">
                          <div className="flex items-center gap-2">
                            {/* Show info icon for failed trades with exchange error */}
                            {(trade.status === 'FAILED' || trade.error || trade.exchangeErrorReason) && (
                              <div className="relative group">
                                <svg className="w-5 h-5 text-red-400 cursor-help" fill="currentColor" viewBox="0 0 20 20">
                                  <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                                </svg>
                                <div className="absolute left-0 bottom-full mb-2 hidden group-hover:block z-50 w-64 p-3 bg-slate-900 border border-red-500/30 rounded-lg shadow-xl">
                                  <div className="text-xs font-semibold text-red-400 mb-1">Exchange Rejection Reason:</div>
                                  <div className="text-xs text-gray-300 leading-relaxed">
                                    {trade.exchangeErrorReason || trade.error || 'Exchange rejected the order (no details provided)'}
                                  </div>
                                </div>
                              </div>
                            )}
                            <span className={`px-2 py-1 rounded text-xs ${
                              trade.status === 'WIN' ? 'bg-green-500/20 text-green-400' :
                              trade.status === 'LOSS' ? 'bg-red-500/20 text-red-400' :
                              trade.status === 'OPEN' ? 'bg-blue-500/20 text-blue-400' :
                              trade.status === 'FAILED' ? 'bg-red-500/20 text-red-400' :
                              'bg-yellow-500/20 text-yellow-400'
                            }`}>
                              {trade.status}
                            </span>
                          </div>
                        </td>
                        <td className="py-2 pr-4 text-gray-300">
                          {trade.executedAt ? toValidDate(trade.executedAt)?.toLocaleString() || '—' : '—'}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Exchange Consensus Breakdown */}
          {consensusBreakdown && (
            <div className="bg-slate-800/40 backdrop-blur-xl border border-purple-500/20 rounded-xl p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-semibold text-white">Exchange Consensus Analysis</h2>
                {/* Countdown Timer */}
                <div className="flex items-center gap-2 bg-purple-900/30 px-4 py-2 rounded-lg border border-purple-500/30">
                  <ClockIcon className="w-5 h-5 text-purple-400" />
                  <div className="text-sm">
                    <div className="text-gray-400 text-xs">Next scan in</div>
                    <div className="text-white font-mono font-semibold">{formatCountdown(countdown)}</div>
                  </div>
                </div>
              </div>
              
              {/* Execution Status Banner */}
              <div className={`mb-4 p-4 rounded-lg border ${
                consensusBreakdown.finalConsensus !== 'NONE'
                  ? 'bg-green-900/20 border-green-500/30'
                  : 'bg-yellow-900/20 border-yellow-500/30'
              }`}>
                <div className="flex items-center justify-between">
                  <div>
                    <div className={`text-lg font-semibold ${
                      consensusBreakdown.finalConsensus !== 'NONE' ? 'text-green-400' : 'text-yellow-400'
                    }`}>
                      {consensusBreakdown.finalConsensus !== 'NONE'
                        ? `✅ Consensus Reached: ${consensusBreakdown.finalConsensus}`
                        : '⏳ Waiting for Consensus'
                      }
                    </div>
                    <div className="text-sm text-gray-300 mt-1">
                      {consensusBreakdown.skipReason || `${consensusBreakdown.consensusStrength} exchanges agreeing`}
                    </div>
                  </div>
                  <div className="text-xs text-gray-400">
                    {toValidDate(consensusBreakdown.timestamp)?.toLocaleTimeString() || '—'}
                  </div>
                </div>
              </div>

              {/* Exchange Signals Grid - ONLY SHOW CONSENSUS EXCHANGES */}
              {consensusBreakdown.exchanges.length > 0 ? (
                <div>
                  <div className="text-sm text-gray-400 mb-3">
                    Showing {consensusBreakdown.exchanges.length} exchange{consensusBreakdown.exchanges.length !== 1 ? 's' : ''} contributing to consensus
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
                    {consensusBreakdown.exchanges.map((exchange) => {
                      const isExpanded = expandedExchanges.has(exchange.name);
                      return (
                        <div
                          key={exchange.name}
                          className="rounded-lg border cursor-pointer transition-all bg-green-900/20 border-green-500/30 hover:bg-green-900/30"
                          onClick={() => toggleExchangeExpansion(exchange.name)}
                        >
                          <div className="p-3">
                            <div className="flex items-center justify-between mb-2">
                              <div className="flex items-center gap-2">
                                <span className="text-2xl">{EXCHANGE_ICONS[exchange.name] || '📊'}</span>
                                <div className="text-sm font-semibold text-white capitalize">
                                  {exchange.name}
                                </div>
                              </div>
                              <CheckCircleIcon className="w-4 h-4 text-green-400" />
                            </div>
                            <div className={`text-xs font-medium mb-1 ${
                              exchange.signal === 'LONG' ? 'text-green-400' :
                              exchange.signal === 'SHORT' ? 'text-red-400' :
                              'text-gray-500'
                            }`}>
                              {exchange.signal}
                            </div>
                            <div className="text-xs text-gray-400">
                              {exchange.confidence}% confidence
                            </div>
                            <div className="text-xs text-gray-500">
                              {exchange.positionCount} positions
                            </div>
                          </div>
                          
                          {/* Expandable Details */}
                          {isExpanded && exchange.positionCount > 0 && (
                            <div className="border-t border-slate-600/30 p-3 bg-slate-900/30">
                              <div className="text-xs font-semibold text-gray-300 mb-2">Position Breakdown:</div>
                              <div className="space-y-1">
                                {exchange.positions && exchange.positions.length > 0 ? (
                                  exchange.positions.map((pos, idx) => (
                                    <div key={idx} className="flex justify-between text-xs">
                                      <span className="text-gray-400">{pos.pair}</span>
                                      <span className="text-gray-300">{pos.count} position{pos.count > 1 ? 's' : ''}</span>
                                    </div>
                                  ))
                                ) : (
                                  <div className="text-xs text-gray-500 italic">
                                    {exchange.signal !== 'NONE' 
                                      ? `${exchange.positionCount} ${exchange.signal} position${exchange.positionCount > 1 ? 's' : ''} detected`
                                      : 'No active positions'
                                    }
                                  </div>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <div className="text-center py-8 text-gray-400">
                  <div className="text-lg mb-2">No consensus detected</div>
                  <div className="text-sm">Waiting for 2+ exchanges to agree on same coin and direction</div>
                  <div className="text-xs mt-2 text-gray-500">Next scan in {formatCountdown(countdown)}</div>
                </div>
              )}
            </div>
          )}

          {/* Skipped / Rejected Trade Diagnostics */}
          <div className="bg-slate-800/40 backdrop-blur-xl border border-purple-500/20 rounded-xl p-6">
            <div className="flex items-center gap-2 mb-4">
              <h2 className="text-xl font-semibold text-white">Diagnostics</h2>
              <button
                onClick={() => setShowExecutionCriteria(!showExecutionCriteria)}
                className="text-purple-400 hover:text-purple-300 transition-colors"
                title="View execution criteria checklist"
              >
                <InformationCircleIcon className="w-5 h-5" />
              </button>
            </div>

            {/* Execution Criteria Checklist */}
            {showExecutionCriteria && (
              <div className="mb-4 p-4 bg-slate-900/50 rounded-lg border border-purple-500/20">
                <h3 className="text-sm font-semibold text-white mb-3">Execution Criteria Checklist</h3>
                <div className="space-y-2">
                  {/* Exchange API Connected */}
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-300">Exchange API Connected</span>
                    {exchangeConnection.connected ? (
                      <div className="flex items-center gap-1 text-green-400">
                        <CheckCircleIcon className="w-4 h-4" />
                        <span className="text-xs font-medium">DONE</span>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1 text-yellow-400" title="Exchange not connected">
                        <ClockIcon className="w-4 h-4" />
                        <span className="text-xs font-medium">PENDING</span>
                      </div>
                    )}
                  </div>

                  {/* API Key Present */}
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-300">API Key Present</span>
                    {exchangeConnection.connected ? (
                      <div className="flex items-center gap-1 text-green-400">
                        <CheckCircleIcon className="w-4 h-4" />
                        <span className="text-xs font-medium">DONE</span>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1 text-yellow-400" title="API key not configured">
                        <ClockIcon className="w-4 h-4" />
                        <span className="text-xs font-medium">PENDING</span>
                      </div>
                    )}
                  </div>

                  {/* Secret Present */}
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-300">Secret Present</span>
                    {exchangeConnection.connected ? (
                      <div className="flex items-center gap-1 text-green-400">
                        <CheckCircleIcon className="w-4 h-4" />
                        <span className="text-xs font-medium">DONE</span>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1 text-yellow-400" title="Secret not configured">
                        <ClockIcon className="w-4 h-4" />
                        <span className="text-xs font-medium">PENDING</span>
                      </div>
                    )}
                  </div>

                  {/* Passphrase Present (conditional) */}
                  {exchangeConnection.exchange && ['kucoin', 'okx'].includes(exchangeConnection.exchange.toLowerCase()) && (
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-gray-300">Passphrase Present</span>
                      {exchangeConnection.connected ? (
                        <div className="flex items-center gap-1 text-green-400">
                          <CheckCircleIcon className="w-4 h-4" />
                          <span className="text-xs font-medium">DONE</span>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1 text-yellow-400" title="Passphrase not configured">
                          <ClockIcon className="w-4 h-4" />
                          <span className="text-xs font-medium">PENDING</span>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Exchange Supported */}
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-300">Exchange Supported</span>
                    {exchangeConnection.connected && exchangeConnection.exchange ? (
                      <div className="flex items-center gap-1 text-green-400">
                        <CheckCircleIcon className="w-4 h-4" />
                        <span className="text-xs font-medium">DONE</span>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1 text-yellow-400" title="Exchange not configured or not supported">
                        <ClockIcon className="w-4 h-4" />
                        <span className="text-xs font-medium">PENDING</span>
                      </div>
                    )}
                  </div>

                  {/* Auto Trade Enabled */}
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-300">Auto Trade Enabled</span>
                    {autoTradeStatus.autoTradeEnabled ? (
                      <div className="flex items-center gap-1 text-green-400">
                        <CheckCircleIcon className="w-4 h-4" />
                        <span className="text-xs font-medium">DONE</span>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1 text-yellow-400" title="Auto trade is disabled">
                        <ClockIcon className="w-4 h-4" />
                        <span className="text-xs font-medium">PENDING</span>
                      </div>
                    )}
                  </div>

                  {/* Agent Approved */}
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-300">Agent Approved</span>
                    {hasAgentAccess ? (
                      <div className="flex items-center gap-1 text-green-400">
                        <CheckCircleIcon className="w-4 h-4" />
                        <span className="text-xs font-medium">DONE</span>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1 text-yellow-400" title="Agent not approved for this user">
                        <ClockIcon className="w-4 h-4" />
                        <span className="text-xs font-medium">PENDING</span>
                      </div>
                    )}
                  </div>

                  {/* Agent Engine Running */}
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-300">Agent Engine Running</span>
                    {scheduler?.isRunning ? (
                      <div className="flex items-center gap-1 text-green-400">
                        <CheckCircleIcon className="w-4 h-4" />
                        <span className="text-xs font-medium">DONE</span>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1 text-yellow-400" title="Scheduler not running">
                        <ClockIcon className="w-4 h-4" />
                        <span className="text-xs font-medium">PENDING</span>
                      </div>
                    )}
                  </div>

                  {/* Risk Check Passed */}
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-300">Risk Check Passed</span>
                    {(() => {
                      const hasRiskFailure = skippedTrades.some(t => t.reason === 'DAILY_LIMIT_REACHED');
                      return !hasRiskFailure ? (
                        <div className="flex items-center gap-1 text-green-400">
                          <CheckCircleIcon className="w-4 h-4" />
                          <span className="text-xs font-medium">DONE</span>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1 text-yellow-400" title="Daily limit reached">
                          <ClockIcon className="w-4 h-4" />
                          <span className="text-xs font-medium">PENDING</span>
                        </div>
                      );
                    })()}
                  </div>

                  {/* Session Time Valid */}
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-300">Session Time Valid</span>
                    {(() => {
                      // Assume session is valid if scheduler is running and no recent session-related skips
                      const isValid = scheduler?.isRunning && autoTradeStatus.autoTradeEnabled;
                      return isValid ? (
                        <div className="flex items-center gap-1 text-green-400">
                          <CheckCircleIcon className="w-4 h-4" />
                          <span className="text-xs font-medium">DONE</span>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1 text-yellow-400" title="Outside trading session or agent not running">
                          <ClockIcon className="w-4 h-4" />
                          <span className="text-xs font-medium">PENDING</span>
                        </div>
                      );
                    })()}
                  </div>

                  {/* Strategy Conditions Met */}
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-300">Strategy Conditions Met</span>
                    {(() => {
                      const hasNoConsensus = skippedTrades.some(t => t.reason === 'NO_CONSENSUS');
                      return !hasNoConsensus ? (
                        <div className="flex items-center gap-1 text-green-400">
                          <CheckCircleIcon className="w-4 h-4" />
                          <span className="text-xs font-medium">DONE</span>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1 text-yellow-400" title="No consensus signal detected">
                          <ClockIcon className="w-4 h-4" />
                          <span className="text-xs font-medium">PENDING</span>
                        </div>
                      );
                    })()}
                  </div>

                  {/* No SR Block */}
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-300">No SR Block</span>
                    {(() => {
                      const hasSRBlock = skippedTrades.some(t => t.reason === 'SR_BLOCKED');
                      return !hasSRBlock ? (
                        <div className="flex items-center gap-1 text-green-400">
                          <CheckCircleIcon className="w-4 h-4" />
                          <span className="text-xs font-medium">DONE</span>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1 text-yellow-400" title="Entry blocked by support/resistance level">
                          <ClockIcon className="w-4 h-4" />
                          <span className="text-xs font-medium">PENDING</span>
                        </div>
                      );
                    })()}
                  </div>

                  {/* Entry Not Late */}
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-300">Entry Not Late</span>
                    {(() => {
                      const hasEntryLate = skippedTrades.some(t => t.reason === 'ENTRY_LATE');
                      return !hasEntryLate ? (
                        <div className="flex items-center gap-1 text-green-400">
                          <CheckCircleIcon className="w-4 h-4" />
                          <span className="text-xs font-medium">DONE</span>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1 text-yellow-400" title="Entry timing missed">
                          <ClockIcon className="w-4 h-4" />
                          <span className="text-xs font-medium">PENDING</span>
                        </div>
                      );
                    })()}
                  </div>

                  {/* RR Ratio Acceptable */}
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-300">RR Ratio Acceptable</span>
                    {(() => {
                      const hasRRTooLow = skippedTrades.some(t => t.reason === 'RR_TOO_LOW');
                      return !hasRRTooLow ? (
                        <div className="flex items-center gap-1 text-green-400">
                          <CheckCircleIcon className="w-4 h-4" />
                          <span className="text-xs font-medium">DONE</span>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1 text-yellow-400" title="Risk/reward ratio too low">
                          <ClockIcon className="w-4 h-4" />
                          <span className="text-xs font-medium">PENDING</span>
                        </div>
                      );
                    })()}
                  </div>
                </div>
              </div>
            )}

            {/* Scheduler Status */}
            <div className="mb-4 p-3 bg-slate-900/50 rounded-lg">
              <div className="flex items-center justify-between">
                <div className="text-sm text-gray-400">Scheduler</div>
                <div className={`text-sm font-medium ${scheduler?.isRunning ? 'text-green-400' : 'text-red-400'}`}>
                  {scheduler?.isRunning ? 'RUNNING' : 'NOT RUNNING'}
                </div>
              </div>
              <div className="mt-2 text-xs text-gray-500">
                Last scan: {scheduler?.lastExecutionAt ? toValidDate(scheduler.lastExecutionAt)?.toLocaleString() || '—' : '—'}
              </div>
              <div className="text-xs text-gray-500">
                Next scan: {scheduler?.nextExecutionAt ? toValidDate(scheduler.nextExecutionAt)?.toLocaleString() || '—' : '—'}
              </div>
              {scheduler?.lastExecutionError && (
                <div className="mt-1 text-xs text-red-400">Last error: {scheduler.lastExecutionError}</div>
              )}
            </div>

            <h3 className="text-md font-medium text-white mb-3">Skipped Trades</h3>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="text-gray-400 border-b border-purple-500/20">
                    <th className="text-left py-2 pr-4 font-medium">Pair</th>
                    <th className="text-left py-2 pr-4 font-medium">Direction</th>
                    <th className="text-left py-2 pr-4 font-medium">Reason</th>
                    <th className="text-left py-2 pr-4 font-medium">Timestamp</th>
                  </tr>
                </thead>
                <tbody>
                  {skippedTrades.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="py-8 text-center text-gray-400">
                        No skipped trades
                      </td>
                    </tr>
                  ) : (
                    skippedTrades.map((skippedTrade) => (
                      <tr key={skippedTrade.id} className="border-b border-purple-500/10">
                        <td className="py-2 pr-4 text-white font-medium">{skippedTrade.pair}</td>
                        <td className={`py-2 pr-4 font-medium ${skippedTrade.direction === 'LONG' ? 'text-green-400' : 'text-red-400'}`}>
                          {skippedTrade.direction}
                        </td>
                        <td className="py-2 pr-4">
                          <div className="flex items-center gap-2">
                            {/* Show info icon for exchange errors with exact error reason */}
                            {(skippedTrade.reason === 'EXCHANGE_ERROR' || skippedTrade.exchangeErrorReason) && (
                              <div className="relative group">
                                <svg className="w-5 h-5 text-red-400 cursor-help" fill="currentColor" viewBox="0 0 20 20">
                                  <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                                </svg>
                                <div className="absolute left-0 bottom-full mb-2 hidden group-hover:block z-50 w-64 p-3 bg-slate-900 border border-red-500/30 rounded-lg shadow-xl">
                                  <div className="text-xs font-semibold text-red-400 mb-1">Exchange Rejection Reason:</div>
                                  <div className="text-xs text-gray-300 leading-relaxed">
                                    {skippedTrade.exchangeErrorReason || skippedTrade.error || 'Exchange rejected the order (no details provided)'}
                                  </div>
                                </div>
                              </div>
                            )}
                            <span className={`px-2 py-1 rounded text-xs ${
                              skippedTrade.reason === 'NO_CONSENSUS' ? 'bg-gray-500/20 text-gray-400' :
                              skippedTrade.reason === 'RR_TOO_LOW' ? 'bg-orange-500/20 text-orange-400' :
                              skippedTrade.reason === 'ENTRY_LATE' ? 'bg-yellow-500/20 text-yellow-400' :
                              skippedTrade.reason === 'SR_BLOCKED' ? 'bg-purple-500/20 text-purple-400' :
                              skippedTrade.reason === 'DAILY_LIMIT_REACHED' ? 'bg-red-500/20 text-red-400' :
                              skippedTrade.reason === 'EXCHANGE_ERROR' ? 'bg-red-500/20 text-red-400' :
                              skippedTrade.reason === 'COIN_OUTSIDE_TOP_100' ? 'bg-red-500/20 text-red-400' :
                              'bg-gray-500/20 text-gray-400'
                            }`}>
                              {skippedTrade.reason.replace(/_/g, ' ')}
                            </span>
                          </div>
                        </td>
                        <td className="py-2 pr-4 text-gray-300">
                          {skippedTrade.timestamp ? toValidDate(skippedTrade.timestamp)?.toLocaleString() || '—' : '—'}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </ErrorBoundary>
  );
}
