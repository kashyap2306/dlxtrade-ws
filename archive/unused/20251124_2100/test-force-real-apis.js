/**
 * FORCE REAL API TEST
 * Test Deep Research by forcing real API usage (bypass fallbacks)
 */

const { ResearchEngine } = require('./dist/services/researchEngine');
const { firestoreAdapter } = require('./dist/services/firestoreAdapter');

async function testForceRealAPIs() {
  console.log('🚀 FORCE REAL API TEST');
  console.log('=====================');
  console.log('Testing Deep Research with FORCED real API usage...\n');

  try {
    // First check what keys are stored
    console.log('🔑 Checking stored API keys...');
    const providerKeys = await firestoreAdapter.getUserProviderApiKeys('system');

    const marketAuxKey = providerKeys.marketaux?.apiKey;
    const cryptoCompareKey = providerKeys.cryptocompare?.apiKey;

    console.log(`MarketAux key: ${marketAuxKey ? '✅ STORED' : '❌ MISSING'}`);
    console.log(`CryptoCompare key: ${cryptoCompareKey ? '✅ STORED' : '❌ MISSING'}`);

    if (!marketAuxKey || !cryptoCompareKey) {
      console.log('\n❌ REQUIRED API KEYS NOT STORED');
      console.log('Cannot run real API test without stored keys.');
      return { success: false, reason: 'Missing API keys' };
    }

    // Override the research engine to use real keys
    console.log('\n🔧 Overriding with stored API keys...');

    const overrideKeys = {
      marketauxApiKey: marketAuxKey,
      cryptocompareApiKey: cryptoCompareKey
    };

    const engine = new ResearchEngine();

    console.log('🚀 Running Deep Research with REAL API keys...');
    const startTime = Date.now();
    const result = await engine.runResearch('BTCUSDT', 'system', null, true, [], '5m', overrideKeys);
    const endTime = Date.now();

    console.log('✅ Research completed!');
    console.log(`⏱️  Execution time: ${(endTime - startTime)}ms\n`);

    // Analyze results
    const features = result.features || {};
    const indicators = result.indicators || {};
    const mtf = result.mtf || {};

    console.log('📊 REAL DATA ANALYSIS:');
    console.log('====================');

    // RSI check
    const rsi = indicators.rsi;
    const rsiReal = rsi !== 50 && rsi !== null && rsi !== undefined && !isNaN(rsi);
    console.log(`RSI: ${rsi} ${rsiReal ? '✅ REAL' : '❌ FALLBACK'}`);

    // MACD check
    const macd = indicators.macd;
    const macdReal = macd && macd.histogram !== 0 && macd.histogram !== null && !isNaN(macd.histogram);
    console.log(`MACD Histogram: ${macd?.histogram} ${macdReal ? '✅ REAL' : '❌ FALLBACK'}`);

    // Sentiment check
    const sentiment = features.newsSentiment;
    const sentimentReal = sentiment &&
                         sentiment !== 'Sentiment data not available' &&
                         !sentiment.includes('neutral') &&
                         !sentiment.includes('0.05');
    console.log(`Sentiment: ${sentiment} ${sentimentReal ? '✅ REAL' : '❌ FALLBACK'}`);

    // MTF check
    const mtf5m = mtf['5m'] && mtf['5m'].rsi !== 50 && mtf['5m'].rsi !== null;
    const mtf15m = mtf['15m'] && mtf['15m'].rsi !== 50 && mtf['15m'].rsi !== null;
    const mtf1h = mtf['1h'] && mtf['1h'].rsi !== 50 && mtf['1h'].rsi !== null;
    const mtfReal = mtf5m && mtf15m && mtf1h;
    console.log(`MTF Data: ${mtfReal ? '✅ REAL' : '❌ FALLBACK'}`);

    console.log('\n📋 FULL RESULTS:');
    console.log('===============');

    console.log(`Symbol: ${result.symbol}`);
    console.log(`Signal: ${result.signal}`);
    console.log(`Confidence: ${result.confidence.toFixed(1)}%`);

    console.log('\n📈 Technical Indicators:');
    console.log(`RSI: ${rsi}`);
    console.log(`MACD: ${macd ? `Histogram: ${macd.histogram}` : 'N/A'}`);

    console.log('\n📰 Sentiment:');
    console.log(`${sentiment || 'N/A'}`);

    console.log('\n⏰ MTF Analysis:');
    console.log(`5m RSI: ${mtf['5m']?.rsi || 'N/A'}`);
    console.log(`15m RSI: ${mtf['15m']?.rsi || 'N/A'}`);
    console.log(`1h RSI: ${mtf['1h']?.rsi || 'N/A'}`);

    console.log('\n🔗 APIs Used:');
    const apisUsed = result.apisUsed || {};
    console.log(Object.keys(apisUsed).join(', '));

    const allReal = rsiReal && macdReal && sentimentReal && mtfReal;

    console.log(`\n🏆 FINAL VERIFICATION: ${allReal ? '✅ ALL REAL APIs WORKING' : '❌ SOME FALLBACK DATA USED'}`);

    return {
      success: true,
      allReal,
      result,
      verification: {
        rsiReal,
        macdReal,
        sentimentReal,
        mtfReal
      }
    };

  } catch (error) {
    console.error('❌ Force real API test failed:', error.message);
    console.error('Stack:', error.stack);
    return { success: false, error: error.message };
  }
}

// Run test
if (require.main === module) {
  testForceRealAPIs().then(result => {
    if (result.success && result.allReal) {
      console.log('\n🎯 SUCCESS: Deep Research is using REAL API data!');
    } else {
      console.log('\n⚠️  PARTIAL: Some APIs may still be using fallbacks.');
    }
  }).catch(console.error);
}

module.exports = { testForceRealAPIs };
