"use strict";
// Redis is completely disabled - no connections, no errors, no logs
// This file exists only to maintain compatibility with imports
Object.defineProperty(exports, "__esModule", { value: true });
exports.getRedis = getRedis;
exports.initRedis = initRedis;
function getRedis() {
    return null;
}
async function initRedis() {
    // Redis is disabled - resolve immediately without any action
    return Promise.resolve();
}
