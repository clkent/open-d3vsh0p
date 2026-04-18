const { WebSocketServer } = require('ws');

class BroadcastServer {
  constructor() {
    this.wss = null;
    this.clients = new Set();
    this._eventBuffer = [];
    this._maxBufferSize = 50;
    this._pingInterval = null;
  }

  async start(port = 3100) {
    return new Promise((resolve, reject) => {
      this.wss = new WebSocketServer({ host: '127.0.0.1', port });

      this.wss.on('listening', () => {
        // Ping clients every 30s to detect dead connections
        this._pingInterval = setInterval(() => {
          for (const client of this.clients) {
            if (client._isAlive === false) {
              this.clients.delete(client);
              client.terminate();
              continue;
            }
            client._isAlive = false;
            try { client.ping(); } catch {
              this.clients.delete(client);
            }
          }
        }, 30000);

        resolve();
      });

      this.wss.on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
          this.wss = null;
          resolve(); // non-fatal — session continues without broadcast
        } else {
          reject(err);
        }
      });

      this.wss.on('connection', (ws) => {
        ws._isAlive = true;
        ws.on('pong', () => { ws._isAlive = true; });

        this.clients.add(ws);

        // Replay buffered events so reconnecting clients catch up
        if (this._eventBuffer.length > 0) {
          try {
            ws.send(JSON.stringify({ type: 'replay', events: this._eventBuffer }));
          } catch {}
        }

        ws.on('close', () => {
          this.clients.delete(ws);
        });

        ws.on('error', () => {
          this.clients.delete(ws);
        });
      });
    });
  }

  broadcast(event) {
    if (!this.wss) return;

    const sanitized = BroadcastServer._stripSensitiveFields(event);

    // Buffer for replay to reconnecting clients
    this._eventBuffer.push(sanitized);
    if (this._eventBuffer.length > this._maxBufferSize) {
      this._eventBuffer.shift();
    }

    const data = JSON.stringify(sanitized);
    for (const client of this.clients) {
      try {
        client.send(data);
      } catch {
        this.clients.delete(client);
      }
    }
  }

  async stop() {
    if (!this.wss) return;

    if (this._pingInterval) {
      clearInterval(this._pingInterval);
      this._pingInterval = null;
    }

    for (const client of this.clients) {
      try {
        client.close(1000, 'session_ended');
      } catch {
        // ignore
      }
    }
    this.clients.clear();
    this._eventBuffer = [];

    return new Promise((resolve) => {
      this.wss.close(() => {
        this.wss = null;
        resolve();
      });
    });
  }

  get isRunning() {
    return this.wss !== null;
  }

  static _stripSensitiveFields(obj) {
    if (obj === null || typeof obj !== 'object') return obj;
    if (Array.isArray(obj)) return obj.map(item => BroadcastServer._stripSensitiveFields(item));

    const result = {};
    for (const [key, value] of Object.entries(obj)) {
      if (key === 'claudeSessionId' || key === 'session_id') continue;
      result[key] = BroadcastServer._stripSensitiveFields(value);
    }
    return result;
  }
}

module.exports = { BroadcastServer };
