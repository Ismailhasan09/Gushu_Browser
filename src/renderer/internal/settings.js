const adblockSwitch = document.getElementById('adblock-switch');
const deleteDataBtn = document.getElementById('delete-data-btn');

async function renderAdBlock() {
  const enabled = await window.internalAPI.getAdBlockEnabled();
  adblockSwitch.classList.toggle('on', enabled);
}

adblockSwitch.addEventListener('click', async () => {
  const enabled = adblockSwitch.classList.contains('on');
  await window.internalAPI.setAdBlockEnabled(!enabled);
  renderAdBlock();
});

// The actual Clear Data dialog (time range + what to clear) lives on the
// History page, so there's only one implementation of it. This just
// hands off there with a flag to auto-open it.
deleteDataBtn.addEventListener('click', () => {
  const url = new URL('history.html', document.baseURI);
  url.search = location.search;
  url.searchParams.set('clear', '1');
  window.location.href = url.href;
});

renderAdBlock();

// ---------- privacy stats ----------

async function renderStats() {
  const { total, byDomain } = await window.internalAPI.getPrivacyReport();
  document.getElementById('stat-blocked').textContent = total;
  document.getElementById('stat-networks').textContent = byDomain.length;
}
renderStats();
setInterval(renderStats, 3000);

// ---------- rail navigation ----------

document.getElementById('snav').addEventListener('click', (e) => {
  const btn = e.target.closest('.navi');
  if (!btn) return;
  const sec = btn.dataset.s;
  document.querySelectorAll('[data-sec]').forEach((el) => {
    el.hidden = el.dataset.sec !== sec;
  });
  document.querySelectorAll('#snav .navi').forEach((n) => n.classList.toggle('on', n === btn));
});

// ---------- profiles ----------

const CURRENT_PROFILE_ID = new URLSearchParams(location.search).get('profile') || 'default';
const PROFILE_COLORS = ['#7c5cff', '#ff7a59', '#ff4fa0', '#ffc56b', '#2bc48a'];

const profilesList = document.getElementById('profiles-list');
const newProfileName = document.getElementById('new-profile-name');
const newProfileBtn = document.getElementById('new-profile-btn');

function escapeHTML(str) {
  return str.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function renderProfiles() {
  const profiles = await window.internalAPI.getProfiles();
  profilesList.innerHTML = profiles
    .map((p) => {
      const isCurrent = p.id === CURRENT_PROFILE_ID;
      return `
      <div class="row" data-id="${p.id}">
        <span style="width:10px;height:10px;border-radius:50%;background:${p.color};flex:0 0 auto;box-shadow:0 0 8px -1px ${p.color}"></span>
        <div class="row-main">
          <div class="row-title">${escapeHTML(p.name)}${isCurrent ? ' — this window' : ''}</div>
        </div>
        ${isCurrent ? '' : '<button class="btn open-btn">Open</button>'}
      </div>`;
    })
    .join('');

  profilesList.querySelectorAll('.open-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.closest('.row').dataset.id;
      window.internalAPI.openProfileWindow(id);
    });
  });
}

newProfileBtn.addEventListener('click', async () => {
  const name = newProfileName.value.trim();
  if (!name) return;
  const profiles = await window.internalAPI.getProfiles();
  const color = PROFILE_COLORS[profiles.length % PROFILE_COLORS.length];
  const profile = await window.internalAPI.createProfile({ name, color });
  newProfileName.value = '';
  await renderProfiles();
  window.internalAPI.openProfileWindow(profile.id);
});

renderProfiles();
