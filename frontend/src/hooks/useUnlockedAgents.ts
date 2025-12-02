import { useState, useEffect } from 'react';
import { agentsApi } from '../services/api';
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

export function useUnlockedAgents() {
  const { user } = useAuth();
  const [unlockedAgents, setUnlockedAgents] = useState<UnlockedAgent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loadingRef, setLoadingRef] = useState(false); // Prevent duplicate calls

  useEffect(() => {
    if (user) {
      loadUnlockedAgents();
      // Refresh every 30 seconds
      const interval = setInterval(loadUnlockedAgents, 30000);
      return () => clearInterval(interval);
    } else {
      setUnlockedAgents([]);
      setLoading(false);
    }
  }, [user]);

  const loadUnlockedAgents = async () => {
    if (!user || loadingRef) return; // Prevent duplicate calls

    setLoadingRef(true);
    setLoading(true);
    setError(null);
    try {
      // Get unlocked agent IDs with safe fallback
      const unlockedResponse = await agentsApi.getUnlocked();
      const agentIds = unlockedResponse?.data?.unlocked || [];

      // Get full agent details for each unlocked agent with safe fallback
      const allAgentsResponse = await agentsApi.getAll();
      const allAgents = allAgentsResponse?.data?.agents || [];

      // Map agent IDs to full agent details with safe fallbacks
      const agentsWithDetails = agentIds.map((agentId: string) => {
        const agentDetails = allAgents.find((a: any) => a?.id === agentId || a?.name === agentId);
        const unlockInfo = null; // Unlock details not available from current endpoints

        return {
          agentId: agentId,
          agentName: agentDetails?.name || agentId,
          unlockedAt: new Date().toISOString(),
          status: 'active',
          settings: {},
          agent: agentDetails || null,
        };
      });

      setUnlockedAgents(agentsWithDetails || []);
    } catch (err: any) {
      console.warn('[Dashboard] API failed: agentsApi', err);
      setError(err?.response?.data?.error || 'Failed to load unlocked agents');
      setUnlockedAgents([]);
    } finally {
      setLoading(false);
      setLoadingRef(false);
    }
  };

  const hasPremiumAgent = unlockedAgents.some(agent =>
    agent.agentName === 'Premium Trading Agent' || agent.agentId === 'premium_trading_agent'
  );

  return { unlockedAgents, loading, error, refresh: loadUnlockedAgents, hasPremiumAgent };
}

