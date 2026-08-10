import { kv } from '@vercel/kv';

const CLIENT_ID = '1368970470824870033';
const CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET;
const REDIRECT_URI = 'https://protectscripts.vercel.app/api/discord-callback';

export const config = { runtime: 'edge' };

const redirect = (path) => new Response(null, { status: 302, headers: { 'Location': path } });

export default async function handler(req) {
    const { searchParams } = new URL(req.url);
    const code = searchParams.get('code');
    const state = searchParams.get('state');

    if (!code) return redirect('/?error=no_code');
    if (!state) return redirect('/?error=no_state');

    const validState = await kv.getdel(`oauth_state:${state}`);
    if (!validState) return redirect('/?error=invalid_state');

    const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, grant_type: 'authorization_code', code, redirect_uri: REDIRECT_URI })
    });
    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) return redirect('/?error=token_failed');

    const userRes = await fetch('https://discord.com/api/users/@me', {
        headers: { Authorization: `Bearer ${tokenData.access_token}` }
    });
    const user = await userRes.json();
    if (!user.id) return redirect('/?error=user_failed');

    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    const sessionToken = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
    await kv.set(`session:${sessionToken}`, { discord_id: user.id, username: user.username, avatar: user.avatar }, { ex: 60 * 60 * 24 * 7 });

    return new Response(null, {
        status: 302,
        headers: {
            'Location': '/dashboard.html',
            'Set-Cookie': `session=${sessionToken}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${60 * 60 * 24 * 7}`
        }
    });
                 }
