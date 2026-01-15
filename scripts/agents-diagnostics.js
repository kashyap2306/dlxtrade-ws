// Diagnostic script for agent subcollections
const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

// Load service account and initialize admin if needed
if (!admin.apps.length) {
  const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_KEY || path.resolve(__dirname, '../.firebase/serviceAccountKey.json');
  const serviceAccount = require(serviceAccountPath);
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
}

const db = admin.firestore();

async function collectAgentDiagnostics() {
  const usersSnap = await db.collection('users').get();
  const diagnostics = [];

  for (const userDoc of usersSnap.docs) {
    const uid = userDoc.id;
    const agentsSnap = await db.collection('users').doc(uid).collection('agents').get();
    const agentDocIds = [];
    const slugs = [];
    const names = [];
    for (const agentDoc of agentsSnap.docs) {
      agentDocIds.push(agentDoc.id);
      const data = agentDoc.data();
      if (data.slug) slugs.push(data.slug);
      if (data.name) names.push(data.name);
    }
    diagnostics.push({ uid, agentDocIds, slugs, names });
  }

  const outPath = path.resolve(__dirname, '../diagnostics/fix-agents-diagnostic.json');
  fs.writeFileSync(outPath, JSON.stringify(diagnostics, null, 2));
  console.log('Diagnostics written to', outPath);
}

collectAgentDiagnostics().catch(e => {
  console.error('Error collecting agent diagnostics:', e);
  process.exit(1);
});
