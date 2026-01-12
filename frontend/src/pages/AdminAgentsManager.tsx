import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Toast from '../components/Toast';
import { useAuth } from '../hooks/useAuth';
import { doc, getDoc, updateDoc, arrayUnion } from 'firebase/firestore';
import { db } from '../config/firebase-config';

interface AgentAccessForm {
  userEmail: string;
  tradingAgent: boolean;
  copyTradingAgent: boolean;
}

const AVAILABLE_AGENTS = [
  {
    id: 'TRADING_AGENT',
    name: 'Rule-Based Trading Agent',
    description: 'Automated trading with RSI/Bollinger Bands strategy'
  },
  {
    id: 'COPY_TRADING_AGENT',
    name: 'Crowd Consensus Copy Trade Agent',
    description: 'Follows crowd consensus across exchanges'
  }
];

export default function AdminAgentsManager() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState<AgentAccessForm>({
    userEmail: '',
    tradingAgent: false,
    copyTradingAgent: false
  });

  const handleGrantAccess = async () => {
    if (!user) return;

    const { userEmail, tradingAgent, copyTradingAgent } = form;
    if (!userEmail.trim() || (!tradingAgent && !copyTradingAgent)) {
      showToast('Please enter user email and select at least one agent', 'error');
      return;
    }

    setLoading(true);
    try {
      // First, find the user by email (we need to query users by email)
      // Note: This is a simplified approach - in a real app you'd have a backend endpoint
      // For now, we'll assume we can find the user by email through a search
      // In practice, you'd want a backend endpoint that can find users by email

      // NOTE: This feature requires a backend endpoint for secure user lookup by email
      // The backend endpoint should be: POST /admin/users/find-by-email
      // It should only be accessible to admin users and return the user ID for the given email

      showToast('Agent Access feature requires backend implementation for secure user lookup', 'error');

      // When implemented properly, the logic would be:
      // 1. Call adminApi.findUserByEmail(userEmail) to get user ID
      // 2. Get user document
      // 3. Update unlockedAgents array
      // 4. Prevent duplicates

      /*
      const userDoc = await getDoc(doc(db, 'users', userId));
      if (userDoc.exists()) {
        const userData = userDoc.data();
        const currentAgents: string[] = userData?.unlockedAgents || [];
        const agentsToAdd: string[] = [];

        if (tradingAgent && !currentAgents.includes('TRADING_AGENT')) {
          agentsToAdd.push('TRADING_AGENT');
        }
        if (copyTradingAgent && !currentAgents.includes('COPY_TRADING_AGENT')) {
          agentsToAdd.push('COPY_TRADING_AGENT');
        }

        if (agentsToAdd.length > 0) {
          await updateDoc(doc(db, 'users', userId), {
            unlockedAgents: arrayUnion(...agentsToAdd)
          });
          showToast(`Agent access granted to ${userEmail}`, 'success');
          setForm({ userEmail: '', tradingAgent: false, copyTradingAgent: false });
        } else {
          showToast('User already has selected agents', 'error');
        }
      } else {
        showToast('User not found', 'error');
      }
      */

    } catch (err: any) {
      console.error('Error granting access:', err);
      showToast('Error granting agent access', 'error');
    } finally {
      setLoading(false);
    }
  };

  const showToast = (message: string, type: 'success' | 'error') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900/20 to-slate-900">
      <div className="p-4 sm:p-6 lg:p-8">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-6 gap-4">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold bg-gradient-to-r from-purple-400 to-pink-400 bg-clip-text text-transparent">
              Agent Access
            </h1>
            <p className="text-gray-400 text-sm mt-1">Grant agent access to users directly</p>
          </div>
          <button
            onClick={() => navigate('/admin')}
            className="btn btn-secondary whitespace-nowrap"
          >
            ← Back to Dashboard
          </button>
        </div>

        <div className="max-w-2xl mx-auto">
          <div className="card">
            <h2 className="text-xl font-bold text-white mb-6">Grant Agent Access</h2>

            <div className="space-y-6">
              {/* User Email Input */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  User Email
                </label>
                <input
                  type="email"
                  value={form.userEmail}
                  onChange={(e) => setForm({ ...form, userEmail: e.target.value })}
                  className="input w-full"
                  placeholder="user@example.com"
                />
              </div>

              {/* Agent Selection */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-4">
                  Select Agents to Grant
                </label>
                <div className="space-y-3">
                  {AVAILABLE_AGENTS.map((agent) => (
                    <div key={agent.id} className="flex items-center justify-between p-4 bg-slate-700/30 rounded-lg border border-purple-500/20">
                      <div className="flex-1">
                        <h3 className="text-white font-medium">{agent.name}</h3>
                        <p className="text-gray-400 text-sm">{agent.description}</p>
                      </div>
                      <label className="flex items-center cursor-pointer">
                        <input
                          type="checkbox"
                          checked={agent.id === 'TRADING_AGENT' ? form.tradingAgent : form.copyTradingAgent}
                          onChange={(e) => {
                            if (agent.id === 'TRADING_AGENT') {
                              setForm({ ...form, tradingAgent: e.target.checked });
                            } else {
                              setForm({ ...form, copyTradingAgent: e.target.checked });
                            }
                          }}
                          className="w-5 h-5 rounded border-purple-500/30 bg-slate-800 text-purple-500 focus:ring-purple-500/50"
                        />
                      </label>
                    </div>
                  ))}
                </div>
              </div>

              {/* Grant Access Button */}
              <button
                onClick={handleGrantAccess}
                disabled={loading || !form.userEmail.trim() || (!form.tradingAgent && !form.copyTradingAgent)}
                className="btn btn-primary w-full disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin mr-2"></div>
                    Granting Access...
                  </>
                ) : (
                  '🎯 Grant Access'
                )}
              </button>

              <div className="text-sm text-gray-400 bg-slate-800/30 p-4 rounded-lg">
                <p className="font-medium mb-2">How it works:</p>
                <ul className="space-y-1 text-xs">
                  <li>• Find user by email address</li>
                  <li>• Add selected agents to user's unlockedAgents array</li>
                  <li>• User will see agents in sidebar immediately</li>
                  <li>• Prevents duplicate agent assignments</li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </div>

      {toast && <Toast message={toast.message} type={toast.type} />}
    </div>
  );
}
