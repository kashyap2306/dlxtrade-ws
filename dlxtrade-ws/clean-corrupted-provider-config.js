const admin = require('firebase-admin');
const { getFirebaseAdmin } = require('./dist/utils/firebase');

const db = admin.firestore(getFirebaseAdmin());

async function cleanCorruptedProviderConfig() {
  const uid = 'q8S8bOTaebd0af64PuTZdIpntg42';

  console.log('🧹 CLEANING CORRUPTED PROVIDER CONFIG FOR USER:', uid.substring(0, 8) + '...');

  try {
    // Get the corrupted document
    const settingsDocRef = db.collection('users').doc(uid).collection('settings').doc('providerConfig');
    const settingsDoc = await settingsDocRef.get();

    if (!settingsDoc.exists) {
      console.log('❌ Document does not exist');
      return;
    }

    const data = settingsDoc.data();
    console.log('📄 CURRENT CORRUPTED DATA:', JSON.stringify(data, null, 2));

    // Extract only the providerConfig key
    const providerConfig = data.providerConfig || {};

    console.log('✅ CLEAN PROVIDER CONFIG TO KEEP:', JSON.stringify(providerConfig, null, 2));

    // Replace the entire document with only the providerConfig
    await settingsDocRef.set({
      providerConfig: providerConfig
    });

    console.log('✅ SUCCESSFULLY CLEANED DOCUMENT');

    // Verify the cleanup
    const cleanedDoc = await settingsDocRef.get();
    const cleanedData = cleanedDoc.data();
    console.log('🔍 VERIFIED CLEAN DATA:', JSON.stringify(cleanedData, null, 2));

  } catch (error) {
    console.error('❌ ERROR:', error.message);
  }

  process.exit(0);
}

cleanCorruptedProviderConfig();
