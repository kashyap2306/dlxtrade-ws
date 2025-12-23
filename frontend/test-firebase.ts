// Simple Firebase test - check if environment variables are loaded
console.log("[TEST] Checking Firebase environment variables...");

const apiKey = process.env.VITE_FIREBASE_API_KEY;
const authDomain = process.env.VITE_FIREBASE_AUTH_DOMAIN;
const projectId = process.env.VITE_FIREBASE_PROJECT_ID;
const appId = process.env.VITE_FIREBASE_APP_ID;

console.log(`API Key: ${apiKey ? '✓ Loaded' : '✗ Missing'}`);
console.log(`Auth Domain: ${authDomain ? '✓ Loaded' : '✗ Missing'}`);
console.log(`Project ID: ${projectId ? '✓ Loaded' : '✗ Missing'}`);
console.log(`App ID: ${appId ? '✓ Loaded' : '✗ Missing'}`);

if (apiKey && authDomain && projectId && appId) {
  console.log("[TEST] ✅ All Firebase environment variables are loaded!");
  console.log("[TEST] Firebase configuration is ready for initialization.");
} else {
  console.log("[TEST] ❌ Some Firebase environment variables are missing.");
  process.exit(1);
}
