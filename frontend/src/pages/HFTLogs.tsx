import { useState, useEffect } from 'react';
import { hftApi } from '../services/api';
import { wsService } from '../services/ws';
import Toast from '../components/Toast';
import Sidebar from '../components/Sidebar';

interface HFTLog {
  id: string;
  symbol: string;
  timestamp: string;
  action: string;
  orderId?: string;
  orderIds?: string[];
  price?: number;
  quantity?: number;
  side?: 'BUY' | 'SELL';
  reason?: string;
  strategy: string;
  status?: string;
}

export default function HFTLogs() {
  const [logs, setLogs] = useState<HFTLog[]>([]);
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  useEffect(() => {
    loadLogs();
    
    // Subscribe to live HFT updates
    const unsubscribe = wsService.subscribe('hft:quote', (data: any) => {
      // Add to logs
      setLogs((prev) => [data.data, ...prev].slice(0, 100));
    });

    return () => unsubscribe();
  }, []);

  const loadLogs = async () => {
    setLoading(true);
    try {
      const response = await hftApi.getLogs({ limit: 100 });
      setLogs(response.data);
    } catch (err: any) {
      showToast(err.response?.data?.error || 'Error loading HFT logs', 'error');
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

  const placedCount = logs.filter((l) => l.action.includes('PLACED')).length;
  const filledCount = logs.filter((l) => l.action === 'FILLED').length;
  const canceledCount = logs.filter((l) => l.action === 'CANCELED').length;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-900 to-slate-900">
      {/* Animated background elements */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-80 h-80 bg-blue-500 rounded-full mix-blend-multiply filter blur-xl opacity-20 animate-blob"></div>
        <div className="absolute -bottom-40 -left-40 w-80 h-80 bg-cyan-500 rounded-full mix-blend-multiply filter blur-xl opacity-20 animate-blob animation-delay-2000"></div>
        <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-80 h-80 bg-indigo-500 rounded-full mix-blend-multiply filter blur-xl opacity-20 animate-blob animation-delay-4000"></div>
      </div>

      <Sidebar onLogout={handleLogout} />

      <main className="min-h-screen">
        <div className="max-w-7xl mx-auto py-8 px-4 sm:px-6 lg:px-8">
          <div className="mb-8">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
              <div>
                <h1 className="text-4xl font-bold bg-gradient-to-r from-blue-400 via-cyan-400 to-indigo-400 bg-clip-text text-transparent mb-2">
                  HFT Execution Logs
                </h1>
                <p className="text-gray-300">View detailed HFT trading activity</p>
              </div>
              <button onClick={loadLogs} className="btn btn-secondary" disabled={loading}>
                {loading ? 'Loading...' : 'Refresh'}
              </button>
            </div>
          </div>
          <div className="space-y-6">
            {/* Stats Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
              <div className="bg-blue-500/10 border border-blue-400/30 rounded-xl p-4 backdrop-blur-sm">
                <div className="text-sm text-gray-400">Orders Placed</div>
                <div className="text-2xl font-bold text-blue-400">{placedCount}</div>
              </div>
              <div className="bg-green-500/10 border border-green-400/30 rounded-xl p-4 backdrop-blur-sm">
                <div className="text-sm text-gray-400">Filled</div>
                <div className="text-2xl font-bold text-green-400">{filledCount}</div>
              </div>
              <div className="bg-red-500/10 border border-red-400/30 rounded-xl p-4 backdrop-blur-sm">
                <div className="text-sm text-gray-400">Canceled</div>
                <div className="text-2xl font-bold text-red-400">{canceledCount}</div>
              </div>
              <div className="bg-purple-500/10 border border-purple-400/30 rounded-xl p-4 backdrop-blur-sm">
                <div className="text-sm text-gray-400">Total</div>
                <div className="text-2xl font-bold text-purple-400">{logs.length}</div>
              </div>
            </div>

            {/* Logs Table */}
            <div className="card">
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-blue-500/20">
                  <thead className="bg-slate-900/50">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-300 uppercase">Time</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-300 uppercase">Symbol</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-300 uppercase">Action</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-300 uppercase">Side</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-300 uppercase">Price</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-300 uppercase">Quantity</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-300 uppercase">Order ID</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-300 uppercase">Status</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-300 uppercase">Reason</th>
                    </tr>
                  </thead>
                  <tbody className="bg-slate-800/40 divide-y divide-blue-500/20">
                    {logs.length === 0 ? (
                      <tr>
                        <td colSpan={9} className="px-4 py-4 text-center text-gray-400">
                          No HFT execution logs yet
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
                              log.action === 'FILLED'
                                ? 'bg-green-500/20 text-green-300 border border-green-400/30'
                                : log.action === 'CANCELED'
                                ? 'bg-red-500/20 text-red-300 border border-red-400/30'
                                : log.action.includes('PLACED')
                                ? 'bg-blue-500/20 text-blue-300 border border-blue-400/30'
                                : 'bg-gray-500/20 text-gray-300 border border-gray-400/30'
                            }`}>
                              {log.action}
                            </span>
                          </td>
                          <td className="px-4 py-2 text-xs text-gray-200">
                            {log.side || '-'}
                          </td>
                          <td className="px-4 py-2 text-xs text-gray-200">
                            {log.price ? log.price.toFixed(2) : '-'}
                          </td>
                          <td className="px-4 py-2 text-xs text-gray-200">
                            {log.quantity ? log.quantity.toFixed(4) : '-'}
                          </td>
                          <td className="px-4 py-2 text-xs font-mono text-gray-200">
                            {log.orderIds && log.orderIds.length > 0
                              ? log.orderIds.map(id => id.slice(0, 8)).join(', ')
                              : log.orderId
                              ? log.orderId.slice(0, 8) + '...'
                              : '-'}
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
              </div>
            </div>
          </div>
        </div>
      </main>

      {toast && <Toast message={toast.message} type={toast.type} />}
    </div>
  );
}

