import { logger } from './logger';

/**
 * REMOVED: One-time cleanup script - no longer needed as all access is user-scoped
 */
async function runCleanup() {
  try {
    console.log('✅ Cleanup skipped - all agentDiagnostics access is now user-scoped');
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