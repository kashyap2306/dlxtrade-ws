import React from 'react';

interface ProviderBadgeProps {
  providerUsage: {
    marketData?: { provider?: string };
    metadata?: { provider?: string };
    news?: { provider?: string };
  };
  className?: string;
}

const ProviderBadge: React.FC<ProviderBadgeProps> = ({
  providerUsage,
  className = ""
}) => {
  return (
    <div className={`flex gap-2 ${className}`}>
      {providerUsage.marketData?.provider && (
        <span className="px-2 py-1 bg-blue-500/20 text-blue-300 text-xs rounded-full">
          Market: {providerUsage.marketData.provider}
        </span>
      )}
      {providerUsage.metadata?.provider && (
        <span className="px-2 py-1 bg-green-500/20 text-green-300 text-xs rounded-full">
          Metadata: {providerUsage.metadata.provider}
        </span>
      )}
      {providerUsage.news?.provider && (
        <span className="px-2 py-1 bg-purple-500/20 text-purple-300 text-xs rounded-full">
          News: {providerUsage.news.provider}
        </span>
      )}
    </div>
  );
};

export default ProviderBadge;
