const list = document.getElementById('list');
const clearBtn = document.getElementById('clear-btn');

function formatWhen(ts) {
  return new Date(ts).toLocaleString();
}

function escapeHTML(str) {
  return str.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function render() {
  const entries = await window.internalAPI.getHistory();
  if (entries.length === 0) {
    list.innerHTML = '<div class="empty-state">No history yet.</div>';
    return;
  }
  list.innerHTML = entries
    .map(
      (entry) => `
      <div class="row">
        ${entry.favicon ? `<img class="row-favicon" src="${escapeHTML(entry.favicon)}" alt="" onerror="this.remove()" />` : ''}
        <div class="row-main">
          <div class="row-title"><a href="${escapeHTML(entry.url)}">${escapeHTML(entry.title)}</a></div>
          <div class="row-meta">${formatWhen(entry.visitedAt)} · ${escapeHTML(entry.url)}</div>
        </div>
      </div>`
    )
    .join('');
}

clearBtn.addEventListener('click', async () => {
  if (!confirm('Clear all history?')) return;
  await window.internalAPI.clearHistory();
  render();
});

render();
