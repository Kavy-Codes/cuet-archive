const fs = require('fs');
const path = require('path');
const cfg = require('./config.cjs');
const { fetchAll } = require('./backup-fetch.cjs');

const MAP_FILE = path.join(cfg.ROOT, 'data', 'padhai-map.json');
const REPORT_FILE = path.join(cfg.ROOT, 'data', 'padhai-fixup-report.json');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function loadMap() {
  return JSON.parse(fs.readFileSync(MAP_FILE, 'utf8'));
}
function saveMap(m) {
  fs.writeFileSync(MAP_FILE, JSON.stringify(m, null, 1));
}

async function getChannelMessages(channelId) {
  let msgs = await cfg.api(`/channels/${channelId}/messages?limit=100`);
  while (msgs.length === 100) {
    const more = await cfg.api(
      `/channels/${channelId}/messages?limit=100&before=${msgs[msgs.length - 1].id}`
    );
    msgs = msgs.concat(more);
    if (more.length < 100) break;
  }
  return msgs;
}

async function downloadBuf(url) {
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, { redirect: 'follow' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 16) throw new Error('too small');
      return buf;
    } catch (e) {
      lastErr = e;
      await sleep(600 * (attempt + 1));
    }
  }
  throw lastErr;
}

async function postFiles(channelId, content, files) {
  cfg.loadEnv();
  const build = () => {
    const fd = new FormData();
    const payload = {
      content,
      allowed_mentions: { parse: [] },
      attachments: files.map((f, i) => ({ id: i, filename: f.filename })),
    };
    files.forEach((f, i) => fd.append('files[' + i + ']', new Blob([f.buf]), f.filename));
    fd.append('payload_json', JSON.stringify(payload));
    return fd;
  };
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch(cfg.API_BASE + '/channels/' + channelId + '/messages', {
      method: 'POST',
      headers: { Authorization: 'Bot ' + process.env.DISCORD_BOT_TOKEN },
      body: build(),
    });
    if (res.status === 429) {
      const b = await res.json().catch(() => ({}));
      await sleep((b.retry_after || 1) * 1000 + 250);
      continue;
    }
    const text = await res.text();
    if (!res.ok) {
      const err = new Error('HTTP ' + res.status + ': ' + text.slice(0, 200));
      err.status = res.status;
      throw err;
    }
    return JSON.parse(text);
  }
  throw new Error('repeated failures posting files');
}

function fmtSize(bytes) {
  if (bytes < 1048576) return (bytes / 1024).toFixed(0) + ' KB';
  return (bytes / 1048576).toFixed(1) + ' MB';
}

async function verify(data, map) {
  const out = {
    threadsOk: 0,
    threadsMissing: [],
    messagesExpected: 0,
    messagesMapped: 0,
    messagesMissing: [],
    filesExpected: 0,
    filesInMirror: 0,
    filesMissing: [],
    reactionsMissing: [],
    contentIssues: [],
  };

  for (const entry of data.threads) {
    const trec = map.threads[entry.thread.id];
    if (!trec) {
      out.threadsMissing.push(entry.thread.name);
      continue;
    }
    let mirrorMsgs;
    try {
      mirrorMsgs = await getChannelMessages(trec.newId);
    } catch (e) {
      out.threadsMissing.push(entry.thread.name + ' (' + e.message + ')');
      continue;
    }
    out.threadsOk++;
    const byNewId = new Map(mirrorMsgs.map((m) => [m.id, m]));

    const mirrorFiles = new Map();
    for (const m of mirrorMsgs) {
      for (const a of m.attachments || []) {
        mirrorFiles.set(a.filename, (mirrorFiles.get(a.filename) || 0) + 1);
      }
    }

    for (const src of entry.messages) {
      out.messagesExpected++;
      const newId = trec.msgs[src.id];
      if (!newId) {
        out.messagesMissing.push(entry.thread.name + ' / ' + src.id);
        continue;
      }
      out.messagesMapped++;
      const mm = byNewId.get(newId);
      if (!mm) {
        out.messagesMissing.push(entry.thread.name + ' / ' + src.id + ' (map stale)');
        continue;
      }
      for (const a of src.attachments) {
        out.filesExpected++;
        const have = mirrorFiles.get(a.filename) || 0;
        if (have > 0) {
          mirrorFiles.set(a.filename, have - 1);
          out.filesInMirror++;
        } else {
          out.filesMissing.push({
            channelId: trec.newId,
            thread: entry.thread.name,
            msgId: src.id,
            newId,
            filename: a.filename,
            size: a.size,
            url: a.url,
          });
        }
      }
      if (src.reactions.length) {
        const have = new Set(
          (mm.reactions || []).map((r) =>
            r.emoji.id ? r.emoji.name + ':' + r.emoji.id : r.emoji.name
          )
        );
        for (const r of src.reactions) {
          const key = r.id ? r.name + ':' + r.id : r.name;
          if (!have.has(key)) {
            out.reactionsMissing.push({ channelId: trec.newId, msgId: newId, emoji: key });
          }
        }
      }
      if (src.content && !mm.content) {
        out.contentIssues.push(entry.thread.name + ' / ' + src.id);
      }
    }
  }
  return out;
}

async function fixup() {
  console.log('Fetching source fresh…');
  const data = await fetchAll();
  const map = loadMap();

  console.log('Verifying mirror…');
  const before = await verify(data, map);

  console.log('');
  console.log('--- verification (before fix) ---');
  console.log('  threads ok:        ' + (data.threads.length - before.threadsMissing.length) + '/' + data.threads.length);
  console.log('  messages mapped:   ' + before.messagesMapped + '/' + before.messagesExpected);
  console.log('  files in mirror:   ' + before.filesInMirror + '/' + before.filesExpected);
  console.log('  reactions missing: ' + before.reactionsMissing.length);
  console.log('  content issues:    ' + before.contentIssues.length);
  if (before.threadsMissing.length) console.log('  missing threads: ' + JSON.stringify(before.threadsMissing));
  if (before.messagesMissing.length) console.log('  missing msgs: ' + JSON.stringify(before.messagesMissing.slice(0, 5)));

  const fixed = { reactionsAdded: 0, filesUploaded: [], filesStillFailing: [], fallbacksEdited: 0 };

  if (before.reactionsMissing.length) {
    console.log('\nRe-adding ' + before.reactionsMissing.length + ' reactions…');
    for (const r of before.reactionsMissing) {
      try {
        await cfg.api(
          '/channels/' +
            r.channelId +
            '/messages/' +
            r.msgId +
            '/reactions/' +
            encodeURIComponent(r.emoji) +
            '/@me',
          { method: 'PUT' }
        );
        fixed.reactionsAdded++;
      } catch (e) {
        console.log('  reaction failed ' + r.emoji + ': ' + e.message);
      }
      await sleep(150);
    }
  }

  if (before.filesMissing.length) {
    console.log('\nRetrying ' + before.filesMissing.length + ' missing files individually…');
    for (const f of before.filesMissing) {
      try {
        const buf = await downloadBuf(f.url);
        await postFiles(
          f.channelId,
          '📎 **' + f.filename + '** (' + fmtSize(f.size) + ') — re-uploaded separately (was over the combined per-message limit)',
          [{ buf, filename: f.filename }]
        );
        fixed.filesUploaded.push({ file: f.filename, msgId: f.msgId });
        console.log('  ✓ ' + f.filename);
      } catch (e) {
        fixed.filesStillFailing.push({ ...f, error: e.message, url: undefined });
        console.log('  ✗ ' + f.filename + ': ' + e.message);
      }
      await sleep(500);
    }
  }

  const fallbackTargets = [];
  for (const entry of data.threads) {
    const trec = map.threads[entry.thread.id];
    if (!trec) continue;
    let mirrorMsgs;
    try {
      mirrorMsgs = await getChannelMessages(trec.newId);
    } catch {
      continue;
    }
    for (const mm of mirrorMsgs) {
      if (!(mm.content || '').startsWith('⚠️ Could not re-upload')) continue;
      const srcMsgId = Object.keys(trec.msgs).find((k) => trec.msgs[k] === mm.id);
      const srcMsg = entry.messages.find((m) => m.id === srcMsgId);
      if (srcMsg) fallbackTargets.push({ mm, srcMsg, entry });
    }
  }

  if (fallbackTargets.length) {
    console.log('\nCorrecting ' + fallbackTargets.length + ' fallback messages…');
    for (const { mm, srcMsg, entry } of fallbackTargets) {
      const failing = fixed.filesStillFailing.filter((f) => f.msgId === srcMsg.id);
      const sourceLink =
        'https://discord.com/channels/' + cfg.GUILD_ID + '/' + entry.thread.id + '/' + srcMsg.id;
      let newContent;
      if (failing.length === 0) {
        newContent =
          '✅ All files from this post were re-uploaded separately (see messages above).\n' +
          'Original: [source message](<' + sourceLink + '>)\n' +
          'Local backup: `~/CUET-Backup/01-files/`';
      } else {
        newContent =
          '⚠️ Could not re-upload (over Discord\'s upload limit):\n' +
          failing.map((a) => '- ' + a.filename + ' (' + fmtSize(a.size) + ')').join('\n') +
          '\nOriginal: [source message](<' + sourceLink + '>)\n' +
          'Local backup: `~/CUET-Backup/01-files/`';
      }
      if (newContent !== mm.content) {
        try {
          await cfg.api('/channels/' + mm.channel_id + '/messages/' + mm.id, {
            method: 'PATCH',
            body: JSON.stringify({ content: newContent }),
          });
          fixed.fallbacksEdited++;
        } catch (e) {
          console.log('  edit failed: ' + e.message);
        }
        await sleep(300);
      }
    }
  }

  console.log('\nRe-verifying…');
  const after = await verify(data, map);
  console.log('--- verification (after fix) ---');
  console.log('  threads ok:        ' + (data.threads.length - after.threadsMissing.length) + '/' + data.threads.length);
  console.log('  messages mapped:   ' + after.messagesMapped + '/' + after.messagesExpected);
  console.log('  files in mirror:   ' + after.filesInMirror + '/' + after.filesExpected);
  console.log('  reactions missing: ' + after.reactionsMissing.length);
  console.log('  content issues:    ' + after.contentIssues.length);
  if (after.filesMissing.length) {
    console.log('  files still missing:');
    after.filesMissing.forEach((f) => console.log('    - ' + f.filename + ' (' + fmtSize(f.size) + ')'));
  }

  const report = { at: new Date().toISOString(), before, fixes: fixed, after };
  fs.writeFileSync(REPORT_FILE, JSON.stringify(report, null, 2));
  console.log('\nReport: data/padhai-fixup-report.json');

  const hardFails =
    after.threadsMissing.length ||
    after.messagesMissing.length ||
    after.reactionsMissing.length ||
    after.contentIssues.length;
  if (hardFails) {
    console.log('REMAINING GAPS — see report');
    process.exitCode = 1;
  } else {
    console.log('\nMirror complete: threads, messages, content, reactions all verified.');
  }
}

if (require.main === module) {
  fixup().catch((e) => {
    console.error('FIXUP FAILED:', e.message);
    process.exit(1);
  });
}

module.exports = { fixup };
