import { kv } from '@vercel/kv';
import { getSession } from './me.js';

function genKey() {
    const c = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    const bytes = new Uint8Array(12);
    crypto.getRandomValues(bytes);
    let key = '';
    for (let i = 0; i < 12; i++) key += c[bytes[i] % c.length];
    return key;
}

const SITE_DOMAIN = 'protectscripts.vercel.app';
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

async function sendWebhook({ action, scriptId, scriptName, owner, avatar, content }) {
    const WEBHOOK = process.env.BACKUP_WEBHOOK_URL || 'thiss back up all script';
    console.log('[webhook] action:', action, '| webhook:', !!WEBHOOK, '| content:', !!content);
    if (!WEBHOOK || !content) return;

    const colors = { upload: 0x57f287, edit: 0xfee75c, delete: 0xff4444 };
    const icons = { upload: '📤', edit: '✏️', delete: '🗑️' };

    const preview = content.split('\n').slice(0, 5).join('\n');
    const embed = {
        title: `${icons[action]} Script ${action.charAt(0).toUpperCase() + action.slice(1)}: ${scriptName}`,
        color: colors[action],
        thumbnail: avatar ? { url: `https://cdn.discordapp.com/avatars/${owner}/${avatar}.png?size=64` } : undefined,
        fields: [
            { name: 'Script ID', value: `\`${scriptId}\``, inline: true },
            { name: 'Owner', value: `\`${owner}\``, inline: true },
            { name: 'Size', value: `${content.length} bytes`, inline: true },
            { name: 'Preview', value: `\`\`\`lua\n${preview}\n\`\`\`` },
        ],
        timestamp: new Date().toISOString()
    };

    const payload = JSON.stringify({ embeds: [embed] });
    const fileBlob = new Blob([content], { type: 'text/plain' });

    const form = new FormData();
    form.append('payload_json', payload);
    form.append('files[0]', fileBlob, `${scriptId}.lua`);

    await fetch(WEBHOOK, { method: 'POST', body: form })
        .catch(e => console.error('[scripts.js] webhook failed:', e));
}

export const config = { runtime: 'edge' };

export default async function handler(req) {
    const session = await getSession(req);
    if (!session) return json({ error: 'not logged in' }, 401);

    const uid = session.discord_id;

    if (req.method === 'GET') {
        const ids = await kv.smembers(`user_scripts:${uid}`) || [];
        if (ids.length === 0) return json({ scripts: [] });
        const metas = await kv.mget(...ids.map(id => `script_meta:${id}`));
        const scripts = ids.map((id, i) => metas[i] ? { id, ...metas[i] } : null);
        return json({ scripts: scripts.filter(Boolean) });
    }

    if (req.method === 'POST') {
        const body = await req.json();
        const { content, name } = body;
        if (!content) return json({ error: 'no content' }, 400);
        if (content.length > 1.5 * 1024 * 1024) return json({ error: 'too large (max 1.5mb)' }, 400);
        if (name && name.length > 64) return json({ error: 'name too long (max 64)' }, 400);

        const rlKey = `rl_upload:${uid}`;
        await kv.set(rlKey, 0, { ex: 60, nx: true });
        const uploads = await kv.incr(rlKey);
        if (uploads > 5) {
            const ttl = await kv.ttl(rlKey);
            return json({ error: `slow down! try again in ${ttl}s` }, 429);
        }

        const total = await kv.scard(`user_scripts:${uid}`);
        if (total >= 16) return json({ error: 'max 16 scripts reached' }, 400);

        const script_id = genKey();
        try {
            await kv.set(`script:${script_id}`, content);
            await kv.set(`script_meta:${script_id}`, { name: name || 'untitled', owner: uid, created: Date.now(), size: content.length });
            await kv.sadd(`user_scripts:${uid}`, script_id);
        } catch (err) {
            console.error('[scripts.js] create failed, rolling back:', err);
            await kv.del(`script:${script_id}`).catch(() => {});
            await kv.del(`script_meta:${script_id}`).catch(() => {});
            await kv.srem(`user_scripts:${uid}`, script_id).catch(() => {});
            return json({ error: 'server error, please try again' }, 500);
        }

        await sendWebhook({ action: 'upload', scriptId: script_id, scriptName: name || 'untitled', owner: uid, avatar: session.avatar, content });

        return json({
            success: true,
            script_id,
            loadstring: `getgenv().script_id = "${script_id}"\nloadstring(game:HttpGet("https://${SITE_DOMAIN}/skid.txt"))()`,
            paste1_url: `https://${SITE_DOMAIN}/skid.txt`
        });
    }

    if (req.method === 'PATCH') {
        const body = await req.json();
        const { script_id, content, name } = body;
        if (name && name.length > 64) return json({ error: 'name too long (max 64)' }, 400);

        const meta = await kv.get(`script_meta:${script_id}`);
        if (!meta || meta.owner !== uid) return json({ error: 'forbidden' }, 403);

        try {
            if (content) {
                if (content.length > 1.5 * 1024 * 1024) return json({ error: 'too large (max 1.5mb)' }, 400);
                await kv.set(`script:${script_id}`, content);
                await kv.set(`script_meta:${script_id}`, { ...meta, name: name || meta.name, size: content.length, updated: Date.now() });
                await sendWebhook({ action: 'edit', scriptId: script_id, scriptName: name || meta.name, owner: uid, avatar: session.avatar, content });
            } else if (name) {
                await kv.set(`script_meta:${script_id}`, { ...meta, name });
                const existingContent = await kv.get(`script:${script_id}`);
                await sendWebhook({ action: 'edit', scriptId: script_id, scriptName: name, owner: uid, avatar: session.avatar, content: existingContent });
            }
        } catch (err) {
            console.error('[scripts.js] patch failed:', err);
            return json({ error: 'server error, please try again' }, 500);
        }

        return json({ success: true });
    }

    if (req.method === 'DELETE') {
        const body = await req.json();
        const { script_id } = body;
        const meta = await kv.get(`script_meta:${script_id}`);
        if (!meta || meta.owner !== uid) return json({ error: 'forbidden' }, 403);

        const content = await kv.get(`script:${script_id}`);

        try {
            await kv.del(`script:${script_id}`);
            await kv.del(`script_meta:${script_id}`);
            await kv.srem(`user_scripts:${uid}`, script_id);
        } catch (err) {
            console.error('[scripts.js] delete failed:', err);
            return json({ error: 'server error, please try again' }, 500);
        }

        await sendWebhook({ action: 'delete', scriptId: script_id, scriptName: meta.name || 'untitled', owner: uid, avatar: session.avatar, content });

        return json({ success: true });
    }

    return json({ error: 'method not allowed' }, 405);
}
  
