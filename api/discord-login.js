import { kv } from '@vercel/kv';

export const config = { runtime: 'edge' };

export default async function handler(req) {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    const state = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
    await kv.set(`oauth_state:${state}`, 1, { ex: 300 });

    const params = new URLSearchParams({
        client_id: '1368970470824870033',
        redirect_uri: 'https://protectscripts.vercel.app/api/discord-callback',
        response_type: 'code',
        scope: 'identify',
        state
    });

    return new Response(null, {
        status: 302,
        headers: { 'Location': `https://discord.com/api/oauth2/authorize?${params}` }
    });
}
