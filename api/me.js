import { kv } from '@vercel/kv';

function getSessionToken(req) {
    const cookie = req.headers.get('cookie') || '';
    const match = cookie.match(/session=([a-f0-9]{64})/);
    if (!match) {
        const raw = cookie.match(/session=([^;]+)/);
        if (raw) console.warn('[me.js] session cookie sai format:', raw[1]?.slice(0, 8) + '...');
        return null;
    }
    return match[1];
}

export async function getSession(req) {
    const token = getSessionToken(req);
    if (!token) return null;
    return await kv.get(`session:${token}`);
}

export const config = { runtime: 'edge' };

export default async function handler(req) {
    const session = await getSession(req);
    if (!session) return new Response(JSON.stringify({ error: 'not logged in' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
    return new Response(JSON.stringify({ discord_id: session.discord_id, username: session.username, avatar: session.avatar }), { status: 200, headers: { 'Content-Type': 'application/json' } });
                                        }
