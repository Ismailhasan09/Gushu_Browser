const list = document.getElementById('list');
const clearBtn = document.getElementById('clear-btn');

function escapeHTML(str) {
  return str.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function statusText(entry) {
  if (entry.state === 'progressing') {
    const pct = entry.totalBytes ? Math.round((entry.receivedBytes / entry.totalBytes) * 100) : null;
    return pct === null ? `Downloading – ${formatBytes(entry.receivedBytes)}` : `Downloading – ${pct}%`;
  }
  if (entry.state === 'completed') return `Completed – ${formatBytes(entry.totalBytes)}`;
  if (entry.state === 'cancelled') return 'Cancelled';
  return 'Interrupted';
}

async function render() {
  const entries = await window.internalAPI.getDownloads();
  if (entries.length === 0) {
    list.innerHTML = '<div class="empty-state">No downloads yet.</div>';
    return;
  }
  list.innerHTML = entries
    .map(
      (entry) => `
      <div class="row" data-id="${entry.id}">
        <div class="row-main">
          <div class="row-title">${escapeHTML(entry.filename)}</div>
          <div class="row-meta">${statusText(entry)}</div>
        </div>
        ${entry.state === 'completed' ? '<button class="row-action show-btn" title="Show in folder">↗</button>' : ''}
      </div>`
    )
    .join('');

  list.querySelectorAll('.show-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.closest('.row').dataset.id;
      window.internalAPI.openDownloadFolder(id);
    });
  });
}

clearBtn.addEventListener('click', async () => {
  await window.internalAPI.clearDownloads();
  render();
});

render();
setInterval(render, 1500);
