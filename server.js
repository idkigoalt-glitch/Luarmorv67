const express = require("express");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

const hits = new Map();
const WINDOW = 15 * 60 * 1000;
const MAX = 100;

function rateLimiter(req, res, next) {
  const ip =
    req.headers["x-forwarded-for"]?.split(",")[0].trim() ||
    req.socket.remoteAddress ||
    "?";
  const now = Date.now();
  const r = hits.get(ip);
  if (!r || now - r.start > WINDOW) {
    hits.set(ip, { count: 1, start: now });
    return next();
  }
  r.count++;
  if (r.count > MAX) {
    const retry = Math.ceil((WINDOW - (now - r.start)) / 1000);
    res.set("Retry-After", String(retry));
    return res.status(429).type("text").send("Too many requests");
  }
  next();
}

setInterval(() => {
  const now = Date.now();
  for (const [ip, r] of hits) {
    if (now - r.start > WINDOW) hits.delete(ip);
  }
}, 5 * 60 * 1000);

let cache = null;
let cacheTime = 0;
const CACHE_TTL = 60 * 1000;

function getScript() {
  const now = Date.now();
  if (cache && now - cacheTime < CACHE_TTL) return cache;
  const filePath = path.join(__dirname, "scripts", "script.lua");
  cache = fs.readFileSync(filePath, "utf-8");
  cacheTime = now;
  return cache;
}

const BLOCKED_PAGE = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Blocked</title><style>*{margin:0;padding:0;box-sizing:border-box}body{background:#1a1a1a;display:flex;align-items:center;justify-content:center;min-height:100vh;font-family:'Segoe UI',sans-serif}.card{background:#2a2a2a;border:1px solid #3a3a3a;border-radius:16px;padding:48px 56px;text-align:center;max-width:420px}.icon{font-size:64px;margin-bottom:20px}h1{color:#e0e0e0;font-size:22px;font-weight:600;letter-spacing:1px;margin-bottom:12px}p{color:#888;font-size:14px;line-height:1.6}</style></head><body><div class="card"><div class="icon">⛔</div><h1>YOU ARE BLOCKED NOW SAY WALLAHI</h1><p>Access to this resource is restricted.<br>This content is not available in your browser for more information no skid</p></div></body></html>`;

function blockBrowsers(req, res, next) {
  const ua = req.headers["user-agent"] || "";
  const uaLower = ua.toLowerCase();
  const isBrowser =
    (uaLower.includes("chrome/") ||
     uaLower.includes("firefox/") ||
     uaLower.includes("safari/") ||
     uaLower.includes("edge/") ||
     uaLower.includes("opr/") ||
     uaLower.includes("trident/")) &&
    uaLower.includes("mozilla");
  if (isBrowser) {
    return res.status(403).type("html").send(BLOCKED_PAGE);
  }
  next();
}

app.get("/get-script", rateLimiter, blockBrowsers, (req, res) => {
  try {
    res.type("text").send(getScript());
  } catch {
    res.status(500).type("text").send("Script no disponible");
  }
});

app.get("/health", (req, res) => {
  res.json({ status: "ok", time: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log(`King Free API corriendo en puerto ${PORT}`);
});
