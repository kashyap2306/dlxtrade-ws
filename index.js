const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Ensure dist/ exists - build if necessary
const distPath = path.join(__dirname, 'dist');
if (!fs.existsSync(distPath)) {
  console.log('Building TypeScript...');
  try {
    execSync('npm run build', { stdio: 'inherit' });
    console.log('Build completed successfully');
  } catch (error) {
    console.error('Build failed:', error.message);
    process.exit(1);
  }
}

const functions = require('firebase-functions');
const { buildApp } = require('./dist/app');

const app = buildApp();

exports.api = functions.https.onRequest(app);
