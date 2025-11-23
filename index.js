const functions = require('firebase-functions');
const { buildApp } = require('./dist/app');

const app = buildApp();

exports.api = functions.https.onRequest(app);
