require('dotenv').config();
// Firestore agents diagnostics script for all users
const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

// Reuse existing admin initialization if present
if (!admin.apps.length) {
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  let privateKey = process.env.FIREBASE_PRIVATE_KEY;
  if (!projectId || !clientEmail || !privateKey) {
    console.error('Missing FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, or FIREBASE_PRIVATE_KEY in environment');
    process.exit(1);
  }
  privateKey = privateKey.replace(/\\n/g, '\n');
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId,
      clientEmail,
      privateKey
    })
  });
}


const db = admin.firestore();

async function main() {
  const usersSnap = await db.collection('users').get();
  const diagnostics = [];
  for (const userDoc of usersSnap.docs) {
    const uid = userDoc.id;
    const agentsSnap = await db.collection('users').doc(uid).collection('agents').get();
    for (const agentDoc of agentsSnap.docs) {
      const data = agentDoc.data();
      diagnostics.push({
        uid,
        agentDocId: agentDoc.id,
        slug: data.slug || null,
        name: data.name || null,
        key: data.key || null,
        agentKey: data.agentKey || null
      });
    }
  }
  const outPath = path.resolve(__dirname, '../../diagnostics/fix-agents-diagnostic.json');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(diagnostics, null, 2));
  console.log('Diagnostics written to', outPath);
}

main().catch(e => {
  console.error('Error:', e);
  process.exit(1);
});
