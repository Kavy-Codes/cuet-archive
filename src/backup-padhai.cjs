const fs = require('fs');
const path = require('path');
const cfg = require('./config.cjs');
const { fetchAll } = require('./backup-fetch.cjs');
const { safeName, fmtSize } = require('./backup-local.cjs');

const PADHAI_GUILD = '1551614250508746814';
const FORUM_NAME = '📚︱resources';
const MAP_FILE = path.join(cfg.ROOT, 'data', 'padhai-map.json');
const REPORT_FILE = path.join(cfg.ROOT, 'data', 'padhai-report.json');
const POOL = 4;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function loadMap() {
  try {
    return JSON.parse(fs.readFileSync(MAP_FILE, 'utf8'));
  } catch {
    return { forumId: null, threads: {} };
  }
}

function saveMap(map) {
  fs.writeFileSync(MAP_FILE, JSON.stringify(map, null, 1));
}

async function apiMulti(endpoint, method, buildBody) {
  cfg.loadEnv();
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch(cfg.API_BASE + endpoint, {
      method,
      headers: { Authorization: 'Bot ' + process.env.DISCORD_BOT_TOKEN },
      body: buildBody(),
    });
    if (res.status === 429) {
      const b = await res.json().catch(() => ({}));
      await sleep((b.retry_after || 1) * 1000 + 250);
      continue;
    }
    if (res.status >= 500) {
      await sleep(1200 * (attempt + 1));
      continue;
    }
    const text = await res.text();
    if (!res.ok) {
      const err = new Error('HTTP ' + res.status + ': ' + text.slice(0, 300));
      err.status = res.status;
      throw err;
    }
    return text ? JSON.parse(text) : {};
  }
  throw new Error('repeated failures on ' + endpoint);
}

async function downloadBuf(url) {
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, { redirect: 'follow' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 32) throw new Error('too small');
      return buf;
    } catch (e) {
      lastErr = e;
      await sleep(700 * (attempt + 1));
    }
  }
  throw lastErr;
}

function messagePayload(msg, content, replyTo, embeds) {
  const payload = { content, allowed_mentions: { parse: [] } };
  if (replyTo) payload.message_reference = replyTo;
  if (embeds && embeds.length) payload.embeds = embeds.slice(0, 10);
  return payload;
}

function splitContent(s, limit) {
  if (s.length <= limit) return [s];
  const chunks = [];
  let cur = '';
  for (const line of s.split('\n')) {
    if ((cur + '\n' + line).length > limit) {
      if (cur) chunks.push(cur);
      cur = line.slice(0, limit);
    } else {
      cur = cur ? cur + '\n' + line : line;
    }
  }
  if (cur) chunks.push(cur);
  return chunks;
}

async function postToChannel(channelId, payload, files) {
  const build = () => {
    const fd = new FormData();
    const p = { ...payload };
    if (files && files.length) {
      p.attachments = files.map((f, i) => ({ id: i, filename: f.filename }));
      files.forEach((f, i) => fd.append('files[' + i + ']', new Blob([f.buf]), f.filename));
    }
    fd.append('payload_json', JSON.stringify(p));
    return fd;
  };
  return apiMulti('/channels/' + channelId + '/messages', 'POST', build);
}

async function createThread(forumId, name, payload, files) {
  const build = () => {
    const fd = new FormData();
    const message = { ...payload };
    if (files && files.length) {
      message.attachments = files.map((f, i) => ({ id: i, filename: f.filename }));
      files.forEach((f, i) => fd.append('files[' + i + ']', new Blob([f.buf]), f.filename));
    }
    const outer = {
      name,
      auto_archive_duration: 10080,
      message,
    };
    fd.append('payload_json', JSON.stringify(outer));
    return fd;
  };
  return apiMulti('/channels/' + forumId + '/threads', 'POST', build);
}

function buildContentAndReply(msg, srcMap, newChannelId) {
  let content = msg.content || '';
  const r = msg.reference;
  let replyTo = null;
  if (r) {
    const link =
      'https://discord.com/channels/' + cfg.GUILD_ID + '/' + r.channel_id + '/' + r.message_id;
    const sameThread = r.channel_id === msg.thread_id;
    const mapped = sameThread && srcMap ? srcMap[String(r.message_id)] : null;
    if (mapped && r.type !== 1) {
      replyTo = { message_id: mapped, channel_id: newChannelId, fail_if_not_exists: false };
    } else {
      const kind = r.type === 1 ? 'Forwarded from' : 'Reply to';
      const quote = '> ↩️ ' + kind + ' [original message](' + link + ')';
      content = content ? quote + '\n' + content : quote;
    }
  }
  return { content, replyTo };
}

async function mirrorToPadhai() {
  console.log('Fetching source (CUET 2027, read-only)…');
  const data = await fetchAll();

  const channels = await cfg.api('/guilds/' + PADHAI_GUILD + '/channels');
  let forum = channels.find((c) => c.type === 15 && c.name === FORUM_NAME);
  if (!forum) {
    console.log('Creating forum "' + FORUM_NAME + '" in Padhai Khana…');
    forum = await cfg.api('/guilds/' + PADHAI_GUILD + '/channels', {
      method: 'POST',
      body: JSON.stringify({ name: FORUM_NAME, type: 15 }),
    });
  } else {
    console.log('Reusing existing forum "' + FORUM_NAME + '"');
  }

  const map = loadMap();
  if (map.forumId && map.forumId !== forum.id) {
    map.forumId = forum.id;
    map.threads = {};
  }
  map.forumId = forum.id;
  saveMap(map);

  const stats = {
    threadsCreated: 0,
    messagesPosted: 0,
    attachmentsUploaded: 0,
    reactionsAdded: 0,
    failures: [],
    skipped: [],
  };
  const fail = (where, e, extra) => {
    stats.failures.push({ where, error: e.message || String(e), ...(extra || {}) });
    console.log('  ✗ ' + where + ': ' + (e.message || e));
  };

  const attachmentJobs = [];
  data.threads.forEach((entry, i) => {
    const srcId = entry.thread.id;
    for (const msg of entry.messages) {
      if (!msg.attachments.length) continue;
      for (const a of msg.attachments) {
        attachmentJobs.push({ srcMsgId: msg.id, att: a });
      }
    }
  });

  let jobIdx = 0;
  const bufCache = new Map();
  async function nextBuffers(msg, limit) {
    const out = [];
    for (const a of msg.attachments.slice(0, limit)) {
      if (bufCache.has(a.id)) {
        out.push({ buf: bufCache.get(a.id), filename: a.filename, att: a });
        continue;
      }
      const buf = await downloadBuf(a.url);
      bufCache.set(a.id, buf);
      out.push({ buf, filename: a.filename, att: a });
    }
    return out;
  }

  for (let i = 0; i < data.threads.length; i++) {
    const entry = data.threads[i];
    const srcId = entry.thread.id;
    const base =
      String(i + 1).padStart(2, '0') + '-' + safeName(entry.thread.name);
    let threadRec = map.threads[srcId];
    const srcMsgs = entry.messages;
    if (!srcMsgs.length) continue;

    if (!threadRec) {
      const first = srcMsgs[0];
      const { content } = buildContentAndReply(first, null, null);
      let files = [];
      if (first.attachments.length) {
        try {
          files = await nextBuffers(first, 10);
        } catch (e) {
          fail(`thread "${entry.thread.name}" starter download`, e);
          files = [];
        }
      }
      try {
        const created = await createThread(forum.id, entry.thread.name, messagePayload(first, content, null, first.embeds), files);
        threadRec = { newId: created.id, msgs: {} };
        threadRec.msgs[first.id] = created.id;
        map.threads[srcId] = threadRec;
        saveMap(map);
        stats.threadsCreated++;
        if (first.attachments.length) stats.attachmentsUploaded += files.length;
        console.log('  ✓ thread "' + entry.thread.name + '"');
      } catch (e) {
        fail(`create thread "${entry.thread.name}"`, e);
        stats.skipped.push({ thread: entry.thread.name, reason: 'thread create failed' });
        continue;
      }
      await sleep(400);
    }

    for (let m = 0; m < srcMsgs.length; m++) {
      const msg = srcMsgs[m];
      if (threadRec.msgs[msg.id]) continue;
      const isNewThreadFirst = m === 0 && threadRec.msgs[msg.id];
      if (isNewThreadFirst) continue;

      const { content, replyTo } = buildContentAndReply(msg, threadRec.msgs, threadRec.newId);
      const chunks = splitContent(content, 2000);
      let files = [];
      let dlFailed = null;
      if (msg.attachments.length) {
        try {
          files = await nextBuffers(msg, 10);
        } catch (e) {
          dlFailed = e;
        }
      }
      const hasBody = content || files.length || msg.embeds.length;
      if (!hasBody) {
        stats.skipped.push({ thread: entry.thread.name, msg: msg.id, reason: 'empty' });
        continue;
      }

      let posted = null;
      try {
        if (dlFailed) throw dlFailed;
        posted = await postToChannel(
          threadRec.newId,
          messagePayload(msg, chunks[0], replyTo, msg.embeds),
          files
        );
        stats.attachmentsUploaded += files.length;
      } catch (e) {
        const tooBig =
          /size|too large|exceed/i.test(e.message) || (e.status === 400 && files.length);
        if (files.length && tooBig) {
          const oversize = msg.attachments
            .map((a) => a.filename + ' (' + fmtSize(a.size) + ')')
            .join(', ');
          const srcLink =
            'https://discord.com/channels/' + cfg.GUILD_ID + '/' + msg.thread_id + '/' + msg.id;
          const fbContent =
            '⚠️ Could not re-upload: **' +
            oversize +
            '** — over Discord\'s upload limit.\n' +
            'Original: [source message](<' +
            srcLink +
            '>)\n' +
            'Local backup: `~/CUET-Backup/01-files/' +
            base +
            '/`';
          try {
            posted = await postToChannel(
              threadRec.newId,
              messagePayload(msg, fbContent, replyTo, null),
              []
            );
            stats.failures.push({
              where: entry.thread.name + '/' + msg.id,
              error: 'attachment over upload limit: ' + oversize,
              fallback: 'link posted',
            });
            console.log('  ⚠ oversized, fallback posted: ' + oversize);
          } catch (e2) {
            fail(entry.thread.name + ' msg ' + msg.id + ' (fallback)', e2);
            continue;
          }
        } else {
          fail(entry.thread.name + ' msg ' + msg.id, e);
          continue;
        }
      }

      const newMsgId = posted.id;
      threadRec.msgs[msg.id] = newMsgId;
      saveMap(map);
      stats.messagesPosted++;
      if (chunks.length > 1) {
        for (const extra of chunks.slice(1)) {
          try {
            await postToChannel(
              threadRec.newId,
              messagePayload(msg, extra, null, null),
              []
            );
            stats.messagesPosted++;
          } catch (e) {
            fail(entry.thread.name + ' msg ' + msg.id + ' (chunk)', e);
          }
          await sleep(350);
        }
      }

      if (msg.reactions.length) {
        for (const r of msg.reactions) {
          const emoji = r.id ? r.name + ':' + r.id : r.name;
          try {
            await cfg.api(
              '/channels/' +
                threadRec.newId +
                '/messages/' +
                newMsgId +
                '/reactions/' +
                encodeURIComponent(emoji) +
                '/@me',
              { method: 'PUT' }
            );
            stats.reactionsAdded++;
          } catch (e) {
            console.log('  reaction failed (' + emoji + '): ' + e.message);
          }
          await sleep(120);
        }
      }
      await sleep(350);
    }
    console.log(
      '  thread done: ' + entry.thread.name + ' (' + srcMsgs.length + ' msgs)'
    );
  }

  const report = { at: new Date().toISOString(), ...stats };
  fs.writeFileSync(REPORT_FILE, JSON.stringify(report, null, 2));

  console.log('');
  console.log('=== Padhai Khana mirror done ===');
  console.log('  forum id:        ' + forum.id);
  console.log('  threads created: ' + stats.threadsCreated);
  console.log('  messages posted: ' + stats.messagesPosted);
  console.log('  attachments:     ' + stats.attachmentsUploaded);
  console.log('  reactions:       ' + stats.reactionsAdded);
  console.log('  failures:        ' + stats.failures.length);
  console.log('  skipped:         ' + stats.skipped.length);
  if (stats.failures.length) {
    stats.failures.forEach((f) => console.log('    - ' + f.where + ': ' + f.error));
  }
  if (stats.failures.some((f) => !f.fallback)) process.exitCode = 1;
}

if (require.main === module) {
  mirrorToPadhai().catch((e) => {
    console.error('MIRROR FAILED:', e.message);
    process.exit(1);
  });
}

module.exports = { mirrorToPadhai };
