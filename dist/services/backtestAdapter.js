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
exports.backtestAdapter = exports.BacktestAdapter = void 0;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const logger_1 = require("../utils/logger");
class BacktestAdapter {
    async loadSnapshot(filePath) {
        try {
            const content = await fs.promises.readFile(filePath, 'utf-8');
            const data = JSON.parse(content);
            // Support CoinAPI format
            if (data.symbol && data.bids && data.asks) {
                return {
                    symbol: data.symbol,
                    timestamp: data.timestamp || Date.now(),
                    bids: data.bids.map(([p, q]) => ({
                        price: p,
                        quantity: q,
                    })),
                    asks: data.asks.map(([p, q]) => ({
                        price: p,
                        quantity: q,
                    })),
                    trades: data.trades || [],
                };
            }
            // Support Kaiko format
            if (data.data && Array.isArray(data.data)) {
                const snapshot = data.data[0];
                return {
                    symbol: snapshot.symbol || 'BTCUSDT',
                    timestamp: snapshot.timestamp || Date.now(),
                    bids: snapshot.bids || [],
                    asks: snapshot.asks || [],
                    trades: snapshot.trades || [],
                };
            }
            throw new Error('Unsupported snapshot format');
        }
        catch (err) {
            logger_1.logger.error({ err, filePath }, 'Error loading snapshot');
            throw err;
        }
    }
    async loadFromDirectory(dirPath) {
        try {
            const files = await fs.promises.readdir(dirPath);
            const snapshots = [];
            for (const file of files) {
                if (file.endsWith('.json')) {
                    const filePath = path.join(dirPath, file);
                    try {
                        const snapshot = await this.loadSnapshot(filePath);
                        snapshots.push(snapshot);
                    }
                    catch (err) {
                        logger_1.logger.warn({ file, err }, 'Skipping invalid snapshot file');
                    }
                }
            }
            return snapshots.sort((a, b) => a.timestamp - b.timestamp);
        }
        catch (err) {
            logger_1.logger.error({ err, dirPath }, 'Error loading snapshots from directory');
            throw err;
        }
    }
    snapshotToOrderbook(snapshot) {
        return {
            symbol: snapshot.symbol,
            bids: snapshot.bids,
            asks: snapshot.asks,
            lastUpdateId: snapshot.timestamp,
        };
    }
}
exports.BacktestAdapter = BacktestAdapter;
exports.backtestAdapter = new BacktestAdapter();
