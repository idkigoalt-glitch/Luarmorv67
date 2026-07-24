const express = require('express');
const fs = require('fs');
const path = require('path');
const compression = require('compression');
const helmet = require('helmet');
const cors = require('cors');

const PORT = process.env.PORT || 3000;
const WINDOW_MS = Number(process.env.RATE_WINDOW) || 15 * 60 * 1000;
const MAX_REQUESTS = Number(process.env.RATE_MAX) || 100;
const CACHE_TTL = Number(process.env.CACHE_TTL) || 60 * 1000;
const SCRIPT_PATH = path.join(__dirname, 'scripts', 'script.lua');

class SlidingWindowRateLimiter {
  constructor(windowMs, maxRequests) {
    this.windowMs = windowMs;
    this.maxRequests = maxRequests;
    this.store = new Map();
  }
  check(ip) {
    const now = Date.now();
    const record = this.store.get(ip) || { timestamps: [] };
    const windowStart = now - this.windowMs;
    record.timestamps = record.timestamps.filter(t => t > windowStart);
    if (record.timestamps.length >= this.maxRequests) {
      const oldest = record.timestamps[0];
      const retryAfter = Math.ceil((oldest + this.windowMs - now) / 1000);
      return { allowed: false, retryAfter: Math.max(retryAfter, 1) };
    }
    record.timestamps.push(now);
    this.store.set(ip, record);
    return { allowed: true };
  }
  cleanup() {
    const now = Date.now();
    for (const [ip, record] of this.store) {
      const windowStart = now - this.windowMs;
      record.timestamps = record.timestamps.filter(t => t > windowStart);
      if (record.timestamps.length === 0) this.store.delete(ip);
    }
  }
}

const limiter = new SlidingWindowRateLimiter(WINDOW_MS, MAX_REQUESTS);

class ScriptCache {
  constructor(filePath, ttl) {
    this.filePath = filePath;
    this.ttl = ttl;
    this.cache = null;
    this.etag = null;
    this.lastModified = null;
    this.timestamp = 0;
  }
  get() {
    const now = Date.now();
    if (this.cache && (now - this.timestamp) < this.ttl) {
      return { script: this.cache, etag: this.etag, lastModified: this.lastModified };
    }
    try {
      const stats = fs.statSync(this.filePath);
      const script = fs.readFileSync(this.filePath, 'utf-8');
      this.cache = script;
      this.etag = `"${Buffer.from(script).length.toString(16)}-${stats.mtimeMs.toString(16)}"`;
      this.lastModified = stats.mtime.toUTCString();
      this.timestamp = now;
      return { script: this.cache, etag: this.etag, lastModified: this.lastModified };
    } catch {
      return null;
    }
  }
}

const scriptCache = new ScriptCache(SCRIPT_PATH, CACHE_TTL);

const BLOCKED_PAGE = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Blocked</title><style>*{margin:0;padding:0;box-sizing:border-box}body{background:#1a1a1a;display:flex;align-items:center;justify-content:center;min-height:100vh;font-family:'Segoe UI',sans-serif}.card{background:#2a2a2a;border:1px solid #3a3a3a;border-radius:16px;padding:48px 56px;text-align:center;max-width:420px}.icon{font-size:64px;margin-bottom:20px}h1{color:#e0e0e0;font-size:22px;font-weight:600;letter-spacing:1px;margin-bottom:12px}p{color:#888;font-size:14px;line-height:1.6}</style></head><body><div class="card"><div class="icon">⛔</div><h1>ACCESS DENIED</h1><p>This resource is protected.<br>Automated or browser access is not permitted.</p></div></body></html>`;

function blockBrowsersAndBots(req, res, next) {
  const ua = req.headers['user-agent'] || '';
  const uaLower = ua.toLowerCase();
  const blockedPatterns = [
    /chrome\//i, /firefox\//i, /safari\//i, /edge\//i, /opr\//i,
    /trident\//i, /mozilla/i,
    /curl/i, /wget/i, /python-requests/i, /postman/i, /insomnia/i,
    /httpie/i, /scrapy/i, /go-http-client/i
  ];
  if (blockedPatterns.some(p => p.test(uaLower))) {
    return res.status(403).type('html').send(BLOCKED_PAGE);
  }
  next();
}

function rateLimiterMiddleware(req, res, next) {
  const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() ||
             req.socket.remoteAddress ||
             'unknown';
  const result = limiter.check(ip);
  if (!result.allowed) {
    res.set('Retry-After', String(result.retryAfter));
    return res.status(429).type('text').send(`Too many requests. Retry after ${result.retryAfter}s.`);
  }
  next();
}

const app = express();
app.use(compression());
app.use(helmet());
app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '1kb' }));

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    time: new Date().toISOString(),
    cacheSize: scriptCache.cache ? Buffer.byteLength(scriptCache.cache, 'utf-8') : 0,
    rateLimit: { window: WINDOW_MS, max: MAX_REQUESTS }
  });
});

app.get('/get-script',
  rateLimiterMiddleware,
  blockBrowsersAndBots,
  (req, res) => {
    const cached = scriptCache.get();
    if (!cached) return res.status(500).type('text').send('Script unavailable');
    const ifNoneMatch = req.headers['if-none-match'];
    if (ifNoneMatch === cached.etag) return res.status(304).end();
    res.set('ETag', cached.etag);
    res.set('Last-Modified', cached.lastModified);
    res.set('Cache-Control', `public, max-age=${Math.floor(CACHE_TTL/1000)}`);
    res.type('text').send(cached.script);
  }
);

app.post('/reload-script', (req, res) => {
  scriptCache.timestamp = 0;
  const cached = scriptCache.get();
  if (cached) res.json({ status: 'reloaded', size: Buffer.byteLength(cached.script, 'utf-8') });
  else res.status(500).json({ error: 'Failed to reload' });
});

setInterval(() => limiter.cleanup(), 60 * 1000);
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).type('text').send('Internal Server Error');
});

app.listen(PORT, () => {
  console.log(`🚀 King Free API running on port ${PORT}`);
});
