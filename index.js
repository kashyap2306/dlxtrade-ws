const path = require("path");

try {
  const serverPath = path.join(__dirname, "backend", "dist", "server.js");
  require(serverPath);
  console.log("Backend started from:", serverPath);
} catch (err) {
  console.error("backend/dist/server.js not found. Did you run npm run build?");
  process.exit(1);
}
