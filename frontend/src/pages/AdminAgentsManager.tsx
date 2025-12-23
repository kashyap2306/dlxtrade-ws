import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import Toast from '../components/Toast';
import { useAuth } from '../hooks/useAuth';
import { adminApi, agentsApi } from '../services/api';

interface Agent {
  id: string;
  name: string;
  description: string;
  longDescription?: string;
  price: number;
  features: string[];
  category: string;
  badge?: string;
  imageUrl?: string;
  enabled?: boolean;
  whatsappNumber?: string;
  usersUnlocked: number;
  userIds: string[];
}

export default function AdminAgentsManager() {
  const { logout } = useAuth();
  const navigate = useNavigate();
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null);
  const [agentUsers, setAgentUsers] = useState<any[]>([]);
  const [showUsersModal, setShowUsersModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editingAgent, setEditingAgent] = useState<Partial<Agent>>({});
  const [uploadingImage, setUploadingImage] = useState(false);

  useEffect(() => {
    loadAgents();
  }, []);

  const loadAgents = async () => {
    setLoading(true);
    try {
      // Load agents from backend
      const agentsResponse = await agentsApi.getAll();
      const backendAgents = agentsResponse.data.agents || [];

      // Load stats
      const statsResponse = await adminApi.getAgentStats();
      const stats = statsResponse.data.agentStats || {};

      // Combine agents with stats
      const agentsWithStats = backendAgents.map((agent: any) => {
        const agentName = agent.name || agent.id;
        return {
          id: agent.id || agent.name?.toLowerCase().replace(/\s+/g, '_') || '',
          name: agent.name || '',
          description: agent.description || '',
          longDescription: agent.longDescription || agent.description || '',
          price: agent.price || 0,
          features: agent.features || [],
          category: agent.category || 'Trading',
          badge: agent.badge,
          imageUrl: agent.imageUrl,
          enabled: agent.enabled !== false,
          whatsappNumber: agent.whatsappNumber || '9155604591',
          usersUnlocked: stats[agentName]?.unlocked || 0,
          userIds: stats[agentName]?.users || [],
        };
      });

      setAgents(agentsWithStats);
    } catch (err: any) {
      if (err.response?.status === 403) {
        showToast('Admin access required', 'error');
        navigate('/admin-login');
      } else {
        showToast(err.response?.data?.error || 'Error loading agents', 'error');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleToggleEnabled = async (agent: Agent) => {
    try {
      await adminApi.toggleAgent(agent.id);
      showToast(`Agent ${agent.enabled ? 'disabled' : 'enabled'} successfully`, 'success');
      await loadAgents();
    } catch (err: any) {
      showToast(err.response?.data?.error || 'Error toggling agent', 'error');
    }
  };

  const handleEdit = (agent: Agent) => {
    setEditingAgent({
      id: agent.id,
      name: agent.name,
      description: agent.description,
      longDescription: agent.longDescription,
      price: agent.price,
      features: agent.features,
      category: agent.category,
      badge: agent.badge,
      imageUrl: agent.imageUrl,
      enabled: agent.enabled,
      whatsappNumber: agent.whatsappNumber,
    });
    setShowEditModal(true);
  };

  const handleSaveEdit = async () => {
    if (!editingAgent.id) return;

    try {
      await adminApi.updateAgent(editingAgent.id, {
        name: editingAgent.name,
        description: editingAgent.description,
        longDescription: editingAgent.longDescription,
        price: editingAgent.price,
        features: editingAgent.features,
        category: editingAgent.category,
        badge: editingAgent.badge,
        imageUrl: editingAgent.imageUrl,
        enabled: editingAgent.enabled,
        whatsappNumber: editingAgent.whatsappNumber,
      });
      showToast('Agent updated successfully', 'success');
      setShowEditModal(false);
      setEditingAgent({});
      await loadAgents();
    } catch (err: any) {
      showToast(err.response?.data?.error || 'Error updating agent', 'error');
    }
  };

  const handleImageUrlChange = (url: string) => {
    setEditingAgent({ ...editingAgent, imageUrl: url });
  };

  const handleViewUsers = async (agent: Agent) => {
    try {
      const response = await adminApi.getAgentUsers(agent.name);
      setAgentUsers(response.data.users || []);
      setSelectedAgent(agent);
      setShowUsersModal(true);
    } catch (err: any) {
      showToast(err.response?.data?.error || 'Error loading users', 'error');
    }
  };

  const showToast = (message: string, type: 'success' | 'error') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900/20 to-slate-900 flex items-center justify-center">
        <div className="text-lg text-gray-300">Loading agents...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900/20 to-slate-900">
      <div className="p-4 sm:p-6 lg:p-8">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-6 gap-4">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold bg-gradient-to-r from-purple-400 to-pink-400 bg-clip-text text-transparent">
              Agents Manager
            </h1>
            <p className="text-gray-400 text-sm mt-1">Manage all premium agents and their settings</p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => navigate('/admin/unlock-requests')}
              className="btn btn-primary whitespace-nowrap"
            >
              🔔 Unlock Requests
            </button>
            <button
              onClick={() => navigate('/admin')}
              className="btn btn-secondary whitespace-nowrap"
            >
              ← Back to Dashboard
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
          {agents.map((agent) => (
            <div
              key={agent.id}
              className={`card transition-all duration-300 ${
                !agent.enabled ? 'opacity-60' : ''
              }`}
            >
              {/* Agent Image */}
              <div className="relative h-40 mb-4 rounded-xl overflow-hidden bg-gradient-to-br from-purple-500/20 to-pink-500/20">
                {agent.imageUrl ? (
                  <img
                    src={agent.imageUrl}
                    alt={agent.name}
                    className="w-full h-full object-cover"
                    onError={(e) => {
                      const target = e.target as HTMLImageElement;
                      target.style.display = 'none';
                    }}
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <div className="w-16 h-16 rounded-xl bg-purple-500/20 border-2 border-purple-400/50 flex items-center justify-center">
                      <svg className="w-8 h-8 text-purple-300" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                        <path strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
                      </svg>
                    </div>
                  </div>
                )}
                {!agent.enabled && (
                  <div className="absolute inset-0 bg-slate-900/70 flex items-center justify-center">
                    <span className="text-red-400 font-bold text-lg">DISABLED</span>
                  </div>
                )}
              </div>

              <h3 className="text-xl font-bold text-white mb-2 line-clamp-1">{agent.name}</h3>
              <p className="text-gray-400 text-sm mb-4 line-clamp-2">{agent.description}</p>

              <div className="flex items-center justify-between mb-4">
                <div>
                  <div className="text-xs text-gray-500">Price</div>
                  <div className="text-xl font-bold text-purple-400">${agent.price}</div>
                </div>
                <div>
                  <div className="text-xs text-gray-500">Users</div>
                  <div className="text-xl font-bold text-green-400">{agent.usersUnlocked}</div>
                </div>
              </div>

              <div className="space-y-2">
                <button
                  onClick={() => handleEdit(agent)}
                  className="btn btn-secondary w-full text-sm"
                >
                  ✏️ Edit Agent
                </button>
                <div className="flex gap-2">
                  <button
                    onClick={() => handleViewUsers(agent)}
                    className="btn btn-secondary flex-1 text-sm"
                  >
                    👥 Users ({agent.usersUnlocked})
                  </button>
                  <button
                    onClick={() => handleToggleEnabled(agent)}
                    className={`btn flex-1 text-sm ${
                      agent.enabled ? 'btn-danger' : 'btn-primary'
                    }`}
                  >
                    {agent.enabled ? '⛔ Disable' : '✅ Enable'}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Edit Modal */}
      {showEditModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="card max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-2xl font-bold text-white">Edit Agent</h2>
              <button
                onClick={() => {
                  setShowEditModal(false);
                  setEditingAgent({});
                }}
                className="text-gray-400 hover:text-white text-2xl"
              >
                ✕
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">Name</label>
                <input
                  type="text"
                  value={editingAgent.name || ''}
                  onChange={(e) => setEditingAgent({ ...editingAgent, name: e.target.value })}
                  className="input"
                  placeholder="Agent name"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">Short Description</label>
                <textarea
                  value={editingAgent.description || ''}
                  onChange={(e) => setEditingAgent({ ...editingAgent, description: e.target.value })}
                  className="input min-h-[100px]"
                  placeholder="Short description (shown on cards)"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">Long Description</label>
                <textarea
                  value={editingAgent.longDescription || ''}
                  onChange={(e) => setEditingAgent({ ...editingAgent, longDescription: e.target.value })}
                  className="input min-h-[200px]"
                  placeholder="Full detailed description (shown on details page)"
                />
                <p className="text-xs text-gray-500 mt-1">This will be displayed on the agent details page</p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">Price ($)</label>
                  <input
                    type="number"
                    value={editingAgent.price || 0}
                    onChange={(e) => setEditingAgent({ ...editingAgent, price: parseFloat(e.target.value) || 0 })}
                    className="input"
                    placeholder="0"
                    min="0"
                    step="0.01"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">Category</label>
                  <input
                    type="text"
                    value={editingAgent.category || ''}
                    onChange={(e) => setEditingAgent({ ...editingAgent, category: e.target.value })}
                    className="input"
                    placeholder="Trading"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">Image URL</label>
                <input
                  type="url"
                  value={editingAgent.imageUrl || ''}
                  onChange={(e) => handleImageUrlChange(e.target.value)}
                  className="input"
                  placeholder="https://example.com/image.jpg"
                />
                {editingAgent.imageUrl && (
                  <div className="mt-2">
                    <img
                      src={editingAgent.imageUrl}
                      alt="Preview"
                      className="w-32 h-32 object-cover rounded-lg border border-purple-500/30"
                      onError={(e) => {
                        const target = e.target as HTMLImageElement;
                        target.style.display = 'none';
                      }}
                    />
                  </div>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">Badge (optional)</label>
                <input
                  type="text"
                  value={editingAgent.badge || ''}
                  onChange={(e) => setEditingAgent({ ...editingAgent, badge: e.target.value })}
                  className="input"
                  placeholder="Premium, New, etc."
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">WhatsApp Number</label>
                <input
                  type="text"
                  value={editingAgent.whatsappNumber || ''}
                  onChange={(e) => setEditingAgent({ ...editingAgent, whatsappNumber: e.target.value })}
                  className="input"
                  placeholder="9155604591"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">Features (one per line)</label>
                <textarea
                  value={editingAgent.features?.join('\n') || ''}
                  onChange={(e) => {
                    const features = e.target.value.split('\n').filter(f => f.trim());
                    setEditingAgent({ ...editingAgent, features });
                  }}
                  className="input min-h-[100px]"
                  placeholder="Feature 1&#10;Feature 2&#10;Feature 3"
                />
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="enabled"
                  checked={editingAgent.enabled !== false}
                  onChange={(e) => setEditingAgent({ ...editingAgent, enabled: e.target.checked })}
                  className="w-4 h-4 rounded border-purple-500/30 bg-slate-800 text-purple-500"
                />
                <label htmlFor="enabled" className="text-sm text-gray-300">Agent Enabled</label>
              </div>

              <div className="flex gap-3 pt-4">
                <button
                  onClick={handleSaveEdit}
                  className="btn btn-primary flex-1"
                >
                  💾 Save Changes
                </button>
                <button
                  onClick={() => {
                    setShowEditModal(false);
                    setEditingAgent({});
                  }}
                  className="btn btn-secondary flex-1"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Users Modal */}
      {showUsersModal && selectedAgent && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="card max-w-2xl w-full max-h-[80vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold text-white">
                Users who unlocked: {selectedAgent.name}
              </h2>
              <button
                onClick={() => {
                  setShowUsersModal(false);
                  setSelectedAgent(null);
                  setAgentUsers([]);
                }}
                className="text-gray-400 hover:text-white text-2xl"
              >
                ✕
              </button>
            </div>
            {agentUsers.length === 0 ? (
              <div className="text-center text-gray-400 py-8">
                No users have unlocked this agent yet
              </div>
            ) : (
              <div className="space-y-2">
                {agentUsers.map((user, idx) => (
                  <div
                    key={idx}
                    className="p-3 bg-slate-700/30 rounded-lg flex items-center justify-between"
                  >
                    <div>
                      <div className="text-white font-medium">{user.email || 'N/A'}</div>
                      <div className="text-gray-400 text-sm font-mono">{user.uid.substring(0, 12)}...</div>
                    </div>
                    <div className="text-gray-400 text-xs">
                      {user.unlockedAt ? new Date(user.unlockedAt).toLocaleDateString() : 'N/A'}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {toast && <Toast message={toast.message} type={toast.type} />}
    </div>
  );
}
