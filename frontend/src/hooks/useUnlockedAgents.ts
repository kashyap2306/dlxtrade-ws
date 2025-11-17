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
    if (!user) return;
    
    setLoading(true);
    setError(null);
    try {
      // Get unlocked agent IDs
      const unlockedResponse = await agentsApi.getUnlocked();
      const agentIds = unlockedResponse.data.unlocked || [];
      
      // Get full agent details for each unlocked agent
      const allAgentsResponse = await agentsApi.getAll();
      const allAgents = allAgentsResponse.data.agents || [];
      
      // Get detailed unlock information
      const unlocksResponse = await agentsApi.getUnlocks();
      const unlocks = unlocksResponse.data.unlocks || [];
      
      // Map agent IDs to full agent details
      const agentsWithDetails = agentIds.map((agentId: string) => {
        const agentDetails = allAgents.find((a: any) => a.id === agentId || a.name === agentId);
        const unlockInfo = unlocks.find((u: any) => 
          (u.agentId === agentId || u.agentName === agentId)
        );
        
        return {
          agentId: agentId,
          agentName: unlockInfo?.agentName || agentDetails?.name || agentId,
          unlockedAt: unlockInfo?.unlockedAt || new Date().toISOString(),
          status: unlockInfo?.status || 'active',
          settings: unlockInfo?.settings || {},
          agent: agentDetails || null,
        };
      });
      
      setUnlockedAgents(agentsWithDetails);
    } catch (err: any) {
      console.error('Error loading unlocked agents:', err);
      setError(err.response?.data?.error || 'Failed to load unlocked agents');
      setUnlockedAgents([]);
    } finally {
      setLoading(false);
    }
  };

  return { unlockedAgents, loading, error, refresh: loadUnlockedAgents };
}

