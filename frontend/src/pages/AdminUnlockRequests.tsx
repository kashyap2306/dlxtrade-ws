import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import Toast from '../components/Toast';
import { useAuth } from '../hooks/useAuth';
import { adminApi } from '../services/api';

interface UnlockRequest {
  id: string;
  uid: string;
  userEmail: string;
  agentId: string;
  agentName: string;
  fullName: string;
  phoneNumber: string;
  email: string;
  submittedAt: string;
  status: string;
}

export default function AdminUnlockRequests() {
  const { logout } = useAuth();
  const navigate = useNavigate();
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [requests, setRequests] = useState<UnlockRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [denyReason, setDenyReason] = useState<Record<string, string>>({});
  const [showDenyModal, setShowDenyModal] = useState<string | null>(null);

  useEffect(() => {
    loadRequests();
    const interval = setInterval(loadRequests, 10000); // Refresh every 10 seconds
    return () => clearInterval(interval);
  }, []);

  const loadRequests = async () => {
    try {
      const response = await adminApi.getUnlockRequests();
      setRequests(response.data.requests || []);
    } catch (err: any) {
      if (err.response?.status === 403) {
        showToast('Admin access required', 'error');
        navigate('/admin-login');
      } else {
        showToast(err.response?.data?.error || 'Error loading unlock requests', 'error');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleApprove = async (requestId: string) => {
    setProcessingId(requestId);
    try {
      await adminApi.approveUnlockRequest(requestId);
      showToast('Unlock request approved successfully', 'success');
      await loadRequests();
    } catch (err: any) {
      showToast(err.response?.data?.error || 'Error approving request', 'error');
    } finally {
      setProcessingId(null);
    }
  };

  const handleDeny = async (requestId: string) => {
    setProcessingId(requestId);
    try {
      const reason = denyReason[requestId] || 'No reason provided';
      await adminApi.denyUnlockRequest(requestId, reason);
      showToast('Unlock request denied', 'success');
      setShowDenyModal(null);
      setDenyReason({ ...denyReason, [requestId]: '' });
      await loadRequests();
    } catch (err: any) {
      showToast(err.response?.data?.error || 'Error denying request', 'error');
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
            <p className="text-gray-400 text-lg">No pending unlock requests</p>
            <p className="text-gray-500 text-sm mt-2">All requests have been processed</p>
          </div>
        ) : (
          <div className="space-y-4">
            {requests.map((request) => (
              <div
                key={request.id}
                className="card"
              >
                <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
                  <div className="flex-1">
                    <div className="flex items-start gap-4 mb-4">
                      <div className="flex-1">
                        <h3 className="text-xl font-bold text-white mb-2">{request.agentName}</h3>
                        <div className="space-y-1 text-sm">
                          <div className="flex items-center gap-2">
                            <span className="text-gray-400">User:</span>
                            <span className="text-gray-300">{request.userEmail}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-gray-400">Name:</span>
                            <span className="text-gray-300">{request.fullName}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-gray-400">Phone:</span>
                            <span className="text-gray-300">{request.phoneNumber}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-gray-400">Email:</span>
                            <span className="text-gray-300">{request.email}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-gray-400">Submitted:</span>
                            <span className="text-gray-300">
                              {new Date(request.submittedAt).toLocaleString()}
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
                      onClick={() => setShowDenyModal(request.id)}
                      disabled={processingId === request.id}
                      className="btn btn-danger flex-1 disabled:opacity-50"
                    >
                      ✗ Deny
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Deny Modal */}
      {showDenyModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-gradient-to-br from-slate-800/95 via-slate-800/95 to-slate-900/95 backdrop-blur-xl border-2 border-red-500/30 rounded-2xl shadow-2xl max-w-md w-full">
            <div className="p-6">
              <h2 className="text-2xl font-bold text-white mb-4">Deny Unlock Request</h2>
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Reason (optional)
                </label>
                <textarea
                  value={denyReason[showDenyModal] || ''}
                  onChange={(e) => setDenyReason({ ...denyReason, [showDenyModal]: e.target.value })}
                  className="input w-full min-h-[100px]"
                  placeholder="Enter reason for denial..."
                />
              </div>
              <div className="flex gap-3">
                <button
                  onClick={() => handleDeny(showDenyModal)}
                  disabled={processingId === showDenyModal}
                  className="btn btn-danger flex-1 disabled:opacity-50"
                >
                  {processingId === showDenyModal ? 'Processing...' : 'Confirm Deny'}
                </button>
                <button
                  onClick={() => {
                    setShowDenyModal(null);
                    setDenyReason({ ...denyReason, [showDenyModal]: '' });
                  }}
                  disabled={processingId === showDenyModal}
                  className="btn btn-secondary disabled:opacity-50"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {toast && <Toast message={toast.message} type={toast.type} />}
    </div>
  );
}

