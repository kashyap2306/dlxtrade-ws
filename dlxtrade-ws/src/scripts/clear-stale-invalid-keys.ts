/**
 * ONE-TIME UTILITY: Clear stale INVALID_KEYS states
 *
 * This script clears INVALID_KEYS states that should be treated as stale.
 * INVALID_KEYS is a transient event and should not persist in the database.
 *
 * Usage: npx ts-node src/scripts/clear-stale-invalid-keys.ts <uid>
 */

import { getFirebaseAdmin } from '../utils/firebase';
import { clearStaleInvalidKeys } from '../services/firestoreAdapter';

async function main() {
  const uid = process.argv[2];

  if (!uid) {
    console.error('Usage: npx ts-node src/scripts/clear-stale-invalid-keys.ts <uid>');
    console.error('Example: npx ts-node src/scripts/clear-stale-invalid-keys.ts q4B5N');
    process.exit(1);
  }

  try {
    // Initialize Firebase
    await getFirebaseAdmin();

    console.log(`🔧 Clearing stale INVALID_KEYS for UID: ${uid}`);

    const result = await clearStaleInvalidKeys(uid);

    if (result.cleared) {
      console.log(`✅ SUCCESS: ${result.reason}`);
      console.log(`🔄 Exchange status changed from INVALID_KEYS to DISCONNECTED`);
      console.log(`📝 This user will now be treated as 'not connected' by the system`);
    } else {
      console.log(`ℹ️  NO ACTION: ${result.reason}`);
    }

  } catch (error: any) {
    console.error(`❌ FAILED: ${error.message}`);
    process.exit(1);
  }
}

main();
