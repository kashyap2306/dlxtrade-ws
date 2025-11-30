import React, { memo } from 'react';
import { ClockIcon } from '@heroicons/react/24/outline';

interface Activity {
  id: string;
  timestamp: string;
  type: 'trade' | 'signal' | 'error';
  message: string;
  symbol?: string;
}

interface ActivityListProps {
  activities?: Activity[];
  loading?: boolean;
}

export default memo(function ActivityList({ activities = [], loading }: ActivityListProps) {
  // Mock recent activities if none provided
  const displayActivities = activities.length > 0 
    ? activities.slice(0, 10)
    : [
        { id: '1', timestamp: new Date().toISOString(), type: 'signal' as const, message: 'No recent activity' },
      ];

  return (
    <div className="bg-black/30 backdrop-blur-xl border border-purple-500/30 rounded-2xl p-6">
      <h2 className="text-xl font-bold bg-gradient-to-r from-purple-400 to-cyan-400 bg-clip-text text-transparent mb-4">
        Recent Activity
      </h2>
      <div className="space-y-2 max-h-64 overflow-y-auto">
        {loading ? (
          <div className="space-y-2">
            {[1, 2, 3].map((i) => (
              <div key={i} className="animate-pulse p-3 bg-black/40 rounded-lg">
                <div className="h-4 bg-gray-700/50 rounded w-3/4 mb-2"></div>
                <div className="h-3 bg-gray-700/50 rounded w-1/2"></div>
              </div>
            ))}
          </div>
        ) : displayActivities.length === 0 ? (
          <div className="text-center py-8 text-gray-400 text-sm">No recent activity</div>
        ) : (
          displayActivities.map((activity) => (
            <div
              key={activity.id}
              className="flex items-start gap-3 p-3 bg-black/40 rounded-lg hover:bg-black/60 transition-colors"
            >
              <div className={`w-2 h-2 rounded-full mt-2 ${
                activity.type === 'trade' ? 'bg-green-400' :
                activity.type === 'error' ? 'bg-red-400' :
                'bg-blue-400'
              }`} />
              <div className="flex-1 min-w-0">
                <div className="text-sm text-white mb-1">{activity.message}</div>
                <div className="flex items-center gap-2 text-xs text-gray-400">
                  <ClockIcon className="w-3 h-3" />
                  <span>
                    {new Date(activity.timestamp).toLocaleString()}
                  </span>
                  {activity.symbol && (
                    <>
                      <span>•</span>
                      <span>{activity.symbol}</span>
                    </>
                  )}
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
});

