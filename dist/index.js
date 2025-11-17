"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildApp = void 0;
// Helper re-export for the Fastify app builder.
// The actual server entrypoint is `server.ts` (compiled to `dist/server.js`).
var app_1 = require("./app");
Object.defineProperty(exports, "buildApp", { enumerable: true, get: function () { return app_1.buildApp; } });
