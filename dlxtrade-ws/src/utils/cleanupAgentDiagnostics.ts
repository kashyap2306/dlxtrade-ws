import { cleanupTopLevelAgentDiagnostics } from '../services/firestoreAdapter';
import { logger } from './logger';

/**
 * One-time cleanup script for old top-level agentDiagnostics data
 * This script will be deleted after execution
 */
async function runCleanup() {
  try {
    console.log('🧹 Starting one-time cleanup of top-level agentDiagnostics collection...');
    await cleanupTopLevelAgentDiagnostics();
    console.log('✅ Cleanup completed successfully');
    process.exit(0);
  } catch (error: any) {
    console.error('❌ Cleanup failed:', error.message);
    logger.error({ error: error.message }, 'Failed to cleanup top-level agentDiagnostics');
    process.exit(1);
  }
}

// Run cleanup if this script is executed directly
if (require.main === module) {
  runCleanup();
}

export { runCleanup };