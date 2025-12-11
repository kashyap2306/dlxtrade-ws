const admin = require('firebase-admin');
admin.initializeApp();
const db = admin.firestore();

(async () => {
  const uid = 'q8S8bOTaebd0af64PuTZdlpntg42';   // <<< PUT REAL UID HERE
  const path = db.collection('users').doc(uid).collection('integrations');

  const targets = ['cryptocompare_news', 'cryptocompare_metadata'];

  console.log('--- BEFORE DELETE ---');
  for (const t of targets) {
    const snap = await path.doc(t).get();
    console.log(t, 'exists:', snap.exists);
  }

  console.log('--- DELETING ---');
  for (const t of targets) {
    try {
      await path.doc(t).delete();
      console.log('Deleted:', t);
    } catch(err) {
      console.log('Delete error:', t, err.message);
    }
  }

  console.log('--- AFTER DELETE (RECHECK) ---');
  for (const t of targets) {
    const snap = await path.doc(t).get();
    console.log(t, 'exists:', snap.exists);
  }

  process.exit(0);
})();
