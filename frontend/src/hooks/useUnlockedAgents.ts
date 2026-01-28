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
  'BB_RSI_EMA200_SCALPER': {
    name: 'BB-RSI EMA200 Scalper Pro (3m/5m Futures)',
    description: 'Mean reversion scalping with Bollinger Bands, RSI confirmation, and 200 EMA filter on 3m/5m timeframes. Bitget USDT-M Futures.',
    features: [
      'Bollinger Bands Mean Reversion',
      'RSI Confirmation (≤30/≥70)',
      'EMA 200 Trend Filter',
      'ADX Trend Strength Filter',
      'BTC/ETH/SOL/BNB/XRP pairs',
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
    ['TRADING_AGENT', 'COPY_TRADING_AGENT', 'VWAP_STRATEGY', 'BB_RSI_EMA200_SCALPER'].includes(agent.agentId)
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

