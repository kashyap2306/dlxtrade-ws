type MessageHandler = (data: any) => void;

class WebSocketService {
  private ws: WebSocket | null = null;
  private handlers: Map<string, Set<MessageHandler>> = new Map();

  async connect(): Promise<void> {
    // Use environment variable for WebSocket URL, fallback to localhost for dev
    const wsUrl = import.meta.env.VITE_WS_URL || 'ws://localhost:4000/ws';
    
    try {
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        console.log('WebSocket connection successful using Render server.');
        console.debug('[WS] readyState=', this.ws?.readyState);
      };

      this.ws.onmessage = (event) => {
        try {
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
        console.log('WebSocket disconnected from Render server');
        console.debug('[WS] close code=', ev.code, 'reason=', ev.reason, 'wasClean=', ev.wasClean);
        // Simple reconnect after a short delay, no token logic
        setTimeout(() => this.connect(), 3000);
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
    this.handlers.clear();
  }
}

export const wsService = new WebSocketService();

