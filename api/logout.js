import { kv } from '@vercel/kv';

export const config = { runtime: 'edge' };

export default async function handler(req) {
    const cookie = req.headers.get('cookie') || '';
    const match = cookie.match(/session=([a-f0-9]{64})/);
    if (match) await kv.del(`session:${match[1]}`);
    return new Response(null, {
        status: 302,
        headers: {
            'Location': '/',
            'Set-Cookie': 'session=; Path=/; Max-Age=0'
        }
    });
}
