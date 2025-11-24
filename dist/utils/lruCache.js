"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.symbolMappingCache = exports.coingeckoCache = exports.cryptocompareCache = exports.LRUCache = void 0;
class LRUCache {
    constructor(maxSize = 100, defaultTTL = 300000) {
        this.cache = new Map();
        this.maxSize = maxSize;
        this.defaultTTL = defaultTTL;
    }
    get(key) {
        const entry = this.cache.get(key);
        if (!entry)
            return null;
        // Check if expired
        if (Date.now() - entry.timestamp > entry.ttl) {
            this.cache.delete(key);
            return null;
        }
        // Move to end (most recently used)
        this.cache.delete(key);
        this.cache.set(key, entry);
        return entry.data;
    }
    set(key, value, ttl) {
        const entry = {
            data: value,
            timestamp: Date.now(),
            ttl: ttl || this.defaultTTL
        };
        // If cache is full, remove least recently used (first item)
        if (this.cache.size >= this.maxSize) {
            const firstKey = this.cache.keys().next().value;
            this.cache.delete(firstKey);
        }
        this.cache.set(key, entry);
    }
    has(key) {
        const entry = this.cache.get(key);
        if (!entry)
            return false;
        // Check if expired
        if (Date.now() - entry.timestamp > entry.ttl) {
            this.cache.delete(key);
            return false;
        }
        return true;
    }
    delete(key) {
        return this.cache.delete(key);
    }
    clear() {
        this.cache.clear();
    }
    size() {
        // Clean expired entries
        const now = Date.now();
        for (const [key, entry] of this.cache.entries()) {
            if (now - entry.timestamp > entry.ttl) {
                this.cache.delete(key);
            }
        }
        return this.cache.size;
    }
    getStats() {
        return {
            size: this.size(),
            maxSize: this.maxSize
        };
    }
}
exports.LRUCache = LRUCache;
// Global caches for different data types
exports.cryptocompareCache = new LRUCache(200, 300000); // 5 minutes
exports.coingeckoCache = new LRUCache(100, 600000); // 10 minutes
exports.symbolMappingCache = new LRUCache(500, 3600000); // 1 hour
