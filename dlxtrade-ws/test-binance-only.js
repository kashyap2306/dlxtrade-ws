// Test BinanceAdapter directly
const { BinanceAdapter } = require('./dist/services/binanceAdapter');

async function testBinance() {
  console.log('🧪 Testing BinanceAdapter directly...');

  try {
    const adapter = new BinanceAdapter('', '', true);
    console.log('Created BinanceAdapter');

    const result = await adapter.getPublicMarketData('BTCUSDT');
    console.log('Result:', result);

    if (result && result.hasData) {
      console.log('✅ Binance succeeded!');
      console.log('OHLC data points:', result.ohlc?.length || 0);
    } else {
      console.log('❌ Binance failed:', result);
    }
  } catch (error) {
    console.error('❌ BinanceAdapter threw error:', error.message);
  }
}

testBinance();
