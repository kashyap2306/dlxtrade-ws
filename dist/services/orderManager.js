"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.orderManager = exports.OrderManager = void 0;
const uuid_1 = require("uuid");
const db_1 = require("../db");
const logger_1 = require("../utils/logger");
class OrderManager {
    constructor() {
        this.adapter = null;
    }
    setAdapter(adapter) {
        this.adapter = adapter;
    }
    async placeOrder(uid, params) {
        if (!this.adapter) {
            throw new Error('Exchange adapter not initialized');
        }
        const clientOrderId = `dlx_${(0, uuid_1.v4)()}`;
        try {
            const exchangeOrder = await this.adapter.placeOrder(params.symbol, params.side, params.type, params.quantity, params.price);
            // Get strategy from settings if available
            const { firestoreAdapter } = await Promise.resolve().then(() => __importStar(require('./firestoreAdapter')));
            const settings = await firestoreAdapter.getSettings(uid);
            const strategy = settings?.strategy || null;
            // Persist to database
            const rows = await (0, db_1.query)(`INSERT INTO orders (
          user_id, symbol, side, type, quantity, price, status,
          client_order_id, exchange_order_id, filled_qty, avg_price, strategy
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        RETURNING *`, [
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
            ]);
            const order = this.mapRowToOrder(rows[0]);
            logger_1.logger.info({ orderId: order.id, symbol: order.symbol }, 'Order placed');
            return order;
        }
        catch (err) {
            logger_1.logger.error({ err, params }, 'Error placing order');
            throw err;
        }
    }
    async cancelOrder(uid, orderId) {
        if (!this.adapter) {
            throw new Error('Exchange adapter not initialized');
        }
        // Get order from DB (scoped to user)
        const rows = await (0, db_1.query)('SELECT * FROM orders WHERE user_id = $1 AND (id = $2 OR exchange_order_id = $2)', [uid, orderId]);
        if (rows.length === 0) {
            throw new Error('Order not found');
        }
        const dbOrder = rows[0];
        try {
            const exchangeOrder = await this.adapter.cancelOrder(dbOrder.symbol, dbOrder.exchange_order_id, dbOrder.client_order_id);
            // Update in database
            await (0, db_1.query)(`UPDATE orders 
         SET status = $1, updated_at = NOW()
         WHERE id = $2`, [exchangeOrder.status, dbOrder.id]);
            logger_1.logger.info({ orderId: dbOrder.id }, 'Order canceled');
            return this.mapRowToOrder({ ...dbOrder, status: exchangeOrder.status });
        }
        catch (err) {
            logger_1.logger.error({ err, orderId }, 'Error canceling order');
            throw err;
        }
    }
    async getOrder(uid, orderId) {
        const rows = await (0, db_1.query)('SELECT * FROM orders WHERE user_id = $1 AND (id = $2 OR exchange_order_id = $2)', [uid, orderId]);
        if (rows.length === 0)
            return null;
        return this.mapRowToOrder(rows[0]);
    }
    async listOrders(uid, filters) {
        let sql = 'SELECT * FROM orders WHERE user_id = $1';
        const params = [uid];
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
        const rows = await (0, db_1.query)(sql, params);
        return rows.map((row) => this.mapRowToOrder(row));
    }
    async recordFill(fill) {
        const rows = await (0, db_1.query)(`INSERT INTO fills (order_id, symbol, side, quantity, price, fee, fee_asset)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`, [
            fill.orderId,
            fill.symbol,
            fill.side,
            fill.quantity,
            fill.price,
            fill.fee,
            fill.feeAsset,
        ]);
        // Update order filled quantity
        await (0, db_1.query)(`UPDATE orders 
       SET filled_qty = filled_qty + $1,
           avg_price = (avg_price * filled_qty + $2 * $1) / (filled_qty + $1),
           status = CASE 
             WHEN filled_qty + $1 >= quantity THEN 'FILLED'
             ELSE 'PARTIALLY_FILLED'
           END,
           updated_at = NOW()
       WHERE id = $3`, [fill.quantity, fill.price, fill.orderId]);
        logger_1.logger.info({ fillId: rows[0].id, orderId: fill.orderId }, 'Fill recorded');
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
    async listFills(uid, filters) {
        let sql = `SELECT f.* FROM fills f 
               INNER JOIN orders o ON f.order_id = o.id 
               WHERE o.user_id = $1`;
        const params = [uid];
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
        const rows = await (0, db_1.query)(sql, params);
        return rows.map((row) => ({
            id: row.id.toString(),
            orderId: row.order_id.toString(),
            symbol: row.symbol,
            side: row.side,
            quantity: parseFloat(row.quantity),
            price: parseFloat(row.price),
            fee: parseFloat(row.fee),
            feeAsset: row.fee_asset,
            timestamp: row.timestamp,
        }));
    }
    mapRowToOrder(row) {
        return {
            id: row.id.toString(),
            symbol: row.symbol,
            side: row.side,
            type: row.type,
            quantity: parseFloat(row.quantity),
            price: row.price ? parseFloat(row.price) : undefined,
            status: row.status,
            clientOrderId: row.client_order_id,
            exchangeOrderId: row.exchange_order_id,
            filledQty: parseFloat(row.filled_qty || '0'),
            avgPrice: parseFloat(row.avg_price || '0'),
            createdAt: row.created_at,
            updatedAt: row.updated_at,
        };
    }
}
exports.OrderManager = OrderManager;
exports.orderManager = new OrderManager();
