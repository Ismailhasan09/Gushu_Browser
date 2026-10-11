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

deleteDataBtn.addEventListener('click', async () => {
  if (!confirm('Delete history, cookies, and cached files? This cannot be undone.')) return;
  await window.internalAPI.deleteBrowsingData();
  deleteDataBtn.textContent = 'Deleted';
  setTimeout(() => {
    deleteDataBtn.textContent = 'Delete';
  }, 1500);
});

renderAdBlock();

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
