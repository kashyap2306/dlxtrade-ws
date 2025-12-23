import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import Toast from '../components/Toast';
import { useAuth } from '../hooks/useAuth';
import { agentsApi } from '../services/api';

interface LaunchpadProject {
  id: string;
  name: string;
  status: 'monitoring' | 'whitelist' | 'presale' | 'active' | 'completed';
  progress: number;
  participants: number;
  hardCap: number;
  currentRaised: number;
  tokenPrice: number;
  startDate: string;
  endDate: string;
}

interface HuntResult {
  id: string;
  projectName: string;
  type: 'whitelist' | 'presale' | 'early_entry';
  status: 'success' | 'failed' | 'pending';
  timestamp: string;
  details: string;
}

export default function AgentControl() {
  const { agentId } = useParams<{ agentId: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [agent, setAgent] = useState<any>(null);
  const [feature, setFeature] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [settings, setSettings] = useState({
    autoHunt: false,
    riskLevel: 'medium',
    minParticipants: 1000,
    maxTokenPrice: 0.01,
    projectTypes: ['presale', 'whitelist'],
    notificationEnabled: true,
    maxInvestAmount: 1000,
  });
  const [projects, setProjects] = useState<LaunchpadProject[]>([]);
  const [huntHistory, setHuntHistory] = useState<HuntResult[]>([]);
  const [activeTab, setActiveTab] = useState<'dashboard' | 'projects' | 'settings' | 'history'>('dashboard');
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  useEffect(() => {
    if (user && agentId) {
      loadAgentAndFeature();
    }
  }, [user, agentId]);

  const loadAgentAndFeature = async () => {
    if (!agentId || !user) return;
    setLoading(true);

    try {
      // Load agent data
      const agentsResponse = await agentsApi.getAll();
      const agents = agentsResponse.data.agents || [];
      const foundAgent = agents.find((a: any) =>
        a.id === agentId ||
        a.name?.toLowerCase().replace(/\s+/g, '_') === agentId
      );

      if (foundAgent) {
        setAgent(foundAgent);
      }

      // Load user features to check if this agent is enabled
      const featuresResponse = await agentsApi.getUserFeatures(user.uid);
      const features = featuresResponse.data.features || [];
      const agentFeature = features.find((f: any) => f.id === agentId && f.enabled);

      if (!agentFeature) {
        // User doesn't have access to this agent
        navigate('/agents');
        return;
      }

      setFeature(agentFeature);

      // Load mock data for AI Launchpad Hunter
      if (agentId === 'ai_launchpad_hunter') {
        loadMockLaunchpadData();
      }

    } catch (err: any) {
      console.error('Error loading agent:', err);
      showToast('Error loading agent', 'error');
    } finally {
      setLoading(false);
    }
  };

  const loadMockLaunchpadData = () => {
    // Mock projects data
    const mockProjects: LaunchpadProject[] = [
      {
        id: '1',
        name: 'CryptoAI Network',
        status: 'presale',
        progress: 75,
        participants: 2450,
        hardCap: 500000,
        currentRaised: 375000,
        tokenPrice: 0.008,
        startDate: '2024-12-15',
        endDate: '2024-12-30',
      },
      {
        id: '2',
        name: 'DeFi Protocol X',
        status: 'whitelist',
        progress: 30,
        participants: 890,
        hardCap: 1000000,
        currentRaised: 300000,
        tokenPrice: 0.015,
        startDate: '2024-12-20',
        endDate: '2025-01-05',
      },
      {
        id: '3',
        name: 'NFT Marketplace Pro',
        status: 'monitoring',
        progress: 0,
        participants: 0,
        hardCap: 750000,
        currentRaised: 0,
        tokenPrice: 0.012,
        startDate: '2025-01-01',
        endDate: '2025-01-15',
      },
    ];

    // Mock hunt history
    const mockHistory: HuntResult[] = [
      {
        id: '1',
        projectName: 'AI Trading Bot',
        type: 'whitelist',
        status: 'success',
        timestamp: '2024-12-10T14:30:00Z',
        details: 'Successfully secured whitelist spot. Auto-entry executed.',
      },
      {
        id: '2',
        projectName: 'DeFi Yield Farm',
        type: 'presale',
        status: 'success',
        timestamp: '2024-12-08T09:15:00Z',
        details: 'Early presale entry with 50% bonus allocation.',
      },
      {
        id: '3',
        projectName: 'Web3 Gaming Hub',
        type: 'whitelist',
        status: 'failed',
        timestamp: '2024-12-05T16:45:00Z',
        details: 'Whitelist application rejected - insufficient social score.',
      },
    ];

    setProjects(mockProjects);
    setHuntHistory(mockHistory);
  };

  const showToast = (message: string, type: 'success' | 'error') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  const updateSettings = async (newSettings: any) => {
    try {
      setSettings({ ...settings, ...newSettings });
      showToast('Settings updated successfully', 'success');
    } catch (err: any) {
      console.error('Error updating settings:', err);
      showToast('Error updating settings', 'error');
    }
  };

  const toggleAutoHunt = () => {
    updateSettings({ autoHunt: !settings.autoHunt });
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active': return 'text-green-400';
      case 'presale': return 'text-blue-400';
      case 'whitelist': return 'text-yellow-400';
      case 'monitoring': return 'text-gray-400';
      case 'completed': return 'text-purple-400';
      default: return 'text-gray-400';
    }
  };

  const getHuntStatusColor = (status: string) => {
    switch (status) {
      case 'success': return 'text-green-400';
      case 'failed': return 'text-red-400';
      case 'pending': return 'text-yellow-400';
      default: return 'text-gray-400';
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900/20 to-slate-900 flex items-center justify-center">
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-purple-500"></div>
      </div>
    );
  }

  if (!agent || !feature) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900/20 to-slate-900 flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-2xl font-bold text-white mb-4">Agent Not Found</h2>
          <p className="text-gray-400 mb-6">You don't have access to this agent or it doesn't exist.</p>
          <button
            onClick={() => navigate('/agents')}
            className="btn btn-primary"
          >
            Back to Agents
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900/20 to-slate-900">
      {/* Animated background elements */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none z-0">
        <div className="absolute -top-40 -right-40 w-80 h-80 bg-purple-500 rounded-full mix-blend-multiply filter blur-xl opacity-20 animate-blob"></div>
        <div className="absolute -bottom-40 -left-40 w-80 h-80 bg-blue-500 rounded-full mix-blend-multiply filter blur-xl opacity-20 animate-blob animation-delay-2000"></div>
      </div>

      <div className="relative z-10 p-6 max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold bg-gradient-to-r from-purple-400 to-pink-400 bg-clip-text text-transparent mb-2">
            🚀 {agent.name}
          </h1>
          <p className="text-gray-400">
            AI-powered launchpad hunter for presales, whitelists, and early entries
          </p>
        </div>

        {/* Tab Navigation */}
        <div className="flex space-x-1 mb-8 bg-slate-800/50 p-1 rounded-lg backdrop-blur-sm">
          {[
            { id: 'dashboard', label: 'Dashboard', icon: '📊' },
            { id: 'projects', label: 'Projects', icon: '🎯' },
            { id: 'settings', label: 'Settings', icon: '⚙️' },
            { id: 'history', label: 'History', icon: '📋' },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`flex-1 py-2 px-4 rounded-md text-sm font-medium transition-all ${
                activeTab === tab.id
                  ? 'bg-purple-600 text-white shadow-lg'
                  : 'text-gray-400 hover:text-white hover:bg-slate-700/50'
              }`}
            >
              {tab.icon} {tab.label}
            </button>
          ))}
        </div>

        {/* Dashboard Tab */}
        {activeTab === 'dashboard' && (
          <>
            {/* Agent Status & Controls */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
              <div className="bg-gradient-to-br from-slate-800/70 via-slate-800/50 to-slate-900/70 backdrop-blur-sm border border-purple-500/30 rounded-xl p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-lg font-semibold text-white mb-1">Status</h3>
                    <p className={`font-medium ${settings.autoHunt ? 'text-green-400' : 'text-yellow-400'}`}>
                      {settings.autoHunt ? 'Active' : 'Inactive'}
                    </p>
                  </div>
                  <div className={`w-12 h-12 rounded-full flex items-center justify-center ${
                    settings.autoHunt ? 'bg-green-500/20' : 'bg-yellow-500/20'
                  }`}>
                    <svg className={`w-6 h-6 ${settings.autoHunt ? 'text-green-400' : 'text-yellow-400'}`}
                         fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                            d={settings.autoHunt ? "M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" : "M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z"} />
                    </svg>
                  </div>
                </div>
              </div>

              <div className="bg-gradient-to-br from-slate-800/70 via-slate-800/50 to-slate-900/70 backdrop-blur-sm border border-purple-500/30 rounded-xl p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-lg font-semibold text-white mb-1">Projects Found</h3>
                    <p className="text-blue-400 font-medium">{projects.length}</p>
                  </div>
                  <div className="w-12 h-12 bg-blue-500/20 rounded-full flex items-center justify-center">
                    <svg className="w-6 h-6 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                  </div>
                </div>
              </div>

              <div className="bg-gradient-to-br from-slate-800/70 via-slate-800/50 to-slate-900/70 backdrop-blur-sm border border-purple-500/30 rounded-xl p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-lg font-semibold text-white mb-1">Success Rate</h3>
                    <p className="text-green-400 font-medium">87.5%</p>
                  </div>
                  <div className="w-12 h-12 bg-green-500/20 rounded-full flex items-center justify-center">
                    <svg className="w-6 h-6 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                    </svg>
                  </div>
                </div>
              </div>

              <div className="bg-gradient-to-br from-slate-800/70 via-slate-800/50 to-slate-900/70 backdrop-blur-sm border border-purple-500/30 rounded-xl p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-lg font-semibold text-white mb-1">Auto Hunt</h3>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        className="sr-only peer"
                        checked={settings.autoHunt}
                        onChange={toggleAutoHunt}
                      />
                      <div className="w-11 h-6 bg-gray-600 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-purple-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-purple-600"></div>
                    </label>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-gray-400">Toggle</p>
                    <p className="text-xs text-gray-400">Hunting</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Recent Projects */}
            <div className="bg-gradient-to-br from-slate-800/70 via-slate-800/50 to-slate-900/70 backdrop-blur-sm border border-purple-500/30 rounded-xl p-6 mb-8">
              <h2 className="text-xl font-bold text-white mb-6">Active Projects</h2>
              <div className="space-y-4">
                {projects.slice(0, 3).map((project) => (
                  <div key={project.id} className="flex items-center justify-between p-4 bg-slate-700/30 rounded-lg">
                    <div className="flex-1">
                      <h3 className="text-white font-medium">{project.name}</h3>
                      <div className="flex items-center space-x-4 mt-2">
                        <span className={`text-sm ${getStatusColor(project.status)}`}>
                          {project.status.toUpperCase()}
                        </span>
                        <span className="text-gray-400 text-sm">
                          {project.participants} participants
                        </span>
                        <span className="text-gray-400 text-sm">
                          ${project.tokenPrice} per token
                        </span>
                      </div>
                      <div className="mt-2 bg-slate-600 rounded-full h-2">
                        <div
                          className="bg-purple-500 h-2 rounded-full transition-all duration-300"
                          style={{ width: `${project.progress}%` }}
                        ></div>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-green-400 font-medium">
                        ${project.currentRaised.toLocaleString()} / ${project.hardCap.toLocaleString()}
                      </p>
                      <p className="text-gray-400 text-sm">{project.progress}% funded</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        {/* Projects Tab */}
        {activeTab === 'projects' && (
          <div className="space-y-6">
            <h2 className="text-2xl font-bold text-white mb-6">Launchpad Projects</h2>
            {projects.map((project) => (
              <div key={project.id} className="bg-gradient-to-br from-slate-800/70 via-slate-800/50 to-slate-900/70 backdrop-blur-sm border border-purple-500/30 rounded-xl p-6">
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <h3 className="text-xl font-bold text-white">{project.name}</h3>
                    <span className={`inline-block px-3 py-1 rounded-full text-xs font-medium mt-2 ${getStatusColor(project.status)} bg-current/10`}>
                      {project.status.toUpperCase()}
                    </span>
                  </div>
                  <div className="text-right">
                    <p className="text-2xl font-bold text-green-400">${project.tokenPrice}</p>
                    <p className="text-gray-400 text-sm">per token</p>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                  <div>
                    <p className="text-gray-400 text-sm">Participants</p>
                    <p className="text-white font-medium">{project.participants.toLocaleString()}</p>
                  </div>
                  <div>
                    <p className="text-gray-400 text-sm">Raised / Hard Cap</p>
                    <p className="text-white font-medium">
                      ${project.currentRaised.toLocaleString()} / ${project.hardCap.toLocaleString()}
                    </p>
                  </div>
                  <div>
                    <p className="text-gray-400 text-sm">Progress</p>
                    <p className="text-white font-medium">{project.progress}%</p>
                  </div>
                </div>

                <div className="mb-4">
                  <div className="flex justify-between text-sm text-gray-400 mb-1">
                    <span>Funding Progress</span>
                    <span>{project.progress}%</span>
                  </div>
                  <div className="bg-slate-600 rounded-full h-3">
                    <div
                      className="bg-gradient-to-r from-purple-500 to-pink-500 h-3 rounded-full transition-all duration-500"
                      style={{ width: `${project.progress}%` }}
                    ></div>
                  </div>
                </div>

                <div className="flex items-center justify-between">
                  <div className="text-sm text-gray-400">
                    {project.startDate} - {project.endDate}
                  </div>
                  <button className="btn btn-primary">
                    {project.status === 'whitelist' ? 'Apply for Whitelist' :
                     project.status === 'presale' ? 'Join Presale' : 'Monitor'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Settings Tab */}
        {activeTab === 'settings' && (
          <div className="bg-gradient-to-br from-slate-800/70 via-slate-800/50 to-slate-900/70 backdrop-blur-sm border border-purple-500/30 rounded-xl p-6">
            <h2 className="text-xl font-bold text-white mb-6">Hunter Settings</h2>
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-white font-medium">Auto Hunting Mode</h3>
                  <p className="text-gray-400 text-sm">Automatically hunt for and join launchpad opportunities</p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    className="sr-only peer"
                    checked={settings.autoHunt}
                    onChange={(e) => updateSettings({ autoHunt: e.target.checked })}
                  />
                  <div className="w-11 h-6 bg-gray-600 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-purple-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-purple-600"></div>
                </label>
              </div>

              <div>
                <h3 className="text-white font-medium mb-2">Risk Level</h3>
                <select
                  value={settings.riskLevel}
                  onChange={(e) => updateSettings({ riskLevel: e.target.value })}
                  className="input w-full"
                >
                  <option value="low">Low Risk - Conservative approach</option>
                  <option value="medium">Medium Risk - Balanced strategy</option>
                  <option value="high">High Risk - Aggressive hunting</option>
                </select>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <h3 className="text-white font-medium mb-2">Minimum Participants</h3>
                  <input
                    type="number"
                    value={settings.minParticipants}
                    onChange={(e) => updateSettings({ minParticipants: parseInt(e.target.value) })}
                    className="input w-full"
                    min="100"
                    max="10000"
                  />
                </div>
                <div>
                  <h3 className="text-white font-medium mb-2">Max Token Price ($)</h3>
                  <input
                    type="number"
                    value={settings.maxTokenPrice}
                    onChange={(e) => updateSettings({ maxTokenPrice: parseFloat(e.target.value) })}
                    className="input w-full"
                    step="0.001"
                    min="0.001"
                    max="1"
                  />
                </div>
              </div>

              <div>
                <h3 className="text-white font-medium mb-2">Project Types to Hunt</h3>
                <div className="space-y-2">
                  {['presale', 'whitelist', 'fair_launch'].map((type) => (
                    <label key={type} className="flex items-center space-x-3">
                      <input
                        type="checkbox"
                        checked={settings.projectTypes.includes(type)}
                        onChange={(e) => {
                          const newTypes = e.target.checked
                            ? [...settings.projectTypes, type]
                            : settings.projectTypes.filter(t => t !== type);
                          updateSettings({ projectTypes: newTypes });
                        }}
                        className="w-5 h-5 rounded border-purple-500/30 bg-slate-800 text-purple-500 focus:ring-purple-500 focus:ring-2"
                      />
                      <span className="text-gray-300 capitalize">{type.replace('_', ' ')}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div>
                <h3 className="text-white font-medium mb-2">Maximum Investment per Project ($)</h3>
                <input
                  type="number"
                  value={settings.maxInvestAmount}
                  onChange={(e) => updateSettings({ maxInvestAmount: parseInt(e.target.value) })}
                  className="input w-full"
                  min="100"
                  max="10000"
                />
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-white font-medium">Notifications</h3>
                  <p className="text-gray-400 text-sm">Get notified when opportunities are found</p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    className="sr-only peer"
                    checked={settings.notificationEnabled}
                    onChange={(e) => updateSettings({ notificationEnabled: e.target.checked })}
                  />
                  <div className="w-11 h-6 bg-gray-600 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-purple-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-purple-600"></div>
                </label>
              </div>

              <div className="pt-4">
                <button
                  onClick={() => showToast('Settings saved successfully', 'success')}
                  className="btn btn-primary w-full"
                >
                  Save Settings
                </button>
              </div>
            </div>
          </div>
        )}

        {/* History Tab */}
        {activeTab === 'history' && (
          <div className="space-y-6">
            <h2 className="text-2xl font-bold text-white mb-6">Hunt History</h2>
            <div className="space-y-4">
              {huntHistory.map((result) => (
                <div key={result.id} className="bg-gradient-to-br from-slate-800/70 via-slate-800/50 to-slate-900/70 backdrop-blur-sm border border-purple-500/30 rounded-xl p-6">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center space-x-3 mb-2">
                        <h3 className="text-lg font-medium text-white">{result.projectName}</h3>
                        <span className={`px-2 py-1 rounded text-xs font-medium ${getHuntStatusColor(result.status)} bg-current/10`}>
                          {result.status.toUpperCase()}
                        </span>
                        <span className="text-gray-400 text-sm capitalize">
                          {result.type.replace('_', ' ')}
                        </span>
                      </div>
                      <p className="text-gray-300 mb-2">{result.details}</p>
                      <p className="text-gray-400 text-sm">
                        {new Date(result.timestamp).toLocaleString()}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {toast && <Toast message={toast.message} type={toast.type} />}
    </div>
  );
}
