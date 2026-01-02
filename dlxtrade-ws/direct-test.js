// Direct test to check if usersRoutes registration works
console.log('=== DIRECT USERS ROUTES TEST ===');

try {
  // Load the built app module directly
  console.log('Loading built app.js...');
  const fs = require('fs');
  const path = require('path');

  // Check if dist/app.js exists
  const appPath = path.join(__dirname, 'dist', 'app.js');
  console.log('App path exists:', fs.existsSync(appPath));

  // Check if dist/routes/users.js exists
  const usersPath = path.join(__dirname, 'dist', 'routes', 'users.js');
  console.log('Users path exists:', fs.existsSync(usersPath));

  // Try to load the users module
  console.log('Loading users module...');
  const usersModule = require('./dist/routes/users.js');
  console.log('Users module loaded, has usersRoutes:', typeof usersModule.usersRoutes);

  // Try to load the app module
  console.log('Loading app module...');
  const appModule = require('./dist/app.js');
  console.log('App module loaded, has buildApp:', typeof appModule.buildApp);

  console.log('✅ All modules loaded successfully');

} catch (error) {
  console.error('❌ ERROR:', error.message);
  console.error('Stack:', error.stack);
}
