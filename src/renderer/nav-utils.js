// Shared between the browser chrome (renderer.js) and the new-tab page
// (start.js): turns whatever someone typed into a real URL to load —
// a real address as-is, a bare domain gets https://, anything else
// becomes a Google search.
function normalizeInput(raw) {
  const value = raw.trim();
  if (!value) return 'https://www.google.com';

  const looksLikeUrl = /^[a-z]+:\/\//i.test(value) || /^[\w-]+(\.[\w-]+)+(:\d+)?([/?#].*)?$/i.test(value);

  if (looksLikeUrl) {
    return /^[a-z]+:\/\//i.test(value) ? value : `https://${value}`;
  }
  return `https://www.google.com/search?q=${encodeURIComponent(value)}`;
}
