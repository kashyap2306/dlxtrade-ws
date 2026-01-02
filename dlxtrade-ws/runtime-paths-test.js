// RUNTIME PATHS TEST - Verify which code is actually being executed
// This proves whether dist files are stale or current

console.log('🔍 RUNTIME PATHS TEST - Execution Reality Check');
console.log('===============================================');

try {
  // Test 1: Check which keyManager is loaded (try dist first)
  console.log('\n1. Testing keyManager module resolution...');

  let keyManagerPath;
  let loadSource = 'UNKNOWN';

  try {
    keyManagerPath = require.resolve('./dist/services/keyManager');
    loadSource = 'DIST';
    console.log(`   ✅ Resolved from DIST: ${keyManagerPath}`);
  } catch (error) {
    try {
      keyManagerPath = require.resolve('./src/services/keyManager');
      loadSource = 'SRC';
      console.log(`   ✅ Resolved from SRC: ${keyManagerPath}`);
    } catch (error2) {
      console.log(`   ❌ Cannot resolve keyManager module`);
      console.log(`   DIST error: ${error.message}`);
      console.log(`   SRC error: ${error2.message}`);
      return;
    }
  }

  if (loadSource === 'DIST') {
    console.log(`   🚨 LOADING FROM DIST DIRECTORY - ensure dist is current`);
  } else if (loadSource === 'SRC') {
    console.log(`   ✅ LOADING FROM SRC DIRECTORY - changes are immediate`);
  }

  // Test 2: Check file timestamps
  console.log('\n2. Checking file modification timestamps...');
  const fs = require('fs');

  const srcPath = './src/services/keyManager.ts';
  const distPath = './dist/services/keyManager.js';

  if (fs.existsSync(srcPath)) {
    const srcStat = fs.statSync(srcPath);
    console.log(`   SRC file exists: ${srcPath}`);
    console.log(`   SRC modified: ${srcStat.mtime}`);

    if (fs.existsSync(distPath)) {
      const distStat = fs.statSync(distPath);
      console.log(`   DIST file exists: ${distPath}`);
      console.log(`   DIST modified: ${distStat.mtime}`);

      const timeDiff = srcStat.mtime - distStat.mtime;
      if (timeDiff > 0) {
        console.log(`   🚨 DIST IS STALE: SRC is ${Math.round(timeDiff / 1000)} seconds newer`);
      } else if (timeDiff < 0) {
        console.log(`   ⚠️  SRC IS OLDER: DIST is ${Math.round(-timeDiff / 1000)} seconds newer`);
      } else {
        console.log(`   ✅ SRC and DIST timestamps match`);
      }
    } else {
      console.log(`   DIST file does not exist`);
    }
  } else {
    console.log(`   SRC file does not exist: ${srcPath}`);
  }

  // Test 3: Try to load the actual module
  console.log('\n3. Testing actual module loading...');
  try {
    let keyManager;
    if (loadSource === 'DIST') {
      keyManager = require('./dist/services/keyManager');
      console.log(`   ✅ Module loaded from DIST`);
    } else {
      keyManager = require('./src/services/keyManager');
      console.log(`   ✅ Module loaded from SRC`);
    }

    // Check if it has our latest functions
    if (typeof keyManager.decryptOrThrow === 'function') {
      console.log(`   ✅ decryptOrThrow function exists`);

      // Try calling it with missing context to see if it throws
      try {
        keyManager.decryptOrThrow('test', 'field');
        console.log(`   ❌ decryptOrThrow should require 3 parameters`);
      } catch (error) {
        if (error.message.includes('Context must be string')) {
          console.log(`   ✅ decryptOrThrow properly requires context parameter`);
        } else {
          console.log(`   ⚠️  decryptOrThrow error: ${error.message}`);
        }
      }

      // Try calling with invalid context
      try {
        keyManager.decryptOrThrow('test', 'field', 'background_job');
        console.log(`   ❌ decryptOrThrow should reject background_job context`);
      } catch (error) {
        if (error.message.includes('not permitted')) {
          console.log(`   ✅ decryptOrThrow properly rejects background_job context`);
        } else {
          console.log(`   ⚠️  decryptOrThrow error: ${error.message}`);
        }
      }
    } else {
      console.log(`   ❌ decryptOrThrow function missing`);
    }
  } catch (error) {
    console.log(`   ❌ Module load failed: ${error.message}`);
  }

  console.log('\n🎯 EXECUTION REALITY SUMMARY:');
  console.log(`   KeyManager path: ${keyManagerPath}`);
  console.log(`   Loading from: ${keyManagerPath.includes('dist') ? 'DIST' : 'SRC'}`);

  if (keyManagerPath.includes('dist')) {
    console.log(`   🚨 POTENTIAL ISSUE: Using DIST files - ensure they are current`);
  } else {
    console.log(`   ✅ Using SRC files - changes should be immediate`);
  }

} catch (error) {
  console.log(`❌ Runtime paths test failed: ${error.message}`);
  console.error(error.stack);
}

console.log('\n🏁 RUNTIME PATHS TEST COMPLETE');
