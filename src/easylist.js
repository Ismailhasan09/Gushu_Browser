const fs = require('fs');
const { net } = require('electron');

// EasyList + EasyPrivacy: the actual filter lists real ad blockers (uBlock
// Origin, AdBlock Plus, etc.) run on. We extract two things from them that
// our domain-only blocklist can't do on its own:
//  - more network-block domains (overlapping with but broader than the
//    hosts-file list)
//  - cosmetic hiding rules: CSS selectors for ad containers/overlays that
//    are baked directly into a page's own HTML, not loaded from a
//    separate blockable domain (this is what catches things like a fake
//    "browser window" scam ad drawn inside the page itself)
const LIST_URLS = ['https://easylist.to/easylist/easylist.txt', 'https://easylist.to/easylist/easyprivacy.txt'];
const REFRESH_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;

// Only ever accept plain, standard CSS selector syntax. uBlock/ABP's
// filter lists also contain "extended" procedural selectors
// (:has-text(), :matches-css(), :xpath(), :upward(), :remove(), etc.)
// that aren't real CSS — we never want to inject those, so anything
// using them (or any character outside a safe set) is dropped.
const SAFE_SELECTOR_RE = /^[a-zA-Z0-9\s.#\-_[\]="'^$*~>+:(),|]+$/;
const UNSAFE_MARKERS = [':has-text(', ':matches-css', ':xpath(', ':upward(', ':remove(', ':style(', ':-abp-', ':if(', ':contains(', ':has('];

function isSafeSelector(selector) {
  if (!selector || selector.length > 300) return false;
  if (!SAFE_SELECTOR_RE.test(selector)) return false;
  return !UNSAFE_MARKERS.some((marker) => selector.includes(marker));
}

function parseFilterList(text, domains, selectors) {
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('!') || line.startsWith('[')) continue;
    if (line.startsWith('@@')) continue; // exception rule — never un-block, so just skip it

    const cosmeticIdx = line.indexOf('##');
    if (cosmeticIdx !== -1) {
      // Only take generic (non-domain-qualified) cosmetic rules — lines
      // that start with "##" rather than "example.com##...". Domain-
      // scoped rules would need per-site matching we don't implement.
      if (line.slice(0, cosmeticIdx) === '') {
        const selector = line.slice(cosmeticIdx + 2).trim();
        if (isSafeSelector(selector)) selectors.add(selector);
      }
      continue;
    }
    if (line.includes('#@#') || line.includes('#?#')) continue; // exception / procedural cosmetic — skip

    // Simple network rule: ||domain.tld^ (optionally with $options, which
    // we ignore rather than try to fully interpret — safe default is to
    // still block the domain).
    const match = line.match(/^\|\|([a-z0-9.-]+)\^/i);
    if (match) domains.add(match[1].toLowerCase());
  }
}

async function loadFilterLists(cachePaths) {
  const domains = new Set();
  const selectors = new Set();

  for (let i = 0; i < LIST_URLS.length; i++) {
    const cachePath = cachePaths[i];
    let text = null;
    try {
      const stat = fs.statSync(cachePath);
      if (Date.now() - stat.mtimeMs < REFRESH_INTERVAL_MS) {
        text = fs.readFileSync(cachePath, 'utf8');
      }
    } catch {
      /* no cache yet, or it's stale — fall through to fetch */
    }
    if (text === null) {
      try {
        const res = await net.fetch(LIST_URLS[i]);
        text = await res.text();
        fs.writeFileSync(cachePath, text);
      } catch (err) {
        console.error(`Filter list fetch failed (${LIST_URLS[i]}):`, err.message);
        try {
          text = fs.readFileSync(cachePath, 'utf8');
        } catch {
          text = '';
        }
      }
    }
    parseFilterList(text, domains, selectors);
  }

  return { domains, selectors };
}

module.exports = { loadFilterLists };
