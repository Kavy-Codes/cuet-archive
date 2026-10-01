const cfg = require('./config.cjs');

const SYS_SKIP = new Set([4, 6]);

async function fetchMessages(threadId) {
  let msgs = await cfg.api(`/channels/${threadId}/messages?limit=100`);
  while (msgs.length === 100) {
    const more = await cfg.api(`/channels/${threadId}/messages?limit=100&before=${msgs[msgs.length - 1].id}`);
    msgs = msgs.concat(more);
    if (more.length < 100) break;
  }
  msgs.reverse();
  const out = [];
  for (const m of msgs) {
    if (SYS_SKIP.has(m.type)) continue;
    const snap =
      (m.message_snapshots && m.message_snapshots[0] && m.message_snapshots[0].message) || null;
    let content = m.content || '';
    if (snap && snap.content) content = content ? content + '\n' + snap.content : snap.content;
    out.push({
      id: m.id,
      thread_id: threadId,
      type: m.type,
      timestamp: m.timestamp,
      edited: !!m.edited_timestamp,
      author: m.author
        ? {
            id: m.author.id,
            name: m.author.global_name || m.author.username,
            username: m.author.username,
          }
        : { id: '0', name: 'system', username: 'system' },
      content,
      embeds: [...(m.embeds || []), ...((snap && snap.embeds) || [])],
      attachments: [...(m.attachments || []), ...((snap && snap.attachments) || [])],
      reference: m.message_reference || null,
      forward: !!snap,
      reactions: (m.reactions || []).map((r) => ({
        name: r.emoji.name,
        id: r.emoji.id || null,
        count: r.count,
      })),
    });
  }
  return out;
}

async function fetchAll() {
  const forum = await cfg.api('/channels/' + cfg.FORUM_ID);
  const active = await cfg.api('/guilds/' + cfg.GUILD_ID + '/threads/active');
  let threads = active.threads.filter((t) => t.parent_id === cfg.FORUM_ID);
  for (const path of ['public', 'private']) {
    try {
      const a = await cfg.api(
        `/channels/${cfg.FORUM_ID}/threads/archived/${path}?limit=100`
      );
      threads = threads.concat(a.threads || []);
    } catch {}
  }
  const seen = new Set();
  threads = threads.filter((t) => !seen.has(t.id) && seen.add(t.id));
  threads.sort((a, b) => (a.id < b.id ? -1 : 1));

  const out = [];
  for (const t of threads) {
    const messages = await fetchMessages(t.id);
    out.push({ thread: t, messages });
    process.stdout.write(`  fetched "${t.name}" (${messages.length} msgs)\n`);
  }
  return { forum, threads: out };
}

module.exports = { fetchAll };
