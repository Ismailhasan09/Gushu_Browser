const form = document.getElementById('search-form');
const input = document.getElementById('search-input');

form.addEventListener('submit', (e) => {
  e.preventDefault();
  window.location.href = normalizeInput(input.value);
});

const favoritesEl = document.getElementById('favorites');

function escapeHTML(str) {
  return str.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function hostnameOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

const MAX_FAVORITES = 10;

// Bookmarks (explicit) first, then fill remaining slots with your most
// frequently visited sites from history (grouped by domain) — the usual
// "favorites start empty, fill in as you browse" behavior.
async function renderFavorites() {
  const bookmarks = await window.internalAPI.getBookmarks();
  const bookmarkHosts = new Set(bookmarks.map((b) => hostnameOf(b.url)));

  const remainingSlots = Math.max(0, MAX_FAVORITES - bookmarks.length);
  const topSites = remainingSlots > 0 ? await window.internalAPI.getTopSites(remainingSlots + bookmarkHosts.size) : [];
  const autoSites = topSites.filter((s) => !bookmarkHosts.has(s.host)).slice(0, remainingSlots);

  const tiles = [
    ...bookmarks.slice(0, MAX_FAVORITES).map((b) => ({ url: b.url, title: b.title, favicon: b.favicon })),
    ...autoSites.map((s) => ({ url: s.url, title: s.title, favicon: s.favicon })),
  ];

  favoritesEl.innerHTML = tiles
    .map((t) => {
      const letter = (hostnameOf(t.url)[0] || '?').toUpperCase();
      const icon = t.favicon
        ? `<img src="${escapeHTML(t.favicon)}" alt="" onerror="this.replaceWith(Object.assign(document.createElement('span'),{textContent:'${letter}'}))" />`
        : letter;
      return `
        <a class="favorite-tile" href="${escapeHTML(t.url)}" title="${escapeHTML(t.title)}">
          <span class="favorite-icon">${icon}</span>
          <span class="favorite-label">${escapeHTML(hostnameOf(t.url))}</span>
        </a>`;
    })
    .join('');
}

renderFavorites();

// ---------- privacy report summary ----------

const privacyTotalEl = document.getElementById('privacy-total');
const privacyNetworksEl = document.getElementById('privacy-networks');
const privacyTopEl = document.getElementById('privacy-top');
const privacyMoreEl = document.getElementById('privacy-more');

const privacyUrl = new URL('internal/privacy.html', document.baseURI);
privacyUrl.search = location.search;
privacyMoreEl.addEventListener('click', () => {
  window.location.href = privacyUrl.href;
});

async function renderPrivacy() {
  const { total, byDomain } = await window.internalAPI.getPrivacyReport();
  privacyTotalEl.textContent = total;
  privacyNetworksEl.textContent = byDomain.length;
  privacyTopEl.innerHTML =
    byDomain.length > 0
      ? `<strong>${escapeHTML(byDomain[0].domain)}</strong> was blocked ${byDomain[0].count} time${byDomain[0].count === 1 ? '' : 's'} this session.`
      : 'Nothing blocked yet this session.';
}

renderPrivacy();
setInterval(renderPrivacy, 3000);
