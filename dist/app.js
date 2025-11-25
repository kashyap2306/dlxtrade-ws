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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildApp = buildApp;
// @ts-nocheck
const fastify_1 = __importDefault(require("fastify"));
const jwt_1 = __importDefault(require("@fastify/jwt"));
const websocket_1 = __importDefault(require("@fastify/websocket"));
const cors_1 = __importDefault(require("@fastify/cors"));
const helmet_1 = __importDefault(require("@fastify/helmet"));
const rate_limit_1 = __importDefault(require("@fastify/rate-limit"));
const config_1 = require("./config");
const logger_1 = require("./utils/logger");
const firebaseAuth_1 = require("./middleware/firebaseAuth");
const auth_1 = require("./routes/auth");
const admin_1 = require("./routes/admin");
const orders_1 = require("./routes/orders");
const engine_1 = require("./routes/engine");
const metrics_1 = require("./routes/metrics");
const research_1 = require("./routes/research");
const settings_1 = require("./routes/settings");
const execution_1 = require("./routes/execution");
const integrations_1 = require("./routes/integrations");
const hft_1 = require("./routes/hft");
const users_1 = require("./routes/users");
const agents_1 = require("./routes/agents");
const activityLogs_1 = require("./routes/activityLogs");
const trades_1 = require("./routes/trades");
const notifications_1 = require("./routes/notifications");
const systemLogs_1 = require("./routes/systemLogs");
const uiPreferences_1 = require("./routes/uiPreferences");
const globalStats_1 = require("./routes/globalStats");
const engineStatus_1 = require("./routes/engineStatus");
const hftLogs_1 = require("./routes/hftLogs");
const autoTrade_1 = require("./routes/autoTrade");
const exchangeConfig_1 = require("./routes/exchangeConfig");
async function buildApp() {
    const app = (0, fastify_1.default)({
        logger: logger_1.logger.child({ component: 'fastify' }),
    });
    // Security
    await app.register(helmet_1.default);
    // CORS - allow all origins in development, specific origin in production
    await app.register(cors_1.default, {
        origin: (origin, cb) => {
            const allowed = [
                'https://dlx-trading.web.app',
                'http://localhost:5173',
                process.env.FRONTEND_URL || '',
            ].filter(Boolean);
            if (!origin || allowed.includes(origin)) {
                cb(null, true);
            }
            else {
                cb(null, false);
            }
        },
        credentials: true,
        methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
        allowedHeaders: ['Content-Type', 'Authorization', 'x-admin-setup'],
    });
    // Rate limiting with user-aware keys and local allow list
    await app.register(rate_limit_1.default, {
        max: config_1.config.rateLimit.max,
        timeWindow: config_1.config.rateLimit.timeWindow,
        allowList: (req) => {
            const ip = req.ip || '';
            // Allow localhost in development to reduce friction
            return ip === '127.0.0.1' || ip === '::1';
        },
        keyGenerator: (req) => {
            try {
                // Prefer Firebase-authenticated uid when available
                const user = req.user;
                if (user?.uid)
                    return `uid:${user.uid}`;
                // Fallback to authorization token hash
                const auth = req.headers.authorization || '';
                if (auth)
                    return `auth:${auth.slice(-16)}`;
            }
            catch { }
            // Fallback to IP
            return `ip:${req.ip}`;
        },
    });
    // Firebase Admin will be initialized in server.ts after server starts
    // Don't initialize here to avoid blocking server startup
    // JWT (kept for backward compatibility if needed)
    await app.register(jwt_1.default, {
        secret: config_1.config.jwtSecret,
    });
    // Firebase Authentication decorator
    app.decorate('authenticate', firebaseAuth_1.firebaseAuthMiddleware);
    // WebSocket
    await app.register(websocket_1.default);
    console.log('WS ROUTE READY');
    // Routes
    // Debug: Verify routes are loaded
    console.log('Loaded agentsRoutes:', typeof agents_1.agentsRoutes, agents_1.agentsRoutes ? 'OK' : 'UNDEFINED');
    console.log('Loaded researchRoutes:', typeof research_1.researchRoutes, research_1.researchRoutes ? 'OK' : 'UNDEFINED');
    await app.register(auth_1.authRoutes, { prefix: '/api/auth' });
    await app.register(admin_1.adminRoutes, { prefix: '/api/admin' });
    await app.register(orders_1.ordersRoutes, { prefix: '/api' });
    await app.register(engine_1.engineRoutes, { prefix: '/api/engine' });
    await app.register(metrics_1.metricsRoutes, { prefix: '/api' });
    await app.register(research_1.researchRoutes, { prefix: '/api/research' });
    await app.register(settings_1.settingsRoutes, { prefix: '/api/settings' });
    await app.register(execution_1.executionRoutes, { prefix: '/api/execution' });
    await app.register(integrations_1.integrationsRoutes, { prefix: '/api/integrations' });
    await app.register(hft_1.hftRoutes, { prefix: '/api/hft' });
    await app.register(users_1.usersRoutes, { prefix: '/api/users' });
    await app.register(agents_1.agentsRoutes, { prefix: '/api/agents' });
    console.log('✅ Routes registered - /api/agents/unlocked and /api/research/manual should be available');
    await app.register(activityLogs_1.activityLogsRoutes, { prefix: '/api/activity-logs' });
    await app.register(trades_1.tradesRoutes, { prefix: '/api/trades' });
    await app.register(notifications_1.notificationsRoutes, { prefix: '/api/notifications' });
    await app.register(systemLogs_1.systemLogsRoutes, { prefix: '/api/logs' });
    await app.register(uiPreferences_1.uiPreferencesRoutes, { prefix: '/api/ui-preferences' });
    await app.register(globalStats_1.globalStatsRoutes, { prefix: '/api/global-stats' });
    await app.register(engineStatus_1.engineStatusRoutes, { prefix: '/api/engine-status' });
    await app.register(hftLogs_1.hftLogsRoutes, { prefix: '/api/hft-logs' });
    await app.register(autoTrade_1.autoTradeRoutes, { prefix: '/api/auto-trade' });
    await app.register(exchangeConfig_1.exchangeConfigRoutes, { prefix: '/api/exchange-config' });
    console.log('✅ All routes registered:');
    console.log('  - /api/auth/*');
    console.log('  - /api/admin/*');
    console.log('  - /api/orders');
    console.log('  - /api/engine/*');
    console.log('  - /api/hft/*');
    console.log('  - /api/settings/*');
    console.log('  - /api/research/*');
    console.log('  - /api/execution/*');
    console.log('  - /api/integrations/*');
    console.log('  - /api/users/*');
    console.log('  - /api/agents/*');
    console.log('  - /api/activity-logs/*');
    console.log('  - /api/trades/*');
    console.log('  - /api/notifications/*');
    console.log('  - /api/logs/*');
    console.log('  - /api/ui-preferences/*');
    console.log('  - /api/global-stats/*');
    console.log('  - /api/engine-status/*');
    console.log('  - /api/hft-logs/*');
    console.log('  - /api/auto-trade/*');
    console.log('  - /api/health');
    console.log('  - /api/metrics');
    console.log('  - /ws (WebSocket)');
    console.log('  - /ws/admin (Admin WebSocket)');
    console.log('  - / (Root WebSocket - unauthenticated, for Render WS health)');
    // Test route to verify server is running (no auth required)
    app.get('/api/test', async (request, reply) => {
        return { status: 'ok', message: 'Backend is running', timestamp: new Date().toISOString() };
    });
    // Health check route (no auth required)
    app.get('/health', async (request, reply) => {
        return { status: 'healthy', timestamp: new Date().toISOString() };
    });
    // Admin WebSocket endpoint for real-time admin events
    app.get('/ws/admin', { websocket: true }, async (connection, req) => {
        // Verify Firebase token and admin role
        let uid = null;
        try {
            const token = req.query.token || req.headers.authorization?.replace('Bearer ', '');
            if (token) {
                const { verifyFirebaseToken } = await Promise.resolve().then(() => __importStar(require('./utils/firebase')));
                const decoded = await verifyFirebaseToken(token);
                uid = decoded.uid;
                // Check admin role (root fields only)
                const { getFirebaseAdmin } = await Promise.resolve().then(() => __importStar(require('./utils/firebase')));
                const db = getFirebaseAdmin().firestore();
                const userDoc = await db.collection('users').doc(uid).get();
                if (!userDoc.exists) {
                    connection.socket.close();
                    return;
                }
                const userData = userDoc.data() || {};
                const roleRoot = userData.role;
                const isAdminRoot = userData.isAdmin === true;
                const hasAdmin = roleRoot === 'admin' || isAdminRoot;
                if (!hasAdmin) {
                    logger_1.logger.warn({ uid }, 'Non-admin attempted to connect to admin WebSocket');
                    connection.socket.close();
                    return;
                }
                req.user = { uid: decoded.uid, email: decoded.email };
            }
            else {
                logger_1.logger.warn('Admin WebSocket connection without token');
                connection.socket.close();
                return;
            }
        }
        catch (err) {
            logger_1.logger.warn({ err }, 'Admin WebSocket auth failed');
            connection.socket.close();
            return;
        }
        // Register admin WebSocket for global events
        const { adminWebSocketManager } = await Promise.resolve().then(() => __importStar(require('./services/adminWebSocketManager')));
        adminWebSocketManager.registerAdmin(connection.socket, uid);
        logger_1.logger.info({ uid }, 'Admin WebSocket connected');
        connection.socket.on('close', () => {
            adminWebSocketManager.unregisterAdmin(connection.socket);
            logger_1.logger.info({ uid }, 'Admin WebSocket disconnected');
        });
    });
    // Root WebSocket endpoint: allow plain connections without auth (Render compatibility/health)
    app.get('/', { websocket: true }, async (connection, req) => {
        logger_1.logger.info('Root WebSocket client connected (no auth)');
        try {
            connection.socket.send(JSON.stringify({ type: 'welcome', data: 'ok' }));
        }
        catch { }
        connection.socket.on('close', () => {
            logger_1.logger.info('Root WebSocket client disconnected');
        });
    });
    // WebSocket endpoint for real-time updates (user channel)
    app.get('/ws', { websocket: true }, async (connection, req) => {
        // Allow unauthenticated connections for Render plain WS; if token provided, attach user
        let uid = null;
        const token = req.query.token || req.headers.authorization?.replace('Bearer ', '');
        if (token) {
            try {
                const { verifyFirebaseToken } = await Promise.resolve().then(() => __importStar(require('./utils/firebase')));
                const decoded = await verifyFirebaseToken(token);
                uid = decoded.uid;
                req.user = { uid: decoded.uid, email: decoded.email };
            }
            catch (err) {
                logger_1.logger.warn({ err }, 'WebSocket auth failed; continuing unauthenticated');
            }
        }
        else {
            logger_1.logger.info('WebSocket connection without token (unauthenticated)');
        }
        // Register WebSocket to user's engines if they exist
        const { userEngineManager } = await Promise.resolve().then(() => __importStar(require('./services/userEngineManager')));
        const accuracyEngine = userEngineManager.getAccuracyEngine(uid);
        const hftEngine = userEngineManager.getHFTEngine(uid);
        if (uid && accuracyEngine) {
            accuracyEngine.registerWebSocketClient(connection.socket);
            logger_1.logger.info({ uid }, 'WebSocket connection registered to AI engine');
        }
        if (uid && hftEngine) {
            hftEngine.registerWebSocketClient(connection.socket);
            logger_1.logger.info({ uid }, 'WebSocket connection registered to HFT engine');
        }
        if (uid && !accuracyEngine && !hftEngine) {
            logger_1.logger.debug({ uid }, 'WebSocket connected but user engines not initialized yet');
        }
        connection.socket.on('message', (message) => {
            try {
                const data = JSON.parse(message.toString());
                logger_1.logger.debug({ data, uid }, 'WebSocket message received');
            }
            catch (err) {
                logger_1.logger.error({ err }, 'Error parsing WebSocket message');
            }
        });
        connection.socket.on('close', () => {
            if (accuracyEngine) {
                accuracyEngine.unregisterWebSocketClient(connection.socket);
            }
            if (hftEngine) {
                hftEngine.unregisterWebSocketClient(connection.socket);
            }
            logger_1.logger.info({ uid }, 'WebSocket connection closed');
        });
    });
    return app;
}
