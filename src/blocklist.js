const fs = require('fs');
const { net } = require('electron');

// StevenBlack/hosts: a widely-used, actively-maintained merge of several
// reputable ad/tracker/malware blocklists (~70k+ domains), in standard
// hosts-file format. Far more thorough than any list we could reasonably
// hand-curate, and it stays current since we refetch it periodically.
const BLOCKLIST_URL = 'https://raw.githubusercontent.com/StevenBlack/hosts/master/hosts';
const REFRESH_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;
const IGNORED_HOSTS = new Set(['localhost', 'localhost.localdomain', 'local', 'broadcasthost', '0.0.0.0', 'ip6-localhost', 'ip6-loopback']);

function parseHostsFile(text) {
  const domains = new Set();
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const spaceIdx = trimmed.search(/\s/);
    if (spaceIdx === -1) continue;
    const ip = trimmed.slice(0, spaceIdx);
    if (ip !== '0.0.0.0' && ip !== '127.0.0.1') continue;
    const domain = trimmed.slice(spaceIdx).trim().split(/\s+/)[0].toLowerCase();
    if (domain && !IGNORED_HOSTS.has(domain)) domains.add(domain);
  }
  return domains;
}

// Tries a fresh download first; falls back to whatever's cached on disk
// (regardless of age) if the fetch fails, so a network hiccup never takes
// ad blocking down to nothing. Returns an empty set only on a totally
// fresh install with no network.
async function loadBlocklist(cachePath) {
  try {
    const stat = fs.statSync(cachePath);
    if (Date.now() - stat.mtimeMs < REFRESH_INTERVAL_MS) {
      return parseHostsFile(fs.readFileSync(cachePath, 'utf8'));
    }
  } catch {
    /* no cache yet, or it's stale — fall through to fetch */
  }

  try {
    const res = await net.fetch(BLOCKLIST_URL);
    const text = await res.text();
    fs.writeFileSync(cachePath, text);
    return parseHostsFile(text);
  } catch (err) {
    console.error('Blocklist fetch failed, falling back to cache if any:', err.message);
    try {
      return parseHostsFile(fs.readFileSync(cachePath, 'utf8'));
    } catch {
      return new Set();
    }
  }
}

module.exports = { loadBlocklist };
