import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../utils/logger';
import type { BacktestSnapshot, Orderbook } from '../types';

export class BacktestAdapter {
  async loadSnapshot(filePath: string): Promise<BacktestSnapshot> {
    try {
      const content = await fs.promises.readFile(filePath, 'utf-8');
      const data = JSON.parse(content);

      // Support CoinAPI format
      if (data.symbol && data.bids && data.asks) {
        return {
          symbol: data.symbol,
          timestamp: data.timestamp || Date.now(),
          bids: data.bids.map(([p, q]: [string, string]) => ({
            price: p,
            quantity: q,
          })),
          asks: data.asks.map(([p, q]: [string, string]) => ({
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
    } catch (err) {
      logger.error({ err, filePath }, 'Error loading snapshot');
      throw err;
    }
  }

  async loadFromDirectory(dirPath: string): Promise<BacktestSnapshot[]> {
    try {
      const files = await fs.promises.readdir(dirPath);
      const snapshots: BacktestSnapshot[] = [];

      for (const file of files) {
        if (file.endsWith('.json')) {
          const filePath = path.join(dirPath, file);
          try {
            const snapshot = await this.loadSnapshot(filePath);
            snapshots.push(snapshot);
          } catch (err) {
            logger.warn({ file, err }, 'Skipping invalid snapshot file');
          }
        }
      }

      return snapshots.sort((a, b) => a.timestamp - b.timestamp);
    } catch (err) {
      logger.error({ err, dirPath }, 'Error loading snapshots from directory');
      throw err;
    }
  }

  snapshotToOrderbook(snapshot: BacktestSnapshot): Orderbook {
    return {
      symbol: snapshot.symbol,
      bids: snapshot.bids,
      asks: snapshot.asks,
      lastUpdateId: snapshot.timestamp,
    };
  }
}

export const backtestAdapter = new BacktestAdapter();

