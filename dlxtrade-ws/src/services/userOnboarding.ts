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

export async function seedProviderIntegrations(
  uid: string,
  db: admin.firestore.Firestore,
  now: admin.firestore.Timestamp
) {
  console.log(`[INTEGRATIONS_SEED_START] Starting provider integrations seeding for user: ${uid}`);

  const userRef = db.collection('users').doc(uid);
  const integrationsRef = userRef.collection('integrations');

  let created = 0;
  let updated = 0;

  // Create deterministic placeholder documents for ALL supported providers
  // This ensures every user has the complete provider structure
  for (const provider of ALL_PROVIDERS) {
    const docRef = integrationsRef.doc(provider);

    // Check if document already exists
    const existingDoc = await docRef.get();
    const existing = existingDoc.exists ? existingDoc.data() || {} : {};

    // Determine provider type
    const type = PROVIDERS.MARKET_DATA.includes(provider)
      ? 'marketdata'
      : PROVIDERS.NEWS.includes(provider)
        ? 'news'
        : 'metadata';

    // Create the exact required structure - NEVER overwrite existing data
    const payload = {
      providerName: existing.providerName || provider,
      type: existing.type || type,
      enabled: typeof existing.enabled === 'boolean' ? existing.enabled : false,
      apiKeyEncrypted: existing.apiKeyEncrypted !== undefined ? existing.apiKeyEncrypted : null,
      usageStats: existing.usageStats || { calls: 0 },
      updatedAt: existing.updatedAt || now,
    };

    // Always ensure the document exists with proper structure
    await docRef.set(payload, { merge: true });

    if (existingDoc.exists) {
      updated++;
    } else {
      created++;
    }
  }

  console.log(`[INTEGRATIONS_SEED_COMPLETE] User: ${uid}, Created: ${created}, Updated: ${updated}, Total providers: ${ALL_PROVIDERS.length}`);
}

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
  console.log(`[AUTH_UID_USED] ensureUser called with UID: ${uid}`);
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
        name: profileData?.name || '',
        email: profileData?.email || '',
        phone: profileData?.phone || null,
        createdAt: now,
        updatedAt: now,
        lastLogin: now,
        role: 'user',
        profilePicture: null,

        // Onboarding & Status
        onboardingRequired: true,
        engineStatus: 'stopped',
        engineRunning: false,
        hftRunning: false,
        autoTradeEnabled: false,

        // Stats
        totalPnl: 0,
        totalTrades: 0,
        weeklyPnl: 0,
        monthlyPnl: 0,

        // Profile details only
        tradingMarkets: [],
        experienceLevel: '',
        interestedAgents: [],
        portfolioSize: '',
        unlockedAgents: [],
        seenPopups: [],

        preferences: {
          riskLevel: '',
          tradingStyle: '',
          analysisType: '',
        },

        // CRITICAL: settings, notifications, tradingSettings, etc. 
        // ARE NO LONGER STORED IN THE ROOT DOCUMENT.
        // They live in users/{uid}/settings/current
        // and other respective subcollections.
      };

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

    // Ensure integrations are always seeded/normalized for every user
    await seedProviderIntegrations(uid, db, now);

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
        symbol: 'BTCUSDT',
        quoteSize: 10,
        adversePct: 1.5,
        cancelMs: 60000,
        maxPos: 0.02,
        minAccuracyThreshold: 85,
        strategy: 'orderbook_imbalance',
        accuracyThreshold: 0.85,
        autoTrade: false,
        hftEnabled: false,
        liveMode: false,
        runIntervalSec: 5,
        status: 'idle',
        risk: {
          max_loss_pct: 5,
          max_drawdown_pct: 10,
          per_trade_risk_pct: 0.5,
          max_pos: 0.02,
        },
        // NEW: Standardized notification objects in subcollection
        notifications: {
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
          tradeConfirmationRequired: false,
          soundEnabled: false,
          vibrateEnabled: false,
          telegramEnabled: false,
          telegramChatId: ''
        },
        notificationSettings: {
          enableAutoTradeAlerts: false,
          enableAccuracyAlerts: false,
          enableWhaleAlerts: false,
          tradeConfirmationRequired: false,
          notificationSounds: false,
          notificationVibration: false,
          telegramBotToken: '',
          telegramChatId: ''
        },
        tradingSettings: {
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
        },
        providerPriority: {
          marketData: [...PROVIDERS.MARKET_DATA],
          news: [...PROVIDERS.NEWS],
          metadata: [...PROVIDERS.METADATA]
        },
        updatedAt: now,
      });
      logger.info({ uid }, 'User settings subcollection document created with full schema');
    } else {
      // Update missing fields to match EXACT schema (isolation fix)
      const existingS = existingUserSettings.data() || {};
      const settingsUpdate: any = {};

      if (existingS.notifications === undefined) {
        settingsUpdate.notifications = {
          autoTradeAlerts: false,
          autoTradeAlertsPrereqMet: false,
          accuracyAlerts: { enabled: false, threshold: 80, telegramEnabled: false },
          whaleAlerts: { enabled: false, sensitivity: 'medium', telegramEnabled: false },
          tradeConfirmationRequired: false,
          soundEnabled: false,
          vibrateEnabled: false,
          telegramEnabled: false,
          telegramChatId: ''
        };
      }

      if (existingS.notificationSettings === undefined) {
        settingsUpdate.notificationSettings = {
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

      if (existingS.tradingSettings === undefined) {
        settingsUpdate.tradingSettings = {
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
      if (existingS.status === undefined) {
        settingsUpdate.status = 'idle';
      }
      if (!existingS.providerPriority) {
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