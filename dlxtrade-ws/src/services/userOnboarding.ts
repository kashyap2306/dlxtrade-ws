import * as admin from 'firebase-admin';
import { getFirebaseAdmin } from '../utils/firebase';
import { firestoreAdapter } from './firestoreAdapter';
import { logger } from '../utils/logger';

// DLXTRADE Provider System - 33 providers total
const PROVIDERS = {
  // Market Data Providers (11 total)
  MARKET_DATA: [
    'coingecko', // Primary - no key required
    'coinpaprika',
    'coinmarketcap',
    'coinlore',
    'coinapi',
    'bravenewcoin',
    'messari',
    'kaiko',
    'livecoinwatch',
    'coinstats',
    'coincheckup'
  ],

  // News Providers (11 total)
  NEWS: [
    'newsdata', // Primary - key required
    'cryptopanic',
    'reddit',
    'cointelegraph_rss',
    'altcoinbuzz_rss',
    'gnews',
    'marketaux',
    'webzio',
    'coinstatsnews',
    'newscatcher',
    'cryptocompare_news'
  ],

  // Metadata Providers (11 total)
  METADATA: [
    'cryptocompare', // Primary - key required
    'coingecko_metadata',
    'coinpaprika_metadata',
    'coinmarketcap_metadata',
    'coinstats_metadata',
    'cryptocompare_metadata',
    'livecoinwatch_metadata',
    'messari_metadata',
    'coinlore_metadata',
    'coincheckup_metadata',
    'coincap_metadata'
  ]
};

// All providers flattened for integration creation
const ALL_PROVIDERS = [
  ...PROVIDERS.MARKET_DATA,
  ...PROVIDERS.NEWS,
  ...PROVIDERS.METADATA
];

// Providers that require API keys
const KEY_REQUIRED_PROVIDERS = [
  'newsdata',
  'cryptopanic',
  'gnews',
  'marketaux',
  'webzio',
  'newscatcher',
  'cryptocompare_news',
  'cryptocompare',
  'coinmarketcap',
  'coinmarketcap_metadata',
  'coinapi',
  'bravenewcoin',
  'messari',
  'messari_metadata',
  'kaiko',
  'livecoinwatch',
  'livecoinwatch_metadata',
  'coinstats',
  'coinstats_metadata'
];

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
  console.log("ENSUREUSER CALLED");
  const startTime = Date.now();
  let createdNew = false;
  
  try {
    // Ensure Firebase Admin is initialized before proceeding
    const firebaseApp = getFirebaseAdmin();
    if (!firebaseApp) {
      logger.error({ uid, email: profileData?.email }, '❌ Firebase Admin not initialized - cannot create user documents');
      return {
        success: false,
        createdNew: false,
        uid,
        error: 'Firebase Admin not initialized - please try again in a few seconds'
      };
    }

    const db = firebaseApp.firestore();
    const now = admin.firestore.Timestamp.now();

    logger.info({ uid, email: profileData?.email }, '🚀 Starting user onboarding (ensureUser) - creating all required Firestore documents');

    // 1. Ensure users/{uid} exists with ALL required fields (idempotent)
    const userRef = db.collection('users').doc(uid);
    const existingUser = await userRef.get();
    
    if (!existingUser.exists) {
      // Create minimal base user document immediately - REQUIREMENT: NO other onboarding code runs before this base doc exists
      const baseUserData = {
        uid,
        email: profileData?.email || '',
        createdAt: now,
        lastLogin: now,
        apiProviders: {} // empty object, keep as default
      };

      logger.info({ uid, baseFields: Object.keys(baseUserData) }, '🔄 Creating minimal base user document');

      await userRef.set(baseUserData);
      createdNew = true;
      logger.info({ uid, createdNew: true, path: `users/${uid}` }, '✅ Base user document created');

      // Verify the document was created
      const verifyDoc = await userRef.get();
      if (!verifyDoc.exists) {
        throw new Error('Base user document creation failed - document does not exist after set()');
      }
      logger.info({ uid }, '✅ Base user document creation verified');
    }

      logger.info({ uid, baseFields: Object.keys(baseUserData) }, '🔄 Creating minimal base user document (signup fix)');

      await userRef.set(baseUserData);
      createdNew = true;
      logger.info({ uid, createdNew: true, path: `users/${uid}` }, '✅ Base user document created: users/{uid}');

      // Verify the document was created
      const verifyDoc = await userRef.get();
      if (!verifyDoc.exists) {
        throw new Error('Base user document creation failed - document does not exist after set()');
      }
      logger.info({ uid }, '✅ Base user document creation verified');
    } else {
      // Update only missing fields (do not overwrite existing user-provided fields)
      const existingData = existingUser.data() || {};

      logger.info({ uid, existingFields: Object.keys(existingData) }, '🔄 Existing user document found, checking for missing fields');

      const updateData: any = {
        updatedAt: now,
        lastLogin: now,
      };

      // Only update if field is missing or empty
      if (!existingData.uid) {
        updateData.uid = uid;
      }
      if (!existingData.email && profileData?.email) {
        updateData.email = profileData.email;
      }
      if (existingData.apiProviders === undefined) {
        updateData.apiProviders = {};
      }
      const fieldsToUpdate = Object.keys(updateData).filter(key => key !== 'lastLogin');

      if (fieldsToUpdate.length > 0) {
        logger.info({ uid, fieldsToUpdate }, '🔄 Updating existing user with missing basic fields');
        await userRef.update(updateData);
        logger.info({ uid, updatedFields: fieldsToUpdate }, '✅ User document updated with missing basic fields');
      } else {
        await userRef.update({ lastLogin: now }); // Still update login timestamp
        logger.info({ uid }, '✅ User document exists and basic fields are present');
      }

    }
          metadata: PROVIDERS.METADATA.map(id => ({
            id,
            category: 'metadata',
            keyRequired: KEY_REQUIRED_PROVIDERS.includes(id)
          }))
        };
      }
      if (existingData.tradingSettings === undefined) {
        updateData.tradingSettings = {
          mode: 'MANUAL',
          manualCoins: [],
          maxPositionPerTrade: 10,
          tradeType: 'Scalping',
          accuracyTrigger: 80,
          maxDailyLoss: 5,
          maxTradesPerDay: 50,
          positionSizingMap: [
            { min: 0, max: 25, percent: 1 },
            { min: 25, max: 50, percent: 2 },
            { min: 50, max: 75, percent: 3 },
            { min: 75, max: 100, percent: 5 }
          ]
        };
      }
      if (existingData.notifications === undefined) {
        updateData.notifications = {
          autoTradeAlerts: false,
          autoTradeAlertsPrereqMet: false,
          accuracyAlerts: {
            enabled: false,
            threshold: 80,
            telegramEnabled: false
          },
          whaleAlerts: {
            enabled: false,
            sensitivity: 'medium',
            telegramEnabled: false
          },
          requireTradeConfirmation: false,
          soundEnabled: false,
          vibrateEnabled: false,
          telegramEnabled: false,
          telegramChatId: ''
        };
      }
      if (existingData.backgroundResearch === undefined) {
        updateData.backgroundResearch = {
          telegramEnabled: false,
          telegramToken: '',
          chatId: '',
          thresholds: {
            minAccuracy: 80,
            maxFrequency: 10
          },
          scheduleInterval: 5
        };
      }
      if (existingData.notificationSettings === undefined) {
        updateData.notificationSettings = {
          enableAutoTradeAlerts: false,
          enableAccuracyAlerts: false,
          enableWhaleAlerts: false,
          tradeConfirmationRequired: false,
          notificationSounds: false,
          notificationVibration: false,
          telegramBotToken: '',
          telegramChatId: ''
        };
      }
      if (existingData.seenPopups === undefined) {
        updateData.seenPopups = [];
      }
      if (existingData.researchSettings === undefined) {
        updateData.researchSettings = {
          coinSelectionMode: 'manual',
          selectedCoins: [],
          accuracyTrigger: 80
        };
      }
      if (existingData.riskLimits === undefined) {
        updateData.riskLimits = {
          max_loss_pct: 5,
          max_drawdown_pct: 10,
          per_trade_risk_pct: 0.5,
          max_pos: 0.02,
          cooldownAfterSLSec: 300
        };
      }
      if (existingData.autoTrade === undefined) {
        updateData.autoTrade = {
          enabled: false,
          accuracyThreshold: 0.85,
          strategy: 'orderbook_imbalance'
        };
      }

      // Ensure required fields exist
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

      const fieldsToUpdate = Object.keys(updateData).filter(key => key !== 'updatedAt' && key !== 'lastLogin');

      if (fieldsToUpdate.length > 0) {
        logger.info({ uid, fieldsToUpdate }, '🔄 Updating existing user with missing fields');
        await userRef.update(updateData);
        logger.info({ uid, updatedFields: fieldsToUpdate }, '✅ User document updated with missing fields');
      } else {
        await userRef.update({ updatedAt: now, lastLogin: now }); // Still update timestamps
        logger.info({ uid }, '✅ User document exists and is up-to-date');
      }

      logger.info({ uid, createdNew: false, path: `users/${uid}` }, '✅ Main user document exists: users/{uid}');
    }

    // 2. API keys are now stored in users/{uid}/exchangeConfig/current and users/{uid}/integrations/{apiName}
    // No need to create apiKeys collection document

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
        providerPriority: {
          marketData: [...PROVIDERS.MARKET_DATA],
          news: [...PROVIDERS.NEWS],
          metadata: [...PROVIDERS.METADATA]
        }
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
      if (!existingSettings.providerPriority) {
        settingsUpdate.providerPriority = {
          marketData: [...PROVIDERS.MARKET_DATA],
          news: [...PROVIDERS.NEWS],
          metadata: [...PROVIDERS.METADATA]
        };
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

    // users/{uid}/integrations: create default disabled docs for ALL 33 DLXTRADE providers
    // Trading exchanges (binance, bitget, bingx, weex) are stored in exchangeConfig/current, NOT in integrations
    for (const providerId of ALL_PROVIDERS) {
      const ref = userDocRef.collection('integrations').doc(providerId);
      const doc = await ref.get();
      if (!doc.exists) {
        const integrationData = {
          enabled: false,
          apiKey: "",
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        };

        await ref.set(integrationData);
        logger.info({ uid, providerId, path: `users/${uid}/integrations/${providerId}` }, `✅ Provider integration doc created: users/{uid}/integrations/${providerId}`);
      }
    }

    // users/{uid}/exchangeConfig/current - Create empty trading exchange config doc
    const exchangeConfigRef = userDocRef.collection('exchangeConfig').doc('current');
    const exchangeConfigDoc = await exchangeConfigRef.get();
    if (!exchangeConfigDoc.exists) {
      // Create empty trading exchange config - fields will be set when user configures an exchange
      await exchangeConfigRef.set({
        testnet: true,
        createdAt: now,
        updatedAt: now,
      });
      logger.info({ uid, path: `users/${uid}/exchangeConfig/current` }, `✅ Trading exchange config doc created: users/{uid}/exchangeConfig/current`);
    } else {
      // Ensure required fields exist
      const existingData = exchangeConfigDoc.data() || {};
      const updateData: any = {};
      if (existingData.createdAt === undefined) {
        updateData.createdAt = now;
      }
      if (existingData.updatedAt === undefined) {
        updateData.updatedAt = now;
      }
      if (existingData.testnet === undefined) {
        updateData.testnet = true;
      }
      if (Object.keys(updateData).length > 0) {
        await exchangeConfigRef.update(updateData);
        logger.info({ uid, updatedFields: Object.keys(updateData), path: `users/${uid}/exchangeConfig/current` }, 'Exchange config updated with missing fields');
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
    
    // Log summary of all documents created/verified
    const createdDocs = [];
    if (createdNew) {
      createdDocs.push(`users/${uid}`);
      createdDocs.push(`users/${uid}/integrations/* (33 DLXTRADE providers)`);
      createdDocs.push(`users/${uid}/exchangeConfig/current`);
    }

    logger.info({
      uid,
      createdNew,
      duration,
      activityType,
      email: profileData?.email,
      createdDocs: createdDocs.length > 0 ? createdDocs : undefined,
      requiredDocs: [
        `users/${uid}`,
        `users/${uid}/integrations/* (33 DLXTRADE providers)`,
        `users/${uid}/exchangeConfig/current`
      ]
    }, '✅ User onboarding completed successfully - all required Firestore documents created/verified');

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

