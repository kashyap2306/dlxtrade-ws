const admin = require('firebase-admin');
const { getFirebaseAdmin } = require('./dlxtrade-ws/dist/utils/firebase');

const db = admin.firestore(getFirebaseAdmin());

async function checkDocuments() {
  const uid = 'q8S8bOTaebd0af64PuTZdIpntg42';

  console.log('🔍 CHECKING FIRESTORE DOCUMENTS FOR USER:', uid.substring(0, 8) + '...');

  try {
    // Check legacy root-level provider-config document
    const legacyDocRef = db.collection('provider-config').doc(uid);
    const legacyDoc = await legacyDocRef.get();
    console.log('\n📄 LEGACY ROOT DOCUMENT: provider-config/' + uid);
    if (legacyDoc.exists) {
      console.log('✅ EXISTS (POTENTIALLY CORRUPTED):', JSON.stringify(legacyDoc.data(), null, 2));
    } else {
      console.log('❌ DOES NOT EXIST');
    }

    // Check users/{uid}/settings/providerConfig
    const settingsDocRef = db.collection('users').doc(uid).collection('settings').doc('providerConfig');
    const settingsDoc = await settingsDocRef.get();
    console.log('\n📄 CURRENT SETTINGS DOCUMENT: users/{uid}/settings/providerConfig');
    if (settingsDoc.exists) {
      console.log('✅ EXISTS:', JSON.stringify(settingsDoc.data(), null, 2));
    } else {
      console.log('❌ DOES NOT EXIST');
    }

    // Check integrations
    const integrationsRef = db.collection('users').doc(uid).collection('integrations');
    const integrationsSnapshot = await integrationsRef.get();
    console.log('\n📄 INTEGRATIONS COLLECTION: users/{uid}/integrations/');
    if (!integrationsSnapshot.empty) {
      integrationsSnapshot.forEach(doc => {
        console.log('✅', doc.id + ':', JSON.stringify(doc.data(), null, 2));
      });
    } else {
      console.log('❌ EMPTY');
    }

  } catch (error) {
    console.error('❌ ERROR:', error.message);
  }

  process.exit(0);
}

checkDocuments();
