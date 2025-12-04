const fs = require('fs');
const path = require('path');

// Files to fix
const files = [
  'dlxtrade-ws/src/providers/marketData/coinstats.ts',
  'dlxtrade-ws/src/providers/marketData/livecoinwatch.ts',
  'dlxtrade-ws/src/providers/marketData/kaiko.ts',
  'dlxtrade-ws/src/providers/marketData/messari.ts',
  'dlxtrade-ws/src/providers/marketData/bravenewcoin.ts',
  'dlxtrade-ws/src/providers/marketData/coinapi.ts',
  'dlxtrade-ws/src/providers/marketData/coinlore.ts',
  'dlxtrade-ws/src/providers/marketData/coinpaprika.ts',
  'dlxtrade-ws/src/providers/marketData/coincheckup.ts'
];

function fixAdapterError(content, filename) {
  // Fix AdapterError constructors
  content = content.replace(
    /throw new AdapterError\('([^']*)', '([^']*)', ([0-9]*)\);/g,
    (match, message, adapter, code) => {
      return `throw new AdapterError({
      adapter: '${adapter}',
      method: 'getPriceData',
      url: BASE_URL,
      statusCode: ${code},
      errorMessage: '${message}',
      isAuthError: true
    });`;
    }
  );

  // Fix extractAdapterError calls
  content = content.replace(
    /throw extractAdapterError\(error, '([^']*)'\);/g,
    (match, adapter) => {
      const methodMap = {
        'getPriceData': 'price',
        'getOHLC': 'ohlc',
        'getVolume': 'volume',
        'getTopCoins': 'top-coins'
      };
      return `throw extractAdapterError('${adapter}', 'getPriceData', BASE_URL, error);`;
    }
  );

  return content;
}

files.forEach(file => {
  const fullPath = path.join(__dirname, file);
  if (fs.existsSync(fullPath)) {
    let content = fs.readFileSync(fullPath, 'utf8');
    content = fixAdapterError(content, file);
    fs.writeFileSync(fullPath, content);
    console.log(`Fixed ${file}`);
  }
});

console.log('All files fixed!');
