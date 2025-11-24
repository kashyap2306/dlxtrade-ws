const fs = require('fs');
const path = require('path');

// Files to move to archive
const filesToArchive = [
  // Root level test/debug files
  'analyze-unused-files.js',
  'debug-api-calls.js',
  'live-issue-diagnostic.js',
  'multi-symbol-diagnostic.js',
  'test-adapter-init.js',
  'test-api-fixes.js',
  'test-api-keys-check.js',
  'test-auto-selection-debug.js',
  'test-binance-fixes.js',
  'test-comprehensive.js',
  'test-deep-research.js',
  'test-direct-research.js',
  'test-final-auto-selection.js',
  'test-firebase-init.js',
  'test-fixed-research.js',
  'test-force-real-apis.js',
  'test-full-provider-verification.js',
  'test-google-finance-fix.js',
  'test-individual-apis.js',
  'test-mandatory-providers.js',
  'test-mtf-pipeline.js',
  'test-mtf-verification.js',
  'test-real-api-verification.js',
  'test-research-apis.js',
  'test-research-engine-apis.js',
  'test-research-manual.js',
  'test-scheduler-symbols.js',
  'test-simple-api-check.js',
  'test-timeout-fixes.js',
  'test-uid-flow-fix.js',
  'test-valid-symbols.js',
  'tmp-research-test.js',

  // Scripts directory - unused ones
  'scripts/comprehensive-research-test.js',
  'scripts/comprehensive-user-api-test.js',
  'scripts/debug-test.js',
  'scripts/direct-research-test.js',
  'scripts/logic-test.js',
  'scripts/migrate-coinapi-to-free-apis.js',
  'scripts/run-e2e-test.ps1',
  'scripts/run-local.sh',
  'scripts/run-migration.sh',
  'scripts/seed-demo-data.sh',
  'scripts/simple-test.js',
  'scripts/simple-user-api-test.js',
  'scripts/test-context-fallback.js',
  'scripts/test-deep-research-comprehensive.js',
  'scripts/test-deep-research-scheduler.ts',
  'scripts/test-integrations-creation.ts',
  'scripts/test-research-api.js',
  'scripts/test-research-engine-e2e.js',
  'scripts/test-research-response.js',
  'scripts/test-scheduler.ts',
  'scripts/user-api-only-test.js',
  'scripts/validateFeatureWeights.ts',
  'scripts/validation-test.js',

  // Markdown reports (not referenced in code)
  'BACKEND_ARCHITECTURE_FIX_SUMMARY.md',
  'CLEANUP_AND_ANALYSIS_REPORT.md',
  'DEEP_RESEARCH_ML_IMPLEMENTATION.md',
  'DEEP_RESEARCH_ML_PLAN.md',
  'DEEP_RESEARCH_ML_SUMMARY.md',
  'deep-research-production-validation.js',
  'E2E_TEST_EXECUTION_REPORT.md',
  'EXTRACTED_LOGS_INSTRUCTIONS.md',
  'FINAL_TASK_IMPLEMENTATION_SUMMARY.md',
  'final-deep-research-test.js',
  'FINAL-FIX-REPORT.md',
  'final-test.js',
  'FIREBASE_ENV_SETUP_VERIFICATION.md',
  'FIRESTORE_IMPLEMENTATION_SUMMARY.md',
  'FIX-SUMMARY.md',
  'MIGRATION_COINAPI_TO_FREE_APIS.md',
  'MIGRATION_FIX_REPORT.md',
  'PRODUCTION_AUDIT_REPORT.md',
  'provider-verification-result.json',
  'RESEARCH_ENGINE_E2E_TEST_GUIDE.md',
  'RESEARCH_ENGINE_VERIFICATION.md',
  'SYSTEM_VERIFICATION_REPORT.md',
  'TESTING-INSTRUCTIONS.md',

  // PowerShell scripts (not used in main build)
  'scripts/extract-research-logs.ps1'
];

const archiveDir = 'archive/unused/20251124_2100';

console.log('🧹 CLEANING UP UNUSED FILES...\n');

// Create archive directory if it doesn't exist
if (!fs.existsSync(archiveDir)) {
  fs.mkdirSync(archiveDir, { recursive: true });
  console.log(`✅ Created archive directory: ${archiveDir}`);
}

let movedCount = 0;
let errors = [];

for (const file of filesToArchive) {
  const sourcePath = path.join('.', file);
  const destPath = path.join(archiveDir, path.basename(file));

  try {
    if (fs.existsSync(sourcePath)) {
      fs.renameSync(sourcePath, destPath);
      console.log(`✅ Moved: ${file}`);
      movedCount++;
    } else {
      console.log(`⚠️  Not found: ${file}`);
    }
  } catch (error) {
    console.log(`❌ Error moving ${file}: ${error.message}`);
    errors.push(`${file}: ${error.message}`);
  }
}

console.log(`\n🎯 CLEANUP COMPLETE:`);
console.log(`   📁 Files moved: ${movedCount}`);
console.log(`   📍 Archive location: ${archiveDir}`);

if (errors.length > 0) {
  console.log(`   ❌ Errors: ${errors.length}`);
  errors.forEach(error => console.log(`      - ${error}`));
}

console.log('\n✅ Ready to run tests and build!');
