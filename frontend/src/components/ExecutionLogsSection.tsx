import { useState, useEffect } from 'react';
import { executionApi, hftLogsApi } from '../services/api';
import { wsService } from '../services/ws';
import { useAuth } from '../hooks/useAuth';

interface ExecutionLog {
  id: string;
  symbol: string;
  timestamp: string;
  action: 'EXECUTED' | 'SKIPPED';
  reason?: string;
  accuracy?: number;
  accuracyUsed?: number;
  orderId?: string;
  orderIds?: string[];
  executionLatency?: number;
  slippage?: number;
  pnl?: number;
  strategy?: string;
  signal?: 'BUY' | 'SELL' | 'HOLD';
  status?: string;
}

export default function ExecutionLogsSection({ limit = 50 }: { limit?: number }) {
  const { user } = useAuth();
  const [logs, setLogs] = useState<ExecutionLog[]>([]);
  const [hftLogs, setHftLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<'execution' | 'hft'>('execution');

  useEffect(() => {
    if (user) {
      loadLogs();
      
      const unsubscribe = wsService.subscribe('execution', (data: any) => {
        setLogs((prev) => [data.data, ...prev].slice(0, limit));
      });

      return () => unsubscribe();
    }
  }, [user, limit]);

  const loadLogs = async () => {
    if (!user) return;
    setLoading(true);
    try {
      const execResponse = await executionApi.getLogs({ limit });
      const execLogs = execResponse.data || [];
      
      const transformedLogs = execLogs.map((log: any) => ({
        id: log.id || '',
        symbol: log.symbol || '',
        timestamp: log.timestamp || log.createdAt || new Date().toISOString(),
        action: log.action || 'SKIPPED',
        reason: log.reason,
        accuracy: log.accuracy,
        accuracyUsed: log.accuracyUsed,
        orderId: log.orderId,
        orderIds: log.orderIds,
        executionLatency: log.executionLatency,
        slippage: log.slippage,
        pnl: log.pnl,
        strategy: log.strategy,
        signal: log.signal,
        status: log.status,
      }));
      
      setLogs(transformedLogs);

      const hftResponse = await hftLogsApi.get({ uid: user.uid, limit });
      const hftLogsData = hftResponse.data.logs || [];
      setHftLogs(hftLogsData);
    } catch (err: any) {
      console.error('Error loading execution logs:', err);
    } finally {
      setLoading(false);
    }
  };

  const executedCount = logs.filter((l) => l.action === 'EXECUTED').length;
  const skippedCount = logs.filter((l) => l.action === 'SKIPPED').length;
  const hftFilledCount = hftLogs.filter((l) => l.action === 'FILLED').length;

  return (
    <div className="space-y-4">
      {/* Stats Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
        <div className="bg-green-500/10 border border-green-400/30 rounded-xl p-3 sm:p-4 backdrop-blur-sm">
          <div className="text-xs sm:text-sm text-gray-400">Executed</div>
          <div className="text-xl sm:text-2xl font-bold text-green-400">{executedCount}</div>
        </div>
        <div className="bg-yellow-500/10 border border-yellow-400/30 rounded-xl p-3 sm:p-4 backdrop-blur-sm">
          <div className="text-xs sm:text-sm text-gray-400">Skipped</div>
          <div className="text-xl sm:text-2xl font-bold text-yellow-400">{skippedCount}</div>
        </div>
        <div className="bg-blue-500/10 border border-blue-400/30 rounded-xl p-3 sm:p-4 backdrop-blur-sm">
          <div className="text-xs sm:text-sm text-gray-400">HFT Filled</div>
          <div className="text-xl sm:text-2xl font-bold text-blue-400">{hftFilledCount}</div>
        </div>
        <div className="bg-purple-500/10 border border-purple-400/30 rounded-xl p-3 sm:p-4 backdrop-blur-sm">
          <div className="text-xs sm:text-sm text-gray-400">Total</div>
          <div className="text-xl sm:text-2xl font-bold text-purple-400">{logs.length + hftLogs.length}</div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex space-x-2 border-b border-purple-500/20 overflow-x-auto">
        <button
          onClick={() => setActiveTab('execution')}
          className={`px-3 sm:px-4 py-2 text-sm font-medium transition-colors whitespace-nowrap ${
            activeTab === 'execution'
              ? 'text-purple-400 border-b-2 border-purple-400'
              : 'text-gray-400 hover:text-gray-300'
          }`}
        >
          Execution ({logs.length})
        </button>
        <button
          onClick={() => setActiveTab('hft')}
          className={`px-3 sm:px-4 py-2 text-sm font-medium transition-colors whitespace-nowrap ${
            activeTab === 'hft'
              ? 'text-purple-400 border-b-2 border-purple-400'
              : 'text-gray-400 hover:text-gray-300'
          }`}
        >
          HFT ({hftLogs.length})
        </button>
      </div>

      {/* Logs Table */}
      <div className="bg-slate-800/40 backdrop-blur-xl border border-purple-500/20 rounded-xl shadow-lg overflow-hidden">
        <div className="overflow-x-auto">
          {activeTab === 'execution' ? (
            <>
              {/* Desktop Table View */}
              <table className="hidden md:table min-w-full divide-y divide-purple-500/20">
                <thead className="bg-slate-900/50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-300 uppercase">Time</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-300 uppercase">Symbol</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-300 uppercase">Action</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-300 uppercase">Accuracy</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-300 uppercase">Strategy</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-300 uppercase">Order ID</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-300 uppercase">Latency</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-300 uppercase">Slippage</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-300 uppercase">PnL</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-300 uppercase">Status</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-300 uppercase">Reason</th>
                  </tr>
                </thead>
                <tbody className="bg-slate-800/40 divide-y divide-purple-500/20">
                  {logs.length === 0 ? (
                    <tr>
                      <td colSpan={11} className="px-4 py-4 text-center text-gray-400">
                        No execution logs yet
                      </td>
                    </tr>
                  ) : (
                    logs.map((log) => (
                      <tr key={log.id} className="hover:bg-slate-700/30 transition-colors">
                        <td className="px-4 py-2 text-xs text-gray-200">
                          {new Date(log.timestamp).toLocaleString()}
                        </td>
                        <td className="px-4 py-2 text-xs text-gray-200">{log.symbol}</td>
                        <td className="px-4 py-2 text-xs">
                          <span className={`px-2 py-1 rounded text-xs ${
                            log.action === 'EXECUTED' 
                              ? 'bg-green-500/20 text-green-300 border border-green-400/30' 
                              : 'bg-yellow-500/20 text-yellow-300 border border-yellow-400/30'
                          }`}>
                            {log.action}
                          </span>
                        </td>
                        <td className="px-4 py-2 text-xs text-gray-200">
                          {log.accuracy ? `${(log.accuracy * 100).toFixed(1)}%` : '-'}
                        </td>
                        <td className="px-4 py-2 text-xs text-gray-300">
                          {log.strategy || '-'}
                        </td>
                        <td className="px-4 py-2 text-xs font-mono text-gray-200">
                          {log.orderIds && log.orderIds.length > 0
                            ? log.orderIds.map(id => id.slice(0, 8)).join(', ')
                            : log.orderId
                            ? log.orderId.slice(0, 8) + '...'
                            : '-'}
                        </td>
                        <td className="px-4 py-2 text-xs text-gray-200">
                          {log.executionLatency ? `${log.executionLatency}ms` : '-'}
                        </td>
                        <td className="px-4 py-2 text-xs text-gray-200">
                          {log.slippage !== undefined ? `${log.slippage.toFixed(4)}` : '-'}
                        </td>
                        <td className="px-4 py-2 text-xs text-gray-200">
                          {log.pnl !== undefined ? (
                            <span className={log.pnl >= 0 ? 'text-green-400' : 'text-red-400'}>
                              {log.pnl >= 0 ? '+' : ''}{log.pnl.toFixed(4)}
                            </span>
                          ) : '-'}
                        </td>
                        <td className="px-4 py-2 text-xs">
                          {log.status ? (
                            <span className={`px-2 py-1 rounded text-xs ${
                              log.status === 'FILLED' 
                                ? 'bg-green-500/20 text-green-300 border border-green-400/30'
                                : log.status === 'PARTIALLY_FILLED'
                                ? 'bg-yellow-500/20 text-yellow-300 border border-yellow-400/30'
                                : log.status === 'CANCELED'
                                ? 'bg-red-500/20 text-red-300 border border-red-400/30'
                                : 'bg-gray-500/20 text-gray-300 border border-gray-400/30'
                            }`}>
                              {log.status}
                            </span>
                          ) : '-'}
                        </td>
                        <td className="px-4 py-2 text-xs text-gray-400 max-w-xs truncate">
                          {log.reason || '-'}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
              
              {/* Mobile Card View */}
              <div className="md:hidden space-y-3 p-4">
                {logs.length === 0 ? (
                  <div className="text-center text-gray-400 py-8">
                    No execution logs yet
                  </div>
                ) : (
                  logs.map((log) => (
                    <div key={log.id} className="bg-slate-800/60 border border-purple-500/20 rounded-lg p-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <span className={`px-2 py-1 rounded text-xs font-medium ${
                          log.action === 'EXECUTED' 
                            ? 'bg-green-500/20 text-green-300 border border-green-400/30' 
                            : 'bg-yellow-500/20 text-yellow-300 border border-yellow-400/30'
                        }`}>
                          {log.action}
                        </span>
                        <span className="text-xs text-gray-400">
                          {new Date(log.timestamp).toLocaleString()}
                        </span>
                      </div>
                      <div className="grid grid-cols-2 gap-2 text-xs">
                        <div>
                          <span className="text-gray-400">Symbol:</span>
                          <span className="text-white ml-1">{log.symbol}</span>
                        </div>
                        <div>
                          <span className="text-gray-400">Accuracy:</span>
                          <span className="text-white ml-1">{log.accuracy ? `${(log.accuracy * 100).toFixed(1)}%` : '-'}</span>
                        </div>
                        {log.strategy && (
                          <div>
                            <span className="text-gray-400">Strategy:</span>
                            <span className="text-white ml-1">{log.strategy}</span>
                          </div>
                        )}
                        {log.executionLatency && (
                          <div>
                            <span className="text-gray-400">Latency:</span>
                            <span className="text-white ml-1">{log.executionLatency}ms</span>
                          </div>
                        )}
                        {log.pnl !== undefined && (
                          <div className="col-span-2">
                            <span className="text-gray-400">PnL:</span>
                            <span className={`ml-1 font-medium ${
                              log.pnl > 0 ? 'text-green-400' : log.pnl < 0 ? 'text-red-400' : 'text-gray-200'
                            }`}>
                              ${log.pnl.toFixed(2)}
                            </span>
                          </div>
                        )}
                        {log.reason && (
                          <div className="col-span-2">
                            <span className="text-gray-400">Reason:</span>
                            <span className="text-white ml-1 break-words">{log.reason}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </>
          ) : (
            <div className="p-4">
              <div className="text-sm text-gray-400 mb-4">HFT Logs</div>
              <div className="space-y-2">
                {hftLogs.length === 0 ? (
                  <div className="text-center text-gray-400 py-8">No HFT logs yet</div>
                ) : (
                  hftLogs.map((log, idx) => (
                    <div key={idx} className="bg-slate-800/60 border border-purple-500/20 rounded-lg p-3 text-xs">
                      <div className="flex justify-between mb-1">
                        <span className="text-gray-300">{log.action}</span>
                        <span className="text-gray-400">
                          {log.timestamp ? new Date(log.timestamp).toLocaleString() : '-'}
                        </span>
                      </div>
                      {log.symbol && <div className="text-gray-400">Symbol: {log.symbol}</div>}
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

