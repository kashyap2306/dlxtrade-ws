
import * as admin from 'firebase-admin';
import { getFirebaseAdmin } from '../utils/firebase';
import { firestoreAdapter, isExchangeUsable } from './firestoreAdapter';
import { BackgroundResearchScheduler } from './backgroundResearchScheduler';

const TEST_UID = 'test_violation_user_empty';

async function runDebug() {
    console.log('🚀 STARTING DEBUG TRACE (EMPTY DOC)');
    const db = getFirebaseAdmin().firestore();

    // 1. Setup user with autoTradeEnabled = true, EMPTY exchangeConfig
    console.log('Setting up user...');
    await db.collection('users').doc(TEST_UID).set({
        autoTradeEnabled: true,
    });
    await db.collection('users').doc(TEST_UID).collection('autoTradeConfig').doc('current').set({
        autoTradeEnabled: true,
    });

    // Create an EMPTY exchangeConfig/current document
    await db.collection('users').doc(TEST_UID).collection('exchangeConfig').doc('current').set({});

    console.log('User setup complete. Running isExchangeUsable...');
    const result = await isExchangeUsable(TEST_UID, 'background_job');
    console.log('isExchangeUsable Result:', JSON.stringify(result));

    console.log('Running scheduler.updateUserResearchSchedule...');
    const scheduler = new BackgroundResearchScheduler();
    try {
        await (scheduler as any).updateUserResearchSchedule(TEST_UID);
    } catch (err) {
        console.log('Scheduler execution failed (expected if fatal error hit):', err.message);
    }

    console.log('DEBUG TRACE COMPLETE');

    // Cleanup
    await db.collection('users').doc(TEST_UID).delete();
    process.exit(0);
}

runDebug().catch(err => {
    console.error('DEBUG ERROR:', err);
    process.exit(1);
});
