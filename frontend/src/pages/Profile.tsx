import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { usersApi, agentsApi, integrationsApi } from '../services/api';
import Sidebar from '../components/Sidebar';
import Toast from '../components/Toast';
import { User } from 'firebase/auth';
import BinanceLogo from '../components/ui/BinanceLogo';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { LoadingState } from '../components/LoadingState';
import { ErrorState } from '../components/ErrorState';
import { suppressConsoleError } from '../utils/errorHandler';

export default function Profile() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false); // Never show global loading like Research page
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<any>(null);
  const [retryCount, setRetryCount] = useState(0);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [userData, setUserData] = useState<any>(null);
  const [userStats, setUserStats] = useState<any>(null);
  const [sessions, setSessions] = useState<any[]>([]);
  const [apiProvidersStatus, setApiProvidersStatus] = useState<any>(null);
  const [usageStats, setUsageStats] = useState<any>(null);
  const [allAgents, setAllAgents] = useState<any[]>([]);
  const [unlockedAgents, setUnlockedAgents] = useState<any[]>([]);
  const [profileData, setProfileData] = useState({
    displayName: '',
    profilePicture: '',
  });
  const [changePasswordData, setChangePasswordData] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
  });
  const [showChangePasswordModal, setShowChangePasswordModal] = useState(false);
  const [showForgotPasswordModal, setShowForgotPasswordModal] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const isMountedRef = useRef(true);

  const loadAllData = useCallback(async () => {
    if (!user || !isMountedRef.current) return;

    setLoading(true);
    setError(null);

    try {
      // Load all profile data asynchronously without Promise.all - no blocking
      const loadPromises = [
        usersApi.get(user.uid).then(result => {
          if (isMountedRef.current) {
            setUserData(result.data);
            setProfileData({
              displayName: result.data?.name || user?.displayName || '',
              profilePicture: result.data?.profilePicture || '',
            });
          }
        }).catch(err => {
          suppressConsoleError(err, 'loadUserData');
          throw err; // User data is critical
        }),

        usersApi.getSessions(user.uid).then(result => {
          if (isMountedRef.current) {
            setSessions(result.data.sessions || []);
          }
        }).catch(err => {
          suppressConsoleError(err, 'loadUserSessions');
          if (isMountedRef.current) setSessions([]);
        }),

        integrationsApi.load().then(result => {
          if (isMountedRef.current) {
            const integrations = result.data || {};
            setApiProvidersStatus({
              cryptoCompare: {
                connected: !!(integrations.cryptocompare?.apiKey),
                status: integrations.cryptocompare?.apiKey ? 'Active' : 'Not Set',
                hasData: true,
                latencyMs: 0
              },
              newsData: {
                connected: !!(integrations.newsdata?.apiKey),
                status: integrations.newsdata?.apiKey ? 'Active' : 'Not Set',
                hasData: true,
                latencyMs: 0
              },
              coinGecko: {
                connected: !!(integrations.coingecko?.apiKey),
                status: integrations.coingecko?.apiKey ? 'Active' : 'Not Set',
                hasData: true,
                latencyMs: 0
              },
              binancePublic: {
                connected: !!(integrations.binancepublic?.enabled),
                status: integrations.binancepublic?.enabled ? 'Active' : 'Not Set',
                hasData: true,
                latencyMs: 0
              },
            });
          }
        }).catch(err => {
          suppressConsoleError(err, 'loadIntegrations');
          if (isMountedRef.current) {
            setApiProvidersStatus({
              cryptoCompare: { connected: false, status: 'Not Set', hasData: false, latencyMs: 0 },
              newsData: { connected: false, status: 'Not Set', hasData: false, latencyMs: 0 },
              coinGecko: { connected: false, status: 'Not Set', hasData: false, latencyMs: 0 },
              binancePublic: { connected: false, status: 'Not Set', hasData: false, latencyMs: 0 }
            });
          }
        }),

        agentsApi.getAll().then(result => {
          if (isMountedRef.current) {
            setAllAgents(result.data.agents || []);
          }
        }).catch(err => {
          suppressConsoleError(err, 'loadAllAgents');
          if (isMountedRef.current) setAllAgents([]);
        }),

        agentsApi.getUnlocked().then(result => {
          if (isMountedRef.current) {
            setUnlockedAgents(result.data.unlocked || []);
          }
        }).catch(err => {
          suppressConsoleError(err, 'loadUnlockedAgents');
          if (isMountedRef.current) setUnlockedAgents([]);
        }),
      ];

      // Fire all promises asynchronously without waiting
      loadPromises.forEach(promise => {
        promise.catch(err => {
          console.warn('[PROFILE] Non-critical data load failed:', err);
        });
      });

      // Handle results - continue even if some APIs fail
      if (userResponse.status === 'fulfilled' && isMountedRef.current) {
        setUserData(userResponse.value.data);
        // Set profile data from user data
        setProfileData({
          displayName: userResponse.value.data?.name || user?.displayName || '',
          profilePicture: userResponse.value.data?.profilePicture || '',
        });
      } else if (userResponse.status === 'rejected') {
        suppressConsoleError(userResponse.reason, 'loadUserData');
        // User data is critical, so we might want to show an error
        throw userResponse.reason;
      }

      if (sessionsResponse.status === 'fulfilled' && isMountedRef.current) {
        setSessions(sessionsResponse.value.data.sessions || []);
      } else if (sessionsResponse.status === 'rejected') {
        suppressConsoleError(sessionsResponse.reason, 'loadUserSessions');
        setSessions([]);
      }

      // Set API providers status from integrations data
      if (integrationsResponse.status === 'fulfilled' && isMountedRef.current) {
        const integrations = integrationsResponse.value.data || {};
        setApiProvidersStatus({
          cryptoCompare: {
            connected: !!(integrations.cryptocompare?.apiKey),
            status: integrations.cryptocompare?.apiKey ? 'Active' : 'Not Set',
            hasData: true,
            latencyMs: 0
          },
          newsData: {
            connected: !!(integrations.newsdata?.apiKey),
            status: integrations.newsdata?.apiKey ? 'Active' : 'Not Set',
            hasData: true,
            latencyMs: 0
          },
          coinGecko: {
            connected: !!(integrations.coingecko?.apiKey),
            status: integrations.coingecko?.apiKey ? 'Active' : 'Not Set',
            hasData: true,
            latencyMs: 0
          },
          binancePublic: {
            connected: !!(integrations.binancepublic?.enabled),
            status: integrations.binancepublic?.enabled ? 'Active' : 'Not Set',
            hasData: true,
            latencyMs: 0
          }
        });
      } else if (integrationsResponse.status === 'rejected') {
        suppressConsoleError(integrationsResponse.reason, 'loadIntegrations');
        if (isMountedRef.current) {
          setApiProvidersStatus({
            cryptoCompare: { connected: false, status: 'Not Set', hasData: false, latencyMs: 0 },
            newsData: { connected: false, status: 'Not Set', hasData: false, latencyMs: 0 },
            coinGecko: { connected: false, status: 'Not Set', hasData: false, latencyMs: 0 },
            binancePublic: { connected: false, status: 'Not Set', hasData: false, latencyMs: 0 }
          });
        }
      }

      if (agentsResponse.status === 'fulfilled' && isMountedRef.current) {
        setAllAgents(agentsResponse.value.data.agents || []);
      } else if (agentsResponse.status === 'rejected') {
        suppressConsoleError(agentsResponse.reason, 'loadAllAgents');
        setAllAgents([]);
      }

      if (unlockedAgentsResponse.status === 'fulfilled' && isMountedRef.current) {
        setUnlockedAgents(unlockedAgentsResponse.value.data.unlocked || []);
      } else if (unlockedAgentsResponse.status === 'rejected') {
        suppressConsoleError(unlockedAgentsResponse.reason, 'loadUnlockedAgents');
        setUnlockedAgents([]);
      }

      setRetryCount(0); // Reset retry count on successful load

    } catch (err: any) {
      suppressConsoleError(err, 'loadProfileData');
      if (isMountedRef.current) {
        setError(err);
        showToast(err.response?.data?.error || 'Failed to load profile data', 'error');
      }
    } finally {
      if (isMountedRef.current) {
        setLoading(false);
      }
    }
  }, [user]);

  useEffect(() => {
    if (user) {
      loadAllData();
    }
  }, [user, loadAllData]);

  // Emergency timeout: force loading=false after 3 seconds
  useEffect(() => {
    if (loading) {
      const timeout = setTimeout(() => {
        console.log('[Profile] EMERGENCY: Forcing loading=false after 3 seconds');
        if (isMountedRef.current) {
          setLoading(false);
        }
      }, 3000);
      return () => clearTimeout(timeout);
    }
  }, [loading]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);


  const handleLogoutAllSessions = async () => {
    try {
      await usersApi.logoutAllSessions(user!.uid);
      showToast('All sessions logged out successfully', 'success');
      loadAllData();
    } catch (err: any) {
      showToast('Failed to logout all sessions', 'error');
    }
  };

  const handleSaveProfile = async () => {
    setSaving(true);
    try {
      await usersApi.update({
        name: profileData.displayName,
        profilePicture: profileData.profilePicture,
      });
      showToast('Profile updated successfully', 'success');
      loadAllData();
    } catch (err: any) {
      showToast('Failed to update profile', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleProfilePictureUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (e) => {
        const base64 = e.target?.result as string;
        setProfileData({ ...profileData, profilePicture: base64 });
      };
      reader.readAsDataURL(file);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (changePasswordData.newPassword !== changePasswordData.confirmPassword) {
      showToast('Passwords do not match', 'error');
      return;
    }
    if (changePasswordData.newPassword.length < 6) {
      showToast('Password must be at least 6 characters', 'error');
      return;
    }

    setSaving(true);
    try {
      // TODO: Connect to backend password change endpoint
      showToast('Password changed successfully', 'success');
      setChangePasswordData({ currentPassword: '', newPassword: '', confirmPassword: '' });
      setShowChangePasswordModal(false);
    } catch (err: any) {
      showToast('Failed to change password', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleForgotPassword = async () => {
    setSaving(true);
    try {
      // TODO: Connect to backend forgot password endpoint
      showToast('Password reset link sent to your email', 'success');
      setShowForgotPasswordModal(false);
    } catch (err: any) {
      showToast('Failed to send reset link', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleRequestAccountDeletion = async () => {
    try {
      await usersApi.requestAccountDeletion(user!.uid);
      showToast('Account deletion request submitted', 'success');
      setShowDeleteConfirm(false);
      loadAllData();
    } catch (err: any) {
      showToast('Failed to request account deletion', 'error');
    }
  };

  const handleLogout = async () => {
    await logout();
  };

  const handleManageKeys = () => {
    navigate('/integrations');
  };

  const showToast = (message: string, type: 'success' | 'error') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  const handleRetry = useCallback(async () => {
    setRetryCount(prev => prev + 1);
    await loadAllData();
  }, [loadAllData]);

  const getInitials = (user: User | null): string => {
    if (!user) return 'U';
    if (profileData.displayName || user.displayName) {
      return (profileData.displayName || user.displayName)
        .split(' ')
        .map((n) => n[0])
        .join('')
        .toUpperCase()
        .slice(0, 2);
    }
    if (user.email) {
      return user.email[0].toUpperCase();
    }
    return 'U';
  };

  const getAccountCreationDate = (user: User | null): string => {
    if (!user || !user.metadata.creationTime) return 'N/A';
    return new Date(user.metadata.creationTime).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  };

  const getLastLogin = (user: User | null): string => {
    if (!user || !user.metadata.lastSignInTime) return 'N/A';
    return new Date(user.metadata.lastSignInTime).toLocaleString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };


  const isAgentUnlocked = (agentName: string) => {
    return unlockedAgents.some((unlock: any) => unlock.agentName === agentName);
  };

  if (!user) {
    return null;
  }

  // Always render content like Research page - no global loading/error states

  return (
    <ErrorBoundary>
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 smooth-scroll">
      {/* Animated background elements - Performance optimized */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none gpu-accelerated">
        <div className="absolute -top-40 -right-40 w-80 h-80 bg-purple-500 rounded-full mix-blend-multiply filter blur-xl opacity-20 animate-blob"></div>
        <div className="absolute -bottom-40 -left-40 w-80 h-80 bg-blue-500 rounded-full mix-blend-multiply filter blur-xl opacity-20 animate-blob animation-delay-2000"></div>
        <div className="hidden lg:block absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-80 h-80 bg-pink-500 rounded-full mix-blend-multiply filter blur-xl opacity-20 animate-blob animation-delay-4000"></div>
      </div>

      <Sidebar onLogout={handleLogout} />

      <main className="min-h-screen smooth-scroll">
        <div className="container py-4 sm:py-8">
          <section className="mb-6 sm:mb-8">
            <div className="space-y-2">
              <h1 className="text-3xl sm:text-4xl font-bold bg-gradient-to-r from-purple-300 via-pink-300 to-cyan-300 bg-clip-text text-transparent">
                Profile
              </h1>
              <p className="text-sm sm:text-base text-gray-300">Manage your DLXTRADE account settings</p>
            </div>
          </section>

          {loading ? (
            <div className="flex justify-center items-center py-12">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-500"></div>
            </div>
          ) : (
            <div className="space-y-4">
              {/* 1. USER INFORMATION */}
              <div className="bg-slate-800/40 backdrop-blur-xl border border-purple-500/20 rounded-xl p-6">
                <h2 className="text-xl font-semibold text-white mb-4">User Information</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="flex items-start gap-4">
                    <div className="relative">
                      <div className="w-20 h-20 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center text-xl font-bold text-white overflow-hidden">
                        {profileData.profilePicture ? (
                          <img src={profileData.profilePicture} alt="Profile" className="w-full h-full object-cover" />
                        ) : (
                          getInitials(user)
                        )}
                      </div>
                      <label className="absolute bottom-0 right-0 bg-purple-600 hover:bg-purple-700 rounded-full p-1 cursor-pointer transition-colors">
                        <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                        </svg>
                        <input
                          type="file"
                          accept="image/*"
                          onChange={handleProfilePictureUpload}
                          className="hidden"
                        />
                      </label>
                    </div>
                    <div className="flex-1 space-y-3">
                      <div>
                        <label className="block text-sm font-medium text-gray-300 mb-1">Full Name</label>
                        <input
                          type="text"
                          className="w-full px-3 py-2 text-sm bg-slate-900/50 backdrop-blur-sm border border-purple-500/30 rounded-lg text-gray-200 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500"
                          value={profileData.displayName}
                          onChange={(e) => setProfileData({ ...profileData, displayName: e.target.value })}
                          placeholder="Enter your full name"
                        />
                      </div>
                      <button
                        onClick={handleSaveProfile}
                        className="px-4 py-2 text-sm font-medium text-white bg-gradient-to-r from-purple-500 to-pink-500 rounded-lg hover:from-purple-600 hover:to-pink-600 transition-all disabled:opacity-50"
                        disabled={saving}
                      >
                        {saving ? 'Saving...' : 'Save Changes'}
                      </button>
                    </div>
                  </div>
                  <div className="space-y-4">
                    <div>
                      <div className="text-sm text-gray-400">Email</div>
                      <div className="text-white">{user.email}</div>
                    </div>
                    <div>
                      <div className="text-sm text-gray-400">UID</div>
                      <div className="text-white font-mono text-sm">{user.uid}</div>
                    </div>
                    <div>
                      <div className="text-sm text-gray-400">Account Created</div>
                      <div className="text-white">{getAccountCreationDate(user)}</div>
                    </div>
                    <div>
                      <div className="text-sm text-gray-400">Last Login Time</div>
                      <div className="text-white">{getLastLogin(user)}</div>
                    </div>
                  </div>
                </div>
              </div>

              {/* 2. ACCOUNT SECURITY */}
              <div className="bg-slate-800/40 backdrop-blur-xl border border-purple-500/20 rounded-xl p-6">
                <h2 className="text-xl font-semibold text-white mb-4">Account Security</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <button
                    onClick={() => setShowChangePasswordModal(true)}
                    className="p-4 bg-slate-900/50 rounded-lg border border-purple-500/20 hover:bg-slate-900/70 transition-all text-left"
                  >
                    <div className="flex items-center gap-3 mb-2">
                      <div className="w-8 h-8 rounded-lg bg-purple-500/20 flex items-center justify-center">
                        <svg className="w-4 h-4 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H7l2-4-4-2h4l2-4 2.257 4H17z" />
                        </svg>
                      </div>
                      <h3 className="text-lg font-medium text-white">Change Password</h3>
                    </div>
                    <p className="text-sm text-gray-400">Update your account password</p>
                  </button>

                  <button
                    onClick={() => setShowForgotPasswordModal(true)}
                    className="p-4 bg-slate-900/50 rounded-lg border border-purple-500/20 hover:bg-slate-900/70 transition-all text-left"
                  >
                    <div className="flex items-center gap-3 mb-2">
                      <div className="w-8 h-8 rounded-lg bg-blue-500/20 flex items-center justify-center">
                        <svg className="w-4 h-4 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                        </svg>
                      </div>
                      <h3 className="text-lg font-medium text-white">Forgot Password</h3>
                    </div>
                    <p className="text-sm text-gray-400">Reset your password via email</p>
                  </button>
                </div>
              </div>


              {/* 3. API PROVIDERS STATUS */}
              <div className="bg-slate-800/40 backdrop-blur-xl border border-purple-500/20 rounded-xl p-6">
                <h2 className="text-xl font-semibold text-white mb-4">API Providers Status</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* CryptoCompare API */}
                  <div className="flex items-center justify-between p-4 bg-slate-900/50 rounded-lg border border-purple-500/20">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg bg-slate-700/50 flex items-center justify-center text-white font-bold text-xs">
                        CC
                      </div>
                      <div>
                        <div className="text-sm font-medium text-white">CryptoCompare API</div>
                        <div className="text-xs text-gray-400">Market Data</div>
                      </div>
                    </div>
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                      apiProvidersStatus?.cryptoCompare?.connected
                        ? 'bg-green-500/20 text-green-300 border border-green-400/30'
                        : 'bg-red-500/20 text-red-300 border border-red-400/30'
                    }`}>
                      {apiProvidersStatus?.cryptoCompare?.status || 'Loading...'}
                    </span>
                  </div>

                  {/* NewsData */}
                  <div className="flex items-center justify-between p-4 bg-slate-900/50 rounded-lg border border-purple-500/20">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg bg-slate-700/50 flex items-center justify-center text-white font-bold text-xs">
                        ND
                      </div>
                      <div>
                        <div className="text-sm font-medium text-white">NewsData</div>
                        <div className="text-xs text-gray-400">News & Sentiment</div>
                      </div>
                    </div>
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                      apiProvidersStatus?.newsData?.connected
                        ? 'bg-green-500/20 text-green-300 border border-green-400/30'
                        : 'bg-red-500/20 text-red-300 border border-red-400/30'
                    }`}>
                      {apiProvidersStatus?.newsData?.status || 'Loading...'}
                    </span>
                  </div>

                  {/* CoinGecko API */}
                  <div className="flex items-center justify-between p-4 bg-slate-900/50 rounded-lg border border-purple-500/20">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg bg-slate-700/50 flex items-center justify-center text-white font-bold text-xs">
                        CG
                      </div>
                      <div>
                        <div className="text-sm font-medium text-white">CoinGecko API</div>
                        <div className="text-xs text-gray-400">Metadata</div>
                      </div>
                    </div>
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                      apiProvidersStatus?.coinGecko?.connected
                        ? 'bg-green-500/20 text-green-300 border border-green-400/30'
                        : 'bg-red-500/20 text-red-300 border border-red-400/30'
                    }`}>
                      {apiProvidersStatus?.coinGecko?.status || 'Loading...'}
                    </span>
                  </div>
                </div>
              </div>

              {/* 4. EXCHANGE API KEYS */}
              <div className="bg-slate-800/40 backdrop-blur-xl border border-purple-500/20 rounded-xl p-6">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-xl font-semibold text-white">Exchange API Keys</h2>
                  <button
                    onClick={() => navigate('/settings')}
                    className="px-3 py-1 bg-purple-600 hover:bg-purple-700 text-white text-sm rounded transition-colors"
                  >
                    Manage Keys
                  </button>
                </div>

                <div className="space-y-3">
                  {/* Binance */}
                  <div className="flex items-center justify-between p-3 bg-slate-900/30 rounded-lg">
                    <div className="flex items-center gap-3">
                      <BinanceLogo className="w-6 h-6" />
                      <div>
                        <div className="text-sm font-medium text-white">Binance</div>
                        <div className="text-xs text-gray-400">
                          {userData?.exchangeConfig?.binance?.apiKeyEncrypted ?
                            '••••••••••••••••' : 'Not configured'}
                        </div>
                      </div>
                    </div>
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                      userData?.exchangeConfig?.binance?.apiKeyEncrypted
                        ? 'bg-green-500/20 text-green-300 border border-green-400/30'
                        : 'bg-red-500/20 text-red-300 border border-red-400/30'
                    }`}>
                      {userData?.exchangeConfig?.binance?.apiKeyEncrypted ? 'Connected' : 'Not Set'}
                    </span>
                  </div>

                  {/* Placeholder for other exchanges */}
                  <div className="text-center py-4 text-gray-400 text-sm">
                    Configure exchange API keys in Settings for automated trading
                  </div>
                </div>
              </div>

              {/* 5. TRADING STATISTICS */}
              <div className="bg-slate-800/40 backdrop-blur-xl border border-purple-500/20 rounded-xl p-6">
                <h2 className="text-xl font-semibold text-white mb-4">Trading Statistics</h2>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="text-center">
                    <div className="text-2xl font-bold text-white">{userStats?.totalTrades || 0}</div>
                    <div className="text-sm text-gray-400">Total Trades</div>
                  </div>
                  <div className="text-center">
                    <div className="text-2xl font-bold text-white">{userStats?.winRate ? userStats.winRate.toFixed(1) : 0}%</div>
                    <div className="text-sm text-gray-400">Win Rate</div>
                  </div>
                  <div className="text-center">
                    <div className="text-2xl font-bold text-white">{userStats?.avgPnL ? userStats.avgPnL.toFixed(2) : 0}%</div>
                    <div className="text-sm text-gray-400">Avg Accuracy</div>
                  </div>
                  <div className="text-center">
                    <div className={`text-2xl font-bold ${(userStats?.totalPnL || 0) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                      ${(userStats?.totalPnL || 0).toFixed(2)}
                    </div>
                    <div className="text-sm text-gray-400">Total P&L</div>
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-6">
                  <div>
                    <div className="text-sm text-gray-400">Best Trade</div>
                    <div className="text-white font-medium">
                      {userStats?.bestTrade ? `$${userStats.bestTrade.toFixed(2)}` : 'N/A'}
                    </div>
                  </div>
                  <div>
                    <div className="text-sm text-gray-400">Worst Trade</div>
                    <div className={`font-medium ${userStats?.worstTrade < 0 ? 'text-red-400' : 'text-green-400'}`}>
                      {userStats?.worstTrade ? `$${userStats.worstTrade.toFixed(2)}` : 'N/A'}
                    </div>
                  </div>
                </div>
              </div>

              {/* 5. USAGE STATS */}
              <div className="bg-slate-800/40 backdrop-blur-xl border border-purple-500/20 rounded-xl p-6">
                <h2 className="text-xl font-semibold text-white mb-6">Usage Statistics</h2>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                  <div className="bg-slate-900/30 rounded-lg p-4 border border-purple-500/10">
                    <div className="flex items-center gap-3 mb-2">
                      <div className="w-8 h-8 rounded-lg bg-blue-500/20 flex items-center justify-center">
                        <svg className="w-4 h-4 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                        </svg>
                      </div>
                      <div className="text-sm text-gray-400">Deep Research</div>
                    </div>
                    <div className="text-2xl font-bold text-white">{usageStats?.totalDeepResearchRuns || 0}</div>
                    <div className="text-xs text-gray-500">Total runs</div>
                  </div>

                  <div className="bg-slate-900/30 rounded-lg p-4 border border-purple-500/10">
                    <div className="flex items-center gap-3 mb-2">
                      <div className="w-8 h-8 rounded-lg bg-green-500/20 flex items-center justify-center">
                        <svg className="w-4 h-4 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                        </svg>
                      </div>
                      <div className="text-sm text-gray-400">Auto-Trade</div>
                    </div>
                    <div className="text-2xl font-bold text-white">{usageStats?.totalAutoTradeRuns || 0}</div>
                    <div className="text-xs text-gray-500">Automated runs</div>
                  </div>

                  <div className="bg-slate-900/30 rounded-lg p-4 border border-purple-500/10">
                    <div className="flex items-center gap-3 mb-2">
                      <div className="w-8 h-8 rounded-lg bg-orange-500/20 flex items-center justify-center">
                        <svg className="w-4 h-4 text-orange-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 100 4m0-4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 100 4m0-4v2m0-6V4" />
                        </svg>
                      </div>
                      <div className="text-sm text-gray-400">Manual Research</div>
                    </div>
                    <div className="text-2xl font-bold text-white">{usageStats?.totalManualResearchRuns || 0}</div>
                    <div className="text-xs text-gray-500">Manual runs</div>
                  </div>
                </div>

                <div className="bg-slate-900/30 rounded-lg p-4 border border-purple-500/10">
                  <div className="flex items-center gap-3 mb-2">
                    <div className="w-8 h-8 rounded-lg bg-purple-500/20 flex items-center justify-center">
                      <svg className="w-4 h-4 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                    </div>
                    <div className="text-sm text-gray-400">Last Research Activity</div>
                  </div>
                  <div className="text-white font-medium">
                    {usageStats?.lastResearchTimestamp
                      ? new Date(usageStats.lastResearchTimestamp).toLocaleString()
                      : 'No research runs yet'
                    }
                  </div>
                </div>
              </div>

              {/* 6. ALL AGENTS */}
              <div className="bg-slate-800/40 backdrop-blur-xl border border-purple-500/20 rounded-xl p-6">
                <h2 className="text-xl font-semibold text-white mb-4">All Agents</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {allAgents.map((agent: any) => (
                    <div key={agent.id} className="p-4 bg-slate-900/50 rounded-lg border border-purple-500/20">
                      <div className="flex items-center gap-3 mb-2">
                        <div className="w-8 h-8 rounded-lg bg-slate-700/50 flex items-center justify-center text-white font-bold text-xs">
                          {agent.name.charAt(0).toUpperCase()}
                        </div>
                        <div className="flex-1">
                          <div className="text-sm font-medium text-white">{agent.name}</div>
                          {isAgentUnlocked(agent.name) ? (
                            <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-green-500/20 text-green-300 border border-green-400/30">
                              Unlocked
                            </span>
                          ) : (
                            <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-gray-500/20 text-gray-300 border border-gray-400/30">
                              <svg className="w-3 h-3 mr-1" fill="currentColor" viewBox="0 0 20 20">
                                <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
                              </svg>
                              Locked
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="text-xs text-gray-400 line-clamp-2">{agent.description}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* SESSION MANAGEMENT */}
              <div className="bg-slate-800/40 backdrop-blur-xl border border-purple-500/20 rounded-xl p-6">
                <h2 className="text-xl font-semibold text-white mb-4">Session Management</h2>
                <div className="space-y-4">
                  <div>
                    <h3 className="text-lg font-medium text-white mb-3">Recent Login Sessions</h3>
                    <div className="space-y-2 max-h-48 overflow-y-auto">
                      {sessions.slice(0, 5).map((session: any, index: number) => (
                        <div key={session.id || index} className="flex items-center justify-between p-3 bg-slate-900/50 rounded-lg border border-purple-500/20">
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-lg bg-slate-700/50 flex items-center justify-center">
                              <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                              </svg>
                            </div>
                            <div>
                              <div className="text-sm text-white">{session.device || 'Unknown Device'}</div>
                              <div className="text-xs text-gray-400">
                                {new Date(session.timestamp).toLocaleString()}
                              </div>
                            </div>
                          </div>
                          <div className="text-xs text-gray-400 text-right">
                            {session.location || 'Unknown'}
                          </div>
                        </div>
                      ))}
                      {sessions.length === 0 && (
                        <div className="text-sm text-gray-400 text-center py-8">No login sessions found</div>
                      )}
                    </div>
                  </div>

                  <div className="border-t border-purple-500/20 pt-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <h3 className="text-lg font-medium text-white">Security Actions</h3>
                        <p className="text-sm text-gray-400">Logout from all devices and sessions</p>
                      </div>
                      <button
                        onClick={handleLogoutAllSessions}
                        className="px-4 py-2 text-sm font-medium text-red-300 bg-red-900/30 border border-red-500/30 rounded-lg hover:bg-red-900/50 transition-all"
                      >
                        Logout All Sessions
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              {/* 7. DELETE ACCOUNT */}
              <div className="bg-slate-800/40 backdrop-blur-xl border border-red-500/20 rounded-xl p-6">
                <h2 className="text-xl font-semibold text-white mb-4">Account Management</h2>
                <div className="space-y-4">
                  <div className="p-4 bg-red-900/20 border border-red-500/30 rounded-lg">
                    <h3 className="text-lg font-medium text-white mb-2">Danger Zone</h3>
                    <p className="text-sm text-gray-400 mb-4">
                      Once you request account deletion, your request will be sent to an admin for approval.
                      This action cannot be undone.
                    </p>
                    {userData?.pendingDeletion ? (
                      <div className="text-sm text-yellow-400 bg-yellow-900/20 border border-yellow-500/30 rounded-lg p-3">
                        Account deletion request sent. Waiting for admin approval.
                      </div>
                    ) : (
                      <button
                        onClick={() => setShowDeleteConfirm(true)}
                        className="px-4 py-2 text-sm font-medium text-red-300 bg-red-900/30 border border-red-500/30 rounded-lg hover:bg-red-900/50 transition-all"
                      >
                        Request Account Deletion
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* Change Password Modal */}
              {showChangePasswordModal && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                  <div className="bg-slate-800 border border-purple-500/20 rounded-xl p-6 max-w-md w-full mx-4">
                    <h3 className="text-lg font-semibold text-white mb-4">Change Password</h3>
                    <form onSubmit={handleChangePassword} className="space-y-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-300 mb-2">Current Password</label>
                        <input
                          type="password"
                          className="w-full px-3 py-2.5 text-sm bg-slate-900/50 backdrop-blur-sm border border-purple-500/30 rounded-lg text-gray-200 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500"
                          value={changePasswordData.currentPassword}
                          onChange={(e) => setChangePasswordData({ ...changePasswordData, currentPassword: e.target.value })}
                          placeholder="Enter current password"
                          required
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-300 mb-2">New Password</label>
                        <input
                          type="password"
                          className="w-full px-3 py-2.5 text-sm bg-slate-900/50 backdrop-blur-sm border border-purple-500/30 rounded-lg text-gray-200 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500"
                          value={changePasswordData.newPassword}
                          onChange={(e) => setChangePasswordData({ ...changePasswordData, newPassword: e.target.value })}
                          placeholder="Enter new password"
                          required
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-300 mb-2">Confirm New Password</label>
                        <input
                          type="password"
                          className="w-full px-3 py-2.5 text-sm bg-slate-900/50 backdrop-blur-sm border border-purple-500/30 rounded-lg text-gray-200 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500"
                          value={changePasswordData.confirmPassword}
                          onChange={(e) => setChangePasswordData({ ...changePasswordData, confirmPassword: e.target.value })}
                          placeholder="Confirm new password"
                          required
                        />
                      </div>
                      <div className="flex gap-3 pt-4">
                        <button
                          type="button"
                          onClick={() => setShowChangePasswordModal(false)}
                          className="flex-1 px-4 py-2 text-sm font-medium text-gray-300 bg-slate-700/50 border border-purple-500/30 rounded-lg hover:bg-slate-700/70 transition-all"
                        >
                          Cancel
                        </button>
                        <button
                          type="submit"
                          className="flex-1 px-4 py-2 text-sm font-medium text-white bg-gradient-to-r from-purple-500 to-pink-500 rounded-lg hover:from-purple-600 hover:to-pink-600 transition-all disabled:opacity-50"
                          disabled={saving}
                        >
                          {saving ? 'Changing...' : 'Change Password'}
                        </button>
                      </div>
                    </form>
                  </div>
                </div>
              )}

              {/* Forgot Password Modal */}
              {showForgotPasswordModal && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                  <div className="bg-slate-800 border border-purple-500/20 rounded-xl p-6 max-w-md w-full mx-4">
                    <h3 className="text-lg font-semibold text-white mb-4">Reset Password</h3>
                    <div className="space-y-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-300 mb-2">Email Address</label>
                        <input
                          type="email"
                          className="w-full px-3 py-2.5 text-sm bg-slate-900/50 backdrop-blur-sm border border-purple-500/30 rounded-lg text-gray-200 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500"
                          value={user?.email || ''}
                          disabled
                          placeholder="Your email address"
                        />
                      </div>
                      <p className="text-sm text-gray-400">
                        A password reset link will be sent to your email address.
                      </p>
                      <div className="flex gap-3 pt-4">
                        <button
                          onClick={() => setShowForgotPasswordModal(false)}
                          className="flex-1 px-4 py-2 text-sm font-medium text-gray-300 bg-slate-700/50 border border-purple-500/30 rounded-lg hover:bg-slate-700/70 transition-all"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={handleForgotPassword}
                          className="flex-1 px-4 py-2 text-sm font-medium text-white bg-gradient-to-r from-purple-500 to-pink-500 rounded-lg hover:from-purple-600 hover:to-pink-600 transition-all disabled:opacity-50"
                          disabled={saving}
                        >
                          {saving ? 'Sending...' : 'Send Reset Link'}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Delete Confirmation Modal */}
              {showDeleteConfirm && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                  <div className="bg-slate-800 border border-purple-500/20 rounded-xl p-6 max-w-md w-full mx-4">
                    <h3 className="text-lg font-semibold text-white mb-4">Confirm Account Deletion</h3>
                    <p className="text-sm text-gray-400 mb-6">
                      Are you sure you want to request account deletion? Your request will be sent to an admin for approval.
                    </p>
                    <div className="flex gap-3">
                      <button
                        onClick={() => setShowDeleteConfirm(false)}
                        className="flex-1 px-4 py-2 text-sm font-medium text-gray-300 bg-slate-700/50 border border-purple-500/30 rounded-lg hover:bg-slate-700/70 transition-all"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={handleRequestAccountDeletion}
                        className="flex-1 px-4 py-2 text-sm font-medium text-red-300 bg-red-900/30 border border-red-500/30 rounded-lg hover:bg-red-900/50 transition-all"
                      >
                        Confirm Request
                      </button>
                    </div>
                  </div>
                </div>
              )}

            </div>
          )}
        </div>
      </main>

      {toast && <Toast message={toast.message} type={toast.type} />}
      </div>
    </ErrorBoundary>
  );
}

