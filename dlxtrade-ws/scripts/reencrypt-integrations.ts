import * as admin from 'firebase-admin';
import { getFirebaseAdmin } from '../src/utils/firebase';
import { encrypt, decrypt } from '../src/services/keyManager';

async function main() {
  const app = getFirebaseAdmin();
  const db = app.firestore();

  const usersSnap = await db.collection('users').get();
  console.log(`Processing ${usersSnap.size} users...`);

  for (const userDoc of usersSnap.docs) {
    const uid = userDoc.id;
    const integrationsSnap = await db.collection('users').doc(uid).collection('integrations').get();
    if (integrationsSnap.empty) continue;

    console.log(`User ${uid} has ${integrationsSnap.size} integrations`);

    for (const integrationDoc of integrationsSnap.docs) {
      const data: any = integrationDoc.data();
      const encrypted = data.apiKey;
      if (!encrypted) {
        console.log(` - ${integrationDoc.id}: no apiKey, skipping`);
        continue;
      }

      let decrypted = '';
      try {
        decrypted = decrypt(encrypted);
      } catch (err: any) {
        console.warn(` - ${integrationDoc.id}: failed to decrypt (${err.message}), skipping`);
        continue;
      }

      if (!decrypted) {
        console.warn(` - ${integrationDoc.id}: empty after decrypt, skipping`);
        continue;
      }

      const reencrypted = encrypt(decrypted);
      await integrationDoc.ref.set({
        apiKey: reencrypted,
        enabled: data.enabled !== false,
        decryptable: true,
        needsReencrypt: false,
        updatedAt: admin.firestore.Timestamp.now(),
      }, { merge: true });

      console.log(` - ${integrationDoc.id}: re-encrypted (len ${reencrypted.length})`);
    }
  }

  console.log('Re-encryption completed.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

