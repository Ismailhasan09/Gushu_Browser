const list = document.getElementById('list');

function formatWhen(ts) {
  return new Date(ts).toLocaleString();
}

function escapeHTML(str) {
  return str.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function render() {
  const entries = await window.internalAPI.getBookmarks();
  if (entries.length === 0) {
    list.innerHTML = '<div class="empty-state">No bookmarks yet.</div>';
    return;
  }
  list.innerHTML = entries
    .map(
      (entry) => `
      <div class="row" data-url="${escapeHTML(entry.url)}">
        ${entry.favicon ? `<img class="row-favicon" src="${escapeHTML(entry.favicon)}" alt="" onerror="this.remove()" />` : ''}
        <div class="row-main">
          <div class="row-title"><a href="${escapeHTML(entry.url)}">${escapeHTML(entry.title)}</a></div>
          <div class="row-meta">${formatWhen(entry.createdAt)} · ${escapeHTML(entry.url)}</div>
        </div>
        <button class="row-action remove-btn" title="Remove bookmark">×</button>
      </div>`
    )
    .join('');

  list.querySelectorAll('.remove-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const url = btn.closest('.row').dataset.url;
      await window.internalAPI.removeBookmark(url);
      render();
    });
  });
}

render();
