import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { executionApi } from '../services/api';
import { useAuth } from '../hooks/useAuth';
import { suppressConsoleError } from '../utils/errorHandler';

export default function ExecutionSummary() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [summary, setSummary] = useState({
    executed: 0,
    skipped: 0,
    total: 0,
  });
  const [loading, setLoading] = useState(false);

  const loadSummary = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const response = await executionApi.getLogs({ limit: 500 });
      const logs = response.data || [];

      const executed = logs.filter((log: any) => log.action === 'EXECUTED').length;
      const skipped = logs.filter((log: any) => log.action === 'SKIPPED').length;
      
      setSummary({
        executed,
        skipped,
        total: logs.length,
      });
    } catch (err: any) {
      // Safe fallback: if response status = 500 → return empty logs so that UI doesn't crash
      if (err.response?.status === 500) {
        console.warn('[ExecutionSummary] Backend returned 500 error, using empty logs fallback');
        setSummary({
          executed: 0,
          skipped: 0,
          total: 0,
        });
      } else {
        suppressConsoleError(err, 'loadExecutionSummary');
      }
      suppressConsoleError(err, 'loadExecutionSummary');
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (user) {
      loadSummary();
      // Reduced polling interval to 60 seconds to improve performance
      const interval = setInterval(loadSummary, 60000);
      return () => clearInterval(interval);
    }
  }, [user, loadSummary]);

  return (
    <div className="bg-black/30 backdrop-blur-xl border border-purple-500/30 rounded-2xl p-6 shadow-2xl shadow-purple-500/10 hover:shadow-purple-500/20 transition-all duration-300 overflow-hidden">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl sm:text-2xl font-bold bg-gradient-to-r from-purple-400 via-pink-400 to-cyan-400 bg-clip-text text-transparent mb-1">
            Execution Summary
          </h2>
          <p className="text-xs sm:text-sm text-gray-400">Recent trading activity</p>
        </div>
      </div>

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-16 bg-gray-700/30 rounded-lg animate-pulse"></div>
          ))}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-4 mb-6">
            <div className="bg-green-500/10 border border-green-400/30 rounded-xl p-4 backdrop-blur-sm">
              <div className="text-xs text-gray-400 mb-1">Executed</div>
              <div className="text-2xl font-bold text-green-400">{summary.executed}</div>
            </div>
            <div className="bg-yellow-500/10 border border-yellow-400/30 rounded-xl p-4 backdrop-blur-sm">
              <div className="text-xs text-gray-400 mb-1">Skipped</div>
              <div className="text-2xl font-bold text-yellow-400">{summary.skipped}</div>
            </div>
            <div className="bg-purple-500/10 border border-purple-400/30 rounded-xl p-4 backdrop-blur-sm">
              <div className="text-xs text-gray-400 mb-1">Total Signals</div>
              <div className="text-2xl font-bold text-purple-400">{summary.total}</div>
            </div>
          </div>
          
          <button
            onClick={() => navigate('/execution')}
            className="w-full px-6 py-3 bg-gradient-to-r from-purple-600 to-pink-600 text-white font-semibold rounded-xl hover:from-purple-500 hover:to-pink-500 transition-all shadow-lg shadow-purple-500/30 hover:shadow-purple-500/50 flex items-center justify-center gap-2"
          >
            View All Logs
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </>
      )}
    </div>
  );
}

