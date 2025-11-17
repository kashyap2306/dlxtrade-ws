"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.strategyManager = exports.StrategyManager = void 0;
const marketMakingHFT_1 = require("./marketMakingHFT");
const orderbookImbalance_1 = require("./orderbookImbalance");
const smcHybrid_1 = require("./smcHybrid");
const statArb_1 = require("./statArb");
const logger_1 = require("../utils/logger");
class StrategyManager {
    constructor() {
        this.strategies = new Map();
        // Register all strategies
        this.strategies.set('market_making_hft', marketMakingHFT_1.marketMakingHFTStrategy);
        this.strategies.set('orderbook_imbalance', orderbookImbalance_1.orderbookImbalanceStrategy);
        this.strategies.set('smc_hybrid', smcHybrid_1.smcHybridStrategy);
        this.strategies.set('stat_arb', statArb_1.statArbStrategy);
    }
    async initializeStrategy(uid, strategyName, config, adapter, orderManager) {
        const strategy = this.strategies.get(strategyName);
        if (!strategy) {
            throw new Error(`Unknown strategy: ${strategyName}`);
        }
        await strategy.init(uid, config);
        // Set adapter and order manager for strategies that need them
        if (strategyName === 'market_making_hft' && adapter && orderManager) {
            marketMakingHFT_1.marketMakingHFTStrategy.setAdapter(uid, adapter);
            marketMakingHFT_1.marketMakingHFTStrategy.setOrderManager(uid, orderManager);
        }
        logger_1.logger.info({ uid, strategy: strategyName }, 'Strategy initialized');
    }
    async executeStrategy(uid, strategyName, researchResult, orderbook) {
        const strategy = this.strategies.get(strategyName);
        if (!strategy) {
            logger_1.logger.warn({ uid, strategy: strategyName }, 'Strategy not found');
            return null;
        }
        try {
            return await strategy.onResearch(uid, researchResult, orderbook);
        }
        catch (err) {
            logger_1.logger.error({ err, uid, strategy: strategyName }, 'Error executing strategy');
            return null;
        }
    }
    async shutdownStrategy(uid, strategyName) {
        const strategy = this.strategies.get(strategyName);
        if (strategy) {
            await strategy.shutdown(uid);
        }
    }
    getStrategy(strategyName) {
        return this.strategies.get(strategyName) || null;
    }
    listStrategies() {
        return Array.from(this.strategies.keys());
    }
}
exports.StrategyManager = StrategyManager;
exports.strategyManager = new StrategyManager();
