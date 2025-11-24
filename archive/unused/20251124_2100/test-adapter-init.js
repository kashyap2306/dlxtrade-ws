const { ResearchEngine } = require('./dist/services/researchEngine');

async function testAdapterInitialization() {
  console.log('🧪 TESTING ADAPTER INITIALIZATION\n');

  const engine = new ResearchEngine();

  try {
    // Test the buildProviderAdapters method directly
    console.log('Testing buildProviderAdapters...');

    // Access private method using bracket notation
    const adapters = await engine['buildProviderAdapters']('system');

    console.log('✅ buildProviderAdapters completed');

    // Check if googleFinanceAdapter is now assigned
    if (adapters.googleFinanceAdapter) {
      console.log('✅ SUCCESS: googleFinanceAdapter is assigned!');
      console.log(`   Type: ${typeof adapters.googleFinanceAdapter}`);
      console.log(`   Is function: ${typeof adapters.googleFinanceAdapter === 'function'}`);
    } else {
      console.log('❌ FAILED: googleFinanceAdapter is still undefined');
    }

    console.log('\n🎉 Adapter initialization test completed');

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    console.error('Stack:', error.stack);
    process.exit(1);
  }
}

testAdapterInitialization();
