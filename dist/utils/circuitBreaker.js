"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.providerCircuitBreakers = exports.CircuitBreaker = void 0;
exports.getCircuitBreaker = getCircuitBreaker;
class CircuitBreaker {
    constructor(options) {
        this.options = options;
        this.failures = 0;
        this.lastFailureTime = 0;
        this.state = 'CLOSED';
        this.nextAttemptTime = 0;
    }
    async execute(fn) {
        if (this.state === 'OPEN') {
            if (Date.now() < this.nextAttemptTime) {
                throw new Error('Circuit breaker is OPEN');
            }
            this.state = 'HALF_OPEN';
        }
        try {
            const result = await fn();
            this.onSuccess();
            return result;
        }
        catch (error) {
            this.onFailure();
            throw error;
        }
    }
    onSuccess() {
        this.failures = 0;
        this.state = 'CLOSED';
    }
    onFailure() {
        this.failures++;
        this.lastFailureTime = Date.now();
        if (this.failures >= this.options.failureThreshold) {
            this.state = 'OPEN';
            this.nextAttemptTime = Date.now() + this.options.recoveryTimeout;
        }
    }
    getState() {
        return this.state;
    }
    isOpen() {
        return this.state === 'OPEN' && Date.now() < this.nextAttemptTime;
    }
    reset() {
        this.failures = 0;
        this.state = 'CLOSED';
        this.lastFailureTime = 0;
        this.nextAttemptTime = 0;
    }
}
exports.CircuitBreaker = CircuitBreaker;
// Global circuit breakers for providers
exports.providerCircuitBreakers = new Map();
function getCircuitBreaker(providerName) {
    if (!exports.providerCircuitBreakers.has(providerName)) {
        exports.providerCircuitBreakers.set(providerName, new CircuitBreaker({
            failureThreshold: 3,
            recoveryTimeout: 30000, // 30 seconds
            monitoringPeriod: 60000 // 1 minute
        }));
    }
    return exports.providerCircuitBreakers.get(providerName);
}
