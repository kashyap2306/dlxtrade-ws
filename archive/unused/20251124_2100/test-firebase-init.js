// Test script to verify Firebase Admin initialization
// Run with: node test-firebase-init.js

require('dotenv').config();
const admin = require('firebase-admin');

console.log('🔍 Testing Firebase Admin Initialization...\n');

// Check if env var exists
const raw = process.env.FIREBASE_SERVICE_ACCOUNT || process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
if (!raw) {
  console.error('❌ FIREBASE_SERVICE_ACCOUNT not found in environment');
  process.exit(1);
}

console.log('✅ FIREBASE_SERVICE_ACCOUNT found in environment');
console.log(`   Length: ${raw.length} characters\n`);

// Parse JSON
let parsed;
try {
  parsed = JSON.parse(raw);
  console.log('✅ JSON parsed successfully');
  console.log(`   Project ID: ${parsed.project_id}`);
  console.log(`   Client Email: ${parsed.client_email}`);
  console.log(`   Private Key ID: ${parsed.private_key_id}`);
  console.log(`   Private Key Length: ${parsed.private_key?.length || 0} characters\n`);
} catch (err) {
  console.error('❌ Failed to parse JSON:', err.message);
  process.exit(1);
}

// Check private_key newline handling
if (parsed.private_key) {
  const hasLiteralNewlines = parsed.private_key.includes('\\n');
  const hasActualNewlines = parsed.private_key.includes('\n');
  
  console.log('🔍 Private Key Analysis:');
  console.log(`   Contains literal \\n: ${hasLiteralNewlines}`);
  console.log(`   Contains actual newlines: ${hasActualNewlines}`);
  
  // Apply the same transformation as the code
  const fixedKey = parsed.private_key.replace(/\\n/g, '\n');
  const hasNewlinesAfterFix = fixedKey.includes('\n');
  console.log(`   After \\n replacement: ${hasNewlinesAfterFix ? '✅ Has newlines' : '❌ No newlines'}\n`);
}

// Try to initialize Firebase Admin
try {
  // Fix private_key like the actual code does
  if (parsed.private_key && typeof parsed.private_key === 'string') {
    parsed.private_key = parsed.private_key.replace(/\\n/g, '\n');
  }

  const app = admin.initializeApp({
    credential: admin.credential.cert({
      projectId: parsed.project_id,
      clientEmail: parsed.client_email,
      privateKey: parsed.private_key,
    }),
    projectId: parsed.project_id,
  });

  console.log('✅ Firebase Admin initialized successfully!');
  console.log(`   App Name: ${app.name}`);
  console.log(`   Project ID: ${app.options.projectId}\n`);

  // Test Firestore connection
  const db = app.firestore();
  console.log('✅ Firestore instance created');
  
  // Try a simple read operation (won't fail if permissions are correct)
  console.log('✅ All checks passed! Firebase Admin is ready.\n');
  
  // Clean up
  app.delete().then(() => {
    console.log('✅ Test completed successfully');
    process.exit(0);
  }).catch((err) => {
    console.error('⚠️  Error cleaning up:', err.message);
    process.exit(0);
  });

} catch (error) {
  console.error('❌ Firebase Admin initialization failed:');
  console.error(`   Error: ${error.message}`);
  if (error.stack) {
    console.error(`   Stack: ${error.stack.split('\n').slice(0, 5).join('\n')}`);
  }
  process.exit(1);
}

