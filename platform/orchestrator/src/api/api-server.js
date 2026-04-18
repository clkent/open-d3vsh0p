const http = require('http');
const crypto = require('crypto');
const { URL } = require('url');

const ERROR_CODES = {
  UNAUTHORIZED: 401,
  BAD_REQUEST: 400,
  NOT_FOUND: 404,
  CONFLICT: 409,
  METHOD_NOT_ALLOWED: 405,
  INTERNAL_ERROR: 500
};

class ApiError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
    this.statusCode = ERROR_CODES[code] || 500;
  }
}

/**
 * Convert a route pattern like '/api/projects/:id/sessions/:sessionId'
 * into a regex with named capture groups.
 */
function patternToRegex(pattern) {
  const regexStr = pattern
    .replace(/:[a-zA-Z]+/g, (match) => {
      const name = match.slice(1);
      return `(?<${name}>[^/]+)`;
    });
  return new RegExp(`^${regexStr}$`);
}

class ApiServer {
  constructor({ token, routes, processManager }) {
    this.token = token;
    this.processManager = processManager;
    this.server = null;
    this.startedAt = Date.now();

    // Compile route patterns
    this.compiledRoutes = routes.map(({ method, pattern, handler }) => ({
      method: method.toUpperCase(),
      regex: patternToRegex(pattern),
      pattern,
      handler
    }));
  }

  async start(port = 3200) {
    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => this._handleRequest(req, res));

      this.server.on('listening', () => {
        this.startedAt = Date.now();
        resolve();
      });

      this.server.on('error', (err) => {
        this.server = null;
        reject(err);
      });

      this.server.listen(port, '127.0.0.1');
    });
  }

  async stop() {
    if (!this.server) return;

    return new Promise((resolve) => {
      this.server.close(() => {
        this.server = null;
        resolve();
      });
    });
  }

  get isRunning() {
    return this.server !== null;
  }

  get uptime() {
    return Date.now() - this.startedAt;
  }

  async _handleRequest(req, res) {
    try {
      // Auth check (skip for health endpoint)
      const url = new URL(req.url, `http://${req.headers.host}`);

      if (url.pathname !== '/api/health') {
        this._authenticate(req);
      }

      // Parse JSON body for POST/PUT/PATCH
      let body = null;
      if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
        body = await this._parseBody(req);
      }

      // Parse query params
      const query = Object.fromEntries(url.searchParams);

      // Route matching
      const route = this._matchRoute(req.method, url.pathname);
      if (!route) {
        throw new ApiError('NOT_FOUND', `No route matches ${req.method} ${url.pathname}`);
      }

      const result = await route.handler(route.params, body, query);
      this._sendJson(res, result.status || 200, result.data);
    } catch (err) {
      if (err instanceof ApiError) {
        this._sendError(res, err.statusCode, err.code, err.message);
      } else {
        this._sendError(res, 500, 'INTERNAL_ERROR', err.message);
      }
    }
  }

  _authenticate(req) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new ApiError('UNAUTHORIZED', 'Missing or invalid Authorization header');
    }

    const provided = authHeader.slice(7);
    const expected = this.token;

    // Constant-time comparison
    const providedBuf = Buffer.from(provided);
    const expectedBuf = Buffer.from(expected);

    if (providedBuf.length !== expectedBuf.length ||
        !crypto.timingSafeEqual(providedBuf, expectedBuf)) {
      throw new ApiError('UNAUTHORIZED', 'Invalid API token');
    }
  }

  _parseBody(req) {
    return new Promise((resolve, reject) => {
      const chunks = [];
      let size = 0;
      const MAX_BODY = 1024 * 1024; // 1MB

      req.on('data', (chunk) => {
        size += chunk.length;
        if (size > MAX_BODY) {
          reject(new ApiError('BAD_REQUEST', 'Request body too large'));
          req.destroy();
          return;
        }
        chunks.push(chunk);
      });

      req.on('end', () => {
        const raw = Buffer.concat(chunks).toString();
        if (!raw) {
          resolve(null);
          return;
        }
        try {
          resolve(JSON.parse(raw));
        } catch {
          reject(new ApiError('BAD_REQUEST', 'Invalid JSON body'));
        }
      });

      req.on('error', reject);
    });
  }

  _matchRoute(method, pathname) {
    for (const route of this.compiledRoutes) {
      if (route.method !== method) continue;
      const match = pathname.match(route.regex);
      if (match) {
        return { handler: route.handler, params: match.groups || {} };
      }
    }
    return null;
  }

  _sendJson(res, status, data) {
    const body = JSON.stringify(data);
    res.writeHead(status, {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body)
    });
    res.end(body);
  }

  _sendError(res, status, code, message) {
    this._sendJson(res, status, { error: { code, message } });
  }
}

module.exports = { ApiServer, ApiError, patternToRegex, ERROR_CODES };
