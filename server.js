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

// --- Rate Limiter ---
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

// --- Cache do script ---
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

// --- Página de bloqueio (tema azul espacial com emojis) ---
const BLOCKED_PAGE = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>🚀 BLOCKED</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      background: radial-gradient(circle at center, #0b1a2e, #030712);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      font-family: 'Segoe UI', system-ui, sans-serif;
      color: #c8d6e5;
      padding: 20px;
    }
    .card {
      background: rgba(16, 36, 60, 0.8);
      backdrop-filter: blur(12px);
      border: 1px solid rgba(100, 180, 255, 0.25);
      border-radius: 28px;
      padding: 50px 40px;
      max-width: 500px;
      width: 100%;
      text-align: center;
      box-shadow: 0 25px 50px -8px rgba(0, 20, 60, 0.8);
    }
    .emoji-row {
      font-size: 3.4rem;
      letter-spacing: 12px;
      margin-bottom: 16px;
      filter: drop-shadow(0 0 12px #4a8db7);
    }
    h1 {
      font-size: 2.8rem;
      font-weight: 700;
      background: linear-gradient(135deg, #64b5f6, #1e88e5);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      text-shadow: 0 0 30px rgba(30, 136, 229, 0.3);
      margin-bottom: 8px;
      letter-spacing: 2px;
    }
    .sub {
      color: #7aa9c9;
      font-size: 1.1rem;
      margin-bottom: 20px;
    }
    .divider {
      width: 60px;
      height: 2px;
      background: linear-gradient(90deg, transparent, #4a8db7, transparent);
      margin: 16px auto;
    }
    .msg {
      color: #b0cce0;
      font-size: 1rem;
      line-height: 1.6;
    }
    .msg strong {
      color: #90caf9;
    }
    .small {
      margin-top: 18px;
      font-size: 0.85rem;
      color: #4a6f8f;
    }
    .emoji-bg {
      position: fixed;
      font-size: 6rem;
      opacity: 0.08;
      pointer-events: none;
      z-index: -1;
      animation: float 12s infinite alternate ease-in-out;
    }
    @keyframes float {
      0% { transform: translate(0, 0) rotate(0deg); }
      100% { transform: translate(-30px, -20px) rotate(12deg); }
    }
  </style>
</head>
<body>
  <div class="emoji-bg" style="top:5%;left:5%;">🌌</div>
  <div class="emoji-bg" style="bottom:8%;right:3%;animation-duration:16s;">🌠</div>
  <div class="emoji-bg" style="top:30%;right:10%;font-size:4rem;animation-duration:14s;">🪐</div>
  <div class="emoji-bg" style="bottom:30%;left:6%;font-size:5rem;animation-duration:18s;">☄️</div>

  <div class="card">
    <div class="emoji-row">🌌 🌠 🪐 ☄️</div>
    <h1>BLOCKED</h1>
    <div class="divider"></div>
    <p class="sub">🚀 Access denied to this resource</p>
    <p class="msg">
      Your request has been <strong>blocked</strong>.<br>
      This content is not available in your browser or tool.<br>
      <span style="font-size:0.9rem;color:#4a8db7;">🌟 Use a different client or contact support.</span>
    </p>
    <div class="small">✨ Protected by Luarmor • 2026</div>
  </div>
</body>
</html>
`;

// --- Middleware de bloqueio (CORRIGIDO: permite Roblox) ---
function blockBrowsersAndBots(req, res, next) {
  const ua = req.headers['user-agent'] || '';
  const uaLower = ua.toLowerCase();

  // ✅ Permite explicitamente o Roblox
  if (uaLower.includes('roblox')) {
    return next();
  }

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

// --- Rate limiter middleware ---
function rateLimiterMiddleware(req, res, next) {
  const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() ||
             req.socket.remoteAddress ||
             'unknown';
  const result = limiter.check(ip);
  if (!result.allowed) {
    res.set('Retry-After', String(result.retryAfter));
    return res.status(429).type('text').send(`⏳ Too many requests. Retry after ${result.retryAfter}s.`);
  }
  next();
}

// --- Inicialização do Express ---
const app = express();
app.use(compression());
app.use(helmet());
app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '1kb' }));

// Rota health
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    time: new Date().toISOString(),
    cacheSize: scriptCache.cache ? Buffer.byteLength(scriptCache.cache, 'utf-8') : 0,
    rateLimit: { window: WINDOW_MS, max: MAX_REQUESTS }
  });
});

// --- Rota /get-script (agora com suporte a Roblox) ---
app.get('/get-script',
  rateLimiterMiddleware,
  blockBrowsersAndBots,
  (req, res) => {
    const cached = scriptCache.get();
    if (!cached) {
      return res.status(500).type('text').send('❌ Script unavailable');
    }
    // Se o cliente mandar Accept: application/json, retorna JSON
    if (req.accepts('json')) {
      return res.json({ script: cached.script, etag: cached.etag });
    }
    // Senão, exibe página HTML bonita com o script
    const escaped = cached.script.replace(/[&<>"]/g, function(m) {
      if (m === '&') return '&amp;';
      if (m === '<') return '&lt;';
      if (m === '>') return '&gt;';
      if (m === '"') return '&quot;';
      return m;
    });
    res.type('html').send(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <title>📜 Script</title>
        <style>
          body {
            background: radial-gradient(circle at center, #0b1a2e, #030712);
            color: #c8d6e5;
            font-family: 'Fira Code', 'Courier New', monospace;
            padding: 20px;
            min-height: 100vh;
            display: flex;
            justify-content: center;
            align-items: center;
            margin: 0;
          }
          .container {
            max-width: 900px;
            width: 100%;
            background: rgba(16, 36, 60, 0.7);
            backdrop-filter: blur(8px);
            border-radius: 24px;
            padding: 30px 20px;
            border: 1px solid rgba(100, 180, 255, 0.2);
            box-shadow: 0 20px 40px -10px rgba(0,0,0,0.8);
          }
          .header {
            display: flex;
            align-items: center;
            gap: 10px;
            margin-bottom: 16px;
            padding-bottom: 10px;
            border-bottom: 1px solid rgba(100, 180, 255, 0.15);
          }
          .header h2 {
            font-size: 1.4rem;
            background: linear-gradient(135deg, #64b5f6, #1e88e5);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            font-weight: 500;
            letter-spacing: 1px;
          }
          pre {
            background: rgba(3, 10, 25, 0.7);
            padding: 20px;
            border-radius: 14px;
            overflow-x: auto;
            font-size: 0.9rem;
            line-height: 1.6;
            color: #b0d0e8;
            border: 1px solid rgba(100, 180, 255, 0.08);
            white-space: pre-wrap;
            word-break: break-all;
          }
          .footer {
            margin-top: 14px;
            font-size: 0.8rem;
            color: #4a6f8f;
            text-align: right;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <span style="font-size:1.8rem;">🌌</span>
            <h2>Script Lua</h2>
            <span style="margin-left:auto;font-size:1.4rem;">🌠</span>
          </div>
          <pre>${escaped}</pre>
          <div class="footer">🪐 Protected • ${new Date().toISOString().slice(0,10)}</div>
        </div>
      </body>
      </html>
    `);
  }
);

// Rota para recarregar cache (admin)
app.post('/reload-script', (req, res) => {
  scriptCache.timestamp = 0;
  const cached = scriptCache.get();
  if (cached) res.json({ status: 'reloaded', size: Buffer.byteLength(cached.script, 'utf-8') });
  else res.status(500).json({ error: 'Failed to reload' });
});

// Limpeza periódica do rate limiter
setInterval(() => limiter.cleanup(), 60 * 1000);

// Tratamento de erros global
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).type('text').send('💥 Internal Server Error');
});

app.listen(PORT, () => {
  console.log(`🚀 King Free API (Luarmor style) running on port ${PORT}`);
});
