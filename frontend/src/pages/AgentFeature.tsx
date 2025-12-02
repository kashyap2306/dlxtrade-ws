import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import AgentFeaturePage from '../components/AgentFeaturePage';
import Toast from '../components/Toast';
import { useUnlockedAgents } from '../hooks/useUnlockedAgents';
import { agentsApi } from '../services/api';

export default function AgentFeature() {
  const { agentId } = useParams<{ agentId: string }>();
  const { unlockedAgents } = useUnlockedAgents();
  const [agent, setAgent] = useState<any>(null);
  const [settings, setSettings] = useState<any>({});
  const [instructions, setInstructions] = useState<string>('');
  const [apiKey, setApiKey] = useState<string>('');
  const [apiSecret, setApiSecret] = useState<string>('');
  const [status, setStatus] = useState<'active' | 'inactive'>('inactive');
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  useEffect(() => {
    if (agentId && unlockedAgents.length > 0) {
      loadAgentData();
    }
  }, [agentId, unlockedAgents]);

  const loadAgentData = async () => {
    if (!agentId) return;
    
    const unlockedAgent = unlockedAgents.find(
      (ua) => ua.agentId === agentId || ua.agent?.id === agentId
    );

    if (unlockedAgent) {
      setAgent(unlockedAgent.agent || { name: unlockedAgent.agentName });
      setSettings(unlockedAgent.settings || {});
      setInstructions(unlockedAgent.settings?.instructions || '');
      setApiKey(unlockedAgent.settings?.apiKey || '');
      setApiSecret(unlockedAgent.settings?.apiSecret || '');
      setStatus(unlockedAgent.status === 'active' ? 'active' : 'inactive');
    }
  };

  const handleSaveSettings = async () => {
    if (!agentId) return;
    setSaving(true);
    try {
      // Save settings to backend
      const updatedSettings = {
        ...settings,
        instructions,
        apiKey,
        apiSecret,
        updatedAt: new Date().toISOString(),
      };
      
      await agentsApi.updateAgentSettings(agentId, updatedSettings);
      
      showToast('Settings saved successfully', 'success');
      // Refresh unlocked agents to get updated settings
      window.location.reload();
    } catch (err: any) {
      showToast(err.response?.data?.error || 'Failed to save settings', 'error');
    } finally {
      setSaving(false);
    }
  };

  const showToast = (message: string, type: 'success' | 'error') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  return (
    <AgentFeaturePage>
      <div className="space-y-6">
        {/* Status Panel */}
        <div className="bg-gradient-to-br from-slate-800/70 via-slate-800/50 to-slate-900/70 backdrop-blur-2xl border border-purple-500/30 rounded-3xl shadow-2xl p-6 md:p-8">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-2xl font-bold text-white">Status</h2>
            <div className={`px-4 py-2 rounded-lg text-sm font-semibold
              ${status === 'active' ? 'bg-green-500/20 border border-green-500/50 text-green-300' : 'bg-slate-700/80 border border-slate-500/50 text-gray-300'}`}>
              {status === 'active' ? '✓ Active' : '⚪ Inactive'}
            </div>
          </div>
          <p className="text-gray-400">
            Agent status: {status === 'active' ? 'Running and operational' : 'Stopped or paused'}
          </p>
        </div>

        {/* Settings Panel */}
        <div className="bg-gradient-to-br from-slate-800/70 via-slate-800/50 to-slate-900/70 backdrop-blur-2xl border border-purple-500/30 rounded-3xl shadow-2xl p-6 md:p-8">
          <h2 className="text-2xl font-bold text-white mb-6">Settings</h2>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">API Key</label>
              <input
                type="text"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                className="input w-full"
                placeholder="Enter API key"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">API Secret</label>
              <input
                type="password"
                value={apiSecret}
                onChange={(e) => setApiSecret(e.target.value)}
                className="input w-full"
                placeholder="Enter API secret"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">Configuration (JSON)</label>
              <textarea
                value={JSON.stringify(settings, null, 2)}
                onChange={(e) => {
                  try {
                    setSettings(JSON.parse(e.target.value));
                  } catch {
                    // Invalid JSON, ignore
                  }
                }}
                className="input w-full min-h-[200px] font-mono text-sm"
                placeholder='{"key": "value"}'
              />
            </div>
            <button
              onClick={handleSaveSettings}
              disabled={saving}
              className="btn btn-primary w-full disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Save Settings'}
            </button>
          </div>
        </div>

        {/* Instructions Panel */}
        <div className="bg-gradient-to-br from-slate-800/70 via-slate-800/50 to-slate-900/70 backdrop-blur-2xl border border-purple-500/30 rounded-3xl shadow-2xl p-6 md:p-8">
          <h2 className="text-2xl font-bold text-white mb-4">Instructions</h2>
          <div className="prose prose-invert max-w-none">
            {instructions ? (
              <div className="text-gray-300 whitespace-pre-line">{instructions}</div>
            ) : (
              <p className="text-gray-400">No instructions available. Contact admin for setup guidance.</p>
            )}
          </div>
        </div>

        {/* Agent Controls */}
        <div className="bg-gradient-to-br from-slate-800/70 via-slate-800/50 to-slate-900/70 backdrop-blur-2xl border border-purple-500/30 rounded-3xl shadow-2xl p-6 md:p-8">
          <h2 className="text-2xl font-bold text-white mb-6">Agent Controls</h2>
          <div className="space-y-4">
            <button
              onClick={() => setStatus(status === 'active' ? 'inactive' : 'active')}
              className={`btn w-full ${
                status === 'active' ? 'btn-danger' : 'btn-primary'
              }`}
            >
              {status === 'active' ? 'Stop Agent' : 'Start Agent'}
            </button>
            <p className="text-sm text-gray-400">
              Use these controls to manage your agent. Changes will be saved automatically.
            </p>
          </div>
        </div>
      </div>
      {toast && <Toast message={toast.message} type={toast.type} />}
    </AgentFeaturePage>
  );
}

