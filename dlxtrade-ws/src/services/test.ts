import { AdapterError } from '../utils/adapterErrorHandler';
import axios from 'axios';

const BASE_URL = 'https://api.binance.com/api/v3';

export class TestAdapter {
  private baseUrl: string;

  constructor() {
    this.baseUrl = BASE_URL;
  }

  async testConnection(): Promise<{ success: boolean; message: string }> {
    try {
      const response = await axios.get(`${this.baseUrl}/ping`, {
        timeout: 5000,
      });

      if (response.status === 200 && response.data === '{}') {
        return { success: true, message: 'Binance Public API accessible' };
      } else {
        return { success: false, message: `Unexpected response: ${response.status}` };
      }
    } catch (error: any) {
      return { success: false, message: `Connection failed again: ${error.message}` };
    }
  }
}
