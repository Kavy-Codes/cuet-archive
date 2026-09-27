const fs = require('fs');
const path = require('path');
const cfg = require('./config.cjs');
const { parseMessage } = require('./parse.cjs');

const EMOJI_RE = /^((?:\p{Regional_Indicator}{2}|\p{Extended_Pictographic}[\uFE0F\u20E3]?(?:\u200D\p{Extended_Pictographic}[\uFE0F\u20E3]?)*))\s*/u;

function splitName(name) {
  const m = name.match(EMOJI_RE);
  if (m && m[1] && name.slice(m[0].length).trim()) {
    return { emoji: m[1], title: name.slice(m[0].length).trim() };
  }
  return { emoji: '', title: name };
}

function slugify(title, used) {
  let slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  if (!slug) slug = 'topic';
  let candidate = slug;
  let n = 2;
  while (used.has(candidate)) candidate = `${slug}-${n++}`;
  used.add(candidate);
  return candidate;
}

async function fetchRolesAndChannels() {
  const roles = new Map();
  const roleList = await cfg.api(`/guilds/${cfg.GUILD_ID}/roles`);
  for (const r of roleList) roles.set(r.id, r.name);

  const channels = new Map();
  const chList = await cfg.api(`/guilds/${cfg.GUILD_ID}/channels`);
  for (const c of chList) channels.set(c.id, c.name);

  return { roles, channels };
}

async function fetchForumThreads() {
  const threads = [];
  const active = await cfg.api(`/guilds/${cfg.GUILD_ID}/threads/active`);
  threads.push(...(active.threads || []).filter((t) => t.parent_id === cfg.FORUM_ID));

  let before = null;
  for (let i = 0; i < 10; i++) {
    const q = before ? `?limit=100&before=${before}` : '?limit=100';
    const batch = await cfg.api(`/channels/${cfg.FORUM_ID}/threads/archived/public${q}`);
    const items = batch.threads || [];
    threads.push(...items);
    if (!batch.has_more || !items.length) break;
    before = items[items.length - 1].archive_timestamp;
  }

  const seen = new Set();
  return threads.filter((t) => {
    if (cfg.EXCLUDE_THREAD_IDS.includes(t.id)) return false;
    if (seen.has(t.id)) return false;
    seen.add(t.id);
    return true;
  });
}

async function fetchThreadMessages(threadId) {
  const msgs = [];
  let before = null;
  for (let page = 0; page < 10; page++) {
    const q = before ? `?limit=100&before=${before}` : '?limit=100';
    const batch = await cfg.api(`/channels/${threadId}/messages${q}`);
    if (!batch.length) break;
    msgs.push(...batch);
    if (batch.length < 100) break;
    before = batch[batch.length - 1].id;
    await new Promise((r) => setTimeout(r, 120));
  }
  return msgs.reverse();
}

function keepMessage(parsed, msg, thread) {
  if (parsed.hasResources) return true;
  if (msg.author.id !== thread.owner_id) return false;
  return parsed.hasHeading || parsed.chars >= 20;
}

async function extract() {
  cfg.loadEnv();
  console.log('Fetching roles and channels...');
  const ctx = await fetchRolesAndChannels();
  console.log(`  ${ctx.roles.size} roles, ${ctx.channels.size} channels`);

  console.log('Fetching forum threads...');
  const threads = await fetchForumThreads();
  console.log(`  ${threads.length} threads to mirror`);

  const usedSlugs = new Set();
  const topics = [];
  let totalKept = 0;
  let totalSeen = 0;
  let totalLinks = 0;

  for (const thread of threads.sort((a, b) => a.id - b.id)) {
    const raw = await fetchThreadMessages(thread.id);
    totalSeen += raw.length;

    const messages = [];
    const tagSet = new Set();
    for (const msg of raw) {
      const parsed = parseMessage(msg, ctx);
      if (!keepMessage(parsed, msg, thread)) continue;
      messages.push({
        id: msg.id,
        author: msg.author.username,
        isOP: msg.author.id === thread.owner_id,
        timestamp: msg.timestamp,
        messageUrl: `https://discord.com/channels/${cfg.GUILD_ID}/${thread.id}/${msg.id}`,
        blocks: parsed.blocks,
        tags: parsed.tags,
      });
      parsed.tags.forEach((t) => tagSet.add(t));
    }

    const { emoji, title } = splitName(thread.name || 'Untitled');
    const slug = slugify(title, usedSlugs);
    const links = [];

    for (const m of messages) {
      for (const b of m.blocks) {
        if (b.type === 'link') {
          links.push({
            url: b.url,
            domain: b.domain,
            title: b.embedTitle || b.context || b.domain,
            topic: title,
            slug,
            source: 'message',
          });
        } else if (b.type === 'attachment') {
          links.push({
            url: b.url,
            domain: 'cdn.discordapp.com',
            title: b.filename,
            topic: title,
            slug,
            source: 'attachment',
          });
        }
      }
    }

    totalKept += messages.length;
    totalLinks += links.length;

    topics.push({
      id: thread.id,
      name: title,
      emoji,
      slug,
      messageCount: messages.length,
      totalMessages: raw.length,
      tags: [...tagSet],
      url: `https://discord.com/channels/${cfg.GUILD_ID}/${thread.id}`,
      createdAt: thread.thread_metadata && thread.thread_metadata.create_time,
      messages,
      links,
    });

    console.log(`  [${messages.length}/${raw.length} msgs, ${links.length} links] ${emoji} ${title}`);
    await new Promise((r) => setTimeout(r, 120));
  }

  topics.sort((a, b) => b.links.length - a.links.length);

  const data = {
    version: 1,
    generatedAt: new Date().toISOString(),
    source: {
      guildId: cfg.GUILD_ID,
      guildName: cfg.GUILD_NAME,
      forumId: cfg.FORUM_ID,
      forumName: cfg.FORUM_NAME,
      forumUrl: `https://discord.com/channels/${cfg.GUILD_ID}/${cfg.FORUM_ID}`,
    },
    stats: {
      topics: topics.length,
      messages: totalKept,
      messagesSeen: totalSeen,
      links: totalLinks,
    },
    topics,
  };

  fs.mkdirSync(path.dirname(cfg.DATA_FILE), { recursive: true });
  fs.writeFileSync(cfg.DATA_FILE, JSON.stringify(data, null, 2));
  console.log(`\nWrote ${path.relative(cfg.ROOT, cfg.DATA_FILE)}`);
  console.log(`  topics: ${topics.length}, messages kept: ${totalKept}/${totalSeen}, links: ${totalLinks}`);
  return data;
}

if (require.main === module) {
  extract().catch((e) => {
    console.error('EXTRACT FAILED:', e.message);
    process.exit(1);
  });
}

module.exports = { extract };
