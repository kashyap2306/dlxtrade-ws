import * as admin from 'firebase-admin';
import { getFirebaseAdmin } from '../utils/firebase';
import { firestoreAdapter } from './firestoreAdapter';
import { logger } from '../utils/logger';

/**
 * Idempotent user onboarding service
 * Creates ALL required Firestore documents when user signs up/logs in
 * Can be called multiple times safely - only creates missing documents/fields
 */

export interface UserOnboardingResult {
  success: boolean;
  createdNew: boolean;
  uid: string;
  error?: string;
}

export async function ensureUser(
  uid: string,
  profileData?: {
    name?: string;
    email?: string;
    phone?: string | null;
  }
): Promise<UserOnboardingResult> {
  const startTime = Date.now();
  let createdNew = false;
  
  try {
    const db = getFirebaseAdmin().firestore();
    const now = admin.firestore.Timestamp.now();

    logger.info({ uid, email: profileData?.email }, 'Starting user onboarding (ensureUser)');

    // 1. Ensure users/{uid} exists with ALL required fields (idempotent)
    const userRef = db.collection('users').doc(uid);
    const existingUser = await userRef.get();
    
    if (!existingUser.exists) {
      // Create new user with full schema
      const userData: any = {
        uid,
        name: profileData?.name || '',
        email: profileData?.email || '',
        phone: profileData?.phone || null,
        createdAt: now,
        updatedAt: now,
        onboardingRequired: true, // New users must complete onboarding
        tradingMarkets: [],
        experienceLevel: '',
        interestedAgents: [],
        portfolioSize: '',
        preferences: {
          riskLevel: '',
          tradingStyle: '',
          analysisType: '',
        },
        isApiConnected: false,
        connectedExchanges: [],
        totalTrades: 0,
        totalPnl: 0,
        dailyPnl: 0,
        weeklyPnl: 0,
        monthlyPnl: 0,
        unlockedAgents: [],
        apiStatus: 'disconnected',
        engineStatus: 'stopped',
        hftRunning: false,
        engineRunning: false,
        autoTradeEnabled: false,
        role: 'user',
        profilePicture: null,
        lastLogin: now,
      };
      
      await userRef.set(userData);
      createdNew = true;
      logger.info({ uid, createdNew: true }, '✅ User document created');
    } else {
      // Update only missing fields (do not overwrite existing user-provided fields)
      const existingData = existingUser.data() || {};
      const updateData: any = {
        updatedAt: now,
        lastLogin: now,
      };
      
      // Only update if field is missing or empty
      if (!existingData.name && profileData?.name) {
        updateData.name = profileData.name;
      }
      if (!existingData.email && profileData?.email) {
        updateData.email = profileData.email;
      }
      if (!existingData.phone && profileData?.phone) {
        updateData.phone = profileData.phone;
      }
      // Ensure onboarding fields exist (don't overwrite if already set)
      if (existingData.onboardingRequired === undefined) {
        updateData.onboardingRequired = true;
      }
      if (existingData.tradingMarkets === undefined) {
        updateData.tradingMarkets = [];
      }
      if (existingData.experienceLevel === undefined) {
        updateData.experienceLevel = '';
      }
      if (existingData.interestedAgents === undefined) {
        updateData.interestedAgents = [];
      }
      if (existingData.portfolioSize === undefined) {
        updateData.portfolioSize = '';
      }
      if (existingData.preferences === undefined) {
        updateData.preferences = {
          riskLevel: '',
          tradingStyle: '',
          analysisType: '',
        };
      }
      
      // Ensure required fields exist
      if (existingData.isApiConnected === undefined) {
        updateData.isApiConnected = false;
      }
      if (existingData.connectedExchanges === undefined) {
        updateData.connectedExchanges = [];
      }
      if (existingData.totalTrades === undefined) {
        updateData.totalTrades = 0;
      }
      if (existingData.totalPnl === undefined) {
        updateData.totalPnl = 0;
      }
      if (existingData.dailyPnl === undefined) {
        updateData.dailyPnl = 0;
      }
      if (existingData.weeklyPnl === undefined) {
        updateData.weeklyPnl = 0;
      }
      if (existingData.monthlyPnl === undefined) {
        updateData.monthlyPnl = 0;
      }
      if (existingData.unlockedAgents === undefined) {
        updateData.unlockedAgents = [];
      }
      if (existingData.apiStatus === undefined) {
        updateData.apiStatus = 'disconnected';
      }
      if (existingData.engineStatus === undefined) {
        updateData.engineStatus = 'stopped';
      }
      if (existingData.hftRunning === undefined) {
        updateData.hftRunning = false;
      }
      if (existingData.engineRunning === undefined) {
        updateData.engineRunning = false;
      }
      if (existingData.autoTradeEnabled === undefined) {
        updateData.autoTradeEnabled = false;
      }
      if (existingData.role === undefined) {
        updateData.role = 'user';
      }
      if (existingData.profilePicture === undefined) {
        updateData.profilePicture = null;
      }
      
      if (Object.keys(updateData).length > 2) { // More than just updatedAt and lastLogin
        await userRef.update(updateData);
        logger.info({ uid, updatedFields: Object.keys(updateData) }, 'User document updated with missing fields');
      } else {
        await userRef.update(updateData); // Still update lastLogin
      }
      
      logger.info({ uid, createdNew: false }, '✅ User document exists');
    }

    // 2. Create apiKeys/{uid} (if not exists)
    const apiKeysRef = db.collection('apiKeys').doc(uid);
    const existingApiKeys = await apiKeysRef.get();
    
    if (!existingApiKeys.exists) {
      await apiKeysRef.set({
        uid,
        exchange: '',
        apiKeyEncrypted: '',
        apiSecretEncrypted: '',
        createdAt: now,
        updatedAt: now,
        status: 'disconnected',
      });
      logger.info({ uid }, 'API keys document created');
    }

    // 3. Create engineStatus/{uid}
    const engineStatusRef = db.collection('engineStatus').doc(uid);
    const existingEngineStatus = await engineStatusRef.get();
    
    if (!existingEngineStatus.exists) {
      await engineStatusRef.set({
        uid,
        engineRunning: false,
        autoTradeEnabled: false,
        lastStarted: null,
        lastStopped: null,
        ordersExecuted: 0,
        totalPnl: 0,
        riskLevel: 'medium',
        updatedAt: now,
      });
      logger.info({ uid }, 'Engine status document created');
    }

    // 4. Create uiPreferences/{uid}
    const prefsRef = db.collection('uiPreferences').doc(uid);
    const existingPrefs = await prefsRef.get();
    
    if (!existingPrefs.exists) {
      await prefsRef.set({
        uid,
        dismissedAgents: [],
        sidebarCollapsed: false,
        showHftPanel: false,
        updatedAt: now,
      });
      logger.info({ uid }, 'UI preferences document created');
    }

    // 5. Create settings/{uid}
    const settingsRef = db.collection('settings').doc(uid);
    const existingSettings = await settingsRef.get();
    
    if (!existingSettings.exists) {
      await settingsRef.set({
        uid,
        theme: 'dark',
        riskMode: 'medium',
        maxDailyLoss: 5, // pct
        maxDailyTrades: 100,
        maxExposure: 0.2, // 20% of balance
        cooldownAfterSLSec: 300,
        stopLossMode: 'fixed_pct', // 'fixed_pct' | 'atr' | 'none'
        takeProfitMode: 'fixed_pct', // 'fixed_pct' | 'rr' | 'none'
        autoEngineStart: false,
        autoHftStart: false,
        updatedAt: now,
      });
      logger.info({ uid }, 'Settings document created');
    }

    // 6. Create users/{uid}/profile document (exact schema match)
    const profileRef = db.collection('users').doc(uid).collection('profile').doc('current');
    const existingProfile = await profileRef.get();
    
    if (!existingProfile.exists) {
      await profileRef.set({
        uid,
        email: profileData?.email || '',
        displayName: profileData?.name || '',
        createdAt: now,
        lastLogin: now,
        role: 'user',
        active: true,
      });
      logger.info({ uid }, 'User profile document created');
    } else {
      // Update missing fields
      const existingProfileData = existingProfile.data() || {};
      const profileUpdate: any = {
        lastLogin: now,
      };
      if (!existingProfileData.uid) {
        profileUpdate.uid = uid;
      }
      if (!existingProfileData.email && profileData?.email) {
        profileUpdate.email = profileData.email;
      }
      if (!existingProfileData.displayName && profileData?.name) {
        profileUpdate.displayName = profileData.name;
      }
      if (existingProfileData.role === undefined) {
        profileUpdate.role = 'user';
      }
      if (existingProfileData.active === undefined) {
        profileUpdate.active = true;
      }
      if (existingProfileData.createdAt === undefined) {
        profileUpdate.createdAt = now;
      }
      await profileRef.update(profileUpdate);
      logger.info({ uid }, 'User profile document updated');
    }

    // 7. Create users/{uid}/settings document (exact schema match)
    const userSettingsRef = db.collection('users').doc(uid).collection('settings').doc('current');
    const existingUserSettings = await userSettingsRef.get();
    
    if (!existingUserSettings.exists) {
      await userSettingsRef.set({
        strategy: 'orderbook_imbalance',
        accuracyThreshold: 0.85,
        autoTrade: false,
        hftEnabled: false,
        liveMode: false,
        runIntervalSec: 5,
        risk: {
          max_loss_pct: 5,
          max_drawdown_pct: 10,
          per_trade_risk_pct: 0.5,
          max_pos: 0.02,
        },
        updatedAt: now,
        status: 'idle',
      });
      logger.info({ uid }, 'User settings subcollection document created');
    } else {
      // Update missing fields to match exact schema
      const existingSettings = existingUserSettings.data() || {};
      const settingsUpdate: any = {};
      
      if (existingSettings.strategy === undefined) {
        settingsUpdate.strategy = 'orderbook_imbalance';
      }
      if (existingSettings.accuracyThreshold === undefined) {
        settingsUpdate.accuracyThreshold = 0.85;
      }
      if (existingSettings.autoTrade === undefined) {
        settingsUpdate.autoTrade = existingSettings.autoTradeEnabled || false;
      }
      if (existingSettings.hftEnabled === undefined) {
        settingsUpdate.hftEnabled = false;
      }
      if (existingSettings.liveMode === undefined) {
        settingsUpdate.liveMode = false;
      }
      if (existingSettings.runIntervalSec === undefined) {
        settingsUpdate.runIntervalSec = 5;
      }
      if (!existingSettings.risk) {
        settingsUpdate.risk = {
          max_loss_pct: existingSettings.max_loss_pct || 5,
          max_drawdown_pct: existingSettings.max_drawdown_pct || 10,
          per_trade_risk_pct: existingSettings.per_trade_risk_pct || 0.5,
          max_pos: existingSettings.maxPos || 0.02,
        };
      }
      if (existingSettings.status === undefined) {
        settingsUpdate.status = 'idle';
      }
      
      if (Object.keys(settingsUpdate).length > 0) {
        settingsUpdate.updatedAt = now;
        await userSettingsRef.update(settingsUpdate);
        logger.info({ uid }, 'User settings updated to match schema');
      }
    }

    // 8. Create users/{uid}/uiPreferences document (if not exists in subcollection)
    const userUIPrefsRef = db.collection('users').doc(uid).collection('uiPreferences').doc('current');
    const existingUserUIPrefs = await userUIPrefsRef.get();
    
    if (!existingUserUIPrefs.exists) {
      await userUIPrefsRef.set({
        dismissedAgents: [],
        updatedAt: now,
      });
      logger.info({ uid }, 'User UI preferences subcollection document created');
    }

    // 9. Initialize required collections and docs under users/{uid}
    const userDocRef = db.collection('users').doc(uid);

    // users/{uid}/integrations: create default disabled docs
    const integrations = ['binance', 'lunarcrush', 'cryptoquant', 'coinapi_market', 'coinapi_flatfile', 'coinapi_exchangerate'];
    for (const apiName of integrations) {
      const ref = userDocRef.collection('integrations').doc(apiName);
      const doc = await ref.get();
      if (!doc.exists) {
        await ref.set({
          enabled: false,
          apiKey: '',
          secretKey: '',
          apiType: apiName.startsWith('coinapi_') ? apiName.replace('coinapi_', '') : undefined,
          updatedAt: now,
          verified: false,
          lastCheckedAt: null,
        });
      }
    }

    // users/{uid}/riskLimits/current
    const riskRef = userDocRef.collection('riskLimits').doc('current');
    const riskDoc = await riskRef.get();
    if (!riskDoc.exists) {
      await riskRef.set({
        max_loss_pct: 5,
        max_drawdown_pct: 10,
        per_trade_risk_pct: 0.5,
        max_pos: 0.02,
        cooldownAfterSLSec: 300,
        updatedAt: now,
      });
    }

    // users/{uid}/engineStatus/current
    const userEngineStatusRef = userDocRef.collection('engineStatus').doc('current');
    const userEngineStatusDoc = await userEngineStatusRef.get();
    if (!userEngineStatusDoc.exists) {
      await userEngineStatusRef.set({
        engineRunning: false,
        autoTradeEnabled: false,
        lastStarted: null,
        lastStopped: null,
        ordersExecuted: 0,
        totalPnl: 0,
        updatedAt: now,
      });
    }

    // users/{uid}/autoTrade/current
    const autoTradeRef = userDocRef.collection('autoTrade').doc('current');
    const autoTradeDoc = await autoTradeRef.get();
    if (!autoTradeDoc.exists) {
      await autoTradeRef.set({
        enabled: false,
        accuracyThreshold: 0.85,
        strategy: 'orderbook_imbalance',
        updatedAt: now,
      });
    }

    // Initialize empty containers with a placeholder doc to ensure collection exists
    const initCollection = async (path: string) => {
      const ref = userDocRef.collection(path).doc('_init');
      const doc = await ref.get();
      if (!doc.exists) {
        await ref.set({ createdAt: now });
      }
    };
    await initCollection('trades');
    await initCollection('positions');
    await initCollection('executionLogs');
    await initCollection('researchLogs');

    // 10. Ensure agents subcollection exists and all agents are created with unlocked=false
    try {
      const allAgentsSnapshot = await db.collection('agents').get();
      for (const doc of allAgentsSnapshot.docs) {
        const agentId = doc.id;
        const agentData = doc.data() || {};
        const userAgentRef = userDocRef.collection('agents').doc(agentId);
        const userAgentDoc = await userAgentRef.get();
        if (!userAgentDoc.exists) {
          await userAgentRef.set({
            name: agentData.name || agentId,
            description: agentData.description || '',
            unlocked: false,
            createdAt: now,
            updatedAt: now,
          });
        } else {
          // Ensure required fields exist without overwriting unlocked status
          const u = userAgentDoc.data() || {};
          const patch: any = {};
          if (u.name === undefined) patch.name = agentData.name || agentId;
          if (u.description === undefined) patch.description = agentData.description || '';
          patch.updatedAt = now;
          if (Object.keys(patch).length > 0) {
            await userAgentRef.set(patch, { merge: true });
          }
        }
      }
    } catch (err) {
      logger.warn({ err }, 'Could not initialize user agents subcollection (continuing)');
    }

    // 11. Log activity (USER_CREATED for new users, USER_LOGIN for existing)
    const activityType = createdNew ? 'USER_CREATED' : 'USER_LOGIN';
    await firestoreAdapter.logActivity(uid, activityType, {
      message: createdNew 
        ? `User ${profileData?.email || uid} signed up`
        : `User ${profileData?.email || uid} logged in`,
      email: profileData?.email,
    });

    // 11. Update globalStats atomically if new user created
    if (createdNew) {
      const globalStatsRef = db.collection('globalStats').doc('main');
      const globalStats = await globalStatsRef.get();
      
      if (globalStats.exists) {
        const currentStats = globalStats.data();
        await globalStatsRef.update({
          totalUsers: admin.firestore.FieldValue.increment(1),
          updatedAt: now,
        });
      } else {
        // Count actual users
        const usersSnapshot = await db.collection('users').get();
        await globalStatsRef.set({
          totalUsers: usersSnapshot.size,
          totalTrades: 0,
          totalAgentsUnlocked: 0,
          runningEngines: 0,
          runningHFT: 0,
          totalPnl: 0,
          updatedAt: now,
        });
      }
    }

    const duration = Date.now() - startTime;
    logger.info({ 
      uid, 
      createdNew, 
      duration, 
      activityType,
      email: profileData?.email 
    }, '✅ User onboarding completed successfully');

    return {
      success: true,
      createdNew,
      uid,
    };
  } catch (error: any) {
    const duration = Date.now() - startTime;
    logger.error({ 
      error: error.message, 
      stack: error.stack,
      uid,
      duration 
    }, '❌ Error during user onboarding');
    
    // Log to Firestore logs collection
    try {
      const db = getFirebaseAdmin().firestore();
      await db.collection('logs').add({
        type: 'error',
        category: 'user_onboarding',
        uid,
        message: error.message,
        stack: error.stack,
        timestamp: admin.firestore.Timestamp.now(),
      });
    } catch (logError) {
      logger.error({ logError }, 'Failed to log error to Firestore');
    }

    return {
      success: false,
      createdNew: false,
      uid,
      error: error.message,
    };
  }
}

// Backward compatibility - keep old function name
export async function onboardNewUser(
  uid: string,
  userData: {
    name?: string;
    email?: string;
    phone?: string | null;
  }
): Promise<void> {
  const result = await ensureUser(uid, userData);
  if (!result.success) {
    throw new Error(result.error || 'User onboarding failed');
  }
}

