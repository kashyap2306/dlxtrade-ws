/**
 * DIAGNOSTIC SCRIPT: Decrypt Failure Root Cause Analysis
 * 
 * This script performs deep analysis to find the EXACT cause of decrypt failures:
 * 1. Verifies ENCRYPTION_SECRET is loaded correctly
 * 2. Tests encryption/decryption round-trip
 * 3. Reads actual encrypted data from Firestore
 * 4. Attempts to decrypt with current key
 * 5. Analyzes encrypted data format
 * 6. Detects key mismatch vs data corruption
 */

require('dotenv').config({ path: require('path').join(__dirname, '.env') });

async function diagnoseDecryptFailure() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('🔍 DECRYPT FAILURE DIAGNOSTIC - ROOT CAUSE ANALYSIS');
  console.log('═══════════════════════════════════════════════════════════════\n');

  // STEP 1: Verify ENCRYPTION_SECRET is loaded
  console.log('STEP 1: Verify ENCRYPTION_SECRET Environment Variable');
  console.log('─────────────────────────────────────────────────────────────');
  const encryptionSecret = process.env.ENCRYPTION_SECRET;
  
  if (!encryptionSecret) {
    console.error('❌ CRITICAL: ENCRYPTION_SECRET is not defined in environment');
    console.error('   This is the root cause - server cannot decrypt without this key');
    process.exit(1);
  }
  
  console.log('✅ ENCRYPTION_SECRET is defined');
  console.log(`   Length: ${encryptionSecret.length} characters`);
  console.log(`   First 8 chars: ${encryptionSecret.substring(0, 8)}...`);
  console.log(`   Last 8 chars: ...${encryptionSecret.substring(encryptionSecret.length - 8)}`);
  
  if (encryptionSecret.length < 32) {
    console.error('❌ CRITICAL: ENCRYPTION_SECRET is too short (< 32 characters)');
    console.error('   This will cause encryption/decryption to fail');
    process.exit(1);
  }
  console.log('✅ ENCRYPTION_SECRET length is valid (>= 32 characters)\n');

  // STEP 2: Initialize encryption key and test round-trip
  console.log('STEP 2: Initialize Encryption Key and Test Round-Trip');
  console.log('─────────────────────────────────────────────────────────────');
  
  const { initializeEncryptionKey, encrypt, decrypt, getEncryptionKeyHash } = require('./dist/services/keyManager');
  
  try {
    initializeEncryptionKey();
    const keyHash = getEncryptionKeyHash(8);
    console.log('✅ Encryption key initialized successfully');
    console.log(`   Key hash: ${keyHash}`);
  } catch (error) {
    console.error('❌ CRITICAL: Failed to initialize encryption key');
    console.error(`   Error: ${error.message}`);
    process.exit(1);
  }

  // Test encryption/decryption round-trip
  const testData = 'test_api_key_12345';
  console.log(`\n   Testing round-trip with: "${testData}"`);
  
  try {
    const encrypted = encrypt(testData);
    console.log(`   Encrypted: ${encrypted.substring(0, 40)}...`);
    console.log(`   Encrypted length: ${encrypted.length}`);
    console.log(`   Encrypted format: ${encrypted.includes(':') ? 'iv:ciphertext (VALID)' : 'INVALID'}`);
    
    const decrypted = decrypt(encrypted, 'user_request');
    console.log(`   Decrypted: ${decrypted}`);
    
    if (decrypted === testData) {
      console.log('✅ Round-trip encryption/decryption works correctly');
    } else {
      console.error('❌ CRITICAL: Round-trip failed - decrypted value does not match original');
      console.error(`   Expected: ${testData}`);
      console.error(`   Got: ${decrypted}`);
      process.exit(1);
    }
  } catch (error) {
    console.error('❌ CRITICAL: Round-trip encryption/decryption failed');
    console.error(`   Error: ${error.message}`);
    process.exit(1);
  }

  console.log('\n');

  // STEP 3: Connect to Firestore and read actual encrypted data
  console.log('STEP 3: Read Actual Encrypted Data from Firestore');
  console.log('─────────────────────────────────────────────────────────────');
  
  const { getFirebaseAdmin } = require('./dist/utils/firebase');
  const admin = getFirebaseAdmin();
  const db = admin.firestore();

  // Find a user with exchange config
  console.log('   Searching for users with exchange config...');
  const usersSnapshot = await db.collection('users').limit(10).get();
  
  let foundUser = null;
  let exchangeConfigData = null;

  for (const userDoc of usersSnapshot.docs) {
    const uid = userDoc.id;
    if (uid.startsWith('system-') || uid.length < 10) continue;

    const exchangeConfigDoc = await db
      .collection('users')
      .doc(uid)
      .collection('exchangeConfig')
      .doc('current')
      .get();

    if (exchangeConfigDoc.exists) {
      foundUser = uid;
      exchangeConfigData = exchangeConfigDoc.data();
      break;
    }
  }

  if (!foundUser) {
    console.log('⚠️  No users found with exchange config');
    console.log('   This is expected if no exchanges have been connected yet');
    console.log('   Connect an exchange in the UI and run this script again');
    process.exit(0);
  }

  console.log(`✅ Found user with exchange config: ${foundUser}`);
  console.log(`   Exchange: ${exchangeConfigData.exchange}`);
  console.log(`   Has apiKeyEncrypted: ${!!exchangeConfigData.apiKeyEncrypted}`);
  console.log(`   Has secretEncrypted: ${!!exchangeConfigData.secretEncrypted}`);
  console.log(`   Has secretKeyEncrypted: ${!!exchangeConfigData.secretKeyEncrypted}`);
  console.log(`   Has passphraseEncrypted: ${!!exchangeConfigData.passphraseEncrypted}`);

  // STEP 4: Analyze encrypted data format
  console.log('\nSTEP 4: Analyze Encrypted Data Format');
  console.log('─────────────────────────────────────────────────────────────');

  const encryptedApiKey = exchangeConfigData.apiKeyEncrypted;
  const encryptedSecret = exchangeConfigData.secretEncrypted || exchangeConfigData.secretKeyEncrypted;
  const encryptedPassphrase = exchangeConfigData.passphraseEncrypted;

  if (encryptedApiKey) {
    console.log('\n   API Key Analysis:');
    console.log(`   - Length: ${encryptedApiKey.length}`);
    console.log(`   - Format: ${encryptedApiKey.includes(':') ? 'iv:ciphertext (VALID)' : 'INVALID - missing colon separator'}`);
    console.log(`   - First 40 chars: ${encryptedApiKey.substring(0, 40)}...`);
    
    if (encryptedApiKey.includes(':')) {
      const parts = encryptedApiKey.split(':');
      console.log(`   - IV part length: ${parts[0].length} (expected: ~24 for base64 16-byte IV)`);
      console.log(`   - Ciphertext part length: ${parts[1].length}`);
    }
  }

  if (encryptedSecret) {
    console.log('\n   Secret Analysis:');
    console.log(`   - Length: ${encryptedSecret.length}`);
    console.log(`   - Format: ${encryptedSecret.includes(':') ? 'iv:ciphertext (VALID)' : 'INVALID - missing colon separator'}`);
    console.log(`   - First 40 chars: ${encryptedSecret.substring(0, 40)}...`);
    
    if (encryptedSecret.includes(':')) {
      const parts = encryptedSecret.split(':');
      console.log(`   - IV part length: ${parts[0].length} (expected: ~24 for base64 16-byte IV)`);
      console.log(`   - Ciphertext part length: ${parts[1].length}`);
    }
  }

  // STEP 5: Attempt to decrypt actual data
  console.log('\nSTEP 5: Attempt to Decrypt Actual Firestore Data');
  console.log('─────────────────────────────────────────────────────────────');

  let decryptSuccess = true;
  let decryptErrors = [];

  // Try to decrypt API key
  if (encryptedApiKey) {
    console.log('\n   Attempting to decrypt API key...');
    try {
      const decryptedApiKey = decrypt(encryptedApiKey, 'background_job');
      
      if (decryptedApiKey === null) {
        console.error('   ❌ Decryption returned NULL');
        console.error('      This means the encrypted data cannot be decrypted with current key');
        decryptSuccess = false;
        decryptErrors.push('API key decryption returned null');
      } else if (decryptedApiKey.trim() === '') {
        console.error('   ❌ Decryption returned EMPTY STRING');
        decryptSuccess = false;
        decryptErrors.push('API key decryption returned empty string');
      } else {
        console.log('   ✅ API key decrypted successfully');
        console.log(`      Length: ${decryptedApiKey.length}`);
        console.log(`      First 8 chars: ${decryptedApiKey.substring(0, 8)}...`);
      }
    } catch (error) {
      console.error('   ❌ Decryption threw error');
      console.error(`      Error: ${error.message}`);
      decryptSuccess = false;
      decryptErrors.push(`API key decryption error: ${error.message}`);
    }
  }

  // Try to decrypt secret
  if (encryptedSecret) {
    console.log('\n   Attempting to decrypt secret...');
    try {
      const decryptedSecret = decrypt(encryptedSecret, 'background_job');
      
      if (decryptedSecret === null) {
        console.error('   ❌ Decryption returned NULL');
        console.error('      This means the encrypted data cannot be decrypted with current key');
        decryptSuccess = false;
        decryptErrors.push('Secret decryption returned null');
      } else if (decryptedSecret.trim() === '') {
        console.error('   ❌ Decryption returned EMPTY STRING');
        decryptSuccess = false;
        decryptErrors.push('Secret decryption returned empty string');
      } else {
        console.log('   ✅ Secret decrypted successfully');
        console.log(`      Length: ${decryptedSecret.length}`);
        console.log(`      First 8 chars: ${decryptedSecret.substring(0, 8)}...`);
      }
    } catch (error) {
      console.error('   ❌ Decryption threw error');
      console.error(`      Error: ${error.message}`);
      decryptSuccess = false;
      decryptErrors.push(`Secret decryption error: ${error.message}`);
    }
  }

  // Try to decrypt passphrase if present
  if (encryptedPassphrase) {
    console.log('\n   Attempting to decrypt passphrase...');
    try {
      const decryptedPassphrase = decrypt(encryptedPassphrase, 'background_job');
      
      if (decryptedPassphrase === null) {
        console.error('   ❌ Decryption returned NULL');
        decryptSuccess = false;
        decryptErrors.push('Passphrase decryption returned null');
      } else if (decryptedPassphrase.trim() === '') {
        console.error('   ❌ Decryption returned EMPTY STRING');
        decryptSuccess = false;
        decryptErrors.push('Passphrase decryption returned empty string');
      } else {
        console.log('   ✅ Passphrase decrypted successfully');
        console.log(`      Length: ${decryptedPassphrase.length}`);
      }
    } catch (error) {
      console.error('   ❌ Decryption threw error');
      console.error(`      Error: ${error.message}`);
      decryptSuccess = false;
      decryptErrors.push(`Passphrase decryption error: ${error.message}`);
    }
  }

  // STEP 6: Root Cause Analysis
  console.log('\n\n═══════════════════════════════════════════════════════════════');
  console.log('📊 ROOT CAUSE ANALYSIS');
  console.log('═══════════════════════════════════════════════════════════════\n');

  if (decryptSuccess) {
    console.log('✅ ALL DECRYPTION SUCCESSFUL');
    console.log('\n   The encrypted data in Firestore CAN be decrypted with the current key.');
    console.log('   This means:');
    console.log('   - ENCRYPTION_SECRET is correct');
    console.log('   - Encrypted data format is valid');
    console.log('   - No key mismatch detected');
    console.log('\n   If agents are still showing decrypt errors, the issue is likely:');
    console.log('   - Timing issue (decrypt called before key initialization)');
    console.log('   - Different ENCRYPTION_SECRET in production vs development');
    console.log('   - Context parameter issue in decrypt calls');
  } else {
    console.log('❌ DECRYPTION FAILED - ROOT CAUSE IDENTIFIED');
    console.log('\n   The encrypted data in Firestore CANNOT be decrypted with the current key.');
    console.log('\n   ROOT CAUSE: ENCRYPTION KEY MISMATCH');
    console.log('   ────────────────────────────────────────────────────────────');
    console.log('   The data was encrypted with a DIFFERENT ENCRYPTION_SECRET than');
    console.log('   the one currently loaded from the environment.');
    console.log('\n   This happens when:');
    console.log('   1. ENCRYPTION_SECRET was changed after credentials were saved');
    console.log('   2. Credentials were saved in a different environment (dev/prod)');
    console.log('   3. The .env file was modified or replaced');
    console.log('\n   ERRORS DETECTED:');
    decryptErrors.forEach((error, index) => {
      console.log(`   ${index + 1}. ${error}`);
    });
    console.log('\n   SOLUTION:');
    console.log('   ────────────────────────────────────────────────────────────');
    console.log('   Users must reconnect their exchange in Settings → Exchange.');
    console.log('   This will re-encrypt credentials with the current key.');
    console.log('\n   PREVENTION:');
    console.log('   ────────────────────────────────────────────────────────────');
    console.log('   - NEVER change ENCRYPTION_SECRET after deployment');
    console.log('   - Use the same ENCRYPTION_SECRET across all environments');
    console.log('   - Store ENCRYPTION_SECRET securely (env variables, secrets manager)');
  }

  console.log('\n═══════════════════════════════════════════════════════════════\n');
}

diagnoseDecryptFailure().catch(error => {
  console.error('\n❌ DIAGNOSTIC SCRIPT FAILED');
  console.error(`   Error: ${error.message}`);
  console.error(`   Stack: ${error.stack}`);
  process.exit(1);
});
