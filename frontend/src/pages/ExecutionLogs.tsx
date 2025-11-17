import { useState, useEffect } from 'react';
import { executionApi, hftLogsApi, systemLogsApi } from '../services/api';
import { wsService } from '../services/ws';
import Toast from '../components/Toast';
import Sidebar from '../components/Sidebar';
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

export default function ExecutionLogs() {
  const { user } = useAuth();
  const [logs, setLogs] = useState<ExecutionLog[]>([]);
  const [hftLogs, setHftLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [activeTab, setActiveTab] = useState<'execution' | 'hft'>('execution');

  useEffect(() => {
    if (user) {
      loadLogs();
      
      // Subscribe to live execution updates
      const unsubscribe = wsService.subscribe('execution', (data: any) => {
        // Add to logs
        setLogs((prev) => [data.data, ...prev].slice(0, 100));
      });

      return () => unsubscribe();
    }
  }, [user]);

  const loadLogs = async () => {
    if (!user) return;
    setLoading(true);
    try {
      // Load execution logs
      const execResponse = await executionApi.getLogs({ limit: 100 });
      console.log('Execution logs API response:', execResponse.data);
      const execLogs = execResponse.data || [];
      
      // Transform to match ExecutionLog interface
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

      // Load HFT logs
      const hftResponse = await hftLogsApi.get({ uid: user.uid, limit: 100 });
      console.log('HFT logs API response:', hftResponse.data);
      const hftLogsData = hftResponse.data.logs || [];
      setHftLogs(hftLogsData);
    } catch (err: any) {
      console.error('Error loading execution logs:', err);
      console.error('Error details:', err.response?.data);
      showToast(err.response?.data?.error || 'Error loading execution logs', 'error');
    } finally {
      setLoading(false);
    }
  };

  const showToast = (message: string, type: 'success' | 'error') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  const handleLogout = async () => {
    const { signOut } = await import('firebase/auth');
    const { auth } = await import('../config/firebase');
    await signOut(auth);
    localStorage.removeItem('firebaseToken');
    localStorage.removeItem('firebaseUser');
    window.location.href = '/login';
  };

  const executedCount = logs.filter((l) => l.action === 'EXECUTED').length;
  const skippedCount = logs.filter((l) => l.action === 'SKIPPED').length;
  const hftFilledCount = hftLogs.filter((l) => l.action === 'FILLED').length;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900">
      {/* Animated background elements */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-80 h-80 bg-purple-500 rounded-full mix-blend-multiply filter blur-xl opacity-20 animate-blob"></div>
        <div className="absolute -bottom-40 -left-40 w-80 h-80 bg-blue-500 rounded-full mix-blend-multiply filter blur-xl opacity-20 animate-blob animation-delay-2000"></div>
        <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-80 h-80 bg-pink-500 rounded-full mix-blend-multiply filter blur-xl opacity-20 animate-blob animation-delay-4000"></div>
      </div>

      <Sidebar onLogout={handleLogout} />

      <main className="min-h-screen">
        <div className="max-w-7xl mx-auto py-8 px-4 sm:px-6 lg:px-8">
          <div className="mb-8">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
              <div>
                <h1 className="text-4xl font-bold bg-gradient-to-r from-purple-400 via-pink-400 to-blue-400 bg-clip-text text-transparent mb-2">
                  Execution Logs
                </h1>
                <p className="text-gray-300">View detailed execution history and trade outcomes</p>
              </div>
              <button onClick={loadLogs} className="btn btn-secondary" disabled={loading}>
                {loading ? 'Loading...' : 'Refresh'}
              </button>
            </div>
          </div>
          <div className="space-y-6">

            {/* Stats Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
              <div className="bg-green-500/10 border border-green-400/30 rounded-xl p-4 backdrop-blur-sm">
                <div className="text-sm text-gray-400">Executed</div>
                <div className="text-2xl font-bold text-green-400">{executedCount}</div>
              </div>
              <div className="bg-yellow-500/10 border border-yellow-400/30 rounded-xl p-4 backdrop-blur-sm">
                <div className="text-sm text-gray-400">Skipped</div>
                <div className="text-2xl font-bold text-yellow-400">{skippedCount}</div>
              </div>
              <div className="bg-blue-500/10 border border-blue-400/30 rounded-xl p-4 backdrop-blur-sm">
                <div className="text-sm text-gray-400">HFT Filled</div>
                <div className="text-2xl font-bold text-blue-400">{hftFilledCount}</div>
              </div>
              <div className="bg-purple-500/10 border border-purple-400/30 rounded-xl p-4 backdrop-blur-sm">
                <div className="text-sm text-gray-400">Total</div>
                <div className="text-2xl font-bold text-purple-400">{logs.length + hftLogs.length}</div>
              </div>
            </div>

            {/* Tabs */}
            <div className="flex space-x-2 border-b border-purple-500/20">
              <button
                onClick={() => setActiveTab('execution')}
                className={`px-4 py-2 font-medium transition-colors ${
                  activeTab === 'execution'
                    ? 'text-purple-400 border-b-2 border-purple-400'
                    : 'text-gray-400 hover:text-gray-300'
                }`}
              >
                Execution Logs ({logs.length})
              </button>
              <button
                onClick={() => setActiveTab('hft')}
                className={`px-4 py-2 font-medium transition-colors ${
                  activeTab === 'hft'
                    ? 'text-purple-400 border-b-2 border-purple-400'
                    : 'text-gray-400 hover:text-gray-300'
                }`}
              >
                HFT Logs ({hftLogs.length})
              </button>
            </div>

            {/* Logs Table */}
            <div className="card">
              <div className="overflow-x-auto">
                {activeTab === 'execution' ? (
                  <table className="min-w-full divide-y divide-purple-500/20">
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
                          <td className="px-4 py-2 text-xs text-gray-400">
                            {log.reason || '-'}
                          </td>
                        </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                ) : (
                  <table className="min-w-full divide-y divide-purple-500/20">
                    <thead className="bg-slate-900/50">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-300 uppercase">Time</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-300 uppercase">Symbol</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-300 uppercase">Action</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-300 uppercase">Side</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-300 uppercase">Price</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-300 uppercase">Quantity</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-300 uppercase">Order ID</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-300 uppercase">PnL</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-300 uppercase">Status</th>
                      </tr>
                    </thead>
                    <tbody className="bg-slate-800/40 divide-y divide-purple-500/20">
                      {hftLogs.length === 0 ? (
                        <tr>
                          <td colSpan={9} className="px-4 py-4 text-center text-gray-400">
                            No HFT logs yet
                          </td>
                        </tr>
                      ) : (
                        hftLogs.map((log: any) => (
                          <tr key={log.id} className="hover:bg-slate-700/30 transition-colors">
                            <td className="px-4 py-2 text-xs text-gray-200">
                              {log.timestamp ? new Date(log.timestamp).toLocaleString() : '-'}
                            </td>
                            <td className="px-4 py-2 text-xs text-gray-200">{log.symbol || '-'}</td>
                            <td className="px-4 py-2 text-xs">
                              <span className={`px-2 py-1 rounded text-xs ${
                                log.action === 'FILLED' 
                                  ? 'bg-green-500/20 text-green-300 border border-green-400/30' 
                                  : 'bg-blue-500/20 text-blue-300 border border-blue-400/30'
                              }`}>
                                {log.action || '-'}
                              </span>
                            </td>
                            <td className={`px-4 py-2 text-xs font-medium ${
                              log.side === 'BUY' ? 'text-green-400' : log.side === 'SELL' ? 'text-red-400' : 'text-gray-400'
                            }`}>
                              {log.side || '-'}
                            </td>
                            <td className="px-4 py-2 text-xs text-gray-200">{log.price ? log.price.toFixed(2) : '-'}</td>
                            <td className="px-4 py-2 text-xs text-gray-200">{log.quantity || '-'}</td>
                            <td className="px-4 py-2 text-xs font-mono text-gray-200">
                              {log.orderId ? log.orderId.slice(0, 8) + '...' : '-'}
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
                                    : 'bg-gray-500/20 text-gray-300 border border-gray-400/30'
                                }`}>
                                  {log.status}
                                </span>
                              ) : '-'}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </div>
        </div>
      </main>

      {toast && <Toast message={toast.message} type={toast.type} />}
    </div>
  );
}
