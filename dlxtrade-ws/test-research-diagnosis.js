// Test script to diagnose Deep Research issues
const { deepResearchEngine } = require('./dist/services/deepResearchEngine');
const { firestoreAdapter } = require('./dist/services/firestoreAdapter');

async function runDiagnosis() {
  console.log('[DIAGNOSIS] Starting Deep Research diagnosis...');

  try {
    // Test with a dummy user ID
    const testUserId = 'test-user-123';

    // Test getting user integrations
    console.log('[DIAGNOSIS] Testing user integrations...');
    const integrations = await firestoreAdapter.getEnabledIntegrations(testUserId);
    console.log('[DIAGNOSIS] User integrations:', {
      cryptocompare: !!integrations.cryptocompare?.apiKey,
      newsdata: !!integrations.newsdata?.apiKey,
      coinmarketcap: !!integrations.coinmarketcap?.apiKey,
      binancepublic: !!integrations.binancePublic?.apiKey,
    });

    // Test getting symbol list
    console.log('[DIAGNOSIS] Testing symbol list retrieval...');
    const symbols = await deepResearchEngine.getResearchSymbolList(testUserId, 5);
    console.log('[DIAGNOSIS] Retrieved symbols:', symbols);

    // Test batch research
    console.log('[DIAGNOSIS] Testing batch research on first 3 symbols...');
    const batchResults = await deepResearchEngine.runDeepResearchBatch(testUserId, symbols.slice(0, 3), 2);
    console.log('[DIAGNOSIS] Batch research completed');
    console.log('[DIAGNOSIS] Batch results summary:');
    batchResults.forEach((result, index) => {
      if (result.result) {
        console.log(`  ${index + 1}. ${result.symbol}: SUCCESS (${result.result.combinedSignal}, ${result.result.accuracy.toFixed(3)}, ${result.durationMs}ms)`);
      } else {
        console.log(`  ${index + 1}. ${result.symbol}: FAILED (${result.error})`);
      }
    });

    // Test single symbol research
    console.log('[DIAGNOSIS] Running deep research on BTCUSDT...');
    const result = await deepResearchEngine.runDeepResearchInternal('BTCUSDT', testUserId);
    console.log('[DIAGNOSIS] Research completed successfully');
    console.log('[DIAGNOSIS] Providers called:', result.legacyResult.providersCalled);
    console.log('[DIAGNOSIS] Combined signal:', result.legacyResult.combinedSignal);
    console.log('[DIAGNOSIS] Accuracy:', result.legacyResult.accuracy);

    // Check raw results for failures
    const raw = result.legacyResult.raw;
    console.log('[DIAGNOSIS] Provider status:');
    console.log('  - CryptoCompare:', raw.cryptoCompare?.error ? 'FAILED: ' + raw.cryptoCompare.error : 'SUCCESS');
    console.log('  - NewsData:', raw.newsData?.error ? 'FAILED: ' + raw.newsData.error : 'SUCCESS');
    console.log('  - CoinMarketCap:', raw.coinMarketCap?.error ? 'FAILED: ' + raw.coinMarketCap.error : 'SUCCESS');
    console.log('  - BinancePublic:', raw.binancePublic?.error ? 'FAILED: ' + raw.binancePublic.error : 'SUCCESS');

  } catch (error) {
    console.error('[DIAGNOSIS] Error during diagnosis:', error.message);
    console.error(error.stack);
  }
}

runDiagnosis();
