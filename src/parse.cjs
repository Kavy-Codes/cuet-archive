const URL_TOKEN = /https?:\/\/[^\s<>]+/g;
const MENTION_TOKEN = /<@&(\d+)>|<@!(\d+)>|<@(\d+)>|<#(\d+)>/g;

function cleanUrl(raw) {
  let u = raw.replace(/[.,;:!?'"\u201d\u2019]+$/, '');
  const count = (s, c) => s.split(c).length - 1;
  while (u.endsWith(')') && count(u, '(') < count(u, ')')) u = u.slice(0, -1);
  while (u.endsWith(']') && count(u, '[') < count(u, ']')) u = u.slice(0, -1);
  return u;
}

function domainOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

function plain(md) {
  return String(md || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/~~([^~]+)~~/g, '$1')
    .replace(/\|\|([^|]+)\|\|/g, '$1')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 $2')
    .replace(/[*_~`>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanAttachmentUrl(url) {
  try {
    const u = new URL(url);
    u.search = '';
    return u.toString();
  } catch {
    return url;
  }
}

function tokenizeLine(line, ctx) {
  const tokens = [];
  const re = new RegExp(MENTION_TOKEN.source + '|' + URL_TOKEN.source, 'g');
  let last = 0;
  let m;
  while ((m = re.exec(line)) !== null) {
    if (m.index > last) tokens.push({ kind: 'text', text: line.slice(last, m.index) });
    if (m[1]) {
      const name = ctx.roles.get(m[1]);
      if (name) tokens.push({ kind: 'role', name });
      else tokens.push({ kind: 'text', text: '' });
    } else if (m[2] || m[3]) {
      tokens.push({ kind: 'user' });
    } else if (m[4]) {
      const name = ctx.channels.get(m[4]);
      tokens.push({ kind: 'channel', name: name || null });
    } else if (m[0]) {
      tokens.push({ kind: 'url', url: cleanUrl(m[0]) });
    }
    last = re.lastIndex;
  }
  if (last < line.length) tokens.push({ kind: 'text', text: line.slice(last) });
  return tokens;
}

function normalizeMessage(msg) {
  const snap = msg.message_snapshots && msg.message_snapshots[0] && msg.message_snapshots[0].message;
  if (!snap) return msg;
  return {
    ...msg,
    content: snap.content || msg.content || '',
    attachments: snap.attachments && snap.attachments.length ? snap.attachments : msg.attachments || [],
    embeds: snap.embeds && snap.embeds.length ? snap.embeds : msg.embeds || [],
    forwarded: true,
  };
}

function parseMessage(rawMsg, ctx) {
  const msg = normalizeMessage(rawMsg);
  const blocks = [];
  const tags = [];
  const contentUrls = new Set();
  const content = msg.content || '';
  const lines = content.split('\n');

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      const level = Math.min(heading[1].length, 3);
      const inner = heading[2];
      const found = inner.match(new RegExp(URL_TOKEN.source, 'g'));
      if (found) {
        const stripped = plain(inner.replace(new RegExp(URL_TOKEN.source, 'g'), '')).trim();
        if (stripped) blocks.push({ type: 'heading', level, text: stripped });
        for (const raw of found) {
          const url = cleanUrl(raw);
          contentUrls.add(url);
          blocks.push({ type: 'link', url, domain: domainOf(url), context: stripped, pendingContext: false });
        }
      } else {
        blocks.push({ type: 'heading', level, text: plain(inner) });
      }
      continue;
    }

    const tokens = tokenizeLine(line, ctx);
    let buffer = [];

    const flush = () => {
      const text = buffer.map((t) => t.text).join('');
      if (text.replace(/\s/g, '').length) {
        blocks.push({ type: 'flow', items: buffer.slice() });
      }
      buffer = [];
    };

    for (const tok of tokens) {
      if (tok.kind === 'url') {
        flush();
        contentUrls.add(tok.url);
        blocks.push({
          type: 'link',
          url: tok.url,
          domain: domainOf(tok.url),
          context: '',
          pendingContext: true,
        });
      } else if (tok.kind === 'role') {
        if (!tags.includes(tok.name.toLowerCase())) tags.push(tok.name.toLowerCase());
        buffer.push({ kind: 'role', name: tok.name });
      } else if (tok.kind === 'user') {
        buffer.push({ kind: 'text', text: ' @user ' });
      } else if (tok.kind === 'channel') {
        buffer.push({ kind: 'channel', name: tok.name });
      } else {
        buffer.push({ kind: 'text', text: tok.text });
      }
    }
    flush();
  }

  for (const block of blocks) {
    if (block.type === 'link' && block.pendingContext) {
      delete block.pendingContext;
      const idx = blocks.indexOf(block);
      for (let i = idx - 1; i >= 0; i--) {
        const b = blocks[i];
        if (b.type === 'flow') {
          const text = plain(b.items.map((t) => t.text || '').join(''));
          if (text) {
            block.context = text;
            break;
          }
        }
        if (b.type === 'heading') {
          if (b.text) block.context = b.text;
          break;
        }
        if (b.type === 'link') break;
      }
    }
  }

  for (const att of msg.attachments || []) {
    blocks.push({
      type: 'attachment',
      filename: att.filename,
      url: att.url,
      size: att.size || 0,
      context: '',
    });
  }

  for (const emb of msg.embeds || []) {
    const url = emb.url || (emb.video && emb.video.url);
    if (!url || !/^https?:\/\//.test(url)) continue;
    const cleaned = cleanUrl(url);
    if (contentUrls.has(cleaned)) {
      const link = blocks.find((b) => b.type === 'link' && b.url === cleaned);
      if (link) {
        if (!link.embedTitle && emb.title) link.embedTitle = plain(emb.title).slice(0, 200);
        if (!link.embedDesc && emb.description) link.embedDesc = plain(emb.description).slice(0, 240);
      }
      continue;
    }
    contentUrls.add(cleaned);
    blocks.push({
      type: 'link',
      url: cleaned,
      domain: domainOf(cleaned),
      context: plain(emb.description || '').slice(0, 240),
      embedTitle: plain(emb.title || '').slice(0, 200),
      embedDesc: plain(emb.description || '').slice(0, 240),
    });
  }

  const hasHeading = blocks.some((b) => b.type === 'heading');
  const hasResources = blocks.some((b) => b.type === 'link' || b.type === 'attachment');
  const chars = content.replace(/\s/g, '').length;

  return { blocks, tags, hasHeading, hasResources, chars };
}

module.exports = { parseMessage, plain, domainOf, cleanUrl, cleanAttachmentUrl };
