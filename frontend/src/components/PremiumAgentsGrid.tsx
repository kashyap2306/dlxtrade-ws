import { useMemo, useState } from 'react';
import AgentCard, { AgentCardData } from './AgentCard';
import UnlockFormModal from './UnlockFormModal';

interface AgentItem extends AgentCardData {}

interface PremiumAgentsGridProps {
  agents: AgentItem[];
  unlockedAgents: Record<string, boolean>;
  supportNumber: string;
  dismissedAgents?: string[];
  onDismiss?: (agentId: string) => void;
}

export default function PremiumAgentsGrid({
  agents,
  unlockedAgents,
  supportNumber,
  dismissedAgents,
  onDismiss,
}: PremiumAgentsGridProps) {
  const [selectedAgent, setSelectedAgent] = useState<AgentCardData | null>(null);
  const [showUnlockModal, setShowUnlockModal] = useState(false);

  // Ensure HFT Bot is present
  const mergedAgents = useMemo(() => {
    const exists = agents.some((a) => (a.id || a.name)?.toLowerCase() === 'hft bot' || (a.id || a.name)?.toLowerCase() === 'hftbot');
    const list = [...agents];
    if (!exists) {
      list.push({
        id: 'hftBot',
        name: 'HFT Bot',
        description: 'High Frequency Trading Engine',
        price: 0,
        category: 'Premium Agent',
        enabled: true,
      });
    }
    return list;
  }, [agents]);

  const handleUnlockClick = (agent: AgentCardData) => {
    setSelectedAgent(agent);
    setShowUnlockModal(true);
  };

  const handleCloseModal = () => {
    setShowUnlockModal(false);
    setSelectedAgent(null);
  };

  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 sm:gap-6">
        {mergedAgents
          .filter((agent) => !dismissedAgents?.includes(agent.id || agent.name))
          .filter((agent) => agent.enabled !== false) // Only show enabled agents
          .map((agent, index) => {
            const aid = (agent.id || agent.name).toString();
            const isUnlocked = !!unlockedAgents[aid];

            return (
              <AgentCard
                key={aid}
                agent={agent}
                isUnlocked={isUnlocked}
                onUnlockClick={handleUnlockClick}
                index={index}
              />
            );
          })}
      </div>

      <UnlockFormModal
        agent={selectedAgent}
        isOpen={showUnlockModal}
        onClose={handleCloseModal}
      />
    </>
  );
}


