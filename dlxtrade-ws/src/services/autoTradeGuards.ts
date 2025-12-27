/**
 * Auto-Trade Guards
 * ONLY exchange usability checks, risk guards, balance checks, early skip validation helpers
 * These functions must remain PURE and return the same results as before
 * NO execution decisions - only validation
 */

import { logger } from '../utils/logger';
import type { AutoTradeConfig } from './autoTradeEngine';

// Type-safe account balance interfaces
interface FuturesBalance {
  asset: string;
  free?: string | number;
  available?: string | number;
  locked?: string | number;
  frozen?: string | number;
}

interface AccountInfo {
  futuresBalances?: FuturesBalance[];
  data?: Array<{
    marginCoin?: string;
    productType?: string;
    equity?: string | number;
    available?: string | number;
  }>;
  totalEquity?: number | string;
  equity?: number | string;
}

/**
 * CRITICAL: Validate symbol is in top 25 high-liquidity non-stablecoins by market cap
 * System is restricted to top 25 coins (single source of truth)
 * Function name kept for compatibility but checks Top 25
 */
export async function isSymbolInTop10(uid: string, symbol: string): Promise<boolean> {
  try {
    const { getTop100Coins } = await import('./researchModes');
    const top25 = await getTop100Coins(uid, 25);
    const normalizedSymbol = symbol.toUpperCase();
    const isInTop25 = top25.some(coin => coin.symbol === normalizedSymbol);

    if (!isInTop25) {
      logger.error({
        uid,
        symbol: normalizedSymbol,
        top25Symbols: top25.map(c => c.symbol),
        stack: new Error().stack
      }, '❌ [TOP_25_VIOLATION] Symbol outside Top 25 detected in auto-trade engine');
    }

    return isInTop25;
  } catch (error: any) {
    logger.error({ uid, symbol, error: error.message, stack: error.stack }, '❌ [TOP_25_ERROR] Error checking if symbol is in top 25');
    // On error, be safe and block (don't allow non-top-25 coins)
    return false;
  }
}

/**
 * Get current equity from exchange
 * CRITICAL: ALWAYS use USDT-M Futures balance - NEVER use spot balance
 * Single source of truth: getFuturesBalance() or futures data from getAccount()
 */
export async function getCurrentEquity(
  uid: string,
  adapter: any,
  config: AutoTradeConfig,
  saveConfig: (uid: string, update: Partial<AutoTradeConfig>) => Promise<AutoTradeConfig>
): Promise<number> {
  let equity = config.equitySnapshot || 1000; // Default fallback
  let futuresBalanceFetched = false;

  try {
    // PRIORITY 1: ALWAYS try getFuturesBalance() first if available
    if (adapter && typeof adapter.getFuturesBalance === 'function') {
      try {
        const futuresBalance = await adapter.getFuturesBalance();
        // CRITICAL: Use futures balance even if it's 0 (don't fall back to spot)
        equity = futuresBalance.totalBalance || futuresBalance.availableBalance || 0;
        futuresBalanceFetched = true;
        logger.info({
          uid,
          equity,
          availableBalance: futuresBalance.availableBalance,
          source: 'futures',
          marketType: futuresBalance.marketType
        }, '✅ Equity fetched from USDT-M Futures balance');
        // Update equity snapshot
        await saveConfig(uid, { equitySnapshot: equity });
      } catch (futuresErr: any) {
        // CRITICAL: Check if error is due to decryption failure
        if (futuresErr.message?.includes('EXCHANGE_KEY_DECRYPTION_FAILED') ||
          futuresErr.message?.includes('empty') ||
          futuresErr.message?.includes('decryption failed')) {
          logger.error({ uid, error: futuresErr.message }, '❌ getFuturesBalance() failed due to decryption error - aborting equity fetch');
          throw futuresErr; // Re-throw to abort execution
        } else {
          logger.warn({ uid, error: futuresErr.message }, '❌ getFuturesBalance() failed');
        }
      }
    }

    // PRIORITY 2: If getFuturesBalance() not available, try getAccount() for futures data
    // CRITICAL: Only check for futures data - NEVER use spot balance
    if (!futuresBalanceFetched && adapter && typeof adapter.getAccount === 'function') {
      const accountInfo: AccountInfo = await adapter.getAccount();

      // Check for futures balance in account response
      if (accountInfo.futuresBalances && Array.isArray(accountInfo.futuresBalances)) {
        const usdtBalance = accountInfo.futuresBalances.find((b: any) =>
          b.asset === 'USDT' || b.asset === 'USDT'
        );
          if (usdtBalance) {
            const free = parseFloat((usdtBalance.free || usdtBalance.available || '0').toString());
            const locked = parseFloat((usdtBalance.locked || usdtBalance.frozen || '0').toString());
          equity = free + locked;
          futuresBalanceFetched = true;
          logger.info({ uid, equity, source: 'futures-balances-array' }, '✅ Equity fetched from futures balances array');
        }
      }
      // Check for Bitget futures format in data field
      else if (accountInfo.data && Array.isArray(accountInfo.data)) {
        const usdtAccount = accountInfo.data.find((acc: any) => acc.marginCoin === 'USDT' && acc.productType === 'USDT-FUTURES');
        if (usdtAccount) {
          equity = parseFloat((usdtAccount.equity || usdtAccount.available || '0').toString());
          futuresBalanceFetched = true;
          logger.info({ uid, equity, source: 'futures-data-array' }, '✅ Equity fetched from futures data array');
        }
      }
      // Check for direct equity/available fields (futures balance directly)
      else if (accountInfo.totalEquity !== undefined) {
        // If totalEquity exists (even if 0), assume it's futures balance
        equity = parseFloat(accountInfo.totalEquity.toString());
        futuresBalanceFetched = true;
        logger.info({ uid, equity, source: 'futures-totalEquity' }, '✅ Equity fetched from totalEquity (futures)');
      } else if (accountInfo.equity !== undefined) {
        equity = parseFloat(accountInfo.equity.toString());
        futuresBalanceFetched = true;
        logger.info({ uid, equity, source: 'futures-equity' }, '✅ Equity fetched from equity (futures)');
      }

      // Update equity snapshot if futures balance was found
      if (futuresBalanceFetched) {
        await saveConfig(uid, { equitySnapshot: equity });
      }
    }

    // If no futures balance found, use snapshot or default
    if (!futuresBalanceFetched) {
      logger.warn({ uid }, '❌ No USDT-M Futures balance found - using snapshot or default');
      equity = config.equitySnapshot || 1000;
    } else if (equity === 0 || isNaN(equity)) {
      // Even if balance is 0, we fetched it from futures API - that's valid
      logger.info({ uid, equity }, 'Futures balance is 0 - using snapshot as fallback for position sizing');
      equity = config.equitySnapshot || 1000;
    }
  } catch (error: any) {
    logger.warn({ error: error.message, uid }, 'Could not fetch futures balance from exchange, using snapshot');
  }

  return equity;
}

