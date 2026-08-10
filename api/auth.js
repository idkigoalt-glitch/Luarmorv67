import { kv } from '@vercel/kv';

function isBrowser(req) {
    const ua = (req.headers.get('user-agent') || '').toLowerCase();
    const accept = (req.headers.get('accept') || '').toLowerCase();
    return accept.includes('text/html') && (ua.includes('mozilla') || ua.includes('chrome') || ua.includes('safari'));
}

const B87 = '.CDJMHOfYQIPkL8X2y$h!gbqUaj6di9Rl(wm0sur4<vpoz#[nt;1S)e>&^c?KVE-A~_/@:*xW3+5=|7%NTG]FBZ';
const SECRET = 'kh3n_s3cr3t_x0r_k3y_2024';

function computeSig(id) {
    const enc = new TextEncoder();
    const idBytes = enc.encode(id);
    const keyBytes = enc.encode(SECRET);
    let out = '';
    for (let i = 0; i < idBytes.length; i++) {
        out += (idBytes[i] ^ keyBytes[i % keyBytes.length]).toString(16).padStart(2, '0');
    }
    return out;
}

function encodeBase87(buf) {
    let out = '';
    for (let i = 0; i < buf.length; i += 4) {
        const chunk = Array.from(buf.slice(i, i + 4));
        const pad = 4 - chunk.length;
        let val = 0;
        for (let j = 0; j < 4; j++) val = val * 256 + (chunk[j] ?? 0);
        let group = '';
        for (let k = 0; k < 5; k++) {
            group = B87[val % 87] + group;
            val = Math.floor(val / 87);
        }
        out += group.slice(0, 5 - pad);
    }
    return out;
}

const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
const html = (body) => new Response(body, { status: 200, headers: { 'Content-Type': 'text/html' } });

export const config = { runtime: 'edge' };

export default async function handler(req) {
    if (isBrowser(req)) return html(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Hidden</title>
<style>*{margin:0;padding:0}body{font-family:monospace;background:#0a0a0a;color:#fff;
min-height:100vh;display:flex;align-items:center;justify-content:center}</style>
</head><body><div>hidden</div></body></html>`);

    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
    const rlKey = `rl_auth:${ip}`;
    await kv.set(rlKey, 0, { ex: 60, nx: true });
    const hits = await kv.incr(rlKey);
    if (hits > 20) return json({ error: 'rate_limited', reason: 'rate_limited' }, 429);

    const { searchParams } = new URL(req.url);
    const script_id = searchParams.get('script_id');
    if (!script_id) return json({ error: 'Not valid token.', reason: 'invalid_request' }, 403);

    const sig = req.headers.get('x-sig');
    if (!sig || sig !== computeSig(script_id)) return json({ error: 'Not valid token.', reason: 'invalid_sig' }, 403);

    let content;
    try {
        content = await kv.get(`script:${script_id}`);
    } catch (err) {
        console.error('[auth.js] kv error:', err);
        return json({ error: 'Server error.', reason: 'server_error' }, 500);
    }
    if (!content) return json({ error: 'Not valid token.', reason: 'deleted' }, 403);

    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    const token = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');

    await kv.set(`token:${token}`, script_id, { ex: 20 });

    const tokenBytes = new Uint8Array(token.split('').map(c => c.charCodeAt(0)));
    const encoded = encodeBase87(tokenBytes);

    return json({ token: encoded });
}
  
