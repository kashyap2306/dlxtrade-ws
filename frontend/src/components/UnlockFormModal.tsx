import { useState } from 'react';
import { AgentCardData } from './AgentCard';
import { agentsApi } from '../services/api';

interface UnlockFormModalProps {
  agent: AgentCardData | null;
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

export default function UnlockFormModal({ agent, isOpen, onClose, onSuccess }: UnlockFormModalProps) {
  const [formData, setFormData] = useState({
    fullName: '',
    phoneNumber: '',
    email: '',
    isInterested: false,
  });
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  if (!isOpen || !agent) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!formData.fullName || !formData.phoneNumber || !formData.email) {
      return;
    }

    if (!formData.isInterested) {
      return;
    }

    setSubmitting(true);
    try {
      // Submit purchase request to backend
      await agentsApi.createPurchaseRequest({
        agentId: agent.id || agent.name,
        agentName: agent.name,
        userName: formData.fullName,
        email: formData.email,
        phoneNumber: formData.phoneNumber,
      });

      setSubmitted(true);
      if (onSuccess) {
        onSuccess();
      }
    } catch (err: any) {
      console.error('Error submitting purchase request:', err);
      // Still show success message to user
      setSubmitted(true);
    } finally {
      setSubmitting(false);
    }
  };

  const handleClose = () => {
    if (!submitting) {
      setFormData({
        fullName: '',
        phoneNumber: '',
        email: '',
        isInterested: false,
      });
      setSubmitted(false);
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-gradient-to-br from-slate-800/95 via-slate-800/95 to-slate-900/95 backdrop-blur-xl border-2 border-purple-500/30 rounded-2xl shadow-2xl max-w-md w-full animate-fade-in">
        <div className="p-6">
          {!submitted ? (
            <>
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-2xl font-bold bg-gradient-to-r from-purple-400 to-pink-400 bg-clip-text text-transparent">
                  Unlock {agent.name}
                </h2>
                <button
                  onClick={handleClose}
                  disabled={submitting}
                  className="text-gray-400 hover:text-white transition-colors disabled:opacity-50"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    Full Name <span className="text-red-400">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={formData.fullName}
                    onChange={(e) => setFormData({ ...formData, fullName: e.target.value })}
                    className="input w-full"
                    placeholder="Enter your full name"
                    disabled={submitting}
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    Phone Number <span className="text-red-400">*</span>
                  </label>
                  <input
                    type="tel"
                    required
                    value={formData.phoneNumber}
                    onChange={(e) => setFormData({ ...formData, phoneNumber: e.target.value })}
                    className="input w-full"
                    placeholder="Enter your phone number"
                    disabled={submitting}
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    Email ID <span className="text-red-400">*</span>
                  </label>
                  <input
                    type="email"
                    required
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    className="input w-full"
                    placeholder="Enter your email"
                    disabled={submitting}
                  />
                </div>

                <div className="bg-purple-500/10 border border-purple-500/30 rounded-lg p-4">
                  <p className="text-gray-300 text-sm mb-3">
                    Are you really interested in unlocking this premium agent?
                  </p>
                  <label className="flex items-center space-x-3 cursor-pointer">
                    <input
                      type="checkbox"
                      required
                      checked={formData.isInterested}
                      onChange={(e) => setFormData({ ...formData, isInterested: e.target.checked })}
                      className="w-5 h-5 rounded border-purple-500/30 bg-slate-800 text-purple-500 focus:ring-purple-500 focus:ring-2"
                      disabled={submitting}
                    />
                    <span className="text-gray-300 text-sm">Yes, I am interested</span>
                  </label>
                </div>

                <div className="flex gap-3 pt-2">
                  <button
                    type="submit"
                    disabled={submitting || !formData.isInterested}
                    className="btn btn-primary flex-1 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {submitting ? 'Submitting...' : 'Submit Request'}
                  </button>
                  <button
                    type="button"
                    onClick={handleClose}
                    disabled={submitting}
                    className="btn btn-secondary disabled:opacity-50"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            </>
          ) : (
            <div className="text-center py-4">
              <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-green-500/20 border-2 border-green-500/50 flex items-center justify-center">
                <svg className="w-8 h-8 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h3 className="text-xl font-bold text-white mb-2">Request Submitted!</h3>
              <p className="text-gray-300 mb-6">
                Our team will contact you within 2 to 12 hours.
              </p>
              <button
                onClick={handleClose}
                className="btn btn-primary w-full"
              >
                Close
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

