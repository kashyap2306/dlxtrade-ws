import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { usersApi, agentsApi } from '../services/api';
import api from '@/config/axios';
import Toast from '../components/Toast';
import { updatePassword, sendPasswordResetEmail, reauthenticateWithCredential, EmailAuthProvider } from 'firebase/auth';
import { getAuth } from 'firebase/auth';
import { getStorage, ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { app, db } from '../config/firebase';
import BinanceLogo from '../components/ui/BinanceLogo';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { SettingsCard } from './SettingsUtils'; // Import reused component

export default function Profile() {
  const { user, logout, authLoading, authReady } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<any>(null);
  const [retryCount, setRetryCount] = useState(0);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [userData, setUserData] = useState<any>(null);
  const [sessions, setSessions] = useState<any[]>([]);
  const [sessionsError, setSessionsError] = useState<string | null>(null);
  const [sessionsRetryCount, setSessionsRetryCount] = useState(0);
  const sessionsRetryCountRef = useRef(0);
  const [apiProvidersStatus, setApiProvidersStatus] = useState<any>(null);
  const [providersLoading, setProvidersLoading] = useState(false);
  const [providersError, setProvidersError] = useState<string | null>(null);
  const [usageStats, setUsageStats] = useState<any>(null);
  const [usageStatsError, setUsageStatsError] = useState<string | null>(null);
  const [usageStatsRetryCount, setUsageStatsRetryCount] = useState(0);
  const usageStatsRetryCountRef = useRef(0);
  const [exchangeConfig, setExchangeConfig] = useState<any>(null);
  const [exchangeConfigError, setExchangeConfigError] = useState<string | null>(null);
  const [exchangeConfigRetryCount, setExchangeConfigRetryCount] = useState(0);
  const exchangeConfigRetryCountRef = useRef(0);
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
  const [pendingDeletion, setPendingDeletion] = useState(false);
  const isMountedRef = useRef(true);
  const dataLoadedRef = useRef(false);
  const userUidRef = useRef<string | null>(null);
  const loadInProgressRef = useRef(false);
  const userRef = useRef<typeof user>(null);

  // Store user and user.uid in refs to stabilize loadAllData
  useEffect(() => {
    const currentUid = user?.uid || null;
    if (userUidRef.current !== currentUid) {
      userUidRef.current = currentUid;
      dataLoadedRef.current = false; // Reset when UID changes
      // Reset retry counts when UID changes
      sessionsRetryCountRef.current = 0;
      usageStatsRetryCountRef.current = 0;
      exchangeConfigRetryCountRef.current = 0;
      setSessionsRetryCount(0);
      setUsageStatsRetryCount(0);
      setExchangeConfigRetryCount(0);
    }
    userRef.current = user; // Always keep user ref updated
  }, [user]);

  const loadAllData = useCallback(async () => {
    const currentUid = userUidRef.current;
    if (!currentUid || !isMountedRef.current || loadInProgressRef.current) return;

    // Prevent multiple simultaneous loads
    if (dataLoadedRef.current && userUidRef.current === currentUid) {
      console.log('[Profile] Data already loaded for this UID, skipping');
      return;
    }

    loadInProgressRef.current = true;

    console.log('[Profile] Starting loadAllData for UID:', currentUid);
    setLoading(true);
    setError(null);

    try {
      // 1. Core Profile Data from Firestore
      console.log('[Profile] Fetching core Firestore data...');
      try {
        const { collection, doc, getDoc } = await import('firebase/firestore');
        const userDocRef = doc(db, 'users', currentUid);
        const userDoc = await getDoc(userDocRef);

        if (isMountedRef.current && userUidRef.current === currentUid && userRef.current) {
          const currentUser = userRef.current;
          const userDataFromFirestore = userDoc.data() || {};
          setProfileData({
            displayName: currentUser.displayName || '',
            profilePicture: userDataFromFirestore.profilePhoto || currentUser.photoURL || '',
          });
          setUserData({
            uid: currentUid,
            email: currentUser.email || '',
            displayName: currentUser.displayName || '',
            photoURL: userDataFromFirestore.profilePhoto || currentUser.photoURL || '',
            emailVerified: false,
            pendingDeletion: userDataFromFirestore.deleteRequested || false,
            stats: userDataFromFirestore.stats || {}
          });
          setPendingDeletion(userDataFromFirestore.deleteRequested || false);
        }
      } catch (firestoreErr) {
        console.warn('[Profile] Firestore data load failed:', firestoreErr);
      }

      // 2. Parallel Loading of Non-Critical Data with individual error handling
      console.log('[Profile] Starting parallel API calls...');
      
      // Helper function for retry logic (max 1 retry with 1s delay)
      // Uses refs to track retry state to prevent re-fetch loops
      const fetchWithRetry = async <T,>(
        fetchFn: () => Promise<T>,
        retryCountRef: React.MutableRefObject<number>,
        setRetryCount: (count: number) => void,
        setError: (error: string | null) => void,
        apiName: string,
        timeout: number = 20000
      ): Promise<T | null> => {
        try {
          const result = await fetchFn();
          if (isMountedRef.current && userUidRef.current === currentUid) {
            setError(null);
            setRetryCount(0);
            retryCountRef.current = 0;
          }
          return result;
        } catch (err: any) {
          const isTimeout = err.code === 'ECONNABORTED' || err.message?.includes('timeout');
          console.warn(`[Profile] ${apiName} fail:`, err.message, isTimeout ? '(timeout)' : '');
          
          if (isMountedRef.current && userUidRef.current === currentUid) {
            if (retryCountRef.current < 1) {
              // Retry once after 1s delay
              retryCountRef.current = 1;
              setRetryCount(1);
              await new Promise(resolve => setTimeout(resolve, 1000));
              try {
                const retryResult = await fetchFn();
                if (isMountedRef.current && userUidRef.current === currentUid) {
                  setError(null);
                  setRetryCount(0);
                  retryCountRef.current = 0;
                }
                return retryResult;
              } catch (retryErr: any) {
                console.warn(`[Profile] ${apiName} retry failed:`, retryErr.message);
                if (isMountedRef.current && userUidRef.current === currentUid) {
                  setError(`Failed to load — Retry`);
                  retryCountRef.current = 1; // Mark as retried
                }
                return null;
              }
            } else {
              if (isMountedRef.current && userUidRef.current === currentUid) {
                setError(`Failed to load — Retry`);
              }
              return null;
            }
          }
          return null;
        }
      };

      const apiPromises = [
        // Sessions (with increased timeout)
        fetchWithRetry(
          () => api.get(`/users/${currentUid}/sessions`, { timeout: 25000 }),
          sessionsRetryCountRef,
          setSessionsRetryCount,
          setSessionsError,
          'Sessions',
          25000
        ).then(res => {
          if (res && isMountedRef.current && userUidRef.current === currentUid) {
            setSessions(Array.isArray(res.data?.sessions) ? res.data.sessions : []);
          }
        }),

        // All Agents
        agentsApi.getAll().then(res => {
          if (isMountedRef.current && userUidRef.current === currentUid) setAllAgents(Array.isArray(res.data) ? res.data : []);
        }).catch(err => console.warn('[Profile] Agents fail:', err.message)),

        // Unlocked Agents
        agentsApi.getUnlocked().then(res => {
          if (isMountedRef.current && userUidRef.current === currentUid) setUnlockedAgents(Array.isArray(res.data) ? res.data : []);
        }).catch(err => console.warn('[Profile] Unlocked fail:', err.message)),

        // Provider Config
        usersApi.getProviderConfig(currentUid).then(res => {
          if (isMountedRef.current && userUidRef.current === currentUid) {
            setApiProvidersStatus(res.data);
            setProvidersError(null);
          }
        }).catch(err => {
          console.warn('[Profile] Provider config fail:', err.message);
          if (isMountedRef.current && userUidRef.current === currentUid) setProvidersError('Failed to load providers');
        }),

        // Exchange Config (with increased timeout)
        fetchWithRetry(
          () => api.get(`/users/${currentUid}/exchangeConfig/current`, { timeout: 25000 }).then(res => res.data),
          exchangeConfigRetryCountRef,
          setExchangeConfigRetryCount,
          setExchangeConfigError,
          'Exchange Config',
          25000
        ).then(data => {
          if (data !== null && isMountedRef.current && userUidRef.current === currentUid) {
            setExchangeConfig(data);
          }
        }),

        // Usage Stats (with increased timeout)
        fetchWithRetry(
          () => api.get(`/users/${currentUid}/usage-stats`, { timeout: 20000 }).then(res => res.data),
          usageStatsRetryCountRef,
          setUsageStatsRetryCount,
          setUsageStatsError,
          'Usage Stats',
          20000
        ).then(data => {
          if (data !== null && isMountedRef.current && userUidRef.current === currentUid) {
            setUsageStats(data);
          }
        })
      ];

      await Promise.allSettled(apiPromises);
      console.log('[Profile] All parallel API calls settled');

      if (isMountedRef.current && userUidRef.current === currentUid) {
        setRetryCount(0);
        dataLoadedRef.current = true;
      }
    } catch (err: any) {
      console.error('[Profile] CRITICAL load error:', err);
      if (isMountedRef.current && userUidRef.current === currentUid) {
        setError(err);
        dataLoadedRef.current = false; // Allow retry on error
      }
    } finally {
      console.log('[Profile] loadAllData complete, setting loading=false');
      loadInProgressRef.current = false;
      if (isMountedRef.current && userUidRef.current === currentUid) {
        setLoading(false);
      }
    }
  }, []); // Empty deps - use refs for user.uid to prevent re-creation

  // Main data loading effect - only runs when auth is ready and user exists
  // CRITICAL: Do NOT include error states or retry counts in dependencies to prevent re-fetch loops
  useEffect(() => {
    console.log('[Profile] Auth state check:', { 
      uid: user?.uid, 
      authLoading, 
      authReady, 
      hasUser: !!user,
      dataLoaded: dataLoadedRef.current,
      loadInProgress: loadInProgressRef.current
    });

    // Wait for auth to be fully ready (not loading AND ready)
    if (authLoading || !authReady) {
      console.log('[Profile] Auth still loading or not ready - waiting');
      return;
    }

    // If user exists and we haven't loaded data yet (or UID changed), load data
    if (user?.uid) {
      const uidChanged = userUidRef.current !== user.uid;
      if ((!dataLoadedRef.current || uidChanged) && !loadInProgressRef.current) {
        console.log('[Profile] ✅ Auth ready and user exists, starting loadAllData');
        if (uidChanged) {
          dataLoadedRef.current = false; // Reset flag if UID changed
        }
        loadAllData();
      }
    }
    // Note: Don't redirect here - let PrivateRoute handle authentication
    // If user is null, PrivateRoute will redirect to login
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.uid, authLoading, authReady]); // Removed loadAllData from deps to prevent loops

  // Auto-refresh API Dashboard every 30 seconds
  useEffect(() => {
    if (!user) return;

    const refreshDashboard = async () => {
      try {
        // Only fetch provider config to be lightweight
        const providerConfigResponse = await usersApi.getProviderConfig(user.uid);
        if (isMountedRef.current) {
          setApiProvidersStatus(providerConfigResponse.data);
        }
        // Also refresh user data for stats
        const userDocPromise = (async () => {
          const { doc, getDoc } = await import('firebase/firestore');
          const userDocRef = doc(db, 'users', user.uid);
          const userDoc = await getDoc(userDocRef);
          return userDoc.data();
        })();

        const freshUserData = await userDocPromise;
        if (isMountedRef.current && freshUserData) {
          setUserData(prev => ({ ...prev, stats: freshUserData.stats }));
        }

      } catch (err) {
        console.warn('Dashboard auto-refresh failed', err);
      }
    };

    const interval = setInterval(refreshDashboard, 30000);
    return () => clearInterval(interval);
  }, [user]);

  const handleDeleteAccount = () => {
    setShowDeleteConfirm(true);
  };

  // No emergency timeout needed - page renders immediately, sections handle their own states

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);


  const handleLogoutAllSessions = async () => {
    if (!user) return;

    try {
      await usersApi.logoutAllSessions(user.uid);
      showToast('All sessions logged out successfully. You will be logged out.', 'success');
      // Wait a bit then logout locally
      setTimeout(async () => {
        await logout();
        navigate('/login');
      }, 1500);
    } catch (err: any) {
      console.error('Logout all sessions error:', err);
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

  const handleProfilePictureUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !user) return;

    // Validate file type and size
    if (!file.type.startsWith('image/')) {
      showToast('Please select a valid image file', 'error');
      return;
    }

    if (file.size > 5 * 1024 * 1024) { // 5MB limit
      showToast('Image size must be less than 5MB', 'error');
      return;
    }

    setSaving(true);

    try {
      const storage = getStorage(app);
      const storageRef = ref(storage, `profilePhotos/${user.uid}.jpg`);

      // Upload file to Firebase Storage
      await uploadBytes(storageRef, file);

      // Get download URL
      const downloadURL = await getDownloadURL(storageRef);

      // Save to Firestore
      const { doc, updateDoc } = await import('firebase/firestore');
      const userDocRef = doc(db, 'users', user.uid);
      await updateDoc(userDocRef, {
        profilePhoto: downloadURL,
        updatedAt: new Date()
      });

      // Update local state
      setProfileData({ ...profileData, profilePicture: downloadURL });

      showToast('Profile photo updated successfully', 'success');
    } catch (error: any) {
      console.error('Profile photo upload error:', error);
      showToast('Failed to upload profile photo', 'error');
    } finally {
      setSaving(false);
      // Clear the input
      if (event.target) {
        event.target.value = '';
      }
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
      const auth = getAuth();
      const user = auth.currentUser;

      if (!user || !user.email) {
        throw new Error('User not authenticated');
      }

      // Reauthenticate user before changing password
      const credential = EmailAuthProvider.credential(
        user.email,
        changePasswordData.currentPassword
      );

      await reauthenticateWithCredential(user, credential);

      // Update password
      await updatePassword(user, changePasswordData.newPassword);

      showToast('Password changed successfully', 'success');
      setChangePasswordData({ currentPassword: '', newPassword: '', confirmPassword: '' });
      setShowChangePasswordModal(false);
    } catch (err: any) {
      console.error('Password change error:', err);

      let errorMessage = 'Failed to change password';
      if (err.code === 'auth/wrong-password') {
        errorMessage = 'Current password is incorrect';
      } else if (err.code === 'auth/weak-password') {
        errorMessage = 'New password is too weak';
      } else if (err.code === 'auth/requires-recent-login') {
        errorMessage = 'Please log in again before changing your password';
      }

      showToast(errorMessage, 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleForgotPassword = async () => {
    setSaving(true);
    try {
      const auth = getAuth();
      const user = auth.currentUser;

      if (!user || !user.email) {
        throw new Error('User email not available');
      }

      await sendPasswordResetEmail(auth, user.email);
      showToast('Password reset link sent to your email', 'success');
      setShowForgotPasswordModal(false);
    } catch (err: any) {
      console.error('Password reset error:', err);

      let errorMessage = 'Failed to send reset link';
      if (err.code === 'auth/user-not-found') {
        errorMessage = 'User account not found';
      } else if (err.code === 'auth/invalid-email') {
        errorMessage = 'Invalid email address';
      }

      showToast(errorMessage, 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleRequestAccountDeletion = async () => {
    try {
      await usersApi.requestAccountDeletion(user!.uid);
      showToast('Account deletion request submitted', 'success');
      setShowDeleteConfirm(false);
      setPendingDeletion(true);
      // Reload data to get updated deletion status
      await loadAllData();
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
    dataLoadedRef.current = false; // Reset flag to allow retry
    loadInProgressRef.current = false; // Reset in-progress flag
    await loadAllData();
  }, [loadAllData]);

  const getInitials = (user: any): string => {
    if (!user) return 'U';
    const displayName = profileData.displayName || user.displayName;
    if (displayName) {
      return displayName
        .split(' ')
        .map((n: string) => n[0])
        .join('')
        .toUpperCase()
        .slice(0, 2);
    }
    if (user.email) {
      return user.email[0].toUpperCase();
    }
    return 'U';
  };

  const getAccountCreationDate = (user: any): string => {
    if (!user) return 'Not available';
    // Try Firebase Auth user metadata first (CleanUser format)
    if (user.metadata?.creationTime) {
      try {
        return new Date(user.metadata.creationTime).toLocaleDateString('en-US', {
          year: 'numeric',
          month: 'long',
          day: 'numeric',
        });
      } catch (e) {
        // Invalid date, continue to fallback
      }
    }
    // Fallback to userData if available
    if (userData?.createdAt) {
      try {
        return new Date(userData.createdAt).toLocaleDateString('en-US', {
          year: 'numeric',
          month: 'long',
          day: 'numeric',
        });
      } catch (e) {
        // Invalid date
      }
    }
    return 'Not available';
  };

  const getLastLogin = (user: any): string => {
    if (!user) return 'Not available';
    // Try Firebase Auth user metadata first (CleanUser format uses lastLoginTime)
    if (user.metadata?.lastLoginTime) {
      try {
        return new Date(user.metadata.lastLoginTime).toLocaleString('en-US', {
          year: 'numeric',
          month: 'long',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        });
      } catch (e) {
        // Invalid date, continue to fallback
      }
    }
    // Fallback to userData if available
    if (userData?.lastLogin) {
      try {
        return new Date(userData.lastLogin).toLocaleString('en-US', {
          year: 'numeric',
          month: 'long',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        });
      } catch (e) {
        // Invalid date
      }
    }
    return 'Not available';
  };


  const isAgentUnlocked = (agentName: string) => {
    return unlockedAgents.some((unlock: any) => unlock.agentName === agentName);
  };

  // Show loading state while auth is initializing - don't return null to prevent unmount
  if (authLoading || !authReady) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-[#0a0f1c] via-[#111727] to-[#000a0f] flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-500 mx-auto mb-4"></div>
          <p className="text-purple-400 text-lg font-medium">Loading profile...</p>
        </div>
      </div>
    );
  }

  // If no user after auth is ready, let route guard handle redirect (don't return null)
  if (!user) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-[#0a0f1c] via-[#111727] to-[#000a0f] flex items-center justify-center">
        <div className="text-center">
          <p className="text-gray-400 text-lg">Redirecting to login...</p>
        </div>
      </div>
    );
  }

  // Always render content like Research page - no global loading/error states

  return (
    <ErrorBoundary>
      <div className="min-h-screen bg-gradient-to-br from-[#0a0f1c] via-[#111727] to-[#000a0f] overflow-y-auto">
        <main className="min-h-screen w-full relative z-10">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 sm:py-12">
            <h1 className="text-4xl font-extrabold text-white mb-10 border-b border-purple-500/30 pb-3">
              Profile
            </h1>

            {/* Always render content - sections handle their own loading/error states */}
            <div className="space-y-4">
              {loading && (
                <div className="flex justify-center items-center py-4 mb-4">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-500"></div>
                  <span className="ml-3 text-gray-400 text-sm">Loading profile data...</span>
                </div>
              )}
                {/* 1. USER INFORMATION */}
                <SettingsCard className="mb-8">
                  <h2 className="text-xl font-bold text-white mb-6 flex items-center gap-3">
                    User Information
                  </h2>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    <div className="flex items-start gap-6">
                      <div className="relative">
                        <div className="w-24 h-24 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center text-2xl font-bold text-white overflow-hidden shadow-lg border-2 border-white/10">
                          {profileData.profilePicture ? (
                            <img src={profileData.profilePicture} alt="Profile" className="w-full h-full object-cover" />
                          ) : (
                            getInitials(user)
                          )}
                        </div>
                        <label className="absolute bottom-0 right-0 bg-purple-600 hover:bg-purple-700 rounded-full p-2 cursor-pointer transition-colors shadow-lg border border-white/20">
                          <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                          </svg>
                          <input
                            type="file"
                            accept="image/*"
                            onChange={handleProfilePictureUpload}
                            className="hidden"
                            disabled={saving}
                          />
                        </label>
                      </div>
                      <div className="flex-1 space-y-4 pt-2">
                        <div>
                          <div className="text-xs text-gray-400 uppercase tracking-wider font-semibold mb-1">Full Name</div>
                          <div className="text-lg text-white font-medium">{profileData.displayName || 'Not set'}</div>
                        </div>
                        <div>
                          <div className="text-xs text-gray-400 uppercase tracking-wider font-semibold mb-1">Email</div>
                          <div className="text-white">{user.email}</div>
                        </div>
                      </div>
                    </div>
                    <div className="space-y-6 pt-2">
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <div className="text-xs text-gray-400 uppercase tracking-wider font-semibold mb-1">UID</div>
                          <div className="text-white font-mono text-sm bg-black/20 px-2 py-1 rounded border border-white/5 truncate">{user.uid}</div>
                        </div>
                        <div>
                          <div className="text-xs text-gray-400 uppercase tracking-wider font-semibold mb-1">Status</div>
                          <div className="text-emerald-400 text-sm font-medium flex items-center gap-1">
                            <span className="w-2 h-2 rounded-full bg-emerald-500"></span> Active
                          </div>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <div className="text-xs text-gray-400 uppercase tracking-wider font-semibold mb-1">Created</div>
                          <div className="text-white text-sm">{getAccountCreationDate(user)}</div>
                        </div>
                        <div>
                          <div className="text-xs text-gray-400 uppercase tracking-wider font-semibold mb-1">Last Login</div>
                          <div className="text-white text-sm">{getLastLogin(user)}</div>
                        </div>
                      </div>
                    </div>
                  </div>
                </SettingsCard>

                {/* 2. ACCOUNT SECURITY */}
                <SettingsCard className="mb-8">
                  <h2 className="text-xl font-bold text-white mb-6">Account Security</h2>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <button
                      onClick={() => setShowChangePasswordModal(true)}
                      className="group p-5 bg-slate-800/30 rounded-xl border border-white/10 hover:border-purple-500/50 hover:bg-slate-800/50 transition-all text-left"
                    >
                      <div className="flex items-center gap-4 mb-2">
                        <div className="w-10 h-10 rounded-lg bg-purple-500/10 flex items-center justify-center group-hover:bg-purple-500/20 transition-colors">
                          <svg className="w-5 h-5 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H7l2-4-4-2h4l2-4 2.257 4H17z" />
                          </svg>
                        </div>
                        <div>
                          <h3 className="text-base font-semibold text-white group-hover:text-purple-300 transition-colors">Change Password</h3>
                          <p className="text-xs text-gray-400 mt-0.5">Update your account password</p>
                        </div>
                      </div>
                    </button>

                    <button
                      onClick={() => setShowForgotPasswordModal(true)}
                      className="group p-5 bg-slate-800/30 rounded-xl border border-white/10 hover:border-blue-500/50 hover:bg-slate-800/50 transition-all text-left"
                    >
                      <div className="flex items-center gap-4 mb-2">
                        <div className="w-10 h-10 rounded-lg bg-blue-500/10 flex items-center justify-center group-hover:bg-blue-500/20 transition-colors">
                          <svg className="w-5 h-5 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                          </svg>
                        </div>
                        <div>
                          <h3 className="text-base font-semibold text-white group-hover:text-blue-300 transition-colors">Forgot Password</h3>
                          <p className="text-xs text-gray-400 mt-0.5">Reset your password via email</p>
                        </div>
                      </div>
                    </button>
                  </div>
                </SettingsCard>


                {/* 3. API USAGE DASHBOARD */}
                <div className="bg-slate-800/40 backdrop-blur-xl border border-purple-500/20 rounded-xl p-6">
                  <div className="flex items-center justify-between mb-6">
                    <div>
                      <h2 className="text-xl font-semibold text-white">API Usage Dashboard</h2>
                      <p className="text-xs text-gray-400 mt-1">Status of primary usage-limited APIs</p>
                    </div>

                    {apiProvidersStatus && (
                      <div className="flex flex-wrap gap-3 text-sm">
                        <div className="px-3 py-1 bg-purple-500/10 border border-purple-500/20 rounded-lg whitespace-nowrap">
                          <span className="text-gray-400">Calls Today: </span>
                          <span className="text-purple-300 font-bold ml-1">
                            {['coingecko', 'cryptocompare', 'newsdata', 'newsdataio'].reduce((total, pid) => {
                              let p: any = null;
                              ['marketData', 'news', 'metadata'].forEach(cat => {
                                const found = Object.values(apiProvidersStatus[cat] || {}).find((i: any) => (i.id === pid || i.providerName?.toLowerCase() === pid || i.provider?.toLowerCase() === pid));
                                if (found) p = found;
                              });
                              return total + (p?.usageStats?.usedToday || 0);
                            }, 0)}
                          </span>
                        </div>
                        <div className="px-3 py-1 bg-blue-500/10 border border-blue-500/20 rounded-lg whitespace-nowrap">
                          <span className="text-gray-400">Total Lifetime: </span>
                          <span className="text-blue-300 font-bold ml-1">
                            {['coingecko', 'cryptocompare', 'newsdata', 'newsdataio'].reduce((total, pid) => {
                              let p: any = null;
                              ['marketData', 'news', 'metadata'].forEach(cat => {
                                const found = Object.values(apiProvidersStatus[cat] || {}).find((i: any) => (i.id === pid || i.providerName?.toLowerCase() === pid || i.provider?.toLowerCase() === pid));
                                if (found) p = found;
                              });
                              return total + (p?.usageStats?.totalUsed || 0);
                            }, 0)}
                          </span>
                        </div>
                        <div className="px-3 py-1 bg-emerald-500/10 border border-emerald-500/20 rounded-lg whitespace-nowrap">
                          <span className="text-gray-400">Active APIs: </span>
                          <span className="text-emerald-300 font-bold ml-1">3</span>
                        </div>
                      </div>
                    )}
                    <h2 className="text-xl font-bold text-white flex items-center gap-3">
                    </h2>
                    <div className="flex gap-2">
                      <span className="text-xs text-purple-400 bg-purple-500/10 px-2 py-1 rounded border border-purple-500/20">
                        Auto-Refresh
                      </span>
                    </div>
                  </div>

                  {providersLoading ? (
                    <div className="flex justify-center items-center py-8">
                      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-500"></div>
                    </div>
                  ) : providersError ? (
                    <div className="text-center py-8">
                      <div className="text-red-400 text-sm">{providersError}</div>
                      <button
                        onClick={loadAllData}
                        className="mt-2 px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white text-sm rounded transition-colors"
                      >
                        Retry
                      </button>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                      {[
                        { id: 'coingecko', name: 'CoinGecko', cat: 'Market Data', icon: 'CG' },
                        { id: 'cryptocompare', name: 'CryptoCompare', cat: 'Metadata', icon: 'CC' },
                        { id: 'newsdata', name: 'NewsData.io', cat: 'News', icon: 'ND' }
                      ].map((def) => {
                        // Find provider data
                        let provider: any = null;
                        ['marketData', 'news', 'metadata'].forEach(cat => {
                          if (provider) return;
                          const found = Object.values((apiProvidersStatus || {})[cat] || {}).find((i: any) =>
                          (i.id === def.id || i.providerName?.toLowerCase() === def.id || i.provider?.toLowerCase() === def.id ||
                            (def.id === 'newsdata' && (i.id === 'newsdataio' || i.provider?.toLowerCase() === 'newsdataio')))
                          );
                          if (found) provider = found;
                        });

                        const usage = provider?.usageStats || {};
                        const usedToday = usage.usedToday || 0;
                        const usedThisMonth = usage.usedThisMonth || 0;
                        const totalUsed = usage.totalUsed || 0;

                        // STRICT display logic for Primary APIs
                        // 1. Force Fixed Limits if they are missing (visualization fallback)
                        // 2. Never show infinity
                        let dailyLimit = usage.dailyLimit;
                        let monthlyLimit = usage.monthlyLimit;
                        let limitSourceLabel = 'Fixed (DLXTRADE)'; // Default for these primaries
                        let limitSourceColor = 'text-purple-400';

                        // Hardcoded fallback if backend limits are somehow missing
                        if (!dailyLimit || !monthlyLimit) {
                          if (def.id === 'coingecko') { dailyLimit = 10000; monthlyLimit = 300000; }
                          if (def.id === 'cryptocompare') { dailyLimit = 100000; monthlyLimit = 3000000; }
                          if (def.id === 'newsdata') { dailyLimit = 200; monthlyLimit = 6000; }
                        }

                        // Determine Source Label - for Primary APIs, we FORCE "Fixed (DLXTRADE)"
                        // If checking backup APIs later, we would add logic here.
                        // But for this fixed list, it's always Fixed.

                        const dailyPercent = Math.min(100, Math.round((usedToday / dailyLimit) * 100));
                        const monthlyPercent = Math.min(100, Math.round((usedThisMonth / monthlyLimit) * 100));
                        const dailyRemaining = Math.max(0, dailyLimit - usedToday);

                        const getIconStyle = (id: string) => {
                          if (id === 'coingecko') return 'bg-green-500/20 text-green-500 border-green-500/30';
                          if (id === 'cryptocompare') return 'bg-amber-500/20 text-amber-500 border-amber-500/30';
                          return 'bg-blue-500/20 text-blue-500 border-blue-500/30';
                        };

                        return (
                          // Match Settings Page Inner Card Style
                          <div key={def.id} className="bg-slate-800/30 rounded-xl border border-purple-500/30 p-5 flex flex-col h-full hover:border-purple-500/50 transition-colors shadow-md">
                            {/* Header */}
                            <div className="flex items-center justify-between mb-4">
                              <div className="flex items-center gap-3">
                                <div className={`w-10 h-10 rounded-lg flex items-center justify-center font-bold text-sm border ${getIconStyle(def.id)}`}>
                                  {def.icon}
                                </div>
                                <div>
                                  <div className="text-base font-bold text-white leading-tight">{def.name}</div>
                                  <div className="text-xs text-gray-400 capitalize">{def.cat}</div>
                                </div>
                              </div>
                              <div className="flex flex-col items-end">
                                <span className={`px-2 py-0.5 rounded-full text-[10px] uppercase font-bold tracking-wider border ${provider?.enabled ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-gray-500/10 text-gray-400 border-gray-500/20'
                                  }`}>
                                  {provider?.enabled ? 'Active' : 'Inactive'}
                                </span>
                              </div>
                            </div>

                            <div className="flex-1 space-y-5">
                              {/* Daily Usage */}
                              <div>
                                <div className="flex justify-between text-xs mb-1.5">
                                  <span className="text-gray-300 font-medium">Daily Quota</span>
                                  <span className="text-gray-400">{usedToday.toLocaleString()} / {dailyLimit.toLocaleString()}</span>
                                </div>
                                <div className="w-full bg-slate-700/50 rounded-full h-2 overflow-hidden">
                                  <div
                                    className={`h-full rounded-full transition-all duration-500 ${dailyPercent > 90 ? 'bg-red-500' : dailyPercent > 70 ? 'bg-amber-500' : 'bg-green-500'
                                      }`}
                                    style={{ width: `${dailyPercent}%` }}
                                  ></div>
                                </div>
                                <div className="text-[10px] text-right mt-1 text-gray-500">
                                  {usedToday === 0 ? 'No API calls yet' : `${dailyRemaining.toLocaleString()} remaining`}
                                </div>
                              </div>

                              {/* Monthly Usage */}
                              <div>
                                <div className="flex justify-between text-xs mb-1.5">
                                  <span className="text-gray-300 font-medium">Monthly Quota</span>
                                  <span className="text-gray-400">{monthlyLimit > 1000000 ? (monthlyLimit / 1000000).toFixed(1) + 'M' : monthlyLimit.toLocaleString()} / {monthlyLimit.toLocaleString()}</span>
                                </div>
                                <div className="w-full bg-slate-700/50 rounded-full h-2 overflow-hidden">
                                  <div
                                    className={`h-full rounded-full transition-all duration-500 ${monthlyPercent > 90 ? 'bg-red-500' : monthlyPercent > 70 ? 'bg-amber-500' : 'bg-blue-500'
                                      }`}
                                    style={{ width: `${monthlyPercent}%` }}
                                  ></div>
                                </div>
                              </div>
                            </div>

                            {/* Footer Stats */}
                            <div className="mt-5 pt-3 border-t border-white/5 grid grid-cols-2 gap-2 text-xs">
                              <div>
                                <div className="text-gray-500 mb-0.5">Limit Source</div>
                                <div className={`font-medium ${limitSourceColor}`}>
                                  {limitSourceLabel}
                                </div>
                                <div className="text-[10px] text-gray-600 mt-0.5">Platform Managed</div>
                              </div>
                              <div className="text-right">
                                <div className="text-gray-500 mb-0.5">Lifetime Calls</div>
                                <div className="text-white font-mono">{totalUsed.toLocaleString()}</div>
                              </div>
                            </div>

                          </div>
                        );
                      })}
                    </div>
                  )}

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
                      {usageStatsError ? (
                        <div className="flex items-center gap-2">
                          <span className="text-red-400 text-sm">{usageStatsError}</span>
                          <button
                            onClick={() => {
                              usageStatsRetryCountRef.current = 0;
                              setUsageStatsRetryCount(0);
                              setUsageStatsError(null);
                              api.get(`/users/${user?.uid}/usage-stats`, { timeout: 20000 })
                                .then(res => {
                                  if (isMountedRef.current) {
                                    setUsageStats(res.data);
                                    setUsageStatsError(null);
                                  }
                                })
                                .catch(err => {
                                  console.warn('[Profile] Usage stats retry failed:', err.message);
                                  if (isMountedRef.current) setUsageStatsError('Failed to load — Retry');
                                });
                            }}
                            className="px-3 py-1 bg-purple-600 hover:bg-purple-700 text-white text-xs rounded transition-colors"
                          >
                            Retry
                          </button>
                        </div>
                      ) : usageStats?.lastResearchTimestamp ? (
                        new Date(usageStats.lastResearchTimestamp).toLocaleString()
                      ) : (
                        'No research runs yet'
                      )}
                    </div>
                  </div>
                </div>

                {/* 6. ALL AGENTS */}
                <div className="bg-slate-800/40 backdrop-blur-xl border border-purple-500/20 rounded-xl p-6">
                  <h2 className="text-xl font-semibold text-white mb-4">All Agents</h2>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {Array.isArray(allAgents) ? allAgents.map((agent: any) => (
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
                        <div className="text-xs text-gray-400 line-clamp-2">{agent.description}                        </div>
                      </div>
                    )) : (
                      <div className="text-sm text-gray-400 text-center py-4 col-span-full">No agents available</div>
                    )}
                  </div>
                </div>

                {/* SESSION MANAGEMENT */}
                <div className="bg-slate-800/40 backdrop-blur-xl border border-purple-500/20 rounded-xl p-6">
                  <h2 className="text-xl font-semibold text-white mb-4">Session Management</h2>
                  <div className="space-y-4">
                    <div>
                      <h3 className="text-lg font-medium text-white mb-3">Recent Login Sessions</h3>
                      {sessionsError ? (
                        <div className="text-center py-8">
                          <div className="text-red-400 text-sm mb-2">{sessionsError}</div>
                          <button
                            onClick={() => {
                              sessionsRetryCountRef.current = 0;
                              setSessionsRetryCount(0);
                              setSessionsError(null);
                              api.get(`/users/${user?.uid}/sessions`, { timeout: 25000 })
                                .then(res => {
                                  if (isMountedRef.current) {
                                    setSessions(Array.isArray(res.data?.sessions) ? res.data.sessions : []);
                                    setSessionsError(null);
                                  }
                                })
                                .catch(err => {
                                  console.warn('[Profile] Sessions retry failed:', err.message);
                                  if (isMountedRef.current) setSessionsError('Failed to load — Retry');
                                });
                            }}
                            className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white text-sm rounded transition-colors"
                          >
                            Retry
                          </button>
                        </div>
                      ) : (
                      <div className="space-y-2 max-h-48 overflow-y-auto">
                        {Array.isArray(sessions) ? sessions.slice(0, 5).map((session: any, index: number) => {
                          const sessionDate = session.lastActive || session.timestamp || session.createdAt;
                          return (
                            <div key={session.id || index} className="flex items-center justify-between p-3 bg-slate-900/50 rounded-lg border border-purple-500/20">
                              <div className="flex items-center gap-3">
                                <div className="w-8 h-8 rounded-lg bg-slate-700/50 flex items-center justify-center">
                                  <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                                  </svg>
                                </div>
                                <div>
                                  <div className="text-sm text-white">{session.device || session.userAgent || 'Unknown Device'}</div>
                                  <div className="text-xs text-gray-400">
                                    {sessionDate ? new Date(sessionDate).toLocaleString() : 'Unknown time'}
                                  </div>
                                </div>
                              </div>
                              <div className="text-xs text-gray-400 text-right">
                                {session.location || session.ipAddress || 'Unknown'}
                              </div>
                            </div>
                          );
                        }) : null}
                          {(!Array.isArray(sessions) || sessions.length === 0) && !sessionsError && (
                          <div className="text-sm text-gray-400 text-center py-8">No login sessions found</div>
                        )}
                      </div>
                      )}
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
                      {pendingDeletion || userData?.pendingDeletion ? (
                        <div className="text-sm text-yellow-400 bg-yellow-900/20 border border-yellow-500/30 rounded-lg p-3">
                          Account deletion request sent. Waiting for admin approval.
                        </div>
                      ) : (
                        <button
                          onClick={() => setShowDeleteConfirm(true)}
                          disabled={pendingDeletion}
                          className="px-4 py-2 text-sm font-medium text-red-300 bg-red-900/30 border border-red-500/30 rounded-lg hover:bg-red-900/50 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
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
                    <div className="bg-slate-800 border border-red-500/30 rounded-xl p-6 max-w-md w-full mx-4">
                      <h3 className="text-lg font-semibold text-white mb-4">⚠️ Confirm Account Deletion Request</h3>
                      <div className="bg-red-900/20 border border-red-500/30 rounded-lg p-4 mb-4">
                        <p className="text-sm text-red-300 font-medium mb-2">This action is irreversible!</p>
                        <p className="text-sm text-gray-300">
                          Your account deletion request will be sent to an admin for approval. Once approved, all your data will be permanently deleted and cannot be recovered.
                        </p>
                      </div>
                      <p className="text-sm text-gray-400 mb-6">
                        Are you absolutely sure you want to proceed?
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
          </div>
        </main>

        {toast && <Toast message={toast.message} type={toast.type} />}
      </div>
    </ErrorBoundary>
  );
}

