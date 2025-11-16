// Root entry to run backend server on Render
// Ensures we start the compiled Fastify server from backend/dist

const path = require('path');
const fs = require('fs');

const distServer = path.join(__dirname, 'backend', 'dist', 'server.js');

if (!fs.existsSync(distServer)) {
	console.error('backend/dist/server.js not found. Did you run "npm run build"?');
	process.exit(1);
}

require(distServer);


