import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import { agentsApi, usersApi } from '../services/api';
import Toast from '../components/Toast';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../config/firebase-config';

type AgentStatus = 'STOPPED' | 'RUNNING';

export default function VWAPStrategy() {
  const { user, authReady } = useAuth();
  const agentId = 'vwap-strategy';

  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [agentAccessChecked, setAgentAccessChecked] = useState(false);
  const [hasAgentAccess, setHasAgentAccess] = useState(false);

  const [loading, setLoading] = useState(true);
  const [exchange, setExchange] = useState<string | null>(null);
  const [exchangeConnected, setExchangeConnected] = useState<boolean>(false);
  const [exchangeConfigLoaded, setExchangeConfigLoaded] = useState(false);
  const [agentStatusLoaded, setAgentStatusLoaded] = useState(false);

  const [status, setStatus] = useState<AgentStatus>('STOPPED');
  const [stoppedReason, setStoppedReason] = useState<string | null>(null);
  const [trades, setTrades] = useState<any[]>([]);
  const [diagnostics, setDiagnostics] = useState<any[]>([]);
  const [scheduler, setScheduler] = useState<any | null>(null);
  const [runtime, setRuntime] = useState<any | null>(null);

  const toValidDate = (value: any): Date | null => {
    if (!value) return null;
    if (value instanceof Date) {
      return Number.isFinite(value.getTime()) ? value : null;
    }

    if (typeof value === 'number' || typeof value === 'string') {
      const d = new Date(value);
      return Number.isFinite(d.getTime()) ? d : null;
    }

    if (typeof value?.toDate === 'function') {
      const d = value.toDate();
      return d instanceof Date && Number.isFinite(d.getTime()) ? d : null;
    }

    const seconds = value?.seconds ?? value?._seconds;
    if (typeof seconds === 'number') {
      const d = new Date(seconds * 1000);
      return Number.isFinite(d.getTime()) ? d : null;
    }

    return null;
  };

  const formatRelative = (target: Date | null, mode: 'past' | 'future') => {
    if (!target) return '—';
    const now = Date.now();
    const deltaMs = target.getTime() - now;
    const absMs = Math.abs(deltaMs);
    const mins = Math.round(absMs / 60000);

    if (mins < 1) {
      return mode === 'past' ? 'just now' : 'in <1 min';
    }
    if (mins < 60) {
      return mode === 'past' ? `${mins} min ago` : `in ~${mins} min`;
    }
    const hrs = Math.round(mins / 60);
    return mode === 'past' ? `${hrs} hr ago` : `in ~${hrs} hr`;
  };

  const showToast = (message: string, type: 'success' | 'error') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 5000);
  };

  const todayStats = useMemo(() => {
    const todayTrades = Array.isArray(trades) ? trades : [];
    const realizedPnL = todayTrades
      .filter((t: any) => (t?.status || '').toLowerCase() === 'closed')
      .reduce((sum: number, t: any) => sum + (Number(t?.pnl) || 0), 0);

    return {
      tradeCount: todayTrades.length,
      realizedPnL,
    };
  }, [trades]);

  // Load exchange config first (independent of agent access)
  useEffect(() => {
    if (!user) return;

    const loadExchangeConfig = async () => {
      try {
        const exRes = await usersApi.getExchangeConfig(user.uid);
        setExchange(exRes.data?.exchange || null);
        setExchangeConnected(!!exRes.data?.connected);
      } catch {
        setExchange(null);
        setExchangeConnected(false);
      } finally {
        setExchangeConfigLoaded(true);
      }
    };

    loadExchangeConfig();
  }, [user]);

  // Check agent access
  useEffect(() => {
    if (!user) return;

    const checkAgentAccess = async () => {
      try {
        const userDoc = await getDoc(doc(db, 'users', user.uid));
        const approvedAgents: string[] = (userDoc.data() as any)?.approvedAgents || [];
        const hasAccess = Array.isArray(approvedAgents) && approvedAgents.includes('VWAP_STRATEGY');
        setHasAgentAccess(hasAccess);
      } catch {
        setHasAgentAccess(false);
      } finally {
        setAgentAccessChecked(true);
      }
    };

    checkAgentAccess();
  }, [user]);

  // Only load agent data when ALL prerequisites are met
  const canMakeAgentCalls = hasAgentAccess && exchangeConfigLoaded && agentAccessChecked;

  const refreshAll = async () => {
    if (!user || !canMakeAgentCalls) return;

    setLoading(true);
    try {
      const sRes = await agentsApi.getAgentStatus(agentId);
      setStatus((sRes.data?.status as AgentStatus) || 'STOPPED');
      setStoppedReason(sRes.data?.stoppedReason || null);
      setAgentStatusLoaded(true);
    } catch {
      setStatus('STOPPED');
      setStoppedReason(null);
      setAgentStatusLoaded(true);
    }

    try {
      const tRes = await agentsApi.getTradingAgentTrades(agentId, 200);
      setTrades(Array.isArray(tRes.data?.trades) ? tRes.data.trades : []);
    } catch {
      setTrades([]);
    }

    try {
      const dRes = await agentsApi.getTradingAgentDiagnostics(agentId, 50);
      setDiagnostics(Array.isArray(dRes.data?.diagnostics) ? dRes.data.diagnostics : []);
      setScheduler(dRes.data?.scheduler || null);
      setRuntime(dRes.data?.runtime || null);
    } catch {
      setDiagnostics([]);
      setScheduler(null);
      setRuntime(null);
    } finally {
      setLoading(false);
    }
  };

  // Load agent data only when prerequisites are met
  useEffect(() => {
    if (!canMakeAgentCalls) {
      if (agentAccessChecked && !hasAgentAccess) {
        setLoading(false);
      }
      return;
    }

    refreshAll();
  }, [canMakeAgentCalls]);

  const toggleAutoTrade = async () => {
    // HARD BLOCK: Do not call API until all prerequisites are met
    if (!user || !canMakeAgentCalls || !agentStatusLoaded || !exchangeConnected) {
      showToast('Agent not ready yet', 'error');
      return;
    }
    setLoading(true);
    try {
      if (status === 'RUNNING') {
        await agentsApi.stopTradingAgent(agentId);
      } else {
        await agentsApi.startTradingAgent(agentId);
      }
      await refreshAll();
    } catch (error: any) {
      const msg = error?.response?.data?.error || error?.response?.data?.message || 'Action failed';
      showToast(msg, 'error');
    } finally {
      setLoading(false);
    }
  };

  // Strict render guards: Wait for auth and agent access check
  if (!authReady || !agentAccessChecked) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <div className="text-slate-400">Loading…</div>
      </div>
    );
  }

  if (agentAccessChecked && !hasAgentAccess) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <div className="text-slate-300">Access denied</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="max-w-4xl mx-auto p-4">
        <div className="flex items-center justify-between">
          <div className="text-xl font-semibold">VWAP Strategy</div>
          <button
            onClick={refreshAll}
            disabled={loading}
            className="px-3 py-2 text-sm rounded bg-slate-800 disabled:opacity-50"
          >
            Refresh
          </button>
        </div>

        <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="p-3 rounded bg-slate-900">
            <div className="text-xs text-slate-400">Exchange</div>
            <div className="mt-1 flex items-center justify-between">
              <div className="text-sm">{exchange || 'Not set'}</div>
              <div className={`text-sm ${exchangeConnected ? 'text-green-400' : 'text-red-400'}`}>
                {exchangeConnected ? 'Connected' : 'Disconnected'}
              </div>
            </div>
          </div>

          <div className="p-3 rounded bg-slate-900">
            <div className="text-xs text-slate-400">Live Status</div>
            <div className="mt-1 flex items-center justify-between">
              <div className={`text-sm ${status === 'RUNNING' ? 'text-green-400' : 'text-slate-300'}`}>
                {status}
              </div>
              <div className="text-xs text-slate-400">{stoppedReason || ''}</div>
            </div>
          </div>

          <div className="p-3 rounded bg-slate-900">
            <div className="text-xs text-slate-400">Auto Trade</div>
            <div className="mt-2">
              <button
                onClick={toggleAutoTrade}
                disabled={loading || !exchangeConnected || !canMakeAgentCalls || !agentStatusLoaded}
                className={`w-full px-3 py-2 rounded text-sm disabled:opacity-50 ${
                  status === 'RUNNING' ? 'bg-red-600' : 'bg-green-600'
                }`}
              >
                {loading ? 'Working…' : !agentStatusLoaded ? 'Loading…' : status === 'RUNNING' ? 'Turn OFF' : 'Turn ON'}
              </button>
            </div>
          </div>

          <div className="p-3 rounded bg-slate-900">
            <div className="text-xs text-slate-400">Today</div>
            <div className="mt-1 flex items-center justify-between">
              <div className="text-sm">Trades: {todayStats.tradeCount}</div>
              <div className={`text-sm ${todayStats.realizedPnL >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                PnL: {todayStats.realizedPnL.toFixed(4)}
              </div>
            </div>
          </div>
        </div>

        <div className="mt-4">
          <div className="text-sm text-slate-300">Today Trades</div>
          <div className="mt-2 overflow-x-auto rounded bg-slate-900">
            <table className="min-w-full text-sm">
              <thead className="text-slate-400">
                <tr>
                  <th className="text-left p-2">Time</th>
                  <th className="text-left p-2">Side</th>
                  <th className="text-left p-2">Qty</th>
                  <th className="text-left p-2">Entry</th>
                  <th className="text-left p-2">Exit</th>
                  <th className="text-left p-2">PnL</th>
                  <th className="text-left p-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {trades.length === 0 ? (
                  <tr>
                    <td className="p-2 text-slate-500" colSpan={7}>
                      No trades today
                    </td>
                  </tr>
                ) : (
                  trades.map((t: any) => (
                    <tr key={t.id} className="border-t border-slate-800">
                      <td className="p-2 text-slate-300">
                        {(() => {
                          const ts = toValidDate(t?.timestamp);
                          return ts ? ts.toLocaleTimeString() : '';
                        })()}
                      </td>
                      <td className="p-2 text-slate-300">{String(t.side || '').toUpperCase()}</td>
                      <td className="p-2 text-slate-300">{Number(t.qty || 0).toFixed(6)}</td>
                      <td className="p-2 text-slate-300">{Number(t.entryPrice || 0).toFixed(2)}</td>
                      <td className="p-2 text-slate-300">{t.exitPrice ? Number(t.exitPrice).toFixed(2) : ''}</td>
                      <td className={`p-2 ${(Number(t.pnl) || 0) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                        {t.pnl !== undefined && t.pnl !== null ? Number(t.pnl || 0).toFixed(4) : ''}
                      </td>
                      <td className="p-2 text-slate-300">{t.status}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="mt-4">
          <div className="text-sm text-slate-300">Diagnostics</div>
          <div className="mt-2 rounded bg-slate-900 p-3">
            <div className="flex items-center justify-between">
              <div className="text-xs text-slate-400">Scheduler</div>
              <div className={`text-xs ${scheduler?.isRunning ? 'text-green-400' : 'text-red-400'}`}>
                {scheduler?.isRunning ? 'RUNNING' : 'NOT RUNNING'}
              </div>
            </div>

            <div className="mt-1 text-xs text-slate-400">
              Last scan: {formatRelative(toValidDate(scheduler?.lastExecutionAt), 'past')}
            </div>
            <div className="text-xs text-slate-400">
              Next scan: {formatRelative(toValidDate(scheduler?.nextExecutionAt), 'future')}
            </div>
            {scheduler?.lastExecutionError ? (
              <div className="mt-1 text-xs text-red-400">Last error: {String(scheduler.lastExecutionError)}</div>
            ) : null}

            <div className="mt-3 flex items-center justify-between">
              <div className="text-xs text-slate-400">Runtime</div>
              <div className={`text-xs ${runtime?.status === 'RUNNING' ? 'text-green-400' : 'text-slate-300'}`}>
                {runtime?.status || status}
              </div>
            </div>
            {runtime?.stoppedReason ? <div className="text-xs text-slate-400">{String(runtime.stoppedReason)}</div> : null}

            <div className="mt-3 overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="text-slate-400">
                  <tr>
                    <th className="text-left p-2">Time</th>
                    <th className="text-left p-2">Result</th>
                    <th className="text-left p-2">Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {diagnostics.length === 0 ? (
                    <tr>
                      <td className="p-2 text-slate-500" colSpan={3}>
                        No diagnostics yet
                      </td>
                    </tr>
                  ) : (
                    diagnostics.map((d: any, idx: number) => {
                      const rawTs = d?.timestamp || d?.createdAt || d?.time || d?.date;
                      const ts = toValidDate(rawTs);
                      const action = String(d?.decision?.action || '').toUpperCase();
                      const reason = d?.decision?.reason ? String(d.decision.reason) : '';
                      const isStopForDay = reason.startsWith('STOPPED_FOR_DAY');
                      const executed = action === 'TRADE' && !!d?.execution?.success;
                      const result = executed ? 'EXECUTED' : isStopForDay ? 'STOPPED_FOR_DAY' : 'SKIPPED';

                      return (
                        <tr key={d?.id || `${idx}`} className="border-t border-slate-800">
                          <td className="p-2 text-slate-300">{ts ? ts.toLocaleTimeString() : ''}</td>
                          <td
                            className={`p-2 ${
                              result === 'EXECUTED'
                                ? 'text-green-400'
                                : result === 'STOPPED_FOR_DAY'
                                  ? 'text-amber-400'
                                  : 'text-slate-300'
                            }`}
                          >
                            {result}
                          </td>
                          <td className="p-2 text-slate-300">
                            {reason || (executed ? '' : action || '')}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      {toast && <Toast message={toast.message} type={toast.type} />}
    </div>
  );
}