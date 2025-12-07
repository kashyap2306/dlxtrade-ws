import { getAuth, onAuthStateChanged } from 'firebase/auth';
import { auth } from '../config/firebase';
import { API_URL, WS_URL } from '@/config/env';

async function getAuthToken() {
  const user = auth.currentUser;
  if (!user) return null;

  try {
    return await user.getIdToken();
  } catch (err) {
    console.error("[WS] Token fetch failed:", err);
    return null;
  }
}

type Timeout = ReturnType<typeof setTimeout>;

type MessageHandler = (data: any) => void;

class WebSocketService {
  private ws: WebSocket | null = null;
  private handlers: Map<string, Set<MessageHandler>> = new Map();
  private reconnectTimer: Timeout | null = null;
  private heartbeatTimer: Timeout | null = null;
  private pongTimeout: Timeout | null = null;
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number = 10; // Max 10 retries
  private healthCheckPassed: boolean = false;
  private isConnecting: boolean = false;

  // Legacy connect method - now delegates to startWebSocket with token
  async connect(): Promise<void> {
    const token = await getAuthToken();
    if (!token) {
      console.warn("[WS] No token available — cannot connect.");
      return;
    }
    await this.startWebSocket(token);
  }

  private handleMessage(data: any): void {
    const type = data.type || 'default';
    const handlers = this.handlers.get(type) || this.handlers.get('*');

    if (handlers) {
      handlers.forEach((handler) => handler(data));
    }
  }

  subscribe(type: string, handler: MessageHandler): () => void {
    if (!this.handlers.has(type)) {
      this.handlers.set(type, new Set());
    }
    this.handlers.get(type)!.add(handler);

    // Return unsubscribe function
    return () => {
      const handlers = this.handlers.get(type);
      if (handlers) {
        handlers.delete(handler);
        if (handlers.size === 0) {
          this.handlers.delete(type);
        }
      }
    };
  }

  send(data: any): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    } else {
      console.warn('WebSocket not connected, cannot send:', data.type);
    }
  }

  disconnect(): void {
    this.maxReconnectAttempts = 0; // Prevent auto-reconnect
    this.reconnectAttempts = 0;
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.stopHeartbeat();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.handlers.clear();
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }

    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.warn(`[WS] Max reconnect attempts (${this.maxReconnectAttempts}) reached`);
      return;
    }

    // Fixed 3 second delay between retries
    const delay = 3000;
    this.reconnectAttempts++;

    console.log(`[WS] Scheduling reconnect in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
    this.reconnectTimer = setTimeout(() => {
      console.log('[WS] Attempting to reconnect...');
      this.connect();
    }, delay);
  }

  private reconnectWebSocket(): void {
    console.log('Reconnecting WebSocket due to token refresh');
    if (this.ws) {
      this.ws.close();
      // onclose will NOT trigger reconnect if we don't reset something?
      // actually onclose triggers scheduleReconnect.
      // But we want to force immediate reconnect with new token.

      // We should wait for close or just call connect() after a small delay?
      // Better to rely on close logic or just forcefully set ws to null and connect.
    }
    // connect() calls at start of function will handle creating new WS if old one is closed
    // If we closed it above, we might need to wait or rely on onclose.
    // Let's just call connect() which will create a NEW socket connection.
    // But connect() has a check for OPEN.

    // Force reset to allow new connection
    this.ws = null;
    this.connect();
  }

  initAuthStateHandler(): void {
    // WebSocket must start ONLY after Firebase login is complete
    onAuthStateChanged(auth, async (user) => {
      if (!user) {
        console.warn("[WS] User not logged in. WS not started.");
        this.disconnect();
        return;
      }

      const token = await user.getIdToken();
      if (!token) {
        console.warn("[WS] No token available after login — skipping WS init.");
        return;
      }

      console.log('[WS] User logged in, starting WebSocket connection');
      this.startWebSocket(token);
    });
  }

  private async startWebSocket(token: string): Promise<void> {
    if (this.ws?.readyState === WebSocket.OPEN || this.isConnecting) {
      return;
    }

    this.isConnecting = true;
    console.log('[WS] Starting WebSocket with authenticated user...');

    try {
      // Ensure WS URL includes a valid token
      const wsUrl = `${WS_URL}?token=${encodeURIComponent(token)}`;
      console.log("[WS CONNECT URL]", wsUrl);

      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        console.log('[WS] WebSocket connection successful - readyState:', this.ws?.readyState);

        // Explicitly send auth message as backup
        console.log('[WS] Sending auth token message');
        this.send({ type: 'auth', token });

        // Reset reconnect attempts on successful connection
        this.reconnectAttempts = 0;
        this.healthCheckPassed = true;
        this.isConnecting = false;

        // Start heartbeat
        this.startHeartbeat();
      };

      this.ws.onmessage = (event) => {
        try {
          // Clear pong timeout on any message (treat as implicit pong)
          this.clearPongTimeout();

          // Handle explicit pong responses for heartbeat
          if (event.data === 'pong') {
            return;
          }

          const data = JSON.parse(event.data);
          this.handleMessage(data);
        } catch (err) {
          console.error('Error parsing WebSocket message:', err);
        }
      };

      this.ws.onerror = (error: any) => {
        console.error('WebSocket error:', error?.message || error);
      };

      this.ws.onclose = (ev) => {
        console.log('[WS] WebSocket disconnected - code:', ev.code, 'reason:', ev.reason, 'wasClean:', ev.wasClean);
        this.isConnecting = false;

        // Stop heartbeat
        this.stopHeartbeat();

        // Prevent disconnect code 1006 (abnormal closure)
        if (ev.code === 1006) {
          console.warn('[WS] Abnormal closure (1006), attempting clean reconnect');
          // Don't increment attempts for abnormal closures, they might be network issues
          this.scheduleReconnect();
          return;
        }

        // Check for authentication failure
        if (ev.code === 1008 || (ev.code >= 4000 && ev.code < 5000)) {
          console.error('[WS] Authentication failed:', ev.reason);
          // Don't retry on auth failures - wait for new auth state
          return;
        }

        // Auto-retry for other codes
        if (this.reconnectAttempts < this.maxReconnectAttempts) {
          console.log(`[WS] Auto-retrying connection (attempt ${this.reconnectAttempts + 1}/${this.maxReconnectAttempts})`);
          this.scheduleReconnect();
        } else {
          console.warn(`[WS] Not reconnecting - code ${ev.code}, attempts: ${this.reconnectAttempts}/${this.maxReconnectAttempts}`);
        }
      };
    } catch (err) {
      console.error('Error starting WebSocket:', err);
      this.isConnecting = false;
      this.scheduleReconnect();
    }
  }

  private startHeartbeat(): void {
    this.stopHeartbeat(); // Clear any existing timers

    // Send ping every 60 seconds
    this.heartbeatTimer = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send('ping');

        // Expect pong within 15 seconds
        this.pongTimeout = setTimeout(() => {
          console.warn('WebSocket heartbeat timeout - no pong received, reconnecting...');
          if (this.ws) {
            this.ws.close();
          }
        }, 15000);
      }
    }, 60000);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    this.clearPongTimeout();
  }

  private clearPongTimeout(): void {
    if (this.pongTimeout) {
      clearTimeout(this.pongTimeout);
      this.pongTimeout = null;
    }
  }
}

export const wsService = new WebSocketService();

// Initialize auth state handler when the module loads
wsService.initAuthStateHandler();

// Add DEV-ONLY test block
if (import.meta.env.DEV) {
  setTimeout(async () => {
    console.log("[WS TEST] User:", auth.currentUser ? "Logged In" : "Not Logged In");
    console.log("[WS TEST] Token:", await getAuthToken() ? "OK" : "MISSING");
  }, 1200);
}

