import { useState, useEffect } from 'react';
import { researchApi, settingsApi } from '../services/api';
import { wsService } from '../services/ws';
import Toast from '../components/Toast';
import Sidebar from '../components/Sidebar';

interface ResearchLog {
  id: string;
  symbol: string;
  timestamp: string;
  signal: 'BUY' | 'SELL' | 'HOLD';
  accuracy: number;
  orderbookImbalance: number;
  recommendedAction: string;
  microSignals: any;
}

export default function ResearchPanel() {
  const [logs, setLogs] = useState<ResearchLog[]>([]);
  const [loading, setLoading] = useState(false);
  const [liveData, setLiveData] = useState<any>(null);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [settings, setSettings] = useState<any>(null);

  useEffect(() => {
    loadLogs();
    loadSettings();
    
    // Subscribe to live research updates
    const unsubscribe = wsService.subscribe('research', (data: any) => {
      setLiveData(data.data);
      // Add to logs
      setLogs((prev) => [data.data, ...prev].slice(0, 100));
    });

    return () => unsubscribe();
  }, []);

  const loadSettings = async () => {
    try {
      const response = await settingsApi.load();
      console.log('Research settings API response:', response.data);
      setSettings(response.data);
    } catch (err: any) {
      console.error('Error loading settings:', err);
      console.error('Error details:', err.response?.data);
    }
  };

  const canExecute = (accuracy: number): boolean => {
    if (!settings) return false;
    return settings.autoTradeEnabled && accuracy >= (settings.minAccuracyThreshold || 0.85);
  };

  const loadLogs = async () => {
    setLoading(true);
    try {
      const response = await researchApi.getLogs({ limit: 100 });
      console.log('Research logs API response:', response.data);
      setLogs(response.data);
    } catch (err: any) {
      console.error('Error loading research logs:', err);
      console.error('Error details:', err.response?.data);
      showToast(err.response?.data?.error || 'Error loading research logs', 'error');
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
                  Research Panel
                </h1>
                <p className="text-gray-300">Analyze market signals and trading opportunities</p>
              </div>
              <button onClick={loadLogs} className="btn btn-secondary" disabled={loading}>
                {loading ? 'Loading...' : 'Refresh'}
              </button>
            </div>
          </div>
          <div className="space-y-6">

            {/* Live Research Card */}
            {liveData && (
              <div className="card">
                <h2 className="text-lg font-semibold mb-4 text-white">Live Research</h2>
                <div className="bg-blue-500/10 border border-blue-400/30 rounded-lg p-4 mb-4">
                  <div className="flex items-center justify-between mb-4">
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 flex-1">
                      <div>
                        <div className="text-sm text-gray-400">Symbol</div>
                        <div className="font-semibold text-white">{liveData.symbol}</div>
                      </div>
                      <div>
                        <div className="text-sm text-gray-400">Signal</div>
                        <div className={`font-semibold ${
                          liveData.signal === 'BUY' ? 'text-green-400' :
                          liveData.signal === 'SELL' ? 'text-red-400' :
                          'text-gray-400'
                        }`}>
                          {liveData.signal}
                        </div>
                      </div>
                      <div>
                        <div className="text-sm text-gray-400">Accuracy</div>
                        <div className={`font-semibold ${
                          liveData.accuracy >= 0.85 ? 'text-green-400' :
                          liveData.accuracy >= 0.7 ? 'text-yellow-400' :
                          'text-red-400'
                        }`}>
                          {(liveData.accuracy * 100).toFixed(1)}%
                        </div>
                      </div>
                      <div>
                        <div className="text-sm text-gray-400">Imbalance</div>
                        <div className="font-semibold text-white">
                          {(liveData.orderbookImbalance * 100).toFixed(2)}%
                        </div>
                      </div>
                    </div>
                    <div className="ml-4">
                      {canExecute(liveData.accuracy) && liveData.signal !== 'HOLD' ? (
                        <span className="inline-flex items-center px-3 py-1.5 rounded-full text-sm font-medium bg-green-500/20 text-green-300 border border-green-400/30">
                          ✓ Can Execute
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-3 py-1.5 rounded-full text-sm font-medium bg-yellow-500/20 text-yellow-300 border border-yellow-400/30">
                          ⏸ Will Skip
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="mt-4 pt-4 border-t border-blue-400/20">
                    <div className="text-sm text-gray-400">Action</div>
                    <div className="font-medium text-white">{liveData.recommendedAction}</div>
                    {settings && (
                      <div className="mt-2 text-xs text-gray-400">
                        Strategy: {settings.strategy || 'orderbook_imbalance'} | 
                        Threshold: {(settings.minAccuracyThreshold || 0.85) * 100}% | 
                        Auto-Trade: {settings.autoTradeEnabled ? 'Enabled' : 'Disabled'}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Research Timeline */}
            <div className="card">
              <h2 className="text-xl font-semibold mb-4 text-white">Research Timeline</h2>
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-purple-500/20">
                  <thead className="bg-slate-900/50">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-300 uppercase">Time</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-300 uppercase">Symbol</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-300 uppercase">Signal</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-300 uppercase">Accuracy</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-300 uppercase">Imbalance</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-300 uppercase">Action</th>
                    </tr>
                  </thead>
                  <tbody className="bg-slate-800/40 divide-y divide-purple-500/20">
                    {logs.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="px-4 py-4 text-center text-gray-400">
                          No research logs yet
                        </td>
                      </tr>
                    ) : (
                      logs.map((log) => (
                        <tr key={log.id} className="hover:bg-slate-700/30 transition-colors">
                          <td className="px-4 py-2 text-xs text-gray-200">
                            {new Date(log.timestamp).toLocaleString()}
                          </td>
                          <td className="px-4 py-2 text-xs text-gray-200">{log.symbol}</td>
                          <td className={`px-4 py-2 text-xs font-medium ${
                            log.signal === 'BUY' ? 'text-green-400' :
                            log.signal === 'SELL' ? 'text-red-400' :
                            'text-gray-400'
                          }`}>
                            {log.signal}
                          </td>
                          <td className={`px-4 py-2 text-xs font-medium ${
                            log.accuracy >= 0.85 ? 'text-green-400' :
                            log.accuracy >= 0.7 ? 'text-yellow-400' :
                            'text-red-400'
                          }`}>
                            {(log.accuracy * 100).toFixed(1)}%
                          </td>
                          <td className="px-4 py-2 text-xs text-gray-200">
                            {(log.orderbookImbalance * 100).toFixed(2)}%
                          </td>
                          <td className="px-4 py-2 text-xs text-gray-200">{log.recommendedAction}</td>
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
