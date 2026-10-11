const totalCountEl = document.getElementById('total-count');
const list = document.getElementById('list');

function escapeHTML(str) {
  return str.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function render() {
  const { total, byDomain } = await window.internalAPI.getPrivacyReport();
  totalCountEl.textContent = total;

  if (byDomain.length === 0) {
    list.innerHTML = '<div class="empty-state">Nothing blocked yet this session.</div>';
    return;
  }

  const max = byDomain[0].count;
  list.innerHTML = byDomain
    .map(
      (entry) => `
      <div class="row">
        <div class="row-main">
          <div class="row-title">${escapeHTML(entry.domain)}</div>
          <div class="bar-track"><div class="bar-fill" style="width:${Math.max(4, (entry.count / max) * 100)}%"></div></div>
        </div>
        <span class="row-count">${entry.count}</span>
      </div>`
    )
    .join('');
}

render();
setInterval(render, 2000);
