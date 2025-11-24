import { v4 as uuidv4 } from 'uuid';
import { query, transaction } from '../db';
import { logger } from '../utils/logger';
import { BinanceAdapter } from './binanceAdapter';
import type { Order, Fill } from '../types';

export class OrderManager {
  private adapter: BinanceAdapter | null = null;

  setAdapter(adapter: BinanceAdapter): void {
    this.adapter = adapter;
  }

  async placeOrder(uid: string, params: {
    symbol: string;
    side: 'BUY' | 'SELL';
    type: 'LIMIT' | 'MARKET';
    quantity: number;
    price?: number;
  }): Promise<Order | null> {
    if (!this.adapter) {
      throw new Error('Exchange adapter not initialized');
    }

    const clientOrderId = `dlx_${uuidv4()}`;

    try {
      if (!this.adapter.placeOrder) {
        throw new Error('Exchange adapter does not support placeOrder');
      }
      const exchangeOrder = await this.adapter.placeOrder({
        symbol: params.symbol,
        side: params.side,
        type: params.type,
        quantity: params.quantity,
        price: params.price,
      });

      // Get strategy from settings if available
      const { firestoreAdapter } = await import('./firestoreAdapter');
      const settings = await firestoreAdapter.getSettings(uid);
      const strategy = settings?.strategy || null;

      // Persist to database
      const rows = await query<any>(
        `INSERT INTO orders (
          user_id, symbol, side, type, quantity, price, status,
          client_order_id, exchange_order_id, filled_qty, avg_price, strategy
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        RETURNING *`,
        [
          uid,
          exchangeOrder.symbol,
          exchangeOrder.side,
          exchangeOrder.type,
          exchangeOrder.quantity,
          exchangeOrder.price || null,
          exchangeOrder.status,
          clientOrderId,
          exchangeOrder.exchangeOrderId,
          exchangeOrder.filledQty,
          exchangeOrder.avgPrice,
          strategy,
        ]
      );

      const order = this.mapRowToOrder(rows[0]);
      logger.info({ orderId: order.id, symbol: order.symbol }, 'Order placed');

      return order;
    } catch (err) {
      logger.error({ err, params }, 'Error placing order');
      throw err;
    }
  }

  async cancelOrder(uid: string, orderId: string): Promise<Order> {
    if (!this.adapter) {
      throw new Error('Exchange adapter not initialized');
    }

    // Get order from DB (scoped to user)
    const rows = await query<any>(
      'SELECT * FROM orders WHERE user_id = $1 AND (id = $2 OR exchange_order_id = $2)',
      [uid, orderId]
    );
    if (rows.length === 0) {
      throw new Error('Order not found');
    }

    const dbOrder = rows[0];

    try {
      const exchangeOrder = await this.adapter.cancelOrder(
        dbOrder.symbol,
        dbOrder.exchange_order_id,
        dbOrder.client_order_id
      );

      // Update in database
      await query(
        `UPDATE orders 
         SET status = $1, updated_at = NOW()
         WHERE id = $2`,
        [exchangeOrder.status, dbOrder.id]
      );

      logger.info({ orderId: dbOrder.id }, 'Order canceled');
      return this.mapRowToOrder({ ...dbOrder, status: exchangeOrder.status });
    } catch (err) {
      logger.error({ err, orderId }, 'Error canceling order');
      throw err;
    }
  }

  async getOrder(uid: string, orderId: string): Promise<Order | null> {
    const rows = await query<any>(
      'SELECT * FROM orders WHERE user_id = $1 AND (id = $2 OR exchange_order_id = $2)',
      [uid, orderId]
    );

    if (rows.length === 0) return null;
    return this.mapRowToOrder(rows[0]);
  }

  async listOrders(uid: string, filters: {
    symbol?: string;
    status?: string;
    limit?: number;
    offset?: number;
  }): Promise<Order[]> {
    let sql = 'SELECT * FROM orders WHERE user_id = $1';
    const params: any[] = [uid];
    let paramCount = 2;

    if (filters.symbol) {
      sql += ` AND symbol = $${paramCount++}`;
      params.push(filters.symbol);
    }
    if (filters.status) {
      sql += ` AND status = $${paramCount++}`;
      params.push(filters.status);
    }

    sql += ' ORDER BY created_at DESC';

    if (filters.limit) {
      sql += ` LIMIT $${paramCount++}`;
      params.push(filters.limit);
    }
    if (filters.offset) {
      sql += ` OFFSET $${paramCount++}`;
      params.push(filters.offset);
    }

    const rows = await query<any>(sql, params);
    return rows.map((row) => this.mapRowToOrder(row));
  }

  async recordFill(fill: Omit<Fill, 'id' | 'timestamp'>): Promise<Fill> {
    const rows = await query<any>(
      `INSERT INTO fills (order_id, symbol, side, quantity, price, fee, fee_asset)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        fill.orderId,
        fill.symbol,
        fill.side,
        fill.quantity,
        fill.price,
        fill.fee,
        fill.feeAsset,
      ]
    );

    // Update order filled quantity
    await query(
      `UPDATE orders 
       SET filled_qty = filled_qty + $1,
           avg_price = (avg_price * filled_qty + $2 * $1) / (filled_qty + $1),
           status = CASE 
             WHEN filled_qty + $1 >= quantity THEN 'FILLED'
             ELSE 'PARTIALLY_FILLED'
           END,
           updated_at = NOW()
       WHERE id = $3`,
      [fill.quantity, fill.price, fill.orderId]
    );

    logger.info({ fillId: rows[0].id, orderId: fill.orderId }, 'Fill recorded');
    return {
      id: rows[0].id.toString(),
      orderId: fill.orderId,
      symbol: fill.symbol,
      side: fill.side,
      quantity: parseFloat(rows[0].quantity),
      price: parseFloat(rows[0].price),
      fee: parseFloat(rows[0].fee),
      feeAsset: rows[0].fee_asset,
      timestamp: rows[0].timestamp,
    };
  }

  async listFills(uid: string, filters: {
    orderId?: string;
    symbol?: string;
    limit?: number;
    offset?: number;
  }): Promise<Fill[]> {
    let sql = `SELECT f.* FROM fills f 
               INNER JOIN orders o ON f.order_id = o.id 
               WHERE o.user_id = $1`;
    const params: any[] = [uid];
    let paramCount = 2;

    if (filters.orderId) {
      sql += ` AND f.order_id = $${paramCount++}`;
      params.push(filters.orderId);
    }
    if (filters.symbol) {
      sql += ` AND f.symbol = $${paramCount++}`;
      params.push(filters.symbol);
    }

    sql += ' ORDER BY f.timestamp DESC';

    if (filters.limit) {
      sql += ` LIMIT $${paramCount++}`;
      params.push(filters.limit);
    }
    if (filters.offset) {
      sql += ` OFFSET $${paramCount++}`;
      params.push(filters.offset);
    }

    const rows = await query<any>(sql, params);
    return rows.map((row) => ({
      id: row.id.toString(),
      orderId: row.order_id.toString(),
      symbol: row.symbol,
      side: row.side as 'BUY' | 'SELL',
      quantity: parseFloat(row.quantity),
      price: parseFloat(row.price),
      fee: parseFloat(row.fee),
      feeAsset: row.fee_asset,
      timestamp: row.timestamp,
    }));
  }

  private mapRowToOrder(row: any): Order {
    return {
      id: row.id.toString(),
      symbol: row.symbol,
      side: row.side as 'BUY' | 'SELL',
      type: row.type as 'LIMIT' | 'MARKET',
      quantity: parseFloat(row.quantity),
      price: row.price ? parseFloat(row.price) : undefined,
      status: row.status as Order['status'],
      clientOrderId: row.client_order_id,
      exchangeOrderId: row.exchange_order_id,
      filledQty: parseFloat(row.filled_qty || '0'),
      avgPrice: parseFloat(row.avg_price || '0'),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}

export const orderManager = new OrderManager();

