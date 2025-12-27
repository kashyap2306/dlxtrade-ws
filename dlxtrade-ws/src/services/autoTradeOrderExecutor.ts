/**
 * Auto-Trade Order Executor
 * ONLY entry order placement, TP/SL placement, cancel/rollback order logic
 * This file must NOT decide *whether* to trade, only *how* to place orders
 */

import { logger } from '../utils/logger';
import type { TradeSignal, TradeExecution } from './autoTradeEngine';

/**
 * Set leverage on exchange before placing order
 */
export async function setLeverageOnExchange(adapter: any, symbol: string, leverage: number, uid: string): Promise<void> {
  if (adapter && typeof adapter.setLeverage === 'function') {
    try {
      await adapter.setLeverage(symbol, leverage);
      logger.info({ uid, symbol, leverage }, 'Leverage set on exchange');
    } catch (levErr: any) {
      // Check if error is due to leverage exceeding exchange limit
      if (levErr.message?.includes('leverage') || levErr.message?.includes('Leverage')) {
        const reason = 'LEVERAGE_EXCEEDS_EXCHANGE_LIMIT';
        logger.error({
          uid,
          symbol,
          step: 'LEVERAGE_VALIDATION_FAILED',
          reason,
          requestedLeverage: leverage,
          error: levErr.message
        }, `❌ [LEVERAGE_VALIDATION] BLOCKED: ${reason} - Exchange rejected leverage ${leverage}x`);
        throw new Error(`${reason}: Exchange rejected leverage ${leverage}x - ${levErr.message}`);
      }
      logger.warn({ uid, symbol, error: levErr.message }, 'Failed to set leverage on exchange, proceeding with order');
    }
  }
}

/**
 * Set margin type (ISOLATED for safety)
 */
export async function setMarginType(adapter: any, symbol: string, marginType: 'ISOLATED' | 'CROSSED'): Promise<void> {
  if (adapter && typeof adapter.setMarginType === 'function') {
    try {
      await adapter.setMarginType(symbol, marginType);
    } catch (marginErr) { /* ignore already set errors */ }
  }
}

/**
 * Place entry order
 */
export async function placeEntryOrder(
  adapter: any,
  symbol: string,
  side: 'BUY' | 'SELL',
  quantity: number,
  uid: string
): Promise<{ orderId: string; executedPrice: number; executedQuantity: number }> {
  // Place order
  const orderResult = await adapter.placeOrder({
    symbol,
    side,
    type: 'MARKET',
    quantity: quantity,
  });

  const executedPrice = orderResult.avgPrice || orderResult.price;
  const executedQuantity = orderResult.quantity || quantity;
  const orderId = orderResult.exchangeOrderId || orderResult.clientOrderId || `order_${Date.now()}`;

  logger.info({
    uid,
    symbol,
    side,
    orderId,
    executedPrice,
    executedQuantity
  }, 'Entry order executed successfully');

  return { orderId, executedPrice, executedQuantity };
}

/**
 * Place scalping TP orders (TP1, TP2, TP3)
 */
export async function placeScalpingTPOrders(
  adapter: any,
  symbol: string,
  side: 'BUY' | 'SELL',
  executedQuantity: number,
  tp1: number | undefined,
  tp2: number | undefined,
  tp3: number | undefined,
  uid: string
): Promise<{ tp1OrderId?: string; tp2OrderId?: string; tp3OrderId?: string }> {
  // Extract base and quote currencies for limit orders
  const baseCurrency = symbol.replace('USDT', '');
  const quoteCurrency = 'USDT';
  const closeSide = side === 'BUY' ? 'SELL' : 'BUY';

  let tp1OrderId: string | undefined;
  let tp2OrderId: string | undefined;
  let tp3OrderId: string | undefined;

  const originalQty = executedQuantity;

  // TP1: Close 50% of position
  const tp1Quantity = Math.floor(originalQty * 0.5 * 100) / 100; // Round to 2 decimals
  if (tp1Quantity > 0 && tp1) {
    const tp1Order = await adapter.placeOrder({
      symbol: `${baseCurrency}${quoteCurrency}`,
      side: closeSide,
      type: 'LIMIT',
      quantity: tp1Quantity,
      price: tp1
    });

    tp1OrderId = tp1Order.exchangeOrderId || tp1Order.clientOrderId;

    logger.info({
      uid,
      symbol,
      tp1OrderId,
      tp1Price: tp1,
      tp1Quantity
    }, '[SCALPING] TP1 order placed (50% exit)');
  }

  // TP2: Close 20% more (70% total of original)
  const tp2Quantity = Math.floor(originalQty * 0.2 * 100) / 100;
  if (tp2Quantity > 0 && tp2) {
    const tp2Order = await adapter.placeOrder({
      symbol: `${baseCurrency}${quoteCurrency}`,
      side: closeSide,
      type: 'LIMIT',
      quantity: tp2Quantity,
      price: tp2
    });

    tp2OrderId = tp2Order.exchangeOrderId || tp2Order.clientOrderId;

    logger.info({
      uid,
      symbol,
      tp2OrderId,
      tp2Price: tp2,
      tp2Quantity
    }, '[SCALPING] TP2 order placed (20% exit, 70% total)');
  }

  // TP3: Close remaining 30% (100% total)
  if (tp3) {
    const tp3Quantity = Math.floor(originalQty * 0.3 * 100) / 100;
    if (tp3Quantity > 0) {
      const tp3Order = await adapter.placeOrder({
        symbol: `${baseCurrency}${quoteCurrency}`,
        side: closeSide,
        type: 'LIMIT',
        quantity: tp3Quantity,
        price: tp3
      });

      tp3OrderId = tp3Order.exchangeOrderId || tp3Order.clientOrderId;

      logger.info({
        uid,
        symbol,
        tp3OrderId,
        tp3Price: tp3,
        tp3Quantity
      }, '[SCALPING] TP3 order placed (30% exit, 100% total)');
    }
  }

  return { tp1OrderId, tp2OrderId, tp3OrderId };
}

/**
 * Place single TP order (non-scalping)
 */
export async function placeSingleTPOrder(
  adapter: any,
  config: any,
  symbol: string,
  side: 'BUY' | 'SELL',
  executedPrice: number,
  executedQuantity: number,
  takeProfit: number,
  uid: string
): Promise<string | undefined> {
  // Extract base and quote currencies for limit orders
  const baseCurrency = symbol.replace('USDT', '');
  const quoteCurrency = 'USDT';
  const closeSide = side === 'BUY' ? 'SELL' : 'BUY';

  let tpOrderId: string | undefined;

  // Place single TP order
  if (config.takeProfitPct && config.takeProfitPct > 0) {
    const tpPrice = side === 'BUY'
      ? executedPrice * (1 + config.takeProfitPct / 100)
      : executedPrice * (1 - config.takeProfitPct / 100);

    const tpOrder = await adapter.placeOrder({
      symbol: `${baseCurrency}${quoteCurrency}`,
      side: closeSide,
      type: 'LIMIT',
      quantity: executedQuantity,
      price: tpPrice
    });

    tpOrderId = tpOrder.exchangeOrderId || tpOrder.clientOrderId;
    logger.info({ uid, symbol, tpOrderId, tpPrice }, 'Take Profit order placed');
  } else {
    // Use fixed TP from signal
    const tpOrder = await adapter.placeOrder({
      symbol: `${baseCurrency}${quoteCurrency}`,
      side: closeSide,
      type: 'LIMIT',
      quantity: executedQuantity,
      price: takeProfit
    });

    tpOrderId = tpOrder.exchangeOrderId || tpOrder.clientOrderId;
    logger.info({ uid, symbol, tpOrderId, tpPrice: takeProfit }, 'Take Profit order placed (from signal)');
  }

  return tpOrderId;
}

/**
 * Place stop loss order
 */
export async function placeStopLossOrder(
  adapter: any,
  symbol: string,
  side: 'BUY' | 'SELL',
  stopLoss: number,
  slQuantity: number,
  uid: string
): Promise<string> {
  // Extract base and quote currencies for limit orders
  const baseCurrency = symbol.replace('USDT', '');
  const quoteCurrency = 'USDT';
  const closeSide = side === 'BUY' ? 'SELL' : 'BUY';

  const slOrder = await adapter.placeOrder({
    symbol: `${baseCurrency}${quoteCurrency}`,
    side: closeSide,
    type: 'LIMIT',
    quantity: slQuantity,
    price: stopLoss
  });

  const slOrderId = slOrder.exchangeOrderId || slOrder.clientOrderId;
  logger.info({ uid, symbol, slOrderId, slPrice: stopLoss }, 'Stop Loss order placed');

  return slOrderId;
}

/**
 * Execute emergency close (when TP/SL placement fails)
 */
export async function executeEmergencyClose(
  adapter: any,
  symbol: string,
  side: 'BUY' | 'SELL',
  quantity: number,
  uid: string,
  tradeId: string
): Promise<void> {
  logger.error({
    uid,
    symbol,
    side,
    quantity,
    tradeId
  }, 'CRITICAL: TP/SL placement failed. Executing EMERGENCY CLOSE to protect capital.');

  try {
    // Attempt to close the position immediately with a MARKET order
    await adapter.placeOrder({
      symbol: symbol,
      side: side === 'BUY' ? 'SELL' : 'BUY', // Inverted side to close
      type: 'MARKET',
      quantity: quantity
    });

    logger.info({ uid, symbol, tradeId }, 'EMERGENCY CLOSE executed successfully');
  } catch (emergencyErr: any) {
    logger.error({
      uid,
      symbol,
      tradeId,
      error: emergencyErr.message
    }, 'FATAL: EMERGENCY CLOSE FAILED - Manual intervention required');
    throw emergencyErr;
  }
}

/**
 * Cancel order by ID
 */
export async function cancelOrder(adapter: any, symbol: string, orderId: string, uid: string): Promise<void> {
  try {
    await adapter.cancelOrder(symbol, orderId);
    logger.info({ uid, symbol, orderId }, 'Order cancelled successfully');
  } catch (e: any) {
    logger.warn({ uid, symbol, orderId, error: e.message }, 'Failed to cancel order');
  }
}

/**
 * Place panic close order for a trade
 */
export async function placePanicCloseOrder(
  adapter: any,
  trade: TradeExecution,
  uid: string
): Promise<any> {
  const closeSide = trade.side === 'BUY' ? 'SELL' : 'BUY';

  // Execute Market Close
  const order = await adapter.placeOrder({
    symbol: trade.symbol,
    side: closeSide,
    type: 'MARKET',
    quantity: trade.quantity
  });

  logger.info({ uid, tradeId: trade.tradeId, symbol: trade.symbol }, 'Panic close order executed');
  return order;
}

