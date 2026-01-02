import { useState, useEffect, useRef } from 'react';
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
  const isLoadingRef = useRef(false);
  const consecutiveErrorsRef = useRef(0);
  const MAX_CONSECUTIVE_ERRORS = 3;
  const pollingIntervalRef = useRef<number | null>(null);

  useEffect(() => {
    if (user) {
      loadUnlockedAgents();
      // Refresh every 30 seconds
      pollingIntervalRef.current = setInterval(loadUnlockedAgents, 30000);
    } else {
      setUnlockedAgents([]);
      setLoading(false);
    }

    return () => {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
      }
    };
  }, [user]);

  const loadUnlockedAgents = async () => {
    if (!user) return;

    // Prevent overlapping calls
    if (isLoadingRef.current) {
      console.log('[UnlockedAgents] Skipping - previous call still in progress');
      return;
    }

    // Stop polling if too many consecutive errors
    if (consecutiveErrorsRef.current >= MAX_CONSECUTIVE_ERRORS) {
      console.warn('[UnlockedAgents] Stopping polling due to too many consecutive errors');
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
      }
      return;
    }

    isLoadingRef.current = true;
    setLoading(true);
    setError(null);

    try {
      // Get user's agents (this will include all approved agents)
      const userAgentsResponse = await agentsApi.getUserAgents(user.uid);
      const userAgents = userAgentsResponse?.data?.agents || [];

      // Get full agent details for each user agent with safe fallback
      const allAgentsResponse = await agentsApi.getAll();
      const allAgents = allAgentsResponse?.data?.agents || [];

      consecutiveErrorsRef.current = 0; // Reset error counter on success

      // Filter to only approved agents and map to full details
      const approvedAgents = userAgents.filter((ua: any) =>
        ua.unlocked === true || ua.status === 'approved'
      );

      const agentsWithDetails = approvedAgents.map((userAgent: any) => {
        const agentDetails = allAgents.find((a: any) => a?.id === userAgent.id);

        return {
          agentId: userAgent.id,
          agentName: agentDetails?.name || userAgent.name || userAgent.id,
          unlockedAt: userAgent.unlockedAt || userAgent.createdAt || new Date().toISOString(),
          status: userAgent.status || 'active',
          settings: userAgent.settings || {},
          agent: {
            id: userAgent.id,
            name: agentDetails?.name || userAgent.name || userAgent.id,
            description: agentDetails?.description || userAgent.description || '',
            icon: agentDetails?.icon || userAgent.icon,
            imageUrl: agentDetails?.imageUrl || userAgent.imageUrl,
            features: agentDetails?.features || userAgent.features || [],
            category: agentDetails?.category || userAgent.category || 'Trading',
            badge: agentDetails?.badge || userAgent.badge,
            price: agentDetails?.price || userAgent.price || 0,
            enabled: agentDetails?.enabled !== false,
            ...agentDetails
          },
        };
      });

      setUnlockedAgents(agentsWithDetails || []);
    } catch (err: any) {
      consecutiveErrorsRef.current++;
      console.warn(`[UnlockedAgents] API failed (${consecutiveErrorsRef.current}/${MAX_CONSECUTIVE_ERRORS}): agentsApi`, err);
      setError(err?.response?.data?.error || 'Failed to load unlocked agents');
      setUnlockedAgents([]);
    } finally {
      setLoading(false);
      isLoadingRef.current = false;
    }
  };

  const hasPremiumAgent = unlockedAgents.some(agent =>
    agent.agentName === 'Premium Trading Agent' || agent.agentId === 'premium_trading_agent'
  );

  return { unlockedAgents, loading, error, refresh: loadUnlockedAgents, hasPremiumAgent };
}

