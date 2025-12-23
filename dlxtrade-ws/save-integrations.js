const { getFirebaseAdmin } = require('./dist/utils/firebase');
const { keyManager } = require('./dist/services/keyManager');

async function main() {
  const uid = 'q8S8bOTaebd0af64PuTZdlpntg42';
  const db = getFirebaseAdmin().firestore();
  const now = new Date().toISOString();

  const cryptocompareKey = "REPLACE_WITH_MY_REAL_CRYPTOCOMPARE_KEY";
  const newsdataKey = "REPLACE_WITH_MY_REAL_NEWSDATA_KEY";

  const docs = [
    {
      id: 'cryptocompare',
      providerName: 'cryptocompare',
      type: 'market',
      enabled: true,
      apiKey: keyManager.encrypt(cryptocompareKey),
      updatedAt: now,
    },
    {
      id: 'newsdata',
      providerName: 'newsdata',
      type: 'news',
      enabled: true,
      apiKey: keyManager.encrypt(newsdataKey),
      updatedAt: now,
    },
  ];

  for (const doc of docs) {
    await db
      .collection('users')
      .doc(uid)
      .collection('integrations')
      .doc(doc.id)
      .set(doc, { merge: true });
    console.log(`Saved ${doc.id}`);
  }
  console.log("DONE: Integrations updated.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

