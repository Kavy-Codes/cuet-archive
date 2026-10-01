const fs = require('fs');
const os = require('os');
const path = require('path');
const cfg = require('./config.cjs');
const { fetchAll } = require('./backup-fetch.cjs');

const ROOT = path.join(os.homedir(), 'CUET-Backup');
const FILES_DIR = path.join(ROOT, '01-files');
const TEXTS_DIR = path.join(ROOT, '02-texts');
const INDEX_DIR = path.join(ROOT, '03-index');
const RAW_DIR = path.join(ROOT, '04-raw');
const POOL = 5;
const BAD_CHARS = new Set(['\\', '/', ':', '*', '?', '"', '<', '>', '|']);

function safeName(s, max) {
  let out = '';
  for (const ch of String(s)) out += BAD_CHARS.has(ch) ? ' ' : ch;
  out = out.replace(/\s+/g, ' ').trim().slice(0, max || 60);
  return out || 'untitled';
}

function fmtSize(bytes) {
  if (!bytes) return '0 B';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1048576) return (bytes / 1024).toFixed(0) + ' KB';
  return (bytes / 1048576).toFixed(1) + ' MB';
}

function fmtTime(iso) {
  return new Date(iso).toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
}

function mdEscapeLink(p) {
  return encodeURI(p).replace(/\(/g, '%28').replace(/\)/g, '%29');
}

async function downloadFile(url, dest, expectedSize) {
  if (fs.existsSync(dest)) {
    const st = fs.statSync(dest);
    if (st.size === expectedSize) return 'skip';
    fs.unlinkSync(dest);
  }
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, { redirect: 'follow' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const buf = Buffer.from(await res.arrayBuffer());
      if (expectedSize && buf.length !== expectedSize) {
        throw new Error('size mismatch ' + buf.length + ' != ' + expectedSize);
      }
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      const tmp = dest + '.part';
      fs.writeFileSync(tmp, buf);
      fs.renameSync(tmp, dest);
      return buf.length;
    } catch (e) {
      lastErr = e;
      await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
    }
  }
  throw lastErr;
}

async function runPool(jobs, fn) {
  let i = 0;
  const failures = [];
  const workers = Array.from({ length: POOL }, async () => {
    for (;;) {
      const idx = i++;
      if (idx >= jobs.length) return;
      try {
        await fn(jobs[idx], idx);
      } catch (e) {
        failures.push({ job: jobs[idx], error: e.message });
      }
    }
  });
  await Promise.all(workers);
  return failures;
}

function messageMarkdown(msg, fileLinks) {
  const parts = [];
  parts.push(
    '**' +
      msg.author.name +
      '** · ' +
      fmtTime(msg.timestamp) +
      (msg.edited ? ' *(edited)*' : '')
  );
  if (msg.content) parts.push(msg.content);
  if (msg.reference) {
    const r = msg.reference;
    const kind = r.type === 1 ? 'forwarded from' : 'reply to';
    const link =
      'https://discord.com/channels/' + cfg.GUILD_ID + '/' + r.channel_id + '/' + r.message_id;
    parts.push('- ↩️ ' + kind + ' [original message](' + link + ')');
  }
  for (const a of msg.attachments) {
    const local = fileLinks.get(a.id);
    const href = local || a.url;
    parts.push(
      '- 📎 [' + a.filename + '](' + mdEscapeLink(href) + ') (' + fmtSize(a.size) + ')'
    );
  }
  const seenUrls = new Set();
  for (const e of msg.embeds) {
    if (e.url && !seenUrls.has(e.url)) {
      seenUrls.add(e.url);
      parts.push('- 🔗 [' + (e.title || e.url) + '](' + e.url + ')');
    }
  }
  if (msg.reactions.length) {
    const rx = msg.reactions
      .map((r) => (r.id ? '<' + r.name + ':' + r.id + '>' : r.name) + ' ' + r.count)
      .join(' · ');
    parts.push('- ' + rx);
  }
  return parts.join('\n\n');
}

async function localBackup() {
  console.log('Fetching source (CUET 2027, read-only)…');
  const data = await fetchAll();

  for (const d of [ROOT, FILES_DIR, TEXTS_DIR, INDEX_DIR, RAW_DIR]) {
    fs.mkdirSync(d, { recursive: true });
  }

  const attJobs = [];
  const perTopic = [];
  let totalMsgs = 0;

  data.threads.forEach((entry, i) => {
    const base =
      String(i + 1).padStart(2, '0') + '-' + safeName(entry.thread.name);
    const usedNames = new Map();
    const fileLinks = new Map();
    let fileCount = 0;
    let fileBytes = 0;

    for (const msg of entry.messages) {
      totalMsgs++;
      for (const a of msg.attachments) {
        let fname = safeName(a.filename, 120);
        const seen = usedNames.get(fname) || 0;
        usedNames.set(fname, seen + 1);
        if (seen > 0) {
          const ext = path.extname(fname);
          fname = fname.slice(0, fname.length - ext.length) + '_' + (seen + 1) + ext;
        }
        const rel = path.join('01-files', base, fname);
        fileLinks.set(a.id, '../' + mdEscapeLink(rel));
        attJobs.push({
          url: a.url,
          dest: path.join(ROOT, rel),
          size: a.size,
          name: a.filename,
        });
        fileCount++;
        fileBytes += a.size;
      }
    }
    perTopic.push({ base, entry, fileCount, fileBytes, fileLinks });
  });

  const expectedBytes = attJobs.reduce((s, j) => s + j.size, 0);
  console.log(
    'Downloading ' + attJobs.length + ' attachments (' + fmtSize(expectedBytes) + ')…'
  );
  let done = 0;
  const failures = await runPool(attJobs, async (job) => {
    await downloadFile(job.url, job.dest, job.size);
    done++;
    if (done % 10 === 0 || done === attJobs.length) {
      console.log('  ' + done + '/' + attJobs.length + ' files');
    }
  });

  console.log('Writing text exports…');
  const indexRows = [];
  for (const t of perTopic) {
    const entry = t.entry;
    const lines = [];
    lines.push('# ' + entry.thread.name);
    lines.push('');
    lines.push(
      '> From **CUET 2027** · 📚︱resources · source: https://discord.com/channels/' +
        cfg.GUILD_ID +
        '/' +
        cfg.FORUM_ID +
        '/' +
        entry.thread.id +
        '  '
    );
    lines.push(
      '> Exported ' +
        new Date().toISOString().slice(0, 16) +
        'Z · ' +
        entry.messages.length +
        ' messages · ' +
        t.fileCount +
        ' files'
    );
    lines.push('');
    lines.push('---');
    lines.push('');
    for (const msg of entry.messages) {
      lines.push(messageMarkdown(msg, t.fileLinks));
      lines.push('');
      lines.push('---');
      lines.push('');
    }
    fs.writeFileSync(path.join(TEXTS_DIR, t.base + '.md'), lines.join('\n'));
    indexRows.push({
      base: t.base,
      name: entry.thread.name,
      msgs: entry.messages.length,
      files: t.fileCount,
      bytes: t.fileBytes,
    });
  }

  const idx = [];
  idx.push('# CUET 2027 — 📚︱resources backup');
  idx.push('');
  idx.push(
    'Backed up ' + new Date().toISOString().slice(0, 16) + 'Z from the CUET 2027 Discord.'
  );
  idx.push('');
  idx.push('| # | Topic | Messages | Files | Size |');
  idx.push('|---|-------|----------|-------|------|');
  indexRows.forEach((r, i) => {
    const n = String(i + 1).padStart(2, '0');
    idx.push(
      '| ' +
        n +
        ' | [' +
        r.name +
        '](../' +
        mdEscapeLink('02-texts/' + r.base + '.md') +
        ') | ' +
        r.msgs +
        ' | ' +
        r.files +
        ' | ' +
        (r.files ? fmtSize(r.bytes) : '—') +
        ' |'
    );
  });
  idx.push('');
  const totFiles = indexRows.reduce((s, r) => s + r.files, 0);
  const totBytes = indexRows.reduce((s, r) => s + r.bytes, 0);
  idx.push(
    '**Total:** ' + totalMsgs + ' messages · ' + totFiles + ' files · ' + fmtSize(totBytes)
  );
  idx.push('');
  idx.push('- `01-files/` — every attachment, sorted into per-topic folders');
  idx.push('- `02-texts/` — every message, link, reply and reaction as Markdown');
  idx.push('- `04-raw/` — untouched raw Discord API data');
  if (failures.length) {
    idx.push('');
    idx.push('**Download failures: ' + failures.length + '** (see backup-report.json)');
  }
  fs.writeFileSync(path.join(INDEX_DIR, 'INDEX.md'), idx.join('\n'));

  fs.writeFileSync(
    path.join(RAW_DIR, 'threads.json'),
    JSON.stringify({ fetchedAt: new Date().toISOString(), forum: data.forum, threads: data.threads }, null, 1)
  );

  const report = {
    fetchedAt: new Date().toISOString(),
    topics: data.threads.length,
    messages: totalMsgs,
    filesExpected: attJobs.length,
    bytesExpected: expectedBytes,
    downloadFailures: failures.map((f) => ({ file: f.job.name, error: f.error })),
  };
  fs.writeFileSync(path.join(ROOT, 'backup-report.json'), JSON.stringify(report, null, 2));

  console.log('');
  console.log('=== Local backup done ===');
  console.log('  topics:   ' + data.threads.length);
  console.log('  messages: ' + totalMsgs);
  console.log(
    '  files:    ' + (attJobs.length - failures.length) + '/' + attJobs.length + ' (' + fmtSize(expectedBytes) + ')'
  );
  if (failures.length) {
    console.log('  FAILED (' + failures.length + '):');
    failures.forEach((f) => console.log('    - ' + f.job.name + ': ' + f.error));
  }
  console.log('  location: ' + ROOT);
  if (failures.length) process.exitCode = 1;
}

if (require.main === module) {
  localBackup().catch((e) => {
    console.error('LOCAL BACKUP FAILED:', e.message);
    process.exit(1);
  });
}

module.exports = { localBackup, safeName, fmtSize, mdEscapeLink };
