import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import Toast from '../components/Toast';
import { useAuth } from '../hooks/useAuth';
import { collection, query, where, getDocs, doc, updateDoc, getDoc, arrayUnion } from 'firebase/firestore';
import { db } from '../config/firebase-config';

interface AgentRequest {
  id: string;
  agentId: string;
  agentType: 'TRADING' | 'COPY';
  requestedBy: string;
  status: 'PENDING_APPROVAL' | 'APPROVED' | 'REJECTED';
  createdAt: any;
  approvedBy?: string;
  approvedAt?: any;
}

// Agent details for display
const AGENT_DETAILS: Record<string, { name: string; description: string }> = {
  'TRADING_AGENT': {
    name: 'Rule-Based Trading Agent',
    description: 'Fully automated trading agent with RSI/Bollinger Bands strategy'
  },
  'COPY_TRADING_AGENT': {
    name: 'Crowd Consensus Copy Trade Agent',
    description: 'Follows crowd consensus across 10+ exchanges'
  }
};

export default function AdminUnlockRequests() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [requests, setRequests] = useState<AgentRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [userEmails, setUserEmails] = useState<Record<string, string>>({});

  useEffect(() => {
    loadRequests();
    const interval = setInterval(loadRequests, 10000); // Refresh every 10 seconds
    return () => clearInterval(interval);
  }, []);

  const loadRequests = async () => {
    try {
      // Get pending agent requests
      const q = query(collection(db, 'agentRequests'), where('status', '==', 'PENDING_APPROVAL'));
      const querySnapshot = await getDocs(q);

      const pendingRequests: AgentRequest[] = [];
      const userIds = new Set<string>();

      querySnapshot.forEach((doc) => {
        const data = doc.data() as Omit<AgentRequest, 'id'>;
        pendingRequests.push({ id: doc.id, ...data });
        userIds.add(data.requestedBy);
      });

      // Get user emails for display
      const emailMap: Record<string, string> = {};
      for (const userId of userIds) {
        try {
          const userDoc = await getDoc(doc(db, 'users', userId));
          if (userDoc.exists()) {
            const userData = userDoc.data();
            emailMap[userId] = userData?.email || 'Unknown';
          }
        } catch (error) {
          console.warn('Failed to load user data for', userId);
        }
      }

      setRequests(pendingRequests);
      setUserEmails(emailMap);
    } catch (err: any) {
      console.error('Error loading requests:', err);
      showToast('Error loading unlock requests', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleApprove = async (requestId: string) => {
    if (!user) return;

    setProcessingId(requestId);
    try {
      const request = requests.find(r => r.id === requestId);
      if (!request) return;

      // Update the request status
      await updateDoc(doc(db, 'agentRequests', requestId), {
        status: 'APPROVED',
        approvedBy: user.uid,
        approvedAt: new Date()
      });

      // Add agent to user's unlockedAgents array (avoid duplicates)
      const userRef = doc(db, 'users', request.requestedBy);
      const userDoc = await getDoc(userRef);

      if (userDoc.exists()) {
        const userData = userDoc.data();
        const currentAgents: string[] = userData?.unlockedAgents || [];

        if (!currentAgents.includes(request.agentId)) {
          await updateDoc(userRef, {
            unlockedAgents: arrayUnion(request.agentId)
          });
        }
      }

      showToast('Agent access request approved successfully', 'success');
      await loadRequests();
    } catch (err: any) {
      console.error('Error approving request:', err);
      showToast('Error approving request', 'error');
    } finally {
      setProcessingId(null);
    }
  };

  const handleDeny = async (requestId: string) => {
    if (!user) return;

    setProcessingId(requestId);
    try {
      await updateDoc(doc(db, 'agentRequests', requestId), {
        status: 'REJECTED',
        approvedBy: user.uid,
        approvedAt: new Date()
      });

      showToast('Agent request denied', 'success');
      await loadRequests();
    } catch (err: any) {
      console.error('Error denying request:', err);
      showToast('Error denying request', 'error');
    } finally {
      setProcessingId(null);
    }
  };

  const showToast = (message: string, type: 'success' | 'error') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900/20 to-slate-900 flex items-center justify-center">
        <div className="text-lg text-gray-300">Loading unlock requests...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900/20 to-slate-900">
      <div className="p-4 sm:p-6 lg:p-8">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-6 gap-4">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold bg-gradient-to-r from-purple-400 to-pink-400 bg-clip-text text-transparent">
              Unlock Requests
            </h1>
            <p className="text-gray-400 text-sm mt-1">Approve or deny agent unlock requests</p>
          </div>
          <button
            onClick={() => navigate('/admin/agents')}
            className="btn btn-secondary whitespace-nowrap"
          >
            ← Back to Agents Manager
          </button>
        </div>

        {requests.length === 0 ? (
          <div className="card text-center py-12">
            <p className="text-gray-400 text-lg">No pending agent requests</p>
            <p className="text-gray-500 text-sm mt-2">All requests have been processed</p>
          </div>
        ) : (
          <div className="space-y-4">
            {requests.map((request) => {
              const agentDetail = AGENT_DETAILS[request.agentId];
              return (
                <div
                  key={request.id}
                  className="card"
                >
                  <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
                    <div className="flex-1">
                      <div className="flex items-start gap-4 mb-4">
                        <div className="flex-1">
                          <h3 className="text-xl font-bold text-white mb-2">
                            {agentDetail?.name || request.agentId}
                          </h3>
                          <div className="space-y-1 text-sm">
                            <div className="flex items-center gap-2">
                              <span className="text-gray-400">Agent ID:</span>
                              <span className="text-gray-300">{request.agentId}</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-gray-400">Type:</span>
                              <span className="text-gray-300">{request.agentType}</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-gray-400">User Email:</span>
                              <span className="text-gray-300">{userEmails[request.requestedBy] || 'Loading...'}</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-gray-400">User ID:</span>
                              <span className="text-gray-300">{request.requestedBy}</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-gray-400">Requested:</span>
                              <span className="text-gray-300">
                                {request.createdAt?.toDate?.()?.toLocaleString() || 'Unknown'}
                              </span>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                    <div className="flex gap-2 lg:flex-col">
                      <button
                        onClick={() => handleApprove(request.id)}
                        disabled={processingId === request.id}
                        className="btn btn-primary flex-1 disabled:opacity-50"
                      >
                        {processingId === request.id ? 'Processing...' : '✓ Approve'}
                      </button>
                      <button
                        onClick={() => handleDeny(request.id)}
                        disabled={processingId === request.id}
                        className="btn btn-danger flex-1 disabled:opacity-50"
                      >
                        ✗ Deny
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>


      {toast && <Toast message={toast.message} type={toast.type} />}
    </div>
  );
}

