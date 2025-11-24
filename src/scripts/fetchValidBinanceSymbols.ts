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
    const cacheFile = path.join(__dirname, '../cache/validSymbols.json');

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

// Run if called directly
if (require.main === module) {
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
