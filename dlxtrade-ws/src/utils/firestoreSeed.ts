import * as admin from 'firebase-admin';
import { getFirebaseAdmin } from './firebase';
import { logger } from './logger';
import { encrypt } from '../services/keyManager';

/**
 * Comprehensive Firestore seed script matching exact PART A schema
 * Seeds all 14 collections with proper field structures
 */

const DEMO_USERS_COUNT = 10;

/**
 * Main seed function - runs test write, then seeds all collections
 */
export async function seedFirestoreData(): Promise<void> {
  try {
    const firebaseAdmin = getFirebaseAdmin();
    if (!firebaseAdmin) {
      logger.warn('Seed skipped — Firebase Admin not initialized');
      return;
    }

    const db = firebaseAdmin.firestore();

    // Verify project ID
    const serviceAccountProjectId = (firebaseAdmin.options as any).projectId || 'NOT_FOUND';
    const appProjectId = firebaseAdmin.options.projectId || 'NOT_FOUND';

    console.log('🔥 VERIFY: serviceAccount.project_id =', serviceAccountProjectId);
    console.log('🔥 VERIFY: admin.app().options.projectId =', appProjectId);

    if (!serviceAccountProjectId || serviceAccountProjectId === 'NOT_FOUND' || appProjectId === 'NOT_FOUND') {
      throw new Error('Project ID verification failed! Cannot proceed.');
    }

    // Perform forced test write
    console.log('🔥 Performing REAL FIRESTORE TEST WRITE...');
    const testData = { ok: true, timestamp: Date.now() };
    await db.collection('debug_test').doc('force').set(testData);
    const verifyDoc = await db.collection('debug_test').doc('force').get();
    if (!verifyDoc.exists) {
      throw new Error('Test write failed - document not found on read!');
    }
    console.log('🔥 REAL FIRESTORE TEST WRITE SUCCESS');

    console.log('🔥 SEED: Starting Firestore data seeding...');
    console.log('🔥 SEED: Writing starts NOW');

    // Seed in order
    await seedAgents(db);
    await seedAdmin(db);
    await seedDemoUsers(db);
    await seedGlobalStats(db);
    await seedSettings(db);
    await seedLogs(db);

    console.log('🔥 SEED COMPLETE');
    logger.info('Firestore data seeding completed successfully');
  } catch (error: any) {
    console.error('❌ SEED ERROR:', error.message);
    console.error('❌ SEED STACK:', error.stack);
    logger.error({ error: error.message, stack: error.stack }, 'Error seeding Firestore data');
    throw error;
  }
}

/**
 * Seed agents collection - 6 agents matching PART A schema
 */
async function seedAgents(db: admin.firestore.Firestore): Promise<void> {
  try {
    console.log('🔥 SEED: Writing to agents collection...');
    const agentsRef = db.collection('agents');
    
    const agents = [
      {
        id: 'premium_trading_agent',
        name: 'Premium Trading Agent',
        price: 999,
        description: 'Master agent that unlocks full DLXTRADE system access - Deep Research, Auto Trade, Exchange connections, and all premium features',
        features: [
          'Unlocks Deep Research capabilities',
          'Enables Auto Trade mode',
          'Activates 5-minute background research engine',
          'Provides Exchange API settings access',
          'Grants Trading engines access',
          'Full system premium access',
        ],
        icon: '👑',
        category: 'Premium',
        badge: 'MASTER',
        displayOrder: 0,
        enabled: true,
        createdAt: admin.firestore.Timestamp.now(),
      },
      {
        id: 'airdrop_multiverse',
        name: 'Airdrop Multiverse Agent',
        price: 350,
        description: 'Creates 100–500 wallets, auto airdrop tasks runner, auto-claim, auto-merge profits',
        features: [
          'Creates 100–500 wallets automatically',
          'Auto airdrop tasks runner',
          'Auto-claim rewards',
          'Auto-merge profits',
        ],
        icon: '🎁',
        category: 'Airdrop',
        badge: 'Popular',
        displayOrder: 1,
        createdAt: admin.firestore.Timestamp.now(),
      },
      {
        id: 'liquidity_sniper_arbitrage',
        name: 'Liquidity Sniper & Arbitrage Agent',
        price: 500,
        description: 'DEX–CEX arbitrage with micro-second gap execution',
        features: [
          'DEX–CEX arbitrage detection',
          'Micro-second gap execution',
          'Real-time opportunity scanning',
          'Automated profit capture',
        ],
        icon: '⚡',
        category: 'Arbitrage',
        badge: 'Premium',
        displayOrder: 2,
        createdAt: admin.firestore.Timestamp.now(),
      },
      {
        id: 'ai_launchpad_hunter',
        name: 'AI Launchpad Hunter & Presale Sniper',
        price: 450,
        description: 'Whitelists, presales, early launch detection, auto-entry & auto-exit',
        features: [
          'Whitelist detection',
          'Presale monitoring',
          'Early launch detection',
          'Auto-entry & auto-exit',
        ],
        icon: '🚀',
        category: 'Launchpad',
        badge: 'Hot',
        displayOrder: 3,
        createdAt: admin.firestore.Timestamp.now(),
      },
      {
        id: 'whale_movement_tracker',
        name: 'Whale Movement Tracker Agent',
        price: 250,
        description: 'Tracks big wallets (whales), auto-buy/sell on accumulation & distribution',
        features: [
          'Tracks big wallets (whales)',
          'Auto-buy on accumulation',
          'Auto-sell on distribution',
          'Real-time alerts',
        ],
        icon: '🐋',
        category: 'Tracking',
        displayOrder: 4,
        createdAt: admin.firestore.Timestamp.now(),
      },
      {
        id: 'pre_market_ai_alpha',
        name: 'Pre-Market AI Alpha Agent',
        price: 300,
        description: 'On-chain + sentiment + funding + volatility analysis, predicts next pump tokens',
        features: [
          'On-chain analysis',
          'Sentiment analysis',
          'Funding rate monitoring',
          'Volatility prediction',
          'Pump token prediction',
        ],
        icon: '🧠',
        category: 'AI Prediction',
        displayOrder: 5,
        createdAt: admin.firestore.Timestamp.now(),
      },
      {
        id: 'whale_copy_trade',
        name: 'Whale Copy Trade Agent',
        price: 400,
        description: 'Tracks top 500 whales, copies entries/exits automatically',
        features: [
          'Tracks top 500 whales',
          'Copies entries automatically',
          'Copies exits automatically',
          'Real-time synchronization',
        ],
        icon: '📊',
        category: 'Copy Trading',
        displayOrder: 6,
        createdAt: admin.firestore.Timestamp.now(),
      },
    ];

    let createdCount = 0;
    for (const agent of agents) {
      const agentDoc = await agentsRef.doc(agent.id).get();
      if (!agentDoc.exists) {
        await agentsRef.doc(agent.id).set(agent);
        createdCount++;
      }
    }
    
    console.log(`🔥 SEED: agents created ${createdCount} docs`);
    const check = await agentsRef.get();
    console.log('🔥 SEED: Agents count:', check.size);
  } catch (error: any) {
    console.error('❌ SEED ERROR (agents):', error.message);
    throw error;
  }
}

/**
 * Seed admin collection - default admin user
 */
async function seedAdmin(db: admin.firestore.Firestore): Promise<void> {
  try {
    console.log('🔥 SEED: Writing to admin collection...');
    const adminRef = db.collection('admin').doc('admin_001');
    
    const adminDoc = await adminRef.get();
    if (!adminDoc.exists) {
      await adminRef.set({
        uid: 'admin_001',
        email: 'admin@dlxtrade.com',
        role: 'admin',
        createdAt: admin.firestore.Timestamp.now(),
      });
      console.log('🔥 SEED: admin created');
    } else {
      console.log('🔥 SEED: admin already exists');
    }
    
    const check = await db.collection('admin').get();
    console.log('🔥 SEED: Admin count:', check.size);
  } catch (error: any) {
    console.error('❌ SEED ERROR (admin):', error.message);
    throw error;
  }
}

/**
 * Seed demo users - creates N users with all related documents
 */
async function seedDemoUsers(db: admin.firestore.Firestore): Promise<void> {
  try {
    console.log(`🔥 SEED: Writing ${DEMO_USERS_COUNT} demo users...`);
    const now = admin.firestore.Timestamp.now();
    let createdCount = 0;

    for (let i = 1; i <= DEMO_USERS_COUNT; i++) {
      const uid = `demo_user_${String(i).padStart(3, '0')}`;
      
      // Check if user exists
      const userDoc = await db.collection('users').doc(uid).get();
      if (userDoc.exists) {
        continue; // Skip if exists
      }

      // Create user document (PART A schema)
      const totalPnL = Math.random() * 5000 - 1000; // Random PnL between -1000 and 4000
      const dailyPnL = Math.random() * 500 - 100;
      const weeklyPnL = Math.random() * 1500 - 300;
      const monthlyPnL = Math.random() * 4000 - 800;
      
      await db.collection('users').doc(uid).set({
        uid,
        name: `Demo User ${i}`,
        email: `demo${i}@dlxtrade.com`,
        phone: i % 2 === 0 ? `+1234567890${i}` : null,
        createdAt: now,
        updatedAt: now,
        apiConnected: i % 3 === 0,
        engineRunning: i % 4 === 0,
        hftRunning: i % 5 === 0,
        totalTrades: Math.floor(Math.random() * 100),
        totalPnl: totalPnL,
        dailyPnl: dailyPnL,
        weeklyPnl: weeklyPnL,
        monthlyPnl: monthlyPnL,
        unlockedAgents: i <= 3 ? ['airdrop_multiverse'] : [],
        lastLogin: now,
        role: 'user' as const,
        profilePicture: i % 2 === 0 ? `https://api.dicebear.com/7.x/avataaars/svg?seed=${uid}` : undefined,
      });

      // Create uiPreferences
      await db.collection('uiPreferences').doc(uid).set({
        uid,
        dismissedAgents: [],
        sidebarCollapsed: false,
        showHftPanel: i % 2 === 0,
        updatedAt: now,
      });

      // Create engineStatus
      await db.collection('engineStatus').doc(uid).set({
        uid,
        engineRunning: i % 4 === 0,
        lastStarted: i % 4 === 0 ? now : undefined,
        lastStopped: i % 4 !== 0 ? now : undefined,
        ordersExecuted: Math.floor(Math.random() * 50),
        totalPnl: totalPnL,
        riskLevel: i % 3 === 0 ? 'low' : i % 3 === 1 ? 'medium' : 'high',
        updatedAt: now,
      });

      // Create apiKeys (one per user)
      await db.collection('apiKeys').doc(uid).set({
        uid,
        exchange: 'binance',
        apiKeyEncrypted: encrypt(`demo_api_key_${uid}`),
        apiSecretEncrypted: encrypt(`demo_secret_${uid}`),
        createdAt: now,
        updatedAt: now,
        status: i % 3 === 0 ? 'connected' : 'pending',
      });

      // Create user settings
      await db.collection('settings').doc(uid).set({
        uid,
        theme: i % 2 === 0 ? 'dark' : 'light',
        riskMode: i % 3 === 0 ? 'low' : i % 3 === 1 ? 'medium' : 'high',
        maxDailyLoss: 5,
        maxDailyTrades: 100,
        autoEngineStart: false,
        autoHftStart: false,
        updatedAt: now,
      });

      // Create 5 sample trades per user
      for (let t = 1; t <= 5; t++) {
        const tradeId = `${uid}_trade_${t}`;
        const side = t % 2 === 0 ? 'buy' : 'sell';
        const entryPrice = 50000 + Math.random() * 10000;
        const exitPrice = entryPrice + (Math.random() - 0.5) * 1000;
        const qty = 0.001 + Math.random() * 0.009;
        const pnl = (exitPrice - entryPrice) * qty * (side === 'buy' ? 1 : -1);
        
        await db.collection('trades').doc(tradeId).set({
          uid,
          symbol: 'BTCUSDT',
          side,
          qty,
          entryPrice,
          exitPrice,
          pnl,
          timestamp: now,
          engineType: t % 2 === 0 ? 'AI' : 'HFT',
        });
      }

      // Create 5 sample hftLogs per user
      for (let h = 1; h <= 5; h++) {
        const logId = `${uid}_hft_${h}`;
        const side = h % 2 === 0 ? 'buy' : 'sell';
        const price = 50000 + Math.random() * 10000;
        const qty = 0.001 + Math.random() * 0.009;
        const pnl = (Math.random() - 0.5) * 50;
        
        await db.collection('hftLogs').doc(logId).set({
          uid,
          symbol: 'BTCUSDT',
          side,
          qty,
          price,
          pnl,
          timestamp: now,
          engineState: 'active',
        });
      }

      // Create 5 sample activityLogs per user
      const activityTypes = ['LOGIN', 'AGENT_UNLOCKED', 'TRADE_EXECUTED', 'ENGINE_STARTED', 'SETTINGS_UPDATED'];
      for (let a = 1; a <= 5; a++) {
        const logId = `${uid}_activity_${a}`;
        await db.collection('activityLogs').doc(logId).set({
          uid,
          type: activityTypes[(a - 1) % activityTypes.length],
          message: `User performed ${activityTypes[(a - 1) % activityTypes.length]}`,
          metadata: { test: true, index: a },
          timestamp: now,
        });
      }

      // Create 3 sample notifications per user
      const notifTypes: Array<'info' | 'warning' | 'success'> = ['info', 'warning', 'success'];
      for (let n = 1; n <= 3; n++) {
        const notifId = `${uid}_notif_${n}`;
        await db.collection('notifications').doc(notifId).set({
          uid,
          title: `Notification ${n}`,
          message: `This is a ${notifTypes[n - 1]} notification for demo user ${i}`,
          type: notifTypes[n - 1],
          createdAt: now,
          read: false,
        });
      }

      // Create 1 agentUnlock for first 3 users
      if (i <= 3) {
        const unlockId = `${uid}_unlock_airdrop`;
        await db.collection('agentUnlocks').doc(unlockId).set({
          uid,
          agentId: 'airdrop_multiverse',
          unlockedAt: now,
          paymentMethod: 'crypto' as const,
          status: 'success' as const,
          txnRef: `txn_${uid}_${Date.now()}`,
        });
      }

      createdCount++;
    }

    console.log(`🔥 SEED: users created ${createdCount} docs`);
    const check = await db.collection('users').get();
    console.log('🔥 SEED: Users count:', check.size);

    // Verify related collections
    const tradesCheck = await db.collection('trades').get();
    console.log('🔥 SEED: Trades count:', tradesCheck.size);
    const hftLogsCheck = await db.collection('hftLogs').get();
    console.log('🔥 SEED: HftLogs count:', hftLogsCheck.size);
    const activityLogsCheck = await db.collection('activityLogs').get();
    console.log('🔥 SEED: ActivityLogs count:', activityLogsCheck.size);
    const notificationsCheck = await db.collection('notifications').get();
    console.log('🔥 SEED: Notifications count:', notificationsCheck.size);
    const agentUnlocksCheck = await db.collection('agentUnlocks').get();
    console.log('🔥 SEED: AgentUnlocks count:', agentUnlocksCheck.size);
  } catch (error: any) {
    console.error('❌ SEED ERROR (users):', error.message);
    throw error;
  }
}

/**
 * Seed globalStats collection (doc id = "main")
 */
async function seedGlobalStats(db: admin.firestore.Firestore): Promise<void> {
  try {
    console.log('🔥 SEED: Writing to globalStats collection...');
    const statsRef = db.collection('globalStats').doc('main');
    
    // Count actual users
    const usersSnapshot = await db.collection('users').get();
    const tradesSnapshot = await db.collection('trades').get();
    const unlocksSnapshot = await db.collection('agentUnlocks').get();
    const engineStatusSnapshot = await db.collection('engineStatus').where('engineRunning', '==', true).get();
    
    const totalUsers = usersSnapshot.size;
    const totalTrades = tradesSnapshot.size;
    const totalAgentsUnlocked = unlocksSnapshot.size;
    const runningEngines = engineStatusSnapshot.size;
    
    // Count running HFT
    const hftRunningSnapshot = await db.collection('users').where('hftRunning', '==', true).get();
    const runningHFT = hftRunningSnapshot.size;
    
    // Calculate total PnL
    let totalPnl = 0;
    usersSnapshot.forEach(doc => {
      const data = doc.data();
      totalPnl += data.totalPnl || 0;
    });

    await statsRef.set({
      totalUsers,
      totalTrades,
      totalAgentsUnlocked,
      runningEngines,
      runningHFT,
      totalPnl,
      updatedAt: admin.firestore.Timestamp.now(),
    });
    
    console.log('🔥 SEED: globalStats created');
    const check = await db.collection('globalStats').get();
    console.log('🔥 SEED: GlobalStats count:', check.size);
  } catch (error: any) {
    console.error('❌ SEED ERROR (globalStats):', error.message);
    throw error;
  }
}

/**
 * Seed settings collection - global and user settings
 */
async function seedSettings(db: admin.firestore.Firestore): Promise<void> {
  try {
    console.log('🔥 SEED: Writing to settings collection...');
    
    // Global settings
    const globalSettingsRef = db.collection('settings').doc('global');
    const globalSettingsDoc = await globalSettingsRef.get();
    
    if (!globalSettingsDoc.exists) {
      await globalSettingsRef.set({
        docId: 'global',
        maintenanceMode: false,
        exchangeExecution: true,
        hftMode: false,
        riskThresholds: {
          maxDailyLoss: 5,
          maxDrawdown: 10,
          perTradeRisk: 1,
        },
        uiDefaults: {
          theme: 'dark',
          sidebarPinned: false,
        },
        updatedAt: admin.firestore.Timestamp.now(),
      });
      console.log('🔥 SEED: settings (global) created');
    } else {
      console.log('🔥 SEED: settings (global) already exists');
    }
    
    const check = await db.collection('settings').get();
    console.log('🔥 SEED: Settings count:', check.size);
  } catch (error: any) {
    console.error('❌ SEED ERROR (settings):', error.message);
    throw error;
  }
}

/**
 * Seed logs collection - system logs
 */
async function seedLogs(db: admin.firestore.Firestore): Promise<void> {
  try {
    console.log('🔥 SEED: Writing to logs collection...');
    const logsRef = db.collection('logs');
    
    const logTypes = [
      { source: 'engine' as const, level: 'info' as const, message: 'Engine started successfully' },
      { source: 'hft' as const, level: 'info' as const, message: 'HFT engine initialized' },
      { source: 'api' as const, level: 'info' as const, message: 'API request processed' },
      { source: 'system' as const, level: 'warn' as const, message: 'System warning detected' },
      { source: 'system' as const, level: 'error' as const, message: 'System error logged' },
    ];

    let createdCount = 0;
    for (const logType of logTypes) {
      const logId = `seed_log_${logType.source}_${logType.level}`;
      const logDoc = await logsRef.doc(logId).get();
      
      if (!logDoc.exists) {
        await logsRef.doc(logId).set({
          ...logType,
          timestamp: admin.firestore.Timestamp.now(),
          uid: logType.source === 'api' ? 'demo_user_001' : undefined,
        });
        createdCount++;
      }
    }
    
    console.log(`🔥 SEED: logs created ${createdCount} docs`);
    const check = await logsRef.get();
    console.log('🔥 SEED: Logs count:', check.size);
  } catch (error: any) {
    console.error('❌ SEED ERROR (logs):', error.message);
    throw error;
  }
}

// Export for manual script execution
export async function seedAll(): Promise<void> {
  return seedFirestoreData();
}
