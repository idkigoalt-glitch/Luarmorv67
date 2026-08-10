import { kv } from '@vercel/kv';

function isBrowser(req) {
    const ua = (req.headers.get('user-agent') || '').toLowerCase();
    const accept = (req.headers.get('accept') || '').toLowerCase();
    return accept.includes('text/html') && (ua.includes('mozilla') || ua.includes('chrome') || ua.includes('safari'));
}

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

const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
const html = (body) => new Response(body, { status: 200, headers: { 'Content-Type': 'text/html' } });

export const config = { runtime: 'edge' };

export default async function handler(req) {
    if (isBrowser(req)) return html(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Hidden</title>
<style>*{margin:0;padding:0}body{font-family:monospace;background:#0a0a0a;color:#fff;
min-height:100vh;display:flex;align-items:center;justify-content:center}</style>
</head><body><div>hidden</div></body></html>`);

    const { searchParams } = new URL(req.url);
    const token = searchParams.get('token');
    if (!token) return json({ error: 'Not valid token.', reason: 'invalid_request' }, 403);

    const script_id = await kv.getdel(`token:${token}`);
    if (!script_id) return json({ error: 'Not valid token.', reason: 'token_expired' }, 403);

    const sig = req.headers.get('x-sig');
    if (!sig || sig !== computeSig(script_id)) return json({ error: 'Not valid token.', reason: 'invalid_sig' }, 403);

    let content;
    try {
        content = await kv.get(`script:${script_id}`);
    } catch (err) {
        console.error('[loader.js] kv error:', err);
        return json({ error: 'Server error.', reason: 'server_error' }, 500);
    }
    if (!content) return json({ error: 'Not valid token.', reason: 'deleted' }, 403);

    return new Response(content, { status: 200, headers: { 'Content-Type': 'text/plain' } });
                                    }
