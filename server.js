const express = require("express");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

const hits = new Map();
const WINDOW = 15 * 60 * 1000;
const MAX = 100;

// --- Rate Limiter ---
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

// --- Garantir que o script.lua existe ---
const SCRIPT_PATH = path.join(__dirname, "scripts", "script.lua");
function ensureScript() {
  const dir = path.dirname(SCRIPT_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  if (!fs.existsSync(SCRIPT_PATH)) {
    const defaultScript = `-- Script padrão (criado automaticamente)
print("🚀 Script carregado com sucesso!")

local function saudacao(nome)
    return "Olá, " .. nome .. "! 🌌"
end

return {
    saudacao = saudacao,
    versao = "1.0.0"
}
`;
    fs.writeFileSync(SCRIPT_PATH, defaultScript, "utf-8");
    console.log("✅ Script padrão criado em:", SCRIPT_PATH);
  }
}
ensureScript();

// --- Cache do script ---
let cache = null;
let cacheTime = 0;
const CACHE_TTL = 60 * 1000;

function getScript() {
  const now = Date.now();
  if (cache && now - cacheTime < CACHE_TTL) return cache;
  try {
    cache = fs.readFileSync(SCRIPT_PATH, "utf-8");
    cacheTime = now;
    return cache;
  } catch {
    return null;
  }
}

// --- Página de bloqueio (tema azul espacial) ---
const BLOCKED_PAGE = `<!DOCTYPE html>
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
</html>`;

// --- Middleware de bloqueio (permite Roblox) ---
function blockBrowsers(req, res, next) {
  const ua = req.headers["user-agent"] || "";
  const uaLower = ua.toLowerCase();

  // ✅ Permite Roblox
  if (uaLower.includes("roblox")) {
    return next();
  }

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

// --- Rotas ---
app.get("/get-script", rateLimiter, blockBrowsers, (req, res) => {
  try {
    const script = getScript();
    if (!script) {
      return res.status(500).type("text").send("❌ Script unavailable");
    }
    res.type("text").send(script);
  } catch {
    res.status(500).type("text").send("❌ Script no disponible");
  }
});

app.get("/health", (req, res) => {
  res.json({ status: "ok", time: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log(`🚀 King Free API corriendo en puerto ${PORT}`);
  console.log(`📁 Script path: ${SCRIPT_PATH}`);
});
