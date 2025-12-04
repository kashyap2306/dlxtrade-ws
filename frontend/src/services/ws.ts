import { getAuth, onIdTokenChanged } from 'firebase/auth';
import { API_URL, WS_URL } from '@/config/env';

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

  async connect(): Promise<void> {
    // Skip health check - WebSocket should connect regardless of health status
    // Health check is optional and shouldn't block WS connections
    console.log('[WS] Connecting to WebSocket...');

    try {
      // Get fresh Firebase token with timeout
      let token: string | undefined;
      try {
        const currentUser = getAuth().currentUser;
        if (currentUser) {
          const tokenPromise = currentUser.getIdToken();
          const timeoutPromise = new Promise<string>((_, reject) =>
            setTimeout(() => reject(new Error('Token fetch timeout')), 3000)
          );
          token = await Promise.race([tokenPromise, timeoutPromise]);
        }
      } catch (tokenError) {
        console.warn('[WS] Token fetch failed, connecting without auth:', tokenError.message);
      }

      const wsUrl = token
        ? `${WS_URL}?token=${token}`
        : WS_URL;

      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        console.log('[WS] WebSocket connection successful - readyState:', this.ws?.readyState);

        // Reset reconnect attempts on successful connection
        this.reconnectAttempts = 0;
        this.healthCheckPassed = true;

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
        console.debug('[WS] error event=', error);
      };

      this.ws.onclose = (ev) => {
        console.log('[WS] WebSocket disconnected - code:', ev.code, 'reason:', ev.reason, 'wasClean:', ev.wasClean);

        // Stop heartbeat
        this.stopHeartbeat();

        // Check for authentication failure
        if (ev.code === 1008 || (ev.code >= 4000 && ev.code < 5000)) {
          console.error('[WS] Authentication failed - check token validity');
        }

        // Auto retry on specific close codes or if before handshake
        if (ev.code === 1006 || ev.code === 1000 || this.reconnectAttempts < this.maxReconnectAttempts) {
          console.log(`[WS] Auto-retrying connection (attempt ${this.reconnectAttempts + 1}/${this.maxReconnectAttempts})`);
          this.scheduleReconnect();
        } else {
          console.warn(`[WS] Max reconnect attempts (${this.maxReconnectAttempts}) reached, giving up`);
        }
      };
    } catch (err) {
      console.error('Error connecting WebSocket:', err);
    }
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
      console.warn('WebSocket not connected');
    }
  }

  disconnect(): void {
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
    } else {
      this.connect();
    }
  }

  initTokenRefreshHandler(): void {
    // Handle token refresh - reconnect WebSocket when token changes
    onIdTokenChanged(getAuth(), async (user) => {
      if (user) {
        this.reconnectWebSocket();
      }
    });
  }

  private startHeartbeat(): void {
    this.stopHeartbeat(); // Clear any existing timers

    // Send ping every 30 seconds
    this.heartbeatTimer = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send('ping');

        // Expect pong within 10 seconds
        this.pongTimeout = setTimeout(() => {
          console.warn('WebSocket heartbeat timeout - no pong received, reconnecting...');
          if (this.ws) {
            this.ws.close();
          }
        }, 10000);
      }
    }, 30000);
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

// Initialize token refresh handler when the module loads
wsService.initTokenRefreshHandler();

