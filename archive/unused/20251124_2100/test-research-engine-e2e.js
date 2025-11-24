// End-to-End Test Script for Research Engine
// This script tests the Research Engine with full debug logging
// Run: node scripts/test-research-engine-e2e.js

const http = require('http');

const API_URL = 'http://localhost:4000';
const TEST_SYMBOL = 'BTCUSDT';
const TEST_TIMEFRAME = '5m';

// Colors for console output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

function log(color, label, message) {
  console.log(`${colors[color]}${colors.bright}[${label}]${colors.reset} ${message}`);
}

async function makeRequest(token) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({
      symbol: TEST_SYMBOL,
      timeframe: TEST_TIMEFRAME,
    });

    const options = {
      hostname: 'localhost',
      port: 4000,
      path: '/api/research/run',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
        ...(token && { 'Authorization': `Bearer ${token}` }),
      },
    };

    const req = http.request(options, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        try {
          const jsonData = JSON.parse(data);
          resolve({ status: res.statusCode, data: jsonData, raw: data });
        } catch (e) {
          resolve({ status: res.statusCode, data: null, raw: data });
        }
      });
    });

    req.on('error', (e) => {
      reject(e);
    });

    req.write(postData);
    req.end();
  });
}

function analyzeResponse(response) {
  const results = {
    success: false,
    indicators: {},
    issues: [],
    warnings: [],
    passed: [],
  };

  if (response.status !== 200) {
    results.issues.push(`HTTP Status: ${response.status} (expected 200)`);
    return results;
  }

  if (!response.data || !response.data.result) {
    results.issues.push('No result data in response');
    return results;
  }

  const result = response.data.result;
  results.success = true;

  // Check indicators
  const indicators = result.indicators || {};

  // RSI Check
  if (indicators.rsi === 50) {
    results.issues.push('❌ RSI is 50 (fallback value detected!)');
  } else if (indicators.rsi === null || indicators.rsi === undefined) {
    results.warnings.push('⚠️  RSI is null (no data available)');
  } else {
    results.passed.push(`✅ RSI: ${indicators.rsi} (real value)`);
    results.indicators.rsi = indicators.rsi;
  }

  // MACD Check
  if (indicators.macd) {
    if (indicators.macd.signal === 0 && indicators.macd.histogram === 0) {
      results.issues.push('❌ MACD is 0/0 (fallback value detected!)');
    } else {
      results.passed.push(`✅ MACD: signal=${indicators.macd.signal}, histogram=${indicators.macd.histogram} (real value)`);
      results.indicators.macd = indicators.macd;
    }
  } else {
    results.warnings.push('⚠️  MACD is null (no data available)');
  }

  // Volume Check
  if (indicators.volume === null || indicators.volume === undefined) {
    results.warnings.push('⚠️  Volume is null (no data available)');
  } else if (typeof indicators.volume === 'string' && indicators.volume === 'Stable') {
    results.issues.push('❌ Volume is "Stable" (fallback value detected!)');
  } else {
    results.passed.push(`✅ Volume: ${indicators.volume} (real value)`);
    results.indicators.volume = indicators.volume;
  }

  // Trend Strength Check
  if (indicators.trendStrength) {
    if (indicators.trendStrength.trend === 'Weak' && !indicators.trendStrength.ema20 && !indicators.trendStrength.ema12) {
      results.issues.push('❌ TrendStrength is "Weak" without EMA values (fallback detected!)');
    } else {
      results.passed.push(`✅ TrendStrength: ${JSON.stringify(indicators.trendStrength)} (real value)`);
      results.indicators.trendStrength = indicators.trendStrength;
    }
  } else {
    results.warnings.push('⚠️  TrendStrength is null (no data available)');
  }

  // Volatility Check
  if (indicators.volatility === null || indicators.volatility === undefined) {
    results.warnings.push('⚠️  Volatility is null (no data available)');
  } else if (typeof indicators.volatility === 'string' && indicators.volatility === 'Low') {
    results.warnings.push('⚠️  Volatility is "Low" (might be real, but verify)');
    results.indicators.volatility = indicators.volatility;
  } else {
    results.passed.push(`✅ Volatility: ${indicators.volatility} (real value)`);
    results.indicators.volatility = indicators.volatility;
  }

  // Orderbook Check
  if (indicators.orderbook === null || indicators.orderbook === undefined) {
    results.warnings.push('⚠️  Orderbook is null (no data available)');
  } else if (indicators.orderbook === 0) {
    results.warnings.push('⚠️  Orderbook imbalance is 0% (might be real, but verify)');
    results.indicators.orderbook = indicators.orderbook;
  } else {
    results.passed.push(`✅ Orderbook: ${indicators.orderbook}% (real value)`);
    results.indicators.orderbook = indicators.orderbook;
  }

  // Accuracy Check
  if (result.accuracy !== undefined && result.accuracy !== null) {
    results.passed.push(`✅ Accuracy: ${(result.accuracy * 100).toFixed(1)}%`);
    results.indicators.accuracy = result.accuracy;
  }

  // Signals Check
  if (result.entrySignal || result.exitSignal) {
    results.passed.push(`✅ Signals generated: entry=${result.entrySignal}, exit=${result.exitSignal ? 'yes' : 'no'}`);
  } else {
    results.warnings.push('⚠️  No signals generated (might be due to accuracy < 60%)');
  }

  // APIs Used Check
  if (result.apisUsed && result.apisUsed.length > 0) {
    results.passed.push(`✅ APIs Used: ${result.apisUsed.join(', ')}`);
    results.indicators.apisUsed = result.apisUsed;
  }

  return results;
}

async function main() {
  console.log('\n' + '='.repeat(80));
  log('cyan', 'TEST', 'Research Engine End-to-End Test');
  console.log('='.repeat(80) + '\n');

  log('yellow', 'INFO', `Testing with Symbol: ${TEST_SYMBOL}, Timeframe: ${TEST_TIMEFRAME}`);
  log('yellow', 'INFO', 'Make sure the backend server is running on http://localhost:4000');
  log('yellow', 'INFO', 'Watch the server console for detailed debug logs\n');

  // Check if server is running
  try {
    const testReq = http.request({
      hostname: 'localhost',
      port: 4000,
      path: '/health',
      method: 'GET',
      timeout: 2000,
    }, () => {
      log('green', 'OK', 'Server is running');
    });

    testReq.on('error', () => {
      log('red', 'ERROR', 'Server is not running! Please start it with: npm run dev');
      process.exit(1);
    });

    testReq.on('timeout', () => {
      log('red', 'ERROR', 'Server connection timeout!');
      process.exit(1);
    });

    testReq.end();

    // Wait a bit
    await new Promise(resolve => setTimeout(resolve, 1000));
  } catch (e) {
    log('red', 'ERROR', 'Cannot connect to server');
    process.exit(1);
  }

  // Get token from command line or use empty
  const token = process.argv[2] || null;
  if (!token) {
    log('yellow', 'WARN', 'No auth token provided. Request may fail with 401.');
    log('yellow', 'INFO', 'To get a token: localStorage.getItem("firebaseToken") from browser console\n');
  }

  log('blue', 'TEST', 'Making research request...\n');

  try {
    const response = await makeRequest(token);

    log('blue', 'RESPONSE', `HTTP Status: ${response.status}`);

    if (response.status === 401) {
      log('red', 'ERROR', 'Authentication required. Please provide a valid token.');
      log('yellow', 'INFO', 'Usage: node scripts/test-research-engine-e2e.js YOUR_TOKEN');
      process.exit(1);
    }

    if (response.status !== 200) {
      log('red', 'ERROR', `Request failed with status ${response.status}`);
      console.log('Response:', response.raw);
      process.exit(1);
    }

    const analysis = analyzeResponse(response);

    console.log('\n' + '='.repeat(80));
    log('cyan', 'ANALYSIS', 'Test Results Summary');
    console.log('='.repeat(80) + '\n');

    if (analysis.issues.length > 0) {
      log('red', 'ISSUES', 'Critical problems found:');
      analysis.issues.forEach(issue => console.log(`  ${issue}`));
      console.log();
    }

    if (analysis.warnings.length > 0) {
      log('yellow', 'WARNINGS', 'Potential issues:');
      analysis.warnings.forEach(warning => console.log(`  ${warning}`));
      console.log();
    }

    if (analysis.passed.length > 0) {
      log('green', 'PASSED', 'Checks that passed:');
      analysis.passed.forEach(pass => console.log(`  ${pass}`));
      console.log();
    }

    console.log('='.repeat(80));
    log('cyan', 'INDICATORS', 'Final Indicator Values');
    console.log('='.repeat(80));
    console.log(JSON.stringify(analysis.indicators, null, 2));
    console.log();

    // Final verdict
    console.log('='.repeat(80));
    if (analysis.issues.length === 0) {
      log('green', 'RESULT', '✅ TEST PASSED - No fallback values detected!');
      if (analysis.warnings.length > 0) {
        log('yellow', 'NOTE', 'Some indicators are null (no data), but this is acceptable if data is unavailable.');
      }
    } else {
      log('red', 'RESULT', '❌ TEST FAILED - Fallback values detected!');
      log('red', 'ACTION', 'Please check the server console logs to identify the root cause.');
      process.exit(1);
    }
    console.log('='.repeat(80) + '\n');

    log('blue', 'NEXT', 'Check the server console for detailed debug logs:');
    log('blue', 'NEXT', '  - STEP 1: REQUEST RECEIVED');
    log('blue', 'NEXT', '  - STEP 2: KLINES FETCH (adapter logs)');
    log('blue', 'NEXT', '  - STEP 3: CALCULATE_FEATURES START');
    log('blue', 'NEXT', '  - STEP 4-6: INDICATOR CALCULATIONS');
    log('blue', 'NEXT', '  - FINAL: INDICATOR VALUES SUMMARY\n');

  } catch (error) {
    log('red', 'ERROR', `Request failed: ${error.message}`);
    console.error(error);
    process.exit(1);
  }
}

main();

