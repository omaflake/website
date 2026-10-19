// Fills the download section from update.json – the feed the release workflow writes and the app's update check
// reads (omaflake spec §11.6). No feed yet: the "on its way" note stays.
(async () => {
  let r;
  try {
    const res = await fetch('update.json', { cache: 'no-cache' });
    if (!res.ok) return;
    r = await res.json();
  } catch { return; }
  if (!r || !r.version || !r.url) return;

  const box = document.querySelector('[data-release]');
  const file = r.url.split('/').pop();
  const set = (sel, text) => box.querySelectorAll(sel).forEach(el => { el.textContent = text; });
  set('[data-version]', r.version);
  set('[data-file]', file);
  set('[data-sha]', r.sha256 || '–');
  box.querySelector('[data-url]').href = r.url;
  if (r.page) {
    box.querySelector('[data-page]').href = r.page;
    box.querySelector('[data-notes-wrap]').hidden = false;
  }
  document.querySelector('[data-install]').textContent =
    `curl -fLO ${r.url}\ncurl -fLO ${r.url}.sha256\nshasum -a 256 -c ${file}.sha256\nditto -x -k ${file} /Applications`;
  document.querySelector('[data-pending]').hidden = true;
  box.hidden = false;
})();
