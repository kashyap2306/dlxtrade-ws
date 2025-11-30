import { getAuth, onIdTokenChanged } from 'firebase/auth';

type MessageHandler = (data: any) => void;

class WebSocketService {
  private ws: WebSocket | null = null;
  private handlers: Map<string, Set<MessageHandler>> = new Map();
  private reconnectTimer: NodeJS.Timeout | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private pongTimeout: NodeJS.Timeout | null = null;
  private reconnectAttempts: number = 0;
  private maxReconnectDelay: number = 30000; // 30 seconds max

  async connect(): Promise<void> {
    // Use Render WebSocket URL
    const WS_URL = 'wss://dlxtrade-ws-1.onrender.com/ws';

    try {
      // Get fresh Firebase token
      const token = await getAuth().currentUser?.getIdToken();
      const wsUrl = token ? `${WS_URL}?token=${token}` : WS_URL;

      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        console.log('WebSocket connection successful.');
        console.debug('[WS] readyState=', this.ws?.readyState);

        // Reset reconnect attempts on successful connection
        this.reconnectAttempts = 0;

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
        console.log('WebSocket disconnected');
        console.debug('[WS] close code=', ev.code, 'reason=', ev.reason, 'wasClean=', ev.wasClean);

        // Stop heartbeat
        this.stopHeartbeat();

        // Reconnect with exponential backoff
        this.scheduleReconnect();
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

    // Exponential backoff: 1s → 2s → 4s → 8s → 16s → max 30s
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), this.maxReconnectDelay);
    this.reconnectAttempts++;

    console.log(`Scheduling WebSocket reconnect in ${delay}ms (attempt ${this.reconnectAttempts})`);
    this.reconnectTimer = setTimeout(() => this.connect(), delay);
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

