import { kv } from '@vercel/kv';
import { getSession } from './me.js';

export const config = { runtime: 'edge' };

export default async function handler(req) {
    const session = await getSession(req);
    if (!session) return new Response('unauthorized', { status: 401 });

    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');

    const meta = await kv.get(`script_meta:${id}`);
    if (!meta || meta.owner !== session.discord_id) return new Response('forbidden', { status: 403 });

    const content = await kv.get(`script:${id}`);
    return new Response(content || '', { status: 200, headers: { 'Content-Type': 'text/plain' } });
}
