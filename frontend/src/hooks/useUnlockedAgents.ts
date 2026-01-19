import { useState, useEffect, useMemo } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../config/firebase-config';
import { useAuth } from './useAuth';

export interface UnlockedAgent {
  agentId: string;
  agentName: string;
  unlockedAt: string;
  status: string;
  settings: any;
  agent: {
    id: string;
    name: string;
    description?: string;
    imageUrl?: string;
    badge?: string;
    [key: string]: any;
  } | null;
}

// Define available agents with their details
const AGENT_DETAILS: Record<string, { name: string; description: string; features: string[]; category: string; badge: string }> = {
  'TRADING_AGENT': {
    name: 'RSI + Bollinger Bands Agent',
    description: 'Fully automated trading agent with RSI/Bollinger Bands strategy. Executes deterministic trades 24/7 with SL/TP protection.',
    features: [
      'RSI + Bollinger Bands signals',
      'Stop Loss & Take Profit',
      'BTC/USDT & ETH/USDT pairs',
      'Spot & Futures markets',
      'Daily safety limits'
    ],
    category: 'Trading Bot',
    badge: 'Premium'
  },
  'COPY_TRADING_AGENT': {
    name: 'Crowd Consensus Copy Trade Agent',
    description: 'Follows crowd consensus across 10+ exchanges, trades when multiple exchanges agree on direction',
    features: [
      'Monitors 10+ exchanges for consensus signals',
      'Detects crowd LONG/SHORT direction',
      'Auto-trades on one exchange when consensus is strong',
      'Risk management with SL/TP',
      'No individual trader data accessed'
    ],
    category: 'Copy Trading',
    badge: 'Advanced'
  },
  'VWAP_STRATEGY': {
    name: 'VWAP Strategy',
    description: 'Institutional-grade VWAP mean reversion scalping strategy with session filters and volatility-based risk management.',
    features: [
      'VWAP Mean Reversion signals',
      'EMA 200 Trend Filter',
      'ATR Volatility Stops',
      'BTC/USDT & ETH/USDT pairs',
      'London/NY Session Trading',
      'Admin approval required'
    ],
    category: 'Scalping Strategy',
    badge: 'Institutional'
  },
  'LIQUIDITY_SWEEP_AGENT': {
    name: 'Liquidity Sweep Session Scalping Agent',
    description: 'Advanced liquidity sweep detection with session-based scalping. Identifies institutional sweeps above/below equal highs/lows during London/NY trading sessions.',
    features: [
      'Liquidity Sweep Detection',
      'Equal Highs/Lows Structure',
      'Session-Based Trading (London/NY)',
      'BTC/USDT & ETH/USDT pairs',
      'Perpetual Futures only',
      'Admin approval required'
    ],
    category: 'Scalping Strategy',
    badge: 'Advanced'
  }
};

export function useUnlockedAgents() {
  const { user } = useAuth();
  const [unlockedAgents, setUnlockedAgents] = useState<UnlockedAgent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [resolved, setResolved] = useState(false);

  useEffect(() => {
    if (user?.uid) {
      loadUnlockedAgents();
    } else {
      setUnlockedAgents([]);
      setLoading(false);
      setResolved(true);
    }
  }, [user?.uid]); // Only depend on uid, not the entire user object

  const loadUnlockedAgents = async () => {
    if (!user?.uid) return;

    setLoading(true);
    setError(null);
    setResolved(false);

    try {
      // Get user document to read approvedAgents array
      const userDoc = await getDoc(doc(db, 'users', user.uid));
      if (!userDoc.exists()) {
        setUnlockedAgents([]);
        setResolved(true);
        return;
      }

      const userData = userDoc.data();
      const approvedAgentIds: string[] = userData?.approvedAgents || [];

      // Map agent IDs to full agent details
      const agents: UnlockedAgent[] = approvedAgentIds.map(agentId => {
        const agentDetail = AGENT_DETAILS[agentId];
        return {
          agentId,
          agentName: agentDetail?.name || agentId,
          unlockedAt: userData.createdAt || new Date().toISOString(),
          status: 'active',
          settings: {},
          agent: {
            id: agentId,
            name: agentDetail?.name || agentId,
            description: agentDetail?.description || '',
            features: agentDetail?.features || [],
            category: agentDetail?.category || 'Trading',
            badge: agentDetail?.badge || '',
            price: 0,
            enabled: true,
          },
        };
      });

      setUnlockedAgents(agents);
      setResolved(true);
    } catch (err: any) {
      console.error('[useUnlockedAgents] Failed to load agents:', err);
      setError('Failed to load unlocked agents');
      setUnlockedAgents([]);
      setResolved(true);
    } finally {
      setLoading(false);
    }
  };

  // Memoize computed values to prevent unnecessary recalculations
  const hasPremiumAgent = useMemo(() => unlockedAgents.some(agent =>
    ['TRADING_AGENT', 'COPY_TRADING_AGENT', 'VWAP_STRATEGY', 'LIQUIDITY_SWEEP_AGENT'].includes(agent.agentId)
  ), [unlockedAgents]);

  // Memoize return value to ensure stable references
  return useMemo(() => ({
    unlockedAgents,
    loading,
    error,
    resolved,
    refresh: loadUnlockedAgents,
    hasPremiumAgent
  }), [unlockedAgents, loading, error, resolved, hasPremiumAgent]);
}

