import * as admin from 'firebase-admin';
import { getFirebaseAdmin } from '../utils/firebase';
import { logger } from '../utils/logger';

/**
 * Archive demo users script
 * Finds and moves demo user documents to archivedUsers collection
 * 
 * Run: npm run archive:demo-users
 */

interface DemoUser {
  uid: string;
  name?: string;
  email?: string;
  demo?: boolean;
}

async function archiveDemoUsers() {
  try {
    console.log('🔥 Starting demo users archive...');
    
    // Initialize Firebase Admin
    const db = getFirebaseAdmin().firestore();
    
    // Get all users
    const usersSnapshot = await db.collection('users').get();
    console.log(`📊 Found ${usersSnapshot.size} total users`);
    
    const demoPatterns = [
      /^demo\d+$/i,           // demo1, demo2, etc.
      /^test-user-/i,         // test-user-*
      /^test\d+$/i,           // test1, test2, etc.
      /^seed_test_/i,         // seed_test_*
    ];
    
    const archivedUsers: DemoUser[] = [];
    
    // Check each user
    for (const doc of usersSnapshot.docs) {
      const userData = doc.data();
      const uid = doc.id;
      const name = userData.name || userData.displayName || '';
      const isDemo = userData.demo === true;
      
      // Check if matches demo pattern
      let isDemoMatch = false;
      if (isDemo) {
        isDemoMatch = true;
      } else {
        for (const pattern of demoPatterns) {
          if (pattern.test(uid) || pattern.test(name)) {
            isDemoMatch = true;
            break;
          }
        }
      }
      
      if (isDemoMatch) {
        try {
          // Move to archivedUsers collection
          const archivedRef = db.collection('archivedUsers').doc(uid);
          await archivedRef.set({
            ...userData,
            originalDocId: uid,
            archivedAt: admin.firestore.Timestamp.now(),
            archivedReason: isDemo ? 'demo flag set' : 'matches demo pattern',
          });
          
          // Delete from users collection
          await doc.ref.delete();
          
          archivedUsers.push({
            uid,
            name: userData.name || userData.displayName || '',
            email: userData.email || '',
            demo: isDemo,
          });
          
          console.log(`✅ Archived user: ${uid} (${name})`);
        } catch (error: any) {
          console.error(`❌ Error archiving user ${uid}:`, error.message);
          logger.error({ uid, error: error.message }, 'Error archiving demo user');
        }
      }
    }
    
    console.log('\n📋 Archive Summary:');
    console.log(`   Total users checked: ${usersSnapshot.size}`);
    console.log(`   Users archived: ${archivedUsers.length}`);
    console.log('\n📝 Archived UIDs:');
    archivedUsers.forEach((user) => {
      console.log(`   - ${user.uid} (${user.name || 'no name'}) ${user.email || ''}`);
    });
    
    if (archivedUsers.length > 0) {
      console.log('\n✅ Demo users archive completed successfully');
    } else {
      console.log('\n✅ No demo users found to archive');
    }
    
    process.exit(0);
  } catch (error: any) {
    console.error('❌ Fatal error in archiveDemoUsers:', error);
    logger.error({ error: error.message, stack: error.stack }, 'Fatal error in archiveDemoUsers');
    process.exit(1);
  }
}

// Run script
archiveDemoUsers();

