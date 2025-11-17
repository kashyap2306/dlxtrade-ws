import type { BacktestSnapshot, Orderbook } from '../types';
export declare class BacktestAdapter {
    loadSnapshot(filePath: string): Promise<BacktestSnapshot>;
    loadFromDirectory(dirPath: string): Promise<BacktestSnapshot[]>;
    snapshotToOrderbook(snapshot: BacktestSnapshot): Orderbook;
}
export declare const backtestAdapter: BacktestAdapter;
//# sourceMappingURL=backtestAdapter.d.ts.map