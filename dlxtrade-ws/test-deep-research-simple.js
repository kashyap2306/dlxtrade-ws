// Simple test for deep research API calls
const { runFreeModeDeepResearch } = require('./dist/services/deepResearchEngine');

async function testDeepResearch() {
  console.log('🧪 Testing Deep Research API calls...');

  try {
    // Test with BTCUSDT
    const result = await runFreeModeDeepResearch('test-user', 'BTCUSDT', undefined, {
      binance: { apiKey: '', secret: '' },
      cryptocompare: { apiKey: '' },
      cmc: { apiKey: '' },
      newsdata: { apiKey: '' }
    });

    console.log('✅ Deep Research completed!');
    console.log('Signal:', result.signal);
    console.log('Accuracy:', result.accuracy);
    console.log('Has indicators:', !!result.indicators);
    console.log('RSI value:', result.indicators?.rsi?.value);

    // Check individual provider results
    const providers = ['binance', 'cryptocompare', 'coinmarketcap', 'newsdata'];
    providers.forEach(provider => {
      const providerResult = result.providers?.[provider];
      if (providerResult) {
        console.log(`${provider}: ${providerResult.success ? '✅' : '❌'} (${providerResult.latency}ms)`);
        if (!providerResult.success) {
          console.log(`  Error: ${providerResult.error}`);
        }
      } else {
        console.log(`${provider}: No result data`);
      }
    });

  } catch (error) {
    console.error('❌ Test failed:', error.message);
  }
}

testDeepResearch();
