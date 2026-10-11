// Executed inside the active tab's page via webview.executeJavaScript() —
// this file is never loaded as a <script> tag, it's fetched as text by
// renderer.js and run on demand. Self-contained and idempotent: calling it
// again while the overlay is open closes it, restoring the page beneath
// untouched (the overlay only ever adds a node to <html>; it never edits
// the original page content).
(function () {
  const ID = '__gushu_reader_overlay__';
  const existing = document.getElementById(ID);
  if (existing) {
    existing.remove();
    return 'closed';
  }

  function pickRoot() {
    const explicit = document.querySelector('article');
    if (explicit) return explicit;

    const candidates = Array.from(
      document.querySelectorAll('main, [role="main"], .post, .article, #content, .content, body > div')
    );
    let best = null;
    let bestScore = 0;
    for (const el of candidates) {
      const text = el.innerText || '';
      const pCount = el.querySelectorAll('p').length;
      const score = text.length * (1 + pCount * 0.1);
      if (score > bestScore && text.length > 200) {
        bestScore = score;
        best = el;
      }
    }
    return best || document.body;
  }

  const root = pickRoot();
  const clone = root.cloneNode(true);
  clone.querySelectorAll('script, style, nav, form, iframe, button, svg, noscript, header, footer, aside').forEach((el) => el.remove());

  const titleText = (document.title || '').replace(/</g, '&lt;');
  const contentHTML = clone.innerHTML;

  const overlay = document.createElement('div');
  overlay.id = ID;
  overlay.dataset.theme = 'dark';
  overlay.innerHTML = `
    <style>
      #${ID} { position: fixed; inset: 0; z-index: 2147483647; background: #15131f; color: #ece9f7;
        font-family: Georgia, "Charter", serif; display: flex; flex-direction: column; }
      #${ID} .bar { flex: 0 0 auto; display: flex; align-items: center; justify-content: space-between;
        padding: 10px 20px; background: rgba(255,255,255,0.04); border-bottom: 1px solid rgba(255,255,255,0.1);
        font-family: -apple-system, sans-serif; }
      #${ID} .bar-title { font-size: 12px; letter-spacing: 1px; text-transform: uppercase; color: #9b95c9; }
      #${ID} .controls { display: flex; gap: 6px; }
      #${ID} .controls button { border: 1px solid rgba(255,255,255,0.14); background: rgba(255,255,255,0.05);
        color: #ece9f7; border-radius: 14px; padding: 4px 10px; font-size: 12px; cursor: pointer;
        font-family: -apple-system, sans-serif; }
      #${ID} .controls button:hover { background: rgba(255,255,255,0.12); }
      #${ID} .scroll { flex: 1 1 auto; overflow-y: auto; }
      #${ID} .article { max-width: 680px; margin: 0 auto; padding: 60px 24px 100px; }
      #${ID} .article h1 { font-size: 32px; line-height: 1.25; margin: 0 0 28px; }
      #${ID} .body { font-size: 19px; line-height: 1.7; }
      #${ID} .body p { margin: 0 0 20px; }
      #${ID} .body img { max-width: 100%; height: auto; border-radius: 8px; }
      #${ID} .body a { color: #22d3ee; }
      #${ID}[data-theme="light"] { background: #fbfaf7; color: #1a1a1a; }
      #${ID}[data-theme="light"] .bar { background: rgba(0,0,0,0.03); border-color: rgba(0,0,0,0.1); }
      #${ID}[data-theme="light"] .controls button { border-color: rgba(0,0,0,0.15); background: rgba(0,0,0,0.04); color: #1a1a1a; }
      #${ID}[data-theme="sepia"] { background: #f4ecd8; color: #433422; }
      #${ID}[data-theme="sepia"] .bar { background: rgba(0,0,0,0.03); border-color: rgba(0,0,0,0.1); }
      #${ID}[data-theme="sepia"] .controls button { border-color: rgba(0,0,0,0.15); background: rgba(0,0,0,0.05); color: #433422; }
    </style>
    <div class="bar">
      <span class="bar-title">Reader</span>
      <div class="controls">
        <button data-theme-btn="light">Light</button>
        <button data-theme-btn="sepia">Sepia</button>
        <button data-theme-btn="dark">Dark</button>
        <button data-font-btn="-1">A-</button>
        <button data-font-btn="1">A+</button>
        <button data-close-btn="1">✕</button>
      </div>
    </div>
    <div class="scroll">
      <div class="article">
        <h1>${titleText}</h1>
        <div class="body">${contentHTML}</div>
      </div>
    </div>
  `;

  document.documentElement.appendChild(overlay);

  let fontSize = 19;
  overlay.addEventListener('click', (e) => {
    if (e.target.closest('[data-close-btn]')) {
      overlay.remove();
      return;
    }
    const themeBtn = e.target.closest('[data-theme-btn]');
    if (themeBtn) {
      overlay.dataset.theme = themeBtn.dataset.themeBtn;
      return;
    }
    const fontBtn = e.target.closest('[data-font-btn]');
    if (fontBtn) {
      fontSize = Math.max(14, Math.min(28, fontSize + Number(fontBtn.dataset.fontBtn) * 2));
      overlay.querySelector('.body').style.fontSize = `${fontSize}px`;
    }
  });

  return 'opened';
})();
