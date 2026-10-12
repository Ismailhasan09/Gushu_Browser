const hlist = document.getElementById('hlist');
const closedList = document.getElementById('closed-list');
const hq = document.getElementById('hq');

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

function dayLabel(ts) {
  const d = new Date(ts);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  const sameDay = (a, b) => a.toDateString() === b.toDateString();
  if (sameDay(d, today)) return `Today · ${d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}`;
  if (sameDay(d, yesterday)) return `Yesterday · ${d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}`;
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
}

function timeLabel(ts) {
  return new Date(ts).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

let query = '';
let allEntries = [];

async function loadHistory() {
  allEntries = await window.internalAPI.getHistory();
  renderHistory();
}

function renderHistory() {
  const q = query.toLowerCase();
  const filtered = allEntries.filter((h) => !q || (h.title + ' ' + h.url).toLowerCase().includes(q));

  if (filtered.length === 0) {
    hlist.innerHTML = `<div class="empty-state">No history ${query ? `matches "${escapeHTML(query)}"` : 'yet'}.</div>`;
    return;
  }

  const days = new Map();
  for (const entry of filtered) {
    const label = dayLabel(entry.visitedAt);
    if (!days.has(label)) days.set(label, []);
    days.get(label).push(entry);
  }

  let html = '';
  for (const [label, entries] of days) {
    html += `<div class="day-group">
      <div class="day-head"><span>${escapeHTML(label)}</span><span>${entries.length} site${entries.length === 1 ? '' : 's'}</span></div>
      <div class="list">`;
    for (const entry of entries) {
      const letter = (hostnameOf(entry.url)[0] || '?').toUpperCase();
      const icon = entry.favicon
        ? `<img src="${escapeHTML(entry.favicon)}" alt="" style="width:20px;height:20px;border-radius:5px" onerror="this.outerHTML='${letter}'" />`
        : `<span style="width:20px;height:20px;border-radius:5px;background:var(--glass-bg-strong);display:inline-flex;align-items:center;justify-content:center;font-size:10px;font-weight:700">${letter}</span>`;
      html += `<div class="hist-item" data-id="${entry.id}">
        <time>${timeLabel(entry.visitedAt)}</time>
        ${icon}
        <div class="row-main">
          <div class="row-title">${escapeHTML(entry.title)}</div>
          <div class="row-meta">${escapeHTML(hostnameOf(entry.url))}</div>
        </div>
        <div class="hist-acts">
          <button class="row-action" data-open="${entry.id}" title="Open in new tab">&#8599;</button>
          <button class="row-action" data-remove="${entry.id}" title="Remove from history">&times;</button>
        </div>
      </div>`;
    }
    html += `</div></div>`;
  }
  hlist.innerHTML = html;
}

hlist.addEventListener('click', async (e) => {
  const openBtn = e.target.closest('[data-open]');
  if (openBtn) {
    const entry = allEntries.find((h) => h.id === openBtn.dataset.open);
    if (entry) window.open(entry.url, '_blank');
    return;
  }
  const removeBtn = e.target.closest('[data-remove]');
  if (removeBtn) {
    const id = removeBtn.dataset.remove;
    const removed = await window.internalAPI.removeHistoryEntry(id);
    allEntries = allEntries.filter((h) => h.id !== id);
    renderHistory();
    if (removed) {
      toast('Removed from history', async () => {
        await window.internalAPI.restoreHistoryEntry(removed);
        loadHistory();
      });
    }
  }
});

hq.addEventListener('input', () => {
  query = hq.value.trim();
  renderHistory();
});

// ---------- recently closed ----------

async function loadRecentlyClosed() {
  const entries = await window.internalAPI.getRecentlyClosed();
  if (entries.length === 0) {
    closedList.innerHTML = '<div class="empty-state" style="padding:16px 0">Nothing closed recently.</div>';
    return;
  }
  closedList.innerHTML = entries
    .map((entry) => {
      const letter = (hostnameOf(entry.url)[0] || '?').toUpperCase();
      const icon = entry.favicon
        ? `<img src="${escapeHTML(entry.favicon)}" alt="" style="width:18px;height:18px;border-radius:5px" onerror="this.outerHTML='${letter}'" />`
        : `<span style="width:18px;height:18px;border-radius:5px;background:var(--glass-bg-strong);display:inline-flex;align-items:center;justify-content:center;font-size:9px;font-weight:700">${letter}</span>`;
      return `<a class="closed-item" href="${escapeHTML(entry.url)}" target="_blank">${icon}<span class="closed-title">${escapeHTML(entry.title)}</span><small>${timeAgo(entry.closedAt)}</small></a>`;
    })
    .join('');
}

function timeAgo(ts) {
  const mins = Math.max(1, Math.round((Date.now() - ts) / 60000));
  if (mins < 60) return `${mins}m`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.round(hrs / 24)}d`;
}

// ---------- clear browsing data modal ----------

const scrim = document.getElementById('clear-scrim');
function openClear() {
  scrim.hidden = false;
}
document.getElementById('open-clear').addEventListener('click', openClear);
document.getElementById('open-clear-2').addEventListener('click', openClear);
document.getElementById('clear-cancel').addEventListener('click', () => {
  scrim.hidden = true;
});
scrim.addEventListener('click', (e) => {
  if (e.target === scrim) scrim.hidden = true;
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') scrim.hidden = true;
});

document.getElementById('clear-go').addEventListener('click', async () => {
  const options = {
    range: document.getElementById('range').value,
    history: document.getElementById('chk-history').checked,
    cookies: document.getElementById('chk-cookies').checked,
    cache: document.getElementById('chk-cache').checked,
  };
  scrim.hidden = true;
  await window.internalAPI.deleteBrowsingData(options);
  loadHistory();
  toast('Browsing data cleared');
});

// ---------- toast ----------

const toastEl = document.getElementById('toast');
let toastTimer;
function toast(msg, undo) {
  clearTimeout(toastTimer);
  toastEl.innerHTML = `<span>${escapeHTML(msg)}</span>` + (undo ? '<button type="button">Undo</button>' : '');
  toastEl.hidden = false;
  if (undo) toastEl.querySelector('button').onclick = () => {
    undo();
    toastEl.hidden = true;
  };
  toastTimer = setTimeout(() => {
    toastEl.hidden = true;
  }, 5000);
}

// Auto-open the Clear Data dialog when navigated here from Settings.
if (new URLSearchParams(location.search).get('clear') === '1') openClear();

loadHistory();
loadRecentlyClosed();
setInterval(loadRecentlyClosed, 3000);
