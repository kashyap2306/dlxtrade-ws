const { query } = require('./dist/db/index.js');

async function checkTables() {
  try {
    console.log('Checking database tables...');
    const tables = await query(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`);
    console.log('Tables:', tables.map(t => t.table_name));

    console.log('\nChecking user_agents table...');
    const userAgents = await query('SELECT COUNT(*) as count FROM user_agents');
    console.log('user_agents count:', userAgents[0].count);

    console.log('\nChecking agent_requests table...');
    const agentRequests = await query('SELECT COUNT(*) as count FROM agent_requests');
    console.log('agent_requests count:', agentRequests[0].count);

    console.log('\nChecking agents table...');
    const agents = await query('SELECT COUNT(*) as count FROM agents');
    console.log('agents count:', agents[0].count);

    console.log('\nChecking users table...');
    const users = await query('SELECT COUNT(*) as count FROM users');
    console.log('users count:', users[0].count);

    console.log('\nSample user_agents data:');
    const sampleUserAgents = await query('SELECT user_id, agent_id, granted_at FROM user_agents LIMIT 5');
    console.log(JSON.stringify(sampleUserAgents, null, 2));

    console.log('\nSample users data:');
    const sampleUsers = await query('SELECT firebase_uid, email FROM users LIMIT 5');
    console.log(JSON.stringify(sampleUsers, null, 2));

    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

checkTables();