const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const firebaseBarrel = path.resolve(__dirname, '../frontend/src/config/firebase.ts');
const firebaseUtils = path.resolve(__dirname, '../frontend/src/config/firebase-utils.ts');
const code = fs.readFileSync(firebaseBarrel, 'utf8');
const utilsCode = fs.readFileSync(firebaseUtils, 'utf8');

const requiredInBarrel = ['isFirebaseAvailable','isFirebaseReady','isUsingMockFirebase','getAuthToken'];
const requiredInUtils = ['getAuthToken'];

const missingInBarrel = requiredInBarrel.filter(r => !code.includes(r));
const missingInUtils = requiredInUtils.filter(r => !utilsCode.includes(r));

if (missingInBarrel.length || missingInUtils.length) {
  console.error('[CI CHECK] Missing firebase exports:');
  if (missingInBarrel.length) console.error('  In firebase.ts:', missingInBarrel);
  if (missingInUtils.length) console.error('  In firebase-utils.ts:', missingInUtils);
  process.exit(2);
}

console.log('[CI CHECK] All firebase exports present');
