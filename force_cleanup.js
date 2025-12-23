const admin = require('firebase-admin');

admin.initializeApp();
const db = admin.firestore();

(async () => {
  const uid = 'q8S8bOTaebd0af64PuTZdlpntg42';   // <-- replace with actual UID

  const base = db.collection('users').doc(uid).collection('integrations');

  const docs = ['cryptocompare_news', 'cryptocompare_metadata'];

  for (const d of docs) {
    const ref = base.doc(d);
    const snap = await ref.get();

    if (snap.exists) {
      await ref.delete();
      console.log('✔ Deleted:', d);
    } else {
      console.log('⟲ Already gone:', d);
    }
  }

  console.log('🔥 Cleanup complete.');
  process.exit(0);
})();
