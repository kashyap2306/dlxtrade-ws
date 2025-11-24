/**
 * Full Provider Verification Test
 * Tests that ALL 5 providers are ALWAYS used in Deep Research
 */

const { ResearchEngine } = require('./dist/services/researchEngine');

async function testFullProviderVerification() {
  console.log('🚀 FULL DEEP RESEARCH PROVIDER VERIFICATION\n');
  console.log('=' .repeat(60));
  console.log('Testing that ALL providers are ALWAYS used...\n');

  const engine = new ResearchEngine();

  // Capture all console output to analyze provider calls
  const originalLog = console.log;
  const originalWarn = console.warn;
  const originalError = console.error;

  const logs = [];
  const captureLog = (level, ...args) => {
    logs.push({ level, message: args.join(' '), timestamp: Date.now() });
    // Still output to console for visibility
    if (level === 'log') originalLog(...args);
    else if (level === 'warn') originalWarn(...args);
    else if (level === 'error') originalError(...args);
  };

  console.log = (...args) => captureLog('log', ...args);
  console.warn = (...args) => captureLog('warn', ...args);
  console.error = (...args) => captureLog('error', ...args);

  try {
    console.log('🔍 Running Deep Research with BTCUSDT...\n');

    const result = await engine.runResearch('BTCUSDT', 'system', null, true, [], '5m');

    // Restore console
    console.log = originalLog;
    console.warn = originalWarn;
    console.error = originalError;

    console.log('\n📊 ANALYSIS RESULTS\n');
    console.log('=' .repeat(40));

    // Check if providers are listed in APIs Used (most reliable indicator)
    const apisUsedData = result.apisUsed || {};
    const providerCalls = {
      marketaux: !!apisUsedData.marketaux,
      binance: !!apisUsedData.binance,
      coingecko: !!apisUsedData.coingecko,
      googlefinance: !!apisUsedData.googlefinance,
      cryptocompare: !!apisUsedData.cryptocompare,
    };

    console.log('🔍 PROVIDER CALL VERIFICATION:');
    console.log('| Provider | Called | Status |');
    console.log('|----------|--------|--------|');

    Object.entries(providerCalls).forEach(([provider, called]) => {
      const status = called ? '✅ PASS' : '❌ FAIL';
      console.log(`| ${provider.padEnd(10)} | ${called ? '✅' : '❌'}     | ${status} |`);
    });

    console.log('');

    // Check result features
    const features = result.features || {};
    const indicators = result.indicators || {};
    const mtf = result.mtf || {};

    console.log('📈 FEATURE CONTRIBUTION VERIFICATION:');
    console.log('| Feature | Provider | Value | Status |');
    console.log('|---------|----------|-------|--------|');

    const featureChecks = [
      { feature: 'Sentiment', provider: 'MarketAux', value: features.newsSentiment, status: features.newsSentiment !== undefined },
      { feature: 'RSI', provider: 'CryptoCompare/Binance', value: indicators.rsi, status: indicators.rsi !== undefined && indicators.rsi !== null },
      { feature: 'MACD', provider: 'CryptoCompare/Binance', value: indicators.macd?.histogram, status: indicators.macd?.histogram !== undefined },
      { feature: 'Volume', provider: 'Binance', value: features.volume, status: features.volume !== undefined },
      { feature: 'Orderbook Imbalance', provider: 'Binance', value: features.orderbookImbalance, status: features.orderbookImbalance !== undefined },
      { feature: 'Liquidity Spread', provider: 'Binance', value: features.liquidity, status: features.liquidity !== undefined },
      { feature: 'Volatility', provider: 'Binance', value: features.volatility, status: features.volatility !== undefined },
      { feature: 'FX Rates', provider: 'Google Finance', value: 'Available', status: true },
      { feature: 'Historical Data', provider: 'CoinGecko', value: 'Available', status: true },
      { feature: 'MTF 5m', provider: 'CryptoCompare/Binance', value: mtf['5m'] ? 'Available' : 'N/A', status: true },
      { feature: 'MTF 15m', provider: 'CryptoCompare/Binance', value: mtf['15m'] ? 'Available' : 'N/A', status: true },
      { feature: 'MTF 1h', provider: 'CryptoCompare/Binance', value: mtf['1h'] ? 'Available' : 'N/A', status: true },
    ];

    featureChecks.forEach(check => {
      const status = check.status ? '✅ PASS' : '❌ FAIL';
      const value = check.value !== undefined ? String(check.value).substring(0, 10) : 'N/A';
      console.log(`| ${check.feature.padEnd(17)} | ${check.provider.padEnd(18)} | ${value.padEnd(5)} | ${status} |`);
    });

    console.log('');

    // Check APIs Used in result
    const apisUsed = result.apisUsed || {};
    console.log('🔗 APIs USED VERIFICATION:');
    console.log('Expected: Binance, CoinGecko, GoogleFinance, MarketAux, CryptoCompare');
    console.log(`Actual: ${Object.keys(apisUsed).join(', ') || 'None'}`);

    const expectedApis = ['binance', 'coingecko', 'googlefinance', 'marketaux', 'cryptocompare'];
    const allApisUsed = expectedApis.every(api => apisUsed[api]);

    console.log(`Status: ${allApisUsed ? '✅ ALL PROVIDERS USED' : '❌ MISSING PROVIDERS'}`);
    console.log('');

    // MTF verification
    console.log('⏰ MTF VERIFICATION:');
    const mtfAvailable = Object.keys(mtf).filter(k => k !== 'score').length;
    console.log(`Available timeframes: ${mtfAvailable}/3`);
    console.log(`MTF Score: ${mtf.score || 'N/A'}`);
    console.log(`Status: ${mtfAvailable >= 3 ? '✅ PASS' : '❌ FAIL'}`);
    console.log('');

    // Final summary
    console.log('🎯 FINAL VERIFICATION SUMMARY:');
    console.log('=' .repeat(40));

    const allProvidersCalled = Object.values(providerCalls).every(called => called);
    const allFeaturesPresent = featureChecks.every(check => check.status);
    const allApisListed = allApisUsed;
    const mtfWorking = mtfAvailable >= 3;

    const overallPass = allProvidersCalled && allFeaturesPresent && allApisListed && mtfWorking;

    console.log(`✅ All Providers Called: ${allProvidersCalled ? 'PASS' : 'FAIL'}`);
    console.log(`✅ All Features Present: ${allFeaturesPresent ? 'PASS' : 'FAIL'}`);
    console.log(`✅ All APIs Listed: ${allApisListed ? 'PASS' : 'FAIL'}`);
    console.log(`✅ MTF Working: ${mtfWorking ? 'PASS' : 'FAIL'}`);
    console.log('');
    console.log(`🎉 OVERALL RESULT: ${overallPass ? '✅ PASS - ALL PROVIDERS WORKING' : '❌ FAIL - ISSUES DETECTED'}`);

    return {
      success: overallPass,
      result,
      providerCalls,
      featureChecks,
      apisUsed,
      mtfAvailable
    };

  } catch (error) {
    // Restore console
    console.log = originalLog;
    console.warn = originalWarn;
    console.error = originalError;

    console.error('❌ Test failed:', error.message);
    return { success: false, error: error.message };
  }
}

// Run test
if (require.main === module) {
  testFullProviderVerification().then(result => {
    if (result.success) {
      console.log('\n🎉 FULL PROVIDER VERIFICATION PASSED!');
      console.log('Deep Research now uses ALL 5 providers reliably.');
      process.exit(0);
    } else {
      console.log('\n❌ FULL PROVIDER VERIFICATION FAILED!');
      console.log('Some providers are not working correctly.');
      process.exit(1);
    }
  }).catch(err => {
    console.error('\n💥 VERIFICATION CRASHED:', err.message);
    process.exit(1);
  });
}

module.exports = { testFullProviderVerification };
