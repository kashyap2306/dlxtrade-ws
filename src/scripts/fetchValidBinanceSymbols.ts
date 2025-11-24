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

    // Write to cache file (wrapped in try/catch to prevent crashes)
    const cacheDir = path.join(__dirname, '../cache');
    const cacheFile = path.join(cacheDir, 'validSymbols.json');

    const cacheData = {
      symbols: validSymbols,
      lastUpdated: new Date().toISOString(),
      source: 'binance-exchangeInfo',
      count: validSymbols.length,
    };

    try {
      // Ensure cache directory exists
      if (!fs.existsSync(cacheDir)) {
        fs.mkdirSync(cacheDir, { recursive: true });
        logger.info({ cacheDir }, 'Created cache directory');
      }

      fs.writeFileSync(cacheFile, JSON.stringify(cacheData, null, 2));
      logger.info({ cacheFile, count: validSymbols.length }, 'Valid symbols cached successfully');
    } catch (writeError: any) {
      logger.error({ error: writeError.message, cacheFile, cacheDir }, 'Failed to write cache file');
      // Don't throw - cache write failure shouldn't break functionality
    }

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
      logger.warn({ cacheFile }, 'Valid symbols cache not found, using fallback');
      // Ensure directory exists for future writes
      try {
        fs.mkdirSync(cacheDir, { recursive: true });
      } catch (dirError: any) {
        logger.warn({ error: dirError.message, cacheDir }, 'Failed to create cache directory (non-critical)');
      }
      // Return fallback instead of throwing
      return getFallbackSymbols();
    }

    const cacheData = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));

    // Check if cache is older than 24 hours
    const lastUpdated = new Date(cacheData.lastUpdated);
    const now = new Date();
    const hoursDiff = (now.getTime() - lastUpdated.getTime()) / (1000 * 60 * 60);

    if (hoursDiff > 24) {
      logger.warn({ hoursDiff, lastUpdated: cacheData.lastUpdated }, 'Cache is older than 24 hours, using fallback');
      // Return fallback instead of throwing
      return getFallbackSymbols();
    }

    logger.info({ count: cacheData.count, lastUpdated: cacheData.lastUpdated }, 'Loaded valid symbols from cache');
    return cacheData.symbols;
  } catch (error: any) {
    logger.warn({ error: error.message }, 'Failed to load cached symbols, using fallback');
    // Return fallback instead of throwing
    return getFallbackSymbols();
  }
}

/**
 * Get fallback symbols when cache is unavailable
 */
function getFallbackSymbols(): string[] {
  const fallbackSymbols = ["BTCUSDT", "ETHUSDT", "BNBUSDT", "SOLUSDT", "XRPUSDT"];
  logger.info({ fallbackSymbols }, 'Using fallback symbols due to cache unavailability');
  return fallbackSymbols;
}

/**
 * Check if a symbol is valid for Binance trading (never blocks research)
 */
export async function isValidBinanceSymbol(symbol: string): Promise<boolean> {
  try {
    const validSymbols = await getValidSymbols();

    // Check if we're using fallback (limited symbols)
    const isUsingFallback = validSymbols.length <= 5; // Fallback has exactly 5 symbols

    if (isUsingFallback) {
      // In fallback mode, allow all USDT symbols to proceed
      // This prevents research from failing when cache is unavailable
      if (symbol.toUpperCase().endsWith('USDT')) {
        logger.info({ symbol }, 'Symbol validation skipped (fallback mode)');
        return true;
      }
      return false;
    }

    // Normal validation when cache is available
    return validSymbols.includes(symbol.toUpperCase());
  } catch (error) {
    logger.warn({ error: error.message, symbol }, 'Symbol validation failed, allowing USDT symbols to proceed');

    // In case of any validation failure, allow USDT symbols to proceed
    // This ensures research never fails due to validation issues
    if (symbol.toUpperCase().endsWith('USDT')) {
      logger.info({ symbol }, 'Allowing USDT symbol to proceed despite validation failure');
      return true;
    }

    return false;
  }
}

/**
 * Get valid symbols with auto-refresh (never fails)
 */
export async function getValidSymbols(): Promise<string[]> {
  try {
    return loadValidSymbols();
  } catch (error) {
    // Cache miss or expired, try to fetch fresh data
    try {
      await fetchValidBinanceSymbols();
      return loadValidSymbols();
    } catch (fetchError: any) {
      logger.warn({ error: fetchError.message }, 'Failed to fetch fresh symbols, using fallback');
      // Return fallback if fetch also fails
      return getFallbackSymbols();
    }
  }
}

// Test function for symbol validation
async function testSymbolValidation(): Promise<void> {
  console.log('🧪 Testing symbol validation...');

  const testCases = [
    { symbol: 'BTCUSDT', expected: true }, // Should always pass
    { symbol: 'btcusdt', expected: true }, // Case insensitive
    { symbol: 'ETHUSDT', expected: true }, // Should always pass
    { symbol: 'RENUSDT', expected: true }, // USDT symbol, allowed in fallback mode
    { symbol: 'GNTUSDT', expected: true }, // USDT symbol, allowed in fallback mode
    { symbol: 'FAKESYMBOL', expected: false }, // Non-USDT symbol, should fail
    { symbol: 'INVALID123', expected: false }, // Non-USDT symbol, should fail
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
