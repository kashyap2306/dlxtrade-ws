import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { engineApi, settingsApi, usersApi, agentsApi, engineStatusApi, hftApi } from '../services/api';
import Sidebar from '../components/Sidebar';
import Toast from '../components/Toast';
import { User } from 'firebase/auth';

export default function Profile() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [engineStatus, setEngineStatus] = useState<any>(null);
  const [autoTradeEnabled, setAutoTradeEnabled] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [profileData, setProfileData] = useState({
    displayName: '',
    phone: '',
    country: '',
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  });
  const [userData, setUserData] = useState<any>(null);
  const [unlockedAgents, setUnlockedAgents] = useState<any[]>([]);
  const [engineStatusData, setEngineStatusData] = useState<any>(null);
  const [hftStatusData, setHftStatusData] = useState<any>(null);

  useEffect(() => {
    loadData();
    const interval = setInterval(loadEngineStatus, 5000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (user) {
      loadUserData();
    }
  }, [user]);

  const loadUserData = async () => {
    if (!user) return;
    try {
      const [userResponse, agentsResponse, engineStatusResponse, hftStatusResponse] = await Promise.all([
        usersApi.get(user.uid),
        agentsApi.getUnlocks(),
        engineStatusApi.get({ uid: user.uid }),
        hftApi.getStatus(),
      ]);
      
      // Profile data loaded successfully
      
      setUserData(userResponse.data);
      setUnlockedAgents(agentsResponse.data.unlocks || []);
      setEngineStatusData(engineStatusResponse.data);
      setHftStatusData(hftStatusResponse.data);
      
      // Update profileData from userData (load from backend, not localStorage)
      if (userResponse.data) {
        const savedProfile = localStorage.getItem('userProfile');
        const parsed = savedProfile ? JSON.parse(savedProfile) : {};
        setProfileData({
          displayName: userResponse.data.name || parsed.displayName || user?.displayName || '',
          phone: userResponse.data.phone || parsed.phone || '',
          country: parsed.country || '',
          timezone: parsed.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone,
        });
      } else {
        // Fallback if no userData
        const savedProfile = localStorage.getItem('userProfile');
        if (savedProfile) {
          const parsed = JSON.parse(savedProfile);
          setProfileData({
            displayName: parsed.displayName || user?.displayName || '',
            phone: parsed.phone || '',
            country: parsed.country || '',
            timezone: parsed.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone,
          });
        } else {
          setProfileData({
            displayName: user?.displayName || '',
            phone: '',
            country: '',
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          });
        }
      }
    } catch (err: any) {
      console.error('Error loading user data:', err);
      console.error('Error details:', err.response?.data);
    }
  };

  const loadData = async () => {
    setLoading(true);
    try {
      await Promise.all([loadEngineStatus(), loadSettings()]);
    } catch (err) {
      console.error('Error loading data:', err);
    } finally {
      setLoading(false);
    }
  };

  const loadEngineStatus = async () => {
    try {
      const response = await engineApi.getStatus();
      setEngineStatus(response.data);
    } catch (err) {
      console.error('Error loading engine status:', err);
    }
  };

  const loadSettings = async () => {
    try {
      const response = await settingsApi.load();
      if (response.data) {
        setAutoTradeEnabled(response.data.autoTradeEnabled || false);
      }
    } catch (err) {
      console.error('Error loading settings:', err);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      // Save to backend
      const response = await usersApi.update({
        name: profileData.displayName,
        phone: profileData.phone,
        country: profileData.country,
      });
      console.log('Profile update API response:', response.data);
      
      // Also save to localStorage for backward compatibility
      localStorage.setItem('userProfile', JSON.stringify(profileData));
      showToast('Profile updated successfully', 'success');
      loadUserData();
    } catch (err: any) {
      console.error('Error saving profile:', err);
      console.error('Error details:', err.response?.data);
      showToast(err.response?.data?.error || 'Error saving profile', 'error');
    } finally {
      setSaving(false);
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

  const getInitials = (user: User | null): string => {
    if (!user) return 'U';
    if (user.displayName) {
      return user.displayName
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

  if (!user) {
    return null;
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900">
      {/* Animated background elements */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-80 h-80 bg-purple-500 rounded-full mix-blend-multiply filter blur-xl opacity-20 animate-blob"></div>
        <div className="absolute -bottom-40 -left-40 w-80 h-80 bg-blue-500 rounded-full mix-blend-multiply filter blur-xl opacity-20 animate-blob animation-delay-2000"></div>
        <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-80 h-80 bg-pink-500 rounded-full mix-blend-multiply filter blur-xl opacity-20 animate-blob animation-delay-4000"></div>
      </div>

      <Sidebar onLogout={handleLogout} />

      <main className="min-h-screen">
        <div className="max-w-4xl mx-auto py-4 sm:py-8 px-4 sm:px-6 lg:px-8">
          <section className="mb-6 sm:mb-8">
            <div className="space-y-2">
              <h1 className="text-3xl sm:text-4xl font-bold bg-gradient-to-r from-purple-300 via-pink-300 to-cyan-300 bg-clip-text text-transparent">
                User Profile
              </h1>
              <p className="text-sm sm:text-base text-gray-300">Manage your account settings and preferences</p>
            </div>
          </section>

          <div className="space-y-6">
            {/* Profile Card */}
            <div className="bg-slate-800/40 backdrop-blur-xl border border-purple-500/20 rounded-xl shadow-lg p-6">
              <div className="flex flex-col sm:flex-row items-start sm:items-center gap-6 mb-6">
                {/* Avatar */}
                <div className="w-24 h-24 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center text-3xl font-bold text-white shadow-lg">
                  {getInitials(user)}
                </div>
                <div className="flex-1">
                  <h2 className="text-2xl font-semibold text-white mb-1">
                    {user.displayName || 'User'}
                  </h2>
                  <p className="text-gray-300">{user.email}</p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-6 border-t border-purple-500/20">
                <div>
                  <label className="block text-xs font-medium text-gray-400 mb-1">Account Creation</label>
                  <p className="text-sm text-gray-200">{userData?.createdAt ? new Date(userData.createdAt).toLocaleDateString() : getAccountCreationDate(user)}</p>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-400 mb-1">Last Login</label>
                  <p className="text-sm text-gray-200">{getLastLogin(user)}</p>
                </div>
                {userData && (
                  <>
                    <div>
                      <label className="block text-xs font-medium text-gray-400 mb-1">Plan</label>
                      <p className="text-sm text-gray-200">{userData.plan || 'Free'}</p>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-400 mb-1">API Connected</label>
                      <p className={`text-sm ${userData.apiConnected ? 'text-green-400' : 'text-gray-400'}`}>
                        {userData.apiConnected ? 'Yes' : 'No'}
                      </p>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-400 mb-1">Total Trades</label>
                      <p className="text-sm text-gray-200">{userData.totalTrades || 0}</p>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-400 mb-1">Total P&L</label>
                      <p className={`text-sm ${(userData.totalPnL || 0) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                        ${(userData.totalPnL || 0).toFixed(2)}
                      </p>
                    </div>
                    {userData.phone && (
                      <div>
                        <label className="block text-xs font-medium text-gray-400 mb-1">Phone</label>
                        <p className="text-sm text-gray-200">{userData.phone}</p>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>

            {/* Unlocked Agents */}
            {unlockedAgents.length > 0 && (
              <div className="bg-slate-800/40 backdrop-blur-xl border border-purple-500/20 rounded-xl shadow-lg p-6">
                <h3 className="text-xl font-semibold text-white mb-4">Unlocked Agents</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {unlockedAgents.map((unlock: any, index: number) => (
                    <div key={unlock.id || unlock.agentName || index} className="p-3 bg-slate-900/50 rounded-lg border border-purple-500/20">
                      <div className="text-sm font-medium text-white">{unlock.agentName}</div>
                      {unlock.unlockedAt && (
                        <div className="text-xs text-gray-400 mt-1">
                          Unlocked: {typeof unlock.unlockedAt === 'string' ? new Date(unlock.unlockedAt).toLocaleDateString() : unlock.unlockedAt.toDate ? new Date(unlock.unlockedAt.toDate()).toLocaleDateString() : 'N/A'}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Engine Status Details */}
            {(engineStatusData || hftStatusData) && (
              <div className="bg-slate-800/40 backdrop-blur-xl border border-purple-500/20 rounded-xl shadow-lg p-6">
                <h3 className="text-xl font-semibold text-white mb-4">Engine Status Details</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {engineStatusData && (
                    <div className="p-4 bg-slate-900/50 rounded-lg border border-purple-500/20">
                      <div className="text-sm font-medium text-gray-300 mb-2">Auto Engine</div>
                      <div className={`text-lg font-bold ${engineStatusData.active ? 'text-green-400' : 'text-gray-400'}`}>
                        {engineStatusData.active ? 'Active' : 'Inactive'}
                      </div>
                      {engineStatusData.symbol && (
                        <div className="text-xs text-gray-400 mt-1">Symbol: {engineStatusData.symbol}</div>
                      )}
                    </div>
                  )}
                  {hftStatusData && (
                    <div className="p-4 bg-slate-900/50 rounded-lg border border-purple-500/20">
                      <div className="text-sm font-medium text-gray-300 mb-2">HFT Engine</div>
                      <div className={`text-lg font-bold ${hftStatusData.running ? 'text-green-400' : 'text-gray-400'}`}>
                        {hftStatusData.running ? 'Active' : 'Inactive'}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Status Card */}
            <div className="bg-slate-800/40 backdrop-blur-xl border border-purple-500/20 rounded-xl shadow-lg p-6">
              <h3 className="text-xl font-semibold text-white mb-4">System Status</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="flex items-center justify-between p-4 bg-slate-900/50 rounded-lg border border-purple-500/20">
                  <span className="text-gray-300">Engine Status</span>
                  <span
                    className={`px-3 py-1 rounded-full text-sm font-medium ${
                      engineStatus?.engine?.running
                        ? 'bg-green-500/20 text-green-300 border border-green-400/30'
                        : 'bg-gray-500/20 text-gray-300 border border-gray-400/30'
                    }`}
                  >
                    {engineStatus?.engine?.running ? 'Running' : 'Stopped'}
                  </span>
                </div>
                <div className="flex items-center justify-between p-4 bg-slate-900/50 rounded-lg border border-purple-500/20">
                  <span className="text-gray-300">Auto-Trade Status</span>
                  <span
                    className={`px-3 py-1 rounded-full text-sm font-medium ${
                      autoTradeEnabled
                        ? 'bg-green-500/20 text-green-300 border border-green-400/30'
                        : 'bg-gray-500/20 text-gray-300 border border-gray-400/30'
                    }`}
                  >
                    {autoTradeEnabled ? 'Enabled' : 'Disabled'}
                  </span>
                </div>
              </div>
            </div>

            {/* Editable Profile Fields */}
            <div className="bg-slate-800/40 backdrop-blur-xl border border-purple-500/20 rounded-xl shadow-lg p-6">
              <h3 className="text-xl font-semibold text-white mb-4">Profile Settings</h3>
              <form onSubmit={handleSave} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    Display Name
                  </label>
                  <input
                    type="text"
                    className="w-full px-3 py-2.5 text-sm bg-slate-900/50 backdrop-blur-sm border border-purple-500/30 rounded-lg text-gray-200 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all"
                    value={profileData.displayName}
                    onChange={(e) => setProfileData({ ...profileData, displayName: e.target.value })}
                    placeholder="Enter your display name"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    Phone (Optional)
                  </label>
                  <input
                    type="tel"
                    className="w-full px-3 py-2.5 text-sm bg-slate-900/50 backdrop-blur-sm border border-purple-500/30 rounded-lg text-gray-200 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all"
                    value={profileData.phone}
                    onChange={(e) => setProfileData({ ...profileData, phone: e.target.value })}
                    placeholder="Enter your phone number"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    Country (Optional)
                  </label>
                  <input
                    type="text"
                    className="w-full px-3 py-2.5 text-sm bg-slate-900/50 backdrop-blur-sm border border-purple-500/30 rounded-lg text-gray-200 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all"
                    value={profileData.country}
                    onChange={(e) => setProfileData({ ...profileData, country: e.target.value })}
                    placeholder="Enter your country"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    Timezone (Optional)
                  </label>
                  <select
                    className="w-full px-3 py-2.5 text-sm bg-slate-900/50 backdrop-blur-sm border border-purple-500/30 rounded-lg text-gray-200 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all"
                    value={profileData.timezone}
                    onChange={(e) => setProfileData({ ...profileData, timezone: e.target.value })}
                  >
                    {Intl.supportedValuesOf('timeZone').map((tz) => (
                      <option key={tz} value={tz} className="bg-slate-800">
                        {tz}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex flex-col sm:flex-row gap-3 pt-4">
                  <button
                    type="submit"
                    className="btn-mobile-full px-4 py-2.5 text-sm font-medium text-white bg-gradient-to-r from-purple-500 to-pink-500 rounded-lg hover:from-purple-600 hover:to-pink-600 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-purple-500/50"
                    disabled={saving}
                  >
                    {saving ? 'Saving...' : 'Save Changes'}
                  </button>
                </div>
              </form>
            </div>

            {/* Action Buttons */}
            <div className="bg-slate-800/40 backdrop-blur-xl border border-purple-500/20 rounded-xl shadow-lg p-4 sm:p-6">
              <h3 className="text-lg sm:text-xl font-semibold text-white mb-4">Actions</h3>
              <div className="flex flex-col sm:flex-row gap-3">
                <button
                  onClick={handleManageKeys}
                  className="btn-mobile-full px-4 py-2.5 text-sm font-medium text-gray-200 bg-slate-700/50 backdrop-blur-sm border border-purple-500/30 rounded-lg hover:bg-slate-700/70 transition-all"
                >
                  Manage API Keys
                </button>
                <button
                  onClick={handleLogout}
                  className="btn-mobile-full px-4 py-2.5 text-sm font-medium text-red-300 bg-red-900/30 backdrop-blur-sm border border-red-500/30 rounded-lg hover:bg-red-900/50 transition-all"
                >
                  Logout
                </button>
              </div>
            </div>
          </div>
        </div>
      </main>

      {toast && <Toast message={toast.message} type={toast.type} />}
    </div>
  );
}

