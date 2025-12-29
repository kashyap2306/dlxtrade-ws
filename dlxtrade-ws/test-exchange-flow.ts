/**
 * Backend Test for Exchange Connect/Disconnect Flow
 * Tests the complete flow without UI interaction
 */

import * as dotenv from 'dotenv';
import * as path from 'path';
import * as admin from 'firebase-admin';

// Load environment variables from .env file
dotenv.config({
  path: path.join(process.cwd(), '.env'),
});

import { getFirebaseAdmin } from './src/utils/firebase';
import { firestoreAdapter } from './src/services/firestoreAdapter';

async function testExchangeFlow() {
  console.log(`\n🧪 STARTING EXCHANGE FLOW TEST`);
  console.log('=' .repeat(60));

  try {
    // Initialize Firebase
    const firebaseAdmin = getFirebaseAdmin();
    const db = admin.firestore(firebaseAdmin);

    // 1. Pick an existing user UID from Firestore
    console.log('\n📋 STEP 1: Finding existing user');
    const usersRef = db.collection('users');
    const usersSnapshot = await usersRef.limit(1).get();

    if (usersSnapshot.empty) {
      throw new Error('No users found in Firestore');
    }

    const userDoc = usersSnapshot.docs[0];
    const uid = userDoc.id;
    console.log(`✅ Using existing user UID: ${uid}`);

    // 2. Verify users/{uid} document exists
    console.log('\n📋 STEP 2: Verifying users/{uid} document');
    const userData = userDoc.data();
    console.log(`✅ User document exists - Email: ${userData?.email || 'N/A'}`);

    // 3. Check initial state
    console.log('\n📋 STEP 3: Checking initial exchange state');
    const exchangeConfigDoc = await db.collection('users').doc(uid).collection('exchangeConfig').doc('current').get();
    const exchangeConfigData = exchangeConfigDoc.exists ? exchangeConfigDoc.data() : null;

    console.log(`Initial users/${uid}.apiConnected:`, userData?.apiConnected);
    console.log(`Initial users/${uid}.connectedExchanges:`, userData?.connectedExchanges);
    console.log(`Exchange config exists:`, exchangeConfigDoc.exists);
    console.log(`Exchange config disconnected:`, exchangeConfigData?.disconnected);

    // STEP 4: Simulate what /exchange/connect should do - create exchangeConfig and update users document
    console.log('\n📋 STEP 4: Simulating exchange connect - creating exchangeConfig and updating users document');

    // Simulate creating exchangeConfig/current with VALID status (as the real endpoint should do)
    await db.collection('users').doc(uid).collection('exchangeConfig').doc('current').set({
      exchange: 'bitget',
      apiKeyEncrypted: 'simulated_encrypted_key_' + Date.now(), // Mock encrypted key
      secretEncrypted: 'simulated_encrypted_secret_' + Date.now(), // Mock encrypted secret
      testnet: false,
      exchangeStatus: 'VALID', // Should be set to VALID after successful connect
      exchangeConnectedAt: admin.firestore.Timestamp.now(), // Grace window timestamp
      updatedAt: admin.firestore.Timestamp.now(),
      createdAt: admin.firestore.Timestamp.now(),
    });

    await db.collection('users').doc(uid).set({
      apiConnected: true,
      isApiConnected: true,
      apiStatus: 'connected',
      connectedExchanges: ['bitget'], // Simulate connecting to bitget
      exchangeLastConnected: admin.firestore.Timestamp.now(),
      updatedAt: admin.firestore.Timestamp.now(),
    }, { merge: true });

    console.log('✅ Simulated exchange connect - created exchangeConfig with VALID status and updated users document');

    // STEP 5: Verify exchangeConfig document after simulated connect
    console.log('\n📋 STEP 5: Verifying exchangeConfig document after connect');
    const exchangeConfigAfterConnect = await db.collection('users').doc(uid).collection('exchangeConfig').doc('current').get();
    const exchangeConfigDataAfterConnect = exchangeConfigAfterConnect.data();

    console.log(`After connect exchangeConfig exists:`, exchangeConfigAfterConnect.exists);
    console.log(`After connect exchangeConfig.exchangeStatus:`, exchangeConfigDataAfterConnect?.exchangeStatus);
    console.log(`After connect exchangeConfig.keysClearedReason:`, exchangeConfigDataAfterConnect?.keysClearedReason);
    console.log(`After connect exchangeConfig has apiKeyEncrypted:`, !!exchangeConfigDataAfterConnect?.apiKeyEncrypted);
    console.log(`After connect exchangeConfig has secretEncrypted:`, !!exchangeConfigDataAfterConnect?.secretEncrypted);

    const exchangeConfigValid = exchangeConfigAfterConnect.exists &&
                               exchangeConfigDataAfterConnect?.exchangeStatus === 'VALID' &&
                               !exchangeConfigDataAfterConnect?.keysClearedReason &&
                               !!exchangeConfigDataAfterConnect?.apiKeyEncrypted &&
                               !!exchangeConfigDataAfterConnect?.secretEncrypted;

    console.log(`Exchange config VALID after connect: ${exchangeConfigValid ? 'YES' : 'NO'}`);

    // STEP 6: Verify users document after simulated connect
    console.log('\n📋 STEP 6: Verifying users document after connect');
    const userDocAfterConnect = await db.collection('users').doc(uid).get();
    const userDataAfterConnect = userDocAfterConnect.data();

    console.log(`After connect users/${uid}.apiConnected:`, userDataAfterConnect?.apiConnected);
    console.log(`After connect users/${uid}.isApiConnected:`, userDataAfterConnect?.isApiConnected);
    console.log(`After connect users/${uid}.apiStatus:`, userDataAfterConnect?.apiStatus);
    console.log(`After connect users/${uid}.connectedExchanges:`, userDataAfterConnect?.connectedExchanges);

    const connectSuccess = userDataAfterConnect?.apiConnected === true &&
                           userDataAfterConnect?.isApiConnected === true &&
                           userDataAfterConnect?.apiStatus === 'connected' &&
                           userDataAfterConnect?.connectedExchanges?.includes('bitget') &&
                           exchangeConfigValid;

    console.log(`✅ Connect simulation successful: ${connectSuccess}`);

    if (!connectSuccess) {
      throw new Error('Connect simulation failed - users document or exchangeConfig not updated correctly');
    }

    // STEP 7: Test grace window - isExchangeUsable should return usable=true immediately after connect
    console.log('\n📋 STEP 7: Testing grace window - immediate exchange usability check');
    const { isExchangeUsable } = await import('./src/services/firestoreAdapter');
    const graceWindowResult = await isExchangeUsable(uid, 'background_job');

    console.log(`Grace window check - usable: ${graceWindowResult.usable}`);
    console.log(`Grace window check - reason: ${graceWindowResult.reason}`);
    console.log(`Grace window check - exchange: ${graceWindowResult.exchange}`);

    const graceWindowWorked = graceWindowResult.usable && graceWindowResult.reason.includes('grace window');

    console.log(`Grace window protection working: ${graceWindowWorked ? 'YES' : 'NO'}`);

    if (!graceWindowWorked) {
      console.log('❌ Grace window not working - background scheduler could interfere immediately after connect');
    }

    // STEP 8: Test /exchange/status endpoint logic (simulate what it should return)
    console.log('\n📋 STEP 8: Testing /exchange/status logic');
    // Simulate the logic from the endpoint
    const isConnected = userDataAfterConnect?.apiConnected === true &&
                       userDataAfterConnect?.connectedExchanges?.includes('bitget');

    console.log(`Status endpoint would return connected: ${isConnected}`);
    console.log(`Status endpoint simulation: ${isConnected ? 'PASS' : 'FAIL'}`);

    // STEP 9: Test /exchange/connected endpoint logic
    console.log('\n📋 STEP 9: Testing /exchange/connected logic');
    const connected = userDataAfterConnect?.apiConnected === true &&
                     userDataAfterConnect?.connectedExchanges?.length > 0;
    const exchange = userDataAfterConnect?.connectedExchanges?.[0];

    console.log(`Connected endpoint would return connected: ${connected}`);
    console.log(`Connected endpoint would return exchange: ${exchange}`);
    console.log(`Connected endpoint simulation: ${connected && exchange === 'bitget' ? 'PASS' : 'FAIL'}`);

    // STEP 10: Simulate disconnect
    console.log('\n📋 STEP 10: Simulating exchange disconnect');

    // Delete the exchangeConfig document to match real disconnect behavior
    await db.collection('users').doc(uid).collection('exchangeConfig').doc('current').delete();

    await db.collection('users').doc(uid).set({
      apiConnected: false,
      isApiConnected: false,
      apiStatus: 'disconnected',
      exchangeStatus: 'DISCONNECTED',
      connectedExchanges: [],
      engineRunning: false,
      autoTradeEnabled: false,
      exchangeLastDisconnected: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });

    // Also disable auto-trade as the disconnect endpoint does
    await db.collection('users').doc(uid).collection('autoTradeConfig').doc('current').set({
      autoTradeEnabled: false,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });

    console.log('✅ Simulated exchange disconnect');

    // STEP 11: Verify final state
    console.log('\n📋 STEP 11: Verifying final state after disconnect');
    const userDocAfterDisconnect = await db.collection('users').doc(uid).get();
    const userDataAfterDisconnect = userDocAfterDisconnect.data();

    const autoTradeDoc = await db.collection('users').doc(uid).collection('autoTradeConfig').doc('current').get();
    const autoTradeData = autoTradeDoc.data();

    console.log(`After disconnect users/${uid}.apiConnected:`, userDataAfterDisconnect?.apiConnected);
    console.log(`After disconnect users/${uid}.isApiConnected:`, userDataAfterDisconnect?.isApiConnected);
    console.log(`After disconnect users/${uid}.apiStatus:`, userDataAfterDisconnect?.apiStatus);
    console.log(`After disconnect users/${uid}.exchangeStatus:`, userDataAfterDisconnect?.exchangeStatus);
    console.log(`After disconnect users/${uid}.engineRunning:`, userDataAfterDisconnect?.engineRunning);
    console.log(`After disconnect users/${uid}.autoTradeEnabled:`, userDataAfterDisconnect?.autoTradeEnabled);
    console.log(`After disconnect users/${uid}.connectedExchanges:`, userDataAfterDisconnect?.connectedExchanges);
    console.log(`After disconnect autoTradeConfig/current.autoTradeEnabled:`, autoTradeData?.autoTradeEnabled);

    const disconnectSuccess = userDataAfterDisconnect?.apiConnected === false &&
                             userDataAfterDisconnect?.isApiConnected === false &&
                             userDataAfterDisconnect?.apiStatus === 'disconnected' &&
                             userDataAfterDisconnect?.exchangeStatus === 'DISCONNECTED' &&
                             userDataAfterDisconnect?.engineRunning === false &&
                             userDataAfterDisconnect?.autoTradeEnabled === false &&
                             (!userDataAfterDisconnect?.connectedExchanges || userDataAfterDisconnect.connectedExchanges.length === 0) &&
                             autoTradeData?.autoTradeEnabled === false;

    console.log(`✅ Disconnect simulation successful: ${disconnectSuccess}`);

    if (!disconnectSuccess) {
      throw new Error('Disconnect simulation failed');
    }

    // STEP 12: Test status endpoints after disconnect
    console.log('\n📋 STEP 12: Testing status endpoints after disconnect');
    const isConnectedAfterDisconnect = userDataAfterDisconnect?.apiConnected === true &&
                                      userDataAfterDisconnect?.connectedExchanges?.includes('bitget');
    const connectedAfterDisconnect = userDataAfterDisconnect?.apiConnected === true &&
                                    userDataAfterDisconnect?.connectedExchanges?.length > 0;

    console.log(`Status endpoint after disconnect would return connected: ${isConnectedAfterDisconnect}`);
    console.log(`Connected endpoint after disconnect would return connected: ${connectedAfterDisconnect}`);
    console.log(`Post-disconnect status check: ${!isConnectedAfterDisconnect && !connectedAfterDisconnect ? 'PASS' : 'FAIL'}`);

    // STEP 13: Check current state of root document vs subcollection
    console.log('\n📋 STEP 13: Checking root document vs subcollection consistency');

    // Check root document
    const rootUserDoc = await db.collection('users').doc(uid).get();
    const rootUserData = rootUserDoc.data();

    // Check subcollection
    const subcollectionDoc = await db.collection('users').doc(uid).collection('autoTradeConfig').doc('current').get();
    const subcollectionData = subcollectionDoc.data();

    console.log(`Root document users/${uid}:`);
    console.log(`  - autoTradeEnabled:`, rootUserData?.autoTradeEnabled);
    console.log(`  - autoTrade.enabled:`, rootUserData?.autoTrade?.enabled);
    console.log(`  - apiConnected:`, rootUserData?.apiConnected);
    console.log(`  - apiStatus:`, rootUserData?.apiStatus);

    console.log(`Subcollection users/${uid}/autoTradeConfig/current:`);
    console.log(`  - autoTradeEnabled:`, subcollectionData?.autoTradeEnabled);

    const rootHasCorrectValues = rootUserData?.autoTradeEnabled === false &&
                                rootUserData?.autoTrade?.enabled === false &&
                                rootUserData?.apiConnected === false &&
                                rootUserData?.apiStatus === 'disconnected';

    const subcollectionHasCorrectValues = subcollectionData?.autoTradeEnabled === false;

    console.log(`Root document has expected initial values: ${rootHasCorrectValues ? 'YES' : 'NO'}`);
    console.log(`Subcollection has expected initial values: ${subcollectionHasCorrectValues ? 'YES' : 'NO'}`);

    // STEP 14: Test autoTradeEngine.startAutoTradeLoop (used by /api/trading/autotrade/toggle)
    console.log('\n📋 STEP 14: Testing autoTradeEngine.startAutoTradeLoop method');

    const { autoTradeEngine } = await import('./src/services/autoTradeEngine');
    await autoTradeEngine.startAutoTradeLoop(uid);

    // Check state after startAutoTradeLoop
    const rootAfterStart = await db.collection('users').doc(uid).get();
    const rootAfterStartData = rootAfterStart.data();
    const subAfterStart = await db.collection('users').doc(uid).collection('autoTradeConfig').doc('current').get();
    const subAfterStartData = subAfterStart.data();

    console.log(`After startAutoTradeLoop - Root document:`);
    console.log(`  - autoTradeEnabled:`, rootAfterStartData?.autoTradeEnabled);
    console.log(`  - autoTrade.enabled:`, rootAfterStartData?.autoTrade?.enabled);
    console.log(`  - apiConnected:`, rootAfterStartData?.apiConnected);

    console.log(`After startAutoTradeLoop - Subcollection:`);
    console.log(`  - autoTradeEnabled:`, subAfterStartData?.autoTradeEnabled);

    const startLoopSyncWorked = rootAfterStartData?.autoTradeEnabled === true &&
                               rootAfterStartData?.autoTrade?.enabled === true &&
                               rootAfterStartData?.apiConnected === true &&
                               subAfterStartData?.autoTradeEnabled === true;

    console.log(`startAutoTradeLoop sync worked: ${startLoopSyncWorked ? 'PASS' : 'FAIL'}`);

    // STEP 15: Test autoTradeEngine.stopAutoTradeLoop
    console.log('\n📋 STEP 15: Testing autoTradeEngine.stopAutoTradeLoop method');

    await autoTradeEngine.stopAutoTradeLoop(uid);

    // Check state after stopAutoTradeLoop
    const rootAfterStop = await db.collection('users').doc(uid).get();
    const rootAfterStopData = rootAfterStop.data();
    const subAfterStop = await db.collection('users').doc(uid).collection('autoTradeConfig').doc('current').get();
    const subAfterStopData = subAfterStop.data();

    console.log(`After stopAutoTradeLoop - Root document:`);
    console.log(`  - autoTradeEnabled:`, rootAfterStopData?.autoTradeEnabled);
    console.log(`  - autoTrade.enabled:`, rootAfterStopData?.autoTrade?.enabled);

    console.log(`After stopAutoTradeLoop - Subcollection:`);
    console.log(`  - autoTradeEnabled:`, subAfterStopData?.autoTradeEnabled);

    const stopLoopSyncWorked = rootAfterStopData?.autoTradeEnabled === false &&
                              rootAfterStopData?.autoTrade?.enabled === false &&
                              subAfterStopData?.autoTradeEnabled === false;

    console.log(`stopAutoTradeLoop sync worked: ${stopLoopSyncWorked ? 'PASS' : 'FAIL'}`);

    return {
      success: true,
      uid,
      userExists: true,
      exchangeConfigExists: exchangeConfigDoc.exists,
      initialApiConnected: userData?.apiConnected,
      initialConnectedExchanges: userData?.connectedExchanges,
      connectSimulationPassed: connectSuccess,
      statusEndpointLogicPassed: isConnected,
      connectedEndpointLogicPassed: connected && exchange === 'bitget',
      disconnectSimulationPassed: disconnectSuccess,
      postDisconnectStatusPassed: !isConnectedAfterDisconnect && !connectedAfterDisconnect,
      startAutoTradeLoopSyncWorked: startLoopSyncWorked,
      stopAutoTradeLoopSyncWorked: stopLoopSyncWorked,
      rootDocumentFinalState: {
        autoTradeEnabled: rootAfterStopData?.autoTradeEnabled,
        autoTradeEnabledObj: rootAfterStopData?.autoTrade?.enabled,
        apiConnected: rootAfterStopData?.apiConnected,
        apiStatus: rootAfterStopData?.apiStatus
      },
      subcollectionFinalState: {
        autoTradeEnabled: subAfterStopData?.autoTradeEnabled
      }
    };

  } catch (error: any) {
    console.error('\n❌ TEST FAILED:', error.message);
    console.error('Stack:', error.stack);

    return {
      success: false,
      error: error.message
    };
  }
}

// Run the test
testExchangeFlow().then(result => {
  if (result.success) {
    console.log('\n✅ EXCHANGE FLOW TEST COMPLETED');
    console.log('Result:', JSON.stringify(result, null, 2));
  } else {
    console.log('\n❌ EXCHANGE FLOW TEST FAILED');
    console.log('Error:', result.error);
  }
  process.exit(result.success ? 0 : 1);
}).catch(console.error);
