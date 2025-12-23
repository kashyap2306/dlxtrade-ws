import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { agentsApi } from '../services/api';
import { db } from '../config/firebase';
import { doc, getDoc } from 'firebase/firestore';
import { ErrorBoundary } from '../components/ErrorBoundary';
import Toast from '../components/Toast';

export default function AgentDashboard() {
  const { agentId } = useParams<{ agentId: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [agent, setAgent] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  useEffect(() => {
    if (!user || !agentId) return;

    const loadAgent = async () => {
      try {
        // Check if agent is unlocked
        const agentDoc = await getDoc(doc(db, 'users', user.uid, 'agents', agentId));
        const agentData = agentDoc.data();

        if (!agentData || !agentData.unlocked) {
          // Agent not unlocked, redirect to agents page
          navigate('/agents');
          return;
        }

        // Load agent metadata
        try {
          const agentResponse = await agentsApi.get(agentId);
          setAgent(agentResponse.data.agent || { name: agentId, id: agentId });
        } catch (err) {
          // If agent not found in global collection, use basic info
          setAgent({ name: agentId, id: agentId });
        }
      } catch (err: any) {
        console.error('Error loading agent:', err);
        setToast({ message: 'Failed to load agent', type: 'error' });
      } finally {
        setLoading(false);
      }
    };

    loadAgent();
  }, [user, agentId, navigate]);

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-500"></div>
      </div>
    );
  }

  if (!agent) {
    return null;
  }

  return (
    <ErrorBoundary>
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900">
        <div className="container mx-auto px-4 py-8">
          {/* Header */}
          <div className="mb-8">
            <h1 className="text-3xl sm:text-4xl font-bold bg-gradient-to-r from-purple-300 via-pink-300 to-cyan-300 bg-clip-text text-transparent mb-2">
              {agent.name || agentId}
            </h1>
            <p className="text-gray-400">Agent Dashboard - Coming Soon</p>
          </div>

          {/* Required API Setup Section */}
          <div className="bg-slate-800/40 backdrop-blur-xl border border-purple-500/20 rounded-xl p-6 mb-6">
            <h2 className="text-xl font-semibold text-white mb-4">Required API Setup</h2>
            <div className="space-y-4">
              <div className="bg-slate-900/50 rounded-lg p-4 border border-purple-500/10">
                <div className="flex items-center gap-3 mb-2">
                  <div className="w-8 h-8 rounded-lg bg-yellow-500/20 flex items-center justify-center">
                    <svg className="w-4 h-4 text-yellow-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                  </div>
                  <div className="text-sm font-medium text-white">API Configuration Required</div>
                </div>
                <p className="text-sm text-gray-400">
                  This agent requires API keys to be configured before it can be used. Please set up your API keys in Settings.
                </p>
              </div>
            </div>
          </div>

          {/* Disabled Features Section */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
            {/* Auto Trade */}
            <div className="bg-slate-800/40 backdrop-blur-xl border border-purple-500/20 rounded-xl p-6 opacity-50">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-lg bg-green-500/20 flex items-center justify-center">
                  <svg className="w-5 h-5 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                </div>
                <h3 className="text-lg font-semibold text-white">Auto Trade</h3>
              </div>
              <p className="text-sm text-gray-400 mb-4">Automated trading functionality</p>
              <button
                disabled
                className="w-full px-4 py-2 text-sm font-medium text-gray-500 bg-slate-700/50 border border-slate-600/50 rounded-lg cursor-not-allowed"
              >
                Coming Soon
              </button>
            </div>

            {/* Deep Research */}
            <div className="bg-slate-800/40 backdrop-blur-xl border border-purple-500/20 rounded-xl p-6 opacity-50">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-lg bg-blue-500/20 flex items-center justify-center">
                  <svg className="w-5 h-5 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                  </svg>
                </div>
                <h3 className="text-lg font-semibold text-white">Deep Research</h3>
              </div>
              <p className="text-sm text-gray-400 mb-4">Advanced research capabilities</p>
              <button
                disabled
                className="w-full px-4 py-2 text-sm font-medium text-gray-500 bg-slate-700/50 border border-slate-600/50 rounded-lg cursor-not-allowed"
              >
                Coming Soon
              </button>
            </div>

            {/* Manual Research */}
            <div className="bg-slate-800/40 backdrop-blur-xl border border-purple-500/20 rounded-xl p-6 opacity-50">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-lg bg-orange-500/20 flex items-center justify-center">
                  <svg className="w-5 h-5 text-orange-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 100 4m0-4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 100 4m0-4v2m0-6V4" />
                  </svg>
                </div>
                <h3 className="text-lg font-semibold text-white">Manual Research</h3>
              </div>
              <p className="text-sm text-gray-400 mb-4">Manual research tools</p>
              <button
                disabled
                className="w-full px-4 py-2 text-sm font-medium text-gray-500 bg-slate-700/50 border border-slate-600/50 rounded-lg cursor-not-allowed"
              >
                Coming Soon
              </button>
            </div>
          </div>

          {/* Info Banner */}
          <div className="bg-blue-900/20 border border-blue-500/30 rounded-xl p-4">
            <div className="flex items-start gap-3">
              <svg className="w-5 h-5 text-blue-400 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <div>
                <h4 className="text-sm font-medium text-blue-300 mb-1">Feature Coming Soon</h4>
                <p className="text-sm text-blue-200/80">
                  This agent dashboard is currently under development. Trading and research features will be available soon.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
      {toast && <Toast message={toast.message} type={toast.type} />}
    </ErrorBoundary>
  );
}
