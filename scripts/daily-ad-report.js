#!/usr/bin/env node
// Opens a pre-filled email draft with today's "ads skipped" count from
// Gushu Browser. Run standalone (no Electron needed) — reads the same
// blocked-daily.json the browser itself writes to. You still have to
// click Send yourself; this never sends anything on its own.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');

// A rough estimate only — Gushu has no way to know what any real ad
// actually pays. $0.002/ad is roughly mid-range for typical display-ad
// CPMs ($1-$3 per 1000 views). Change this if you want a different guess.
const RATE_PER_AD = 0.002;

// Set your own address via an env var rather than hardcoding it here —
// this file is committed to a public repo, and a hardcoded address would
// leak it to anyone who views the source.
//   export GUSHU_REPORT_EMAIL="you@example.com"
const RECIPIENT = process.env.GUSHU_REPORT_EMAIL;
if (!RECIPIENT) {
  console.error('Set GUSHU_REPORT_EMAIL to your email address first, e.g.:\n  export GUSHU_REPORT_EMAIL="you@example.com"');
  process.exit(1);
}

function appDataDir() {
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Application Support');
  if (process.platform === 'win32') return process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
  return process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
}

function todayKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

const blockedDailyPath = path.join(appDataDir(), 'Gushu Browser', 'blocked-daily.json');

let blockedDaily = {};
try {
  blockedDaily = JSON.parse(fs.readFileSync(blockedDailyPath, 'utf8'));
} catch {
  // No data yet (browser never run today, or never run at all).
}

const count = blockedDaily[todayKey()] || 0;
const estimate = (count * RATE_PER_AD).toFixed(2);

const subject = `Gushu Browser — ${count} ads skipped today`;
const body = [
  `You skipped ${count} ads today in Gushu Browser.`,
  '',
  `If you'd watched them instead, a rough estimate is about $${estimate}`,
  `(at $${RATE_PER_AD}/ad — a guess based on typical display-ad rates,`,
  'not a verified or guaranteed payout).',
].join('\n');

const mailto = `mailto:${encodeURIComponent(RECIPIENT)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

if (process.platform === 'darwin') {
  execSync(`open "${mailto}"`);
} else if (process.platform === 'win32') {
  execSync(`start "" "${mailto}"`, { shell: 'cmd.exe' });
} else {
  execSync(`xdg-open "${mailto}"`);
}

console.log(`Opened draft: ${count} ads skipped today, ~$${estimate} estimate.`);
