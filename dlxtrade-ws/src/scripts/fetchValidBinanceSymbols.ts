import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../utils/logger';

/**
 * Fetch valid Binance USDT trading pairs and cache them
 */
export async function fetchValidBinanceSymbols() {
    try {
        logger.info('Fetching valid Binance USDT trading pairs...');
        const response = await axios.get('https://api.binance.com/api/v3/exchangeInfo', {
            timeout: 10000,
        });

        const validSymbols = response.data.symbols
            .filter((symbol: any) => symbol.status === 'TRADING' && symbol.quoteAsset === 'USDT')
            .map((symbol: any) => symbol.symbol)
            .sort();

        logger.info({ count: validSymbols.length }, 'Fetched valid Binance USDT symbols');

        // Write to cache file (wrapped in try/catch to prevent crashes)
        // Always use root-level cache directory (writable in production)
        const cacheDir = path.join(process.cwd(), 'cache');
        const cacheFile = path.join(cacheDir, 'validSymbols.json');
        const cacheData = {
            symbols: validSymbols,
            lastUpdated: new Date().toISOString(),
            source: 'binance-exchangeInfo',
            count: validSymbols.length,
        };

        try {
            // Ensure cache directory exists with better error handling
            try {
                if (!fs.existsSync(cacheDir)) {
                    fs.mkdirSync(cacheDir, { recursive: true });
                    logger.info({ cacheDir }, 'Created cache directory');
                }
            } catch (dirError: any) {
                logger.error({ error: dirError.message, cacheDir }, 'Failed to create cache directory');
                // Try alternative cache location
                const altCacheDir = path.join(process.cwd(), 'cache');
                try {
                    if (!fs.existsSync(altCacheDir)) {
                        fs.mkdirSync(altCacheDir, { recursive: true });
                    }
                    const altCacheFile = path.join(altCacheDir, 'validSymbols.json');
                    fs.writeFileSync(altCacheFile, JSON.stringify(cacheData, null, 2));
                    logger.info({ cacheFile: altCacheFile, count: validSymbols.length }, 'Valid symbols cached successfully (alternative location)');
                    return;
                } catch (altError: any) {
                    logger.error({ error: altError.message, altCacheDir }, 'Failed to write to alternative cache location');
                }
                return;
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
        // Always use root-level cache directory (consistent between dev and production)
        const cacheDir = path.join(process.cwd(), 'cache');
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
export function isValidBinanceSymbol(symbol: string): boolean {
    try {
        const validSymbols = loadValidSymbols();

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

    } catch (error: any) {
        logger.warn({ error: error.message, symbol }, 'Symbol validation failed, allowing USDT symbols to proceed');
        // In case of any validation failure, allow USDT symbols to proceed
        return symbol.toUpperCase().endsWith('USDT');
    }
}

/**
 * Get valid symbols (with fallback)
 */
export function getValidSymbols(): string[] {
    return loadValidSymbols();
}
