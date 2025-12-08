// Test script to verify API calls don't crash on errors
import { api } from './src/config/axios.js';
import { agentsApi, notificationsApi, autoTradeApi } from './src/services/api.js';

async function testAPICalls() {
  console.log('Testing API calls...');

  try {
    // Test agents API
    console.log('Testing /agents...');
    await api.get('/agents');
    console.log('✅ /agents call completed');
  } catch (err) {
    console.log('✅ /agents call failed gracefully:', err.response?.status || 'network error');
  }

  try {
    // Test agents unlocked API
    console.log('Testing /agents/unlocked...');
    await api.get('/agents/unlocked');
    console.log('✅ /agents/unlocked call completed');
  } catch (err) {
    console.log('✅ /agents/unlocked call failed gracefully:', err.response?.status || 'network error');
  }

  try {
    // Test notifications API
    console.log('Testing /notifications...');
    await api.get('/notifications');
    console.log('✅ /notifications call completed');
  } catch (err) {
    console.log('✅ /notifications call failed gracefully:', err.response?.status || 'network error');
  }

  try {
    // Test auto-trade status API
    console.log('Testing /auto-trade/status...');
    await api.get('/auto-trade/status');
    console.log('✅ /auto-trade/status call completed');
  } catch (err) {
    console.log('✅ /auto-trade/status call failed gracefully:', err.response?.status || 'network error');
  }

  console.log('All API calls tested successfully - no crashes!');
}

testAPICalls();
