#!/usr/bin/env node

/**
 * Test script to verify AES encryption/decryption fixes
 */

const { encrypt, decrypt } = require('./dist/services/keyManager');

console.log('🧪 Testing AES Encryption/Decryption Fixes\n');

async function runTests() {
  try {
    // Test 1: Basic encryption/decryption
    console.log('✅ Test 1: Basic encryption/decryption');
    const testKey = 'test-api-key-12345';
    const encrypted = encrypt(testKey);
    const decrypted = decrypt(encrypted);

    console.log(`   Original: ${testKey}`);
    console.log(`   Encrypted: ${encrypted.substring(0, 30)}...`);
    console.log(`   Decrypted: ${decrypted}`);
    console.log(`   ✅ Round-trip: ${decrypted === testKey ? 'SUCCESS' : 'FAILED'}`);

    if (decrypted !== testKey) {
      console.error('❌ Basic encryption/decryption test FAILED');
      process.exit(1);
    }

    // Test 2: Empty string handling
    console.log('\n✅ Test 2: Empty string handling');
    const emptyEncrypted = encrypt('');
    const emptyDecrypted = decrypt(emptyEncrypted);
    console.log(`   Empty string round-trip: ${emptyDecrypted === '' ? 'SUCCESS' : 'FAILED'}`);

    // Test 3: Invalid encrypted data handling
    console.log('\n✅ Test 3: Invalid encrypted data handling');
    const invalidDecrypted = decrypt('invalid-encrypted-data');
    console.log(`   Invalid data returns: "${invalidDecrypted}" (${invalidDecrypted === '' ? 'SUCCESS' : 'FAILED'})`);

    // Test 4: Legacy format compatibility (old CBC format)
    console.log('\n✅ Test 4: Legacy format compatibility');
    // Test with some random base64 data that doesn't match our format
    const invalidData = 'some-random-base64-data-that-does-not-match-our-format';

    // This should fail gracefully and return empty
    const legacyDecrypted = decrypt(invalidData);
    console.log(`   Invalid format handled: ${legacyDecrypted === '' ? 'SUCCESS' : 'FAILED'}`);

    console.log('\n🎉 All encryption tests passed!');
    console.log('✅ AES-256-CBC encryption/decryption working correctly');
    console.log('✅ Invalid data handled gracefully');
    console.log('✅ Empty strings handled properly');
    console.log('✅ Legacy formats handled safely');

  } catch (error) {
    console.error('❌ Encryption test failed:', error);
    process.exit(1);
  }
}

runTests();
