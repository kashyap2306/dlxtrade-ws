import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../utils/logger';

/**
 * Fetch valid Binance USDT trading pairs and cache them
 */
async function fetchValidBinanceSymbols(): Promise<void> {
  try {
    logger.info('Fetching valid Binance USDT trading pairs...');

    const response = await axios.get('https://api.binance.com/api/v3/exchangeInfo', {
      timeout: 10000,
    });

    // Filter for USDT pairs that are TRADING status
    const validSymbols = response.data.symbols
      .filter((symbol: any) => symbol.status === 'TRADING' && symbol.quoteAsset === 'USDT')
      .map((symbol: any) => symbol.symbol)
      .sort();

    logger.info({ count: validSymbols.length }, 'Fetched valid Binance USDT symbols');

    // Write to cache file
    const cacheDir = path.join(__dirname, '../cache');
    const cacheFile = path.join(cacheDir, 'validSymbols.json');

    const cacheData = {
      symbols: validSymbols,
      lastUpdated: new Date().toISOString(),
      source: 'binance-exchangeInfo',
      count: validSymbols.length,
    };

    fs.writeFileSync(cacheFile, JSON.stringify(cacheData, null, 2));
    logger.info({ cacheFile, count: validSymbols.length }, 'Valid symbols cached successfully');

    // Log some examples
    logger.info({
      first10: validSymbols.slice(0, 10),
      last10: validSymbols.slice(-10),
      totalCount: validSymbols.length
    }, 'Sample of cached symbols');

  } catch (error: any) {
    logger.error({ error: error.message }, 'Failed to fetch valid Binance symbols');
    throw error;
  }
}

/**
 * Load cached valid symbols
 */
export function loadValidSymbols(): string[] {
  try {
    // In development, look in src/cache, in production look in dist/cache
    const isCompiled = __dirname.includes('dist');
    const cacheDir = isCompiled ? path.join(__dirname, '../cache') : path.join(__dirname, '../../src/cache');
    const cacheFile = path.join(cacheDir, 'validSymbols.json');

    if (!fs.existsSync(cacheFile)) {
      logger.warn({ cacheFile }, 'Valid symbols cache not found, will fetch fresh data');
      throw new Error('Cache file not found');
    }

    const cacheData = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));

    // Check if cache is older than 24 hours
    const lastUpdated = new Date(cacheData.lastUpdated);
    const now = new Date();
    const hoursDiff = (now.getTime() - lastUpdated.getTime()) / (1000 * 60 * 60);

    if (hoursDiff > 24) {
      logger.warn({ hoursDiff, lastUpdated: cacheData.lastUpdated }, 'Cache is older than 24 hours, will refresh');
      throw new Error('Cache expired');
    }

    logger.info({ count: cacheData.count, lastUpdated: cacheData.lastUpdated }, 'Loaded valid symbols from cache');
    return cacheData.symbols;
  } catch (error: any) {
    logger.warn({ error: error.message }, 'Failed to load cached symbols, fetching fresh data');
    throw error;
  }
}

/**
 * Check if a symbol is valid for Binance trading
 */
export async function isValidBinanceSymbol(symbol: string): Promise<boolean> {
  try {
    const validSymbols = await getValidSymbols();
    return validSymbols.includes(symbol.toUpperCase());
  } catch (error) {
    logger.warn({ error: error.message, symbol }, 'Failed to check symbol validity, allowing major symbols to proceed');

    // In case of cache/network issues, allow major symbols to proceed
    // This prevents blocking research when cache is temporarily unavailable
    const majorSymbols = [
      'BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'ADAUSDT', 'XRPUSDT', 'SOLUSDT', 'DOTUSDT', 'DOGEUSDT',
      'AVAXUSDT', 'LTCUSDT', 'MATICUSDT', 'SHIBUSDT', 'UNIUSDT', 'LINKUSDT', 'ETCUSDT', 'ATOMUSDT'
    ];

    if (majorSymbols.includes(symbol.toUpperCase())) {
      logger.info({ symbol }, 'Allowing major symbol to proceed despite cache failure');
      return true;
    }

    // For less common symbols, be more conservative
    return false;
  }
}

/**
 * Get valid symbols with auto-refresh
 */
export async function getValidSymbols(): Promise<string[]> {
  try {
    return loadValidSymbols();
  } catch (error) {
    // Cache miss or expired, fetch fresh data
    await fetchValidBinanceSymbols();
    return loadValidSymbols();
  }
}

// Test function for symbol validation
async function testSymbolValidation(): Promise<void> {
  console.log('🧪 Testing symbol validation...');

  const testCases = [
    { symbol: 'BTCUSDT', expected: true },
    { symbol: 'btcusdt', expected: true }, // Case insensitive
    { symbol: 'ETHUSDT', expected: true },
    { symbol: 'RENUSDT', expected: false }, // Invalid symbol
    { symbol: 'GNTUSDT', expected: false }, // Invalid symbol
    { symbol: 'FAKESYMBOL', expected: false }, // Definitely invalid symbol
    { symbol: 'INVALID123', expected: false }, // Invalid symbol
  ];

  for (const testCase of testCases) {
    try {
      const result = await isValidBinanceSymbol(testCase.symbol);
      const status = result === testCase.expected ? '✅ PASS' : '❌ FAIL';
      console.log(`${status} isValidBinanceSymbol("${testCase.symbol}") -> ${result} (expected: ${testCase.expected})`);
    } catch (error: any) {
      console.log(`❌ ERROR testing "${testCase.symbol}": ${error.message}`);
    }
  }
}

// Run if called directly
if (require.main === module) {
  const args = process.argv.slice(2);

  if (args.includes('--test')) {
    testSymbolValidation()
      .then(() => {
        console.log('🧪 Symbol validation tests completed');
        process.exit(0);
      })
      .catch((error) => {
        console.error('❌ Symbol validation tests failed:', error.message);
        process.exit(1);
      });
  } else {
    fetchValidBinanceSymbols()
      .then(() => {
        logger.info('Symbol fetch completed successfully');
        process.exit(0);
      })
      .catch((error) => {
        logger.error({ error: error.message }, 'Symbol fetch failed');
        process.exit(1);
      });
  }
}
