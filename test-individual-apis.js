// Test individual API calls to find which one is slow
const { MarketAuxAdapter } = require('./dist/services/MarketAuxAdapter.js');
const { BinancePublicAdapter } = require('./dist/services/binancePublicAdapter.js');
const { CoinGeckoAdapter } = require('./dist/services/coingeckoAdapter.js');
const { GoogleFinanceAdapter } = require('./dist/services/googleFinanceAdapter.js');

async function testIndividualAPIs() {
  console.log('🔬 Testing Individual API Calls...\n');

  // Test MarketAux
  console.log('Testing MarketAux...');
  const start1 = Date.now();
  try {
    const marketAux = new MarketAuxAdapter(null);
    const result1 = await Promise.race([
      marketAux.getNewsSentiment('BTCUSDT'),
      new Promise((_, reject) => setTimeout(() => reject(new Error('MarketAux timeout')), 2000))
    ]);
    console.log(`✅ MarketAux: ${Date.now() - start1}ms`);
  } catch (error) {
    console.log(`❌ MarketAux: ${Date.now() - start1}ms - ${error.message}`);
  }

  // Test Binance
  console.log('Testing Binance...');
  const start2 = Date.now();
  try {
    const binance = new BinancePublicAdapter();
    const result2 = await Promise.race([
      binance.getTicker('BTCUSDT'),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Binance timeout')), 2000))
    ]);
    console.log(`✅ Binance: ${Date.now() - start2}ms`);
  } catch (error) {
    console.log(`❌ Binance: ${Date.now() - start2}ms - ${error.message}`);
  }

  // Test CoinGecko
  console.log('Testing CoinGecko...');
  const start3 = Date.now();
  try {
    const result3 = await Promise.race([
      CoinGeckoAdapter.getHistoricalData('BTCUSDT', 30),
      new Promise((_, reject) => setTimeout(() => reject(new Error('CoinGecko timeout')), 2000))
    ]);
    console.log(`✅ CoinGecko: ${Date.now() - start3}ms`);
  } catch (error) {
    console.log(`❌ CoinGecko: ${Date.now() - start3}ms - ${error.message}`);
  }

  // Test Google Finance
  console.log('Testing Google Finance...');
  const start4 = Date.now();
  try {
    const result4 = await Promise.race([
      GoogleFinanceAdapter.getExchangeRate('USD', 'INR'),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Google Finance timeout')), 2000))
    ]);
    console.log(`✅ Google Finance: ${Date.now() - start4}ms`);
  } catch (error) {
    console.log(`❌ Google Finance: ${Date.now() - start4}ms - ${error.message}`);
  }

  console.log('\n🏁 Individual API testing complete.');
}

testIndividualAPIs();
