import { useState, useEffect } from 'react';
import { engineApi } from '../services/api';
import ConfigForm from '../components/ConfigForm';
import Toast from '../components/Toast';
import Sidebar from '../components/Sidebar';

export default function EngineControl() {
  const [status, setStatus] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  useEffect(() => {
    loadStatus();
    const interval = setInterval(loadStatus, 2000);
    return () => clearInterval(interval);
  }, []);

  const loadStatus = async () => {
    try {
      const response = await engineApi.getStatus();
      setStatus(response.data);
    } catch (err) {
      console.error('Error loading status:', err);
    }
  };

  const showToast = (message: string, type: 'success' | 'error') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  const handleStart = async (config: any) => {
    setLoading(true);
    try {
      await engineApi.start(config);
      showToast('Engine started', 'success');
      loadStatus();
    } catch (err: any) {
      showToast(err.response?.data?.error || 'Error starting engine', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleStop = async () => {
    if (!confirm('Are you sure you want to stop the engine?')) return;

    setLoading(true);
    try {
      await engineApi.stop();
      showToast('Engine stopped', 'success');
      loadStatus();
    } catch (err: any) {
      showToast(err.response?.data?.error || 'Error stopping engine', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handlePause = async () => {
    try {
      await engineApi.pauseRisk();
      showToast('Risk manager paused', 'success');
      loadStatus();
    } catch (err: any) {
      showToast(err.response?.data?.error || 'Error pausing', 'error');
    }
  };

  const handleResume = async () => {
    try {
      await engineApi.resumeRisk();
      showToast('Risk manager resumed', 'success');
      loadStatus();
    } catch (err: any) {
      showToast(err.response?.data?.error || 'Error resuming', 'error');
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900">
      {/* Animated background elements */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-80 h-80 bg-purple-500 rounded-full mix-blend-multiply filter blur-xl opacity-20 animate-blob"></div>
        <div className="absolute -bottom-40 -left-40 w-80 h-80 bg-blue-500 rounded-full mix-blend-multiply filter blur-xl opacity-20 animate-blob animation-delay-2000"></div>
        <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-80 h-80 bg-pink-500 rounded-full mix-blend-multiply filter blur-xl opacity-20 animate-blob animation-delay-4000"></div>
      </div>

      <Sidebar onLogout={async () => {
        const { signOut } = await import('firebase/auth');
        const { auth } = await import('../config/firebase');
        await signOut(auth);
        localStorage.removeItem('firebaseToken');
        localStorage.removeItem('firebaseUser');
        window.location.href = '/login';
      }} />

      <main className="min-h-screen">
        <div className="max-w-7xl mx-auto py-8 px-4 sm:px-6 lg:px-8">
          <div className="mb-8">
            <h1 className="text-4xl font-bold bg-gradient-to-r from-purple-400 via-pink-400 to-blue-400 bg-clip-text text-transparent mb-2">
              Engine Control
            </h1>
            <p className="text-gray-300">Start, stop, and configure the trading engine</p>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="card">
              <h2 className="text-xl font-semibold mb-4 text-white">Engine Configuration</h2>
              <ConfigForm
                onSubmit={handleStart}
                onStop={handleStop}
                loading={loading}
                isRunning={status?.engine?.running || false}
              />
            </div>
            <div className="card">
              <h2 className="text-xl font-semibold mb-4 text-white">Risk Management</h2>
              {status?.risk ? (
                <div className="space-y-4">
                  <div>
                    <div className="flex justify-between mb-2">
                      <span className="text-gray-300">Circuit Breaker:</span>
                      <span className={status.risk.circuitBreaker ? 'text-red-400' : 'text-green-400'}>
                        {status.risk.circuitBreaker ? 'Active' : 'Inactive'}
                      </span>
                    </div>
                    <div className="flex justify-between mb-2">
                      <span className="text-gray-300">Paused:</span>
                      <span className={status.risk.paused ? 'text-yellow-400' : 'text-green-400'}>
                        {status.risk.paused ? 'Yes' : 'No'}
                      </span>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <div className="flex justify-between">
                      <span className="text-gray-300">Max Daily PnL:</span>
                      <span className="text-gray-200">${status.risk.limits.maxDailyPnL}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-300">Max Drawdown:</span>
                      <span className="text-gray-200">${status.risk.limits.maxDrawdown}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-300">Max Position:</span>
                      <span className="text-gray-200">{status.risk.limits.maxPosition} BTC</span>
                    </div>
                  </div>
                  <div className="flex space-x-2">
                    <button
                      onClick={handlePause}
                      className="btn btn-secondary flex-1"
                    >
                      Pause
                    </button>
                    <button
                      onClick={handleResume}
                      className="btn btn-primary flex-1"
                    >
                      Resume
                    </button>
                  </div>
                </div>
              ) : (
                <p className="text-gray-400">Loading risk status...</p>
              )}
            </div>
          </div>
        </div>
      </main>

      {toast && <Toast message={toast.message} type={toast.type} />}
    </div>
  );
}

