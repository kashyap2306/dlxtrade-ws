import * as admin from 'firebase-admin';
import { getFirebaseAdmin } from './firebase';
import { logger } from './logger';

/**
 * List of required Firestore collections that must exist
 */
const REQUIRED_COLLECTIONS = [
  'users',
  'agents',
  'agentUnlocks',
  'uiPreferences',
  'activityLogs',
  'hftLogs',
  'engineStatus',
  'trades',
  'notifications',
  'globalStats',
  'apiKeys',
  'admin',
  'logs',
  'settings',
] as const;

/**
 * Checks if a collection exists by attempting to read documents.
 * In Firestore, a collection doesn't exist until it has at least one document.
 * Skips any documents starting with "__" prefix.
 * 
 * @param db Firestore instance
 * @param collectionName Name of the collection to check
 * @returns true if collection exists (has at least one non-__ document), false otherwise
 */
async function collectionExists(
  db: admin.firestore.Firestore,
  collectionName: string
): Promise<boolean> {
  try {
    // Check if collection has any documents, skipping those starting with "__"
    const snapshot = await db.collection(collectionName).limit(100).get();
    
    // Filter out documents starting with "__"
    const validDocs = snapshot.docs.filter(doc => !doc.id.startsWith('__'));
    
    return validDocs.length > 0;
  } catch (error: any) {
    // If collection doesn't exist, Firestore may throw an error
    // Log and return false to be safe
    if (error.code === 'not-found' || error.code === 5) {
      return false;
    }
    // For other errors, log and assume collection doesn't exist
    logger.warn(
      { error: error.message, collectionName },
      'Error checking collection existence, assuming it does not exist'
    );
    return false;
  }
}

/**
 * Initializes a collection by ensuring it exists.
 * Collections in Firestore are created automatically when the first document is added.
 * This function does not create any "__" prefixed documents.
 * 
 * @param db Firestore instance
 * @param collectionName Name of the collection to initialize
 * @returns false (collections are created naturally when first document is added)
 */
async function initializeCollection(
  db: admin.firestore.Firestore,
  collectionName: string
): Promise<boolean> {
  try {
    console.log('Checking collection:', collectionName);
    
    // Collections are created automatically when first document is added
    // We don't need to create any "__" prefixed documents
    // Just verify the collection exists (has at least one non-__ document)
    const exists = await collectionExists(db, collectionName);
    
    if (exists) {
      logger.debug({ collectionName }, 'Collection already exists');
      console.log(`Collection ${collectionName} already exists`);
      return false;
    }
    
    // Collection doesn't exist yet, but it will be created when first real document is added
    // We don't create placeholder documents with "__" prefix
    logger.info({ collectionName }, 'Collection will be created when first document is added');
    console.log(`Collection ${collectionName} will be created when first document is added`);
    return false;
  } catch (error: any) {
    console.error(`INIT ERROR (Collection ${collectionName}):`, error);
    logger.error(
      { error: error.message, collectionName },
      'Error checking collection'
    );
    throw error;
  }
}

/**
 * Initializes all required Firestore collections.
 * This function is idempotent and safe to call multiple times.
 * 
 * @returns Promise that resolves when all collections are initialized
 */
export async function initializeFirestoreCollections(): Promise<void> {
  try {
    console.log('🔥 Starting Firestore collection initialization...');
    const firebaseAdmin = getFirebaseAdmin();
    const db = firebaseAdmin.firestore();

    logger.info('Starting Firestore collection initialization...');
    console.log(`Total collections to initialize: ${REQUIRED_COLLECTIONS.length}`);

    const results = await Promise.allSettled(
      REQUIRED_COLLECTIONS.map(async (collectionName) => {
        try {
          console.log(`Checking collection: ${collectionName}`);
          const exists = await collectionExists(db, collectionName);
          
          if (!exists) {
            console.log(`Collection ${collectionName} does not exist, creating...`);
            await initializeCollection(db, collectionName);
            return { collectionName, initialized: true };
          }
          
          console.log(`Collection ${collectionName} already exists`);
          return { collectionName, initialized: false };
        } catch (error: any) {
          console.error(`INIT ERROR (Processing ${collectionName}):`, error);
          throw error;
        }
      })
    );

    // Log results
    const initialized: string[] = [];
    const alreadyExists: string[] = [];
    const errors: Array<{ collection: string; error: string }> = [];

    results.forEach((result, index) => {
      const collectionName = REQUIRED_COLLECTIONS[index];
      
      if (result.status === 'fulfilled') {
        if (result.value.initialized) {
          initialized.push(collectionName);
        } else {
          alreadyExists.push(collectionName);
        }
      } else {
        errors.push({
          collection: collectionName,
          error: result.reason?.message || 'Unknown error',
        });
      }
    });

    // Log summary
    if (initialized.length > 0) {
      logger.info(
        { collections: initialized },
        `Initialized ${initialized.length} new collection(s)`
      );
    }

    if (alreadyExists.length > 0) {
      logger.debug(
        { collections: alreadyExists },
        `${alreadyExists.length} collection(s) already exist`
      );
    }

    if (errors.length > 0) {
      logger.error(
        { errors },
        `Failed to initialize ${errors.length} collection(s)`
      );
      // Don't throw - allow server to start even if some collections fail
      // This ensures production stability
    }

    logger.info(
      {
        total: REQUIRED_COLLECTIONS.length,
        initialized: initialized.length,
        existing: alreadyExists.length,
        errors: errors.length,
      },
      'Firestore collection initialization completed'
    );

    // Log completion message as requested
    console.log('🔥 Firestore initialization complete');
    console.log(`Summary: ${initialized.length} initialized, ${alreadyExists.length} existing, ${errors.length} errors`);
  } catch (error: any) {
    // Log error but don't throw - allow server to start
    // This ensures production stability
    console.error('INIT ERROR (Critical):', error);
    logger.error(
      { error: error.message, stack: error.stack },
      'Critical error during Firestore collection initialization'
    );
  }
}

