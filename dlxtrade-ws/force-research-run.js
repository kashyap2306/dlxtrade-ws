// One-time manual trigger for Auto-Trade research cycle verification
// Usage: node force-research-run.js <uid>

const { BackgroundResearchScheduler } = require('./dist/services/backgroundResearchScheduler.js');

async function main() {
  const uid = process.argv[2];

  if (!uid) {
    console.error('Usage: node force-research-run.js <uid>');
    process.exit(1);
  }

  console.log('🔥 [MANUAL_TRIGGER] Starting force research run for user:', uid);

  try {
    const scheduler = new BackgroundResearchScheduler();

    // Force run one research cycle
    await scheduler.forceRunResearchCycle(uid);

    console.log('✅ [MANUAL_TRIGGER] Force research run completed successfully');
  } catch (error) {
    console.error('❌ [MANUAL_TRIGGER] Force research run failed:', error.message);
    process.exit(1);
  }
}

main().catch(console.error);