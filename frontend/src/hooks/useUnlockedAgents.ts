import { useState, useEffect } from 'react';
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
    name: 'Rule-Based Trading Agent',
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
  }
};

export function useUnlockedAgents() {
  const { user } = useAuth();
  const [unlockedAgents, setUnlockedAgents] = useState<UnlockedAgent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (user) {
      loadUnlockedAgents();
    } else {
      setUnlockedAgents([]);
      setLoading(false);
    }
  }, [user]);

  const loadUnlockedAgents = async () => {
    if (!user) return;

    setLoading(true);
    setError(null);

    try {
      // Get user document to read unlockedAgents array
      const userDoc = await getDoc(doc(db, 'users', user.uid));
      if (!userDoc.exists()) {
        setUnlockedAgents([]);
        return;
      }

      const userData = userDoc.data();
      const unlockedAgentIds: string[] = userData?.unlockedAgents || [];

      // Map agent IDs to full agent details
      const agents: UnlockedAgent[] = unlockedAgentIds.map(agentId => {
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
    } catch (err: any) {
      console.error('[useUnlockedAgents] Failed to load agents:', err);
      setError('Failed to load unlocked agents');
      setUnlockedAgents([]);
    } finally {
      setLoading(false);
    }
  };

  const hasPremiumAgent = unlockedAgents.some(agent =>
    agent.agentId === 'TRADING_AGENT' || agent.agentId === 'COPY_TRADING_AGENT'
  );

  return { unlockedAgents, loading, error, refresh: loadUnlockedAgents, hasPremiumAgent };
}

