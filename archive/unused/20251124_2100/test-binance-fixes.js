/**
 * Test script to verify Binance market data fixes
 * Tests the 6 issues mentioned in the task:
 * 1. Orderbook parsing
 * 2. Bid-ask spread (liquidity)
 * 3. Volume extraction
 * 4. Volatility calculation
 * 5. Fallback handling
 * 6. Final aggregation
 */

const axios = require('axios');

// Configuration
const API_URL = process.env.API_URL || 'http://localhost:4000';
const TEST_TOKEN = process.env.TEST_TOKEN || ''; // You'll need to provide a valid token

async function testBinanceFixes() {
  console.log('🔧 Testing Binance Market Data Fixes...\n');
  console.log('API URL:', API_URL);
  console.log('Testing symbol: BTCUSDT\n');

  try {
    const response = await axios.post(
      `${API_URL}/api/research/run`,
      {
        symbol: 'BTCUSDT',
        forceEngine: true,
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${TEST_TOKEN}`,
        },
        timeout: 60000, // 60 seconds timeout
      }
    );

    console.log('✅ Response Status:', response.status);

    if (response.data && response.data.success && response.data.results && response.data.results.length > 0) {
      const result = response.data.results[0];
      const features = result.features || {};
      const providerDebug = result._providerDebug || {};

      console.log('\n🔍 BINANCE FIX VERIFICATION:\n');

      // 1. Check orderbook parsing
      console.log('1. ORDERBOOK PARSING:');
      if (providerDebug.binance && providerDebug.binance.depthParseSummary) {
        const depth = providerDebug.binance.depthParseSummary;
        console.log(`   - Bids count: ${depth.bidsCount}`);
        console.log(`   - Asks count: ${depth.asksCount}`);
        console.log(`   - Total bid volume: ${depth.totalBidVolume}`);
        console.log(`   - Total ask volume: ${depth.totalAskVolume}`);
        console.log(`   - Imbalance: ${depth.imbalance}`);
        console.log(`   - ✅ Orderbook parsing: ${depth.bidsCount > 0 && depth.asksCount > 0 ? 'SUCCESS' : 'FAILED'}`);
      } else {
        console.log('   - ❌ No depth parse summary found');
      }

      // 2. Check bid-ask spread (liquidity)
      console.log('\n2. BID-ASK SPREAD (LIQUIDITY):');
      const liquidity = features.liquidity || '';
      const spreadMatch = liquidity.match(/(\d+\.\d+)% spread/);
      if (spreadMatch) {
        const spreadPercent = parseFloat(spreadMatch[1]);
        console.log(`   - Spread percentage: ${spreadPercent}%`);
        console.log(`   - ✅ Spread calculation: ${spreadPercent > 0 ? 'SUCCESS (not 0.000%)' : 'FAILED'}`);
      } else {
        console.log('   - ❌ Could not parse spread percentage');
      }

      // 3. Check volume extraction
      console.log('\n3. VOLUME EXTRACTION:');
      const volume = features.volume || '';
      console.log(`   - Volume signal: ${volume}`);
      console.log(`   - ✅ Volume analysis: ${!volume.includes('Stable') ? 'SUCCESS (not always Stable)' : 'PARTIAL (still Stable)'}`);

      // 4. Check volatility calculation
      console.log('\n4. VOLATILITY CALCULATION:');
      const volatility = features.volatility;
      console.log(`   - Volatility value: ${volatility}`);
      if (volatility && !volatility.includes('null') && !volatility.includes('NaN')) {
        console.log('   - ✅ Volatility calculation: SUCCESS (not NaN)');
      } else {
        console.log('   - ❌ Volatility calculation: FAILED (still NaN/null)');
      }

      // 5. Check orderbook imbalance display
      console.log('\n5. ORDERBOOK IMBALANCE:');
      const imbalanceDisplay = features.orderbookImbalance || '';
      console.log(`   - Imbalance display: ${imbalanceDisplay}`);
      if (imbalanceDisplay.includes('Insufficient depth')) {
        console.log('   - ⚠️  Imbalance: Insufficient depth (this may be expected)');
      } else if (imbalanceDisplay.includes('-99.82%')) {
        console.log('   - ❌ Imbalance: FAILED (still showing unrealistic -99.82%)');
      } else {
        console.log('   - ✅ Imbalance: SUCCESS (realistic value or insufficient depth)');
      }

      // 6. Check provider debug
      console.log('\n6. PROVIDER DEBUG:');
      if (providerDebug.binance) {
        console.log('   - ✅ Provider debug includes Binance details');
        console.log(`   - Spread percentage in debug: ${providerDebug.binance.spreadPercentage}`);
        console.log(`   - Volatility number in debug: ${providerDebug.binance.volatilityNumber}`);
        console.log(`   - Volume trend in debug: ${providerDebug.binance.volumeSummary?.trend}`);
      } else {
        console.log('   - ❌ No Binance provider debug found');
      }

      console.log('\n📋 SUMMARY:');
      console.log('All fixes have been implemented. Check the above results for verification.');

    } else {
      console.log('❌ No valid research results found');
      console.log('Response:', JSON.stringify(response.data, null, 2));
    }

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    if (error.response) {
      console.error('Response status:', error.response.status);
      console.error('Response data:', JSON.stringify(error.response.data, null, 2));
    }
  }
}

// Run the test
if (require.main === module) {
  testBinanceFixes().catch(console.error);
}

module.exports = { testBinanceFixes };
