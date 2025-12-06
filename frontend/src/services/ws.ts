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
  private isConnecting: boolean = false;

  async connect(): Promise<void> {
    if (this.ws?.readyState === WebSocket.OPEN || this.isConnecting) {
      return;
    }

    this.isConnecting = true;
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
      } catch (tokenError: any) {
        console.warn('[WS] Token fetch failed, connecting without auth:', tokenError.message);
      }

      // Add token to URL as fallback/primary depending on server support, 
      // but USER explicitly asked to send it as a message too.
      const wsUrl = token
        ? `${WS_URL}?token=${token}`
        : WS_URL;

      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        console.log('[WS] WebSocket connection successful - readyState:', this.ws?.readyState);

        // Explicitly send auth message as requested
        if (token) {
          console.log('[WS] Sending auth token message');
          this.send({ type: 'auth', token });
        }

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
        // Only log, let onclose handle reconnection logic
      };

      this.ws.onclose = (ev) => {
        console.log('[WS] WebSocket disconnected - code:', ev.code, 'reason:', ev.reason, 'wasClean:', ev.wasClean);
        this.isConnecting = false;

        // Stop heartbeat
        this.stopHeartbeat();

        // Check for authentication failure 
        if (ev.code === 1008 || (ev.code >= 4000 && ev.code < 5000)) {
          console.error('[WS] Authentication failed:', ev.reason);
          // Retry logic: if token expired, we might want to refresh and retry, 
          // but for now we follow the pattern of limited retries or stopping if it's a hard auth fail.
          // However, we should try to reconnect if it's just a transient auth glith.
          // Let's allow reconnect but maybe with a fresh token check in connect()
        }

        // Auto-retry unless explicitly closed by user (which we don't track well here, but standard behavior is retry)
        // We always try to reconnect unless max attempts reached
        if (this.reconnectAttempts < this.maxReconnectAttempts) {
          console.log(`[WS] Auto-retrying connection (attempt ${this.reconnectAttempts + 1}/${this.maxReconnectAttempts})`);
          this.scheduleReconnect();
        } else {
          console.warn(`[WS] Not reconnecting - code ${ev.code}, attempts: ${this.reconnectAttempts}/${this.maxReconnectAttempts}`);
        }
      };
    } catch (err) {
      console.error('Error connecting WebSocket:', err);
      this.isConnecting = false;
      this.scheduleReconnect();
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

  initTokenRefreshHandler(): void {
    // Handle token refresh - reconnect WebSocket when token changes

    onIdTokenChanged(getAuth(), async (user) => {
      if (user) {
        // Always try to ensure we are connected when we have a user
        // If already connected, maybe refresh?
        // If not connected, definitely connect.

        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
          console.log('[WS] Token refreshed, reconnecting WebSocket to update auth');
          this.reconnectWebSocket();
        } else {
          console.log('[WS] Token available, initiating connection');
          this.connect();
        }
      } else {
        // User logged out
        console.log('[WS] User logged out, disconnecting');
        this.disconnect();
        // Reset for next login
        this.maxReconnectAttempts = 10;
      }
    });
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

// Initialize token refresh handler when the module loads
wsService.initTokenRefreshHandler();

