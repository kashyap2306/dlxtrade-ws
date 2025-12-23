// Simple test script to run provider config system test
import { testProviderConfigSystem } from './routes/users/providerConfig';

async function main() {
  console.log("Starting provider config test...");

  // Use a test UID - replace with actual UID when testing
  const testUid = process.argv[2] || 'test-user-123';

  try {
    const result = await testProviderConfigSystem(testUid);
    console.log("Test completed with result:", result);
  } catch (error) {
    console.error("Test failed:", error);
    process.exit(1);
  }
}

main().catch(console.error);