// The recipe catalog: loads a source's catalog.json (by default omaflake/recipes on GitHub) and lets you search and
// filter it. The catalog is the file omaflake itself reads to browse a source (schema: omaflake.dev/schema/catalog/).
// Everything from a catalog is shown as text – a source other than the official one is not trusted.
(() => {
  const OFFICIAL = { owner: 'omaflake', repo: 'recipes' };
  // Which hosts run a recipe: a Mac runs macOS (aarch64-darwin) and NixOS aarch64-linux guests, a Linux host NixOS
  // guests of its own architecture.
  const HOSTS = {
    mac: { label: 'Mac', runs: r => r.systems.includes(r.kind === 'macos' ? 'aarch64-darwin' : 'aarch64-linux') },
    'linux-x86_64': { label: 'Linux x86_64', runs: r => r.kind === 'nixos' && r.systems.includes('x86_64-linux') },
    'linux-aarch64': { label: 'Linux aarch64', runs: r => r.kind === 'nixos' && r.systems.includes('aarch64-linux') },
  };
  const KINDS = { nixos: 'NixOS', macos: 'macOS' };
  const DISPLAYS = { gpu: '3D window', window: 'Window', none: 'Headless' };
  const NETWORKS = { shared: 'Shared (NAT)', isolated: 'Isolated', none: 'None' };
  const SORTS = { name: 'Name', kind: 'Guest', size: 'Smallest VM first' };

  const $ = (sel, root = document) => root.querySelector(sel);
  const form = $('[data-filters]');
  const list = $('[data-list]');
  const tagBox = $('[data-tags]');
  const count = $('[data-count]');
  const empty = $('[data-empty]');
  const error = $('[data-error]');
  const resets = document.querySelectorAll('[data-reset]');
  const template = $('template[data-card]');

  const params = new URLSearchParams(location.search);
  const source = parseSource(params.get('source'));
  const state = {
    q: params.get('q') || '',
    kind: KINDS[params.get('kind')] ? params.get('kind') : '',
    host: HOSTS[params.get('host')] ? params.get('host') : '',
    sort: SORTS[params.get('sort')] ? params.get('sort') : 'name',
    lab: params.get('lab') === '1',
    tags: new Set((params.get('tag') || '').split(',').filter(Boolean)),
  };
  let recipes = [];
  const opened = new Set(); // cards with their details open – kept when the list is drawn again

  // A source: nothing (the official one), "owner/repo[@ref]", a github.com URL, or the HTTPS URL of a catalog.json.
  function parseSource(raw) {
    const text = (raw || '').trim();
    if (!text) return github(OFFICIAL.owner, OFFICIAL.repo, 'HEAD', '');
    const repo = text.replace(/^(https?:\/\/)?(www\.)?github\.com\//, '');
    const gh = repo.match(/^([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:@([\w./-]+)|\/tree\/([\w./-]+))?\/?$/);
    if (gh) return github(gh[1], gh[2], gh[3] || gh[4] || 'HEAD', text);
    if (/^https:\/\/\S+\/catalog\.json$/.test(text)) {
      const base = text.replace(/catalog\.json$/, '');
      return { url: text, base, tree: base, label: text, add: text, official: false, raw: text };
    }
    return null;
  }

  function github(owner, repo, ref, raw) {
    const official = owner.toLowerCase() === OFFICIAL.owner && repo.toLowerCase() === OFFICIAL.repo;
    const path = `${owner}/${repo}`;
    return {
      url: `https://raw.githubusercontent.com/${path}/${ref}/catalog.json`,
      tree: `https://github.com/${path}/tree/${ref}/`,
      home: `https://github.com/${path}`,
      label: path + (ref === 'HEAD' ? '' : `@${ref}`),
      add: ref === 'HEAD' ? path : `https://github.com/${path}/tree/${ref}`,
      official,
      raw,
    };
  }

  const slug = r => `${r.author}/${r.kind}/${r.name}`;
  const anchor = r => `${r.author}-${r.kind}-${r.name}`;

  function normalize(r) {
    const str = v => (typeof v === 'string' ? v : '');
    const arr = v => (Array.isArray(v) ? v.filter(x => typeof x === 'string') : []);
    const out = {
      author: str(r.author), kind: str(r.kind), name: str(r.name), path: str(r.path),
      description: str(r.description), tags: arr(r.tags), systems: arr(r.systems), requires: arr(r.requires),
      license: str(r.license), homepage: str(r.homepage), version: str(r.version), lab: r.lab === true,
      defaults: r.defaults && typeof r.defaults === 'object' ? r.defaults : {},
      files: Array.isArray(r.files) ? r.files : [],
    };
    out.hosts = Object.keys(HOSTS).filter(h => HOSTS[h].runs(out));
    out.haystack = [slug(out), out.description, out.tags.join(' '), out.license].join(' ').toLowerCase();
    return out;
  }

  // --- filtering --------------------------------------------------------------------------------------------------

  function matches(r, ignoreTags = false) {
    if (r.lab && !state.lab) return false;
    if (state.kind && r.kind !== state.kind) return false;
    if (state.host && !r.hosts.includes(state.host)) return false;
    if (!ignoreTags) for (const t of state.tags) if (!r.tags.includes(t)) return false;
    const words = state.q.toLowerCase().split(/\s+/).filter(Boolean);
    return words.every(w => r.haystack.includes(w));
  }

  function sorted(rs) {
    const by = {
      name: (a, b) => a.name.localeCompare(b.name) || a.author.localeCompare(b.author),
      kind: (a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name),
      size: (a, b) => (a.defaults.memory_gb || 0) - (b.defaults.memory_gb || 0) ||
        (a.defaults.disk_gb || 0) - (b.defaults.disk_gb || 0) || a.name.localeCompare(b.name),
    }[state.sort];
    return [...rs].sort(by);
  }

  function render() {
    const shown = sorted(recipes.filter(r => matches(r)));
    list.replaceChildren(...shown.map(card));
    const total = recipes.filter(r => state.lab || !r.lab).length;
    count.textContent = recipes.length ? `${shown.length} of ${total} recipe${total === 1 ? '' : 's'}` : '';
    empty.hidden = !recipes.length || shown.length > 0;
    const filtered = state.q || state.kind || state.host || state.tags.size;
    resets.forEach(b => { b.hidden = !filtered; });
    renderTags();
    writeUrl();
  }

  // Tags with how many recipes they would leave, given the other filters; a tag that leaves none is hidden.
  function renderTags() {
    const pool = recipes.filter(r => matches(r, true) && [...state.tags].every(t => r.tags.includes(t)));
    const counts = new Map();
    recipes.filter(r => matches(r, true)).forEach(r => r.tags.forEach(t => counts.set(t, 0)));
    pool.forEach(r => r.tags.forEach(t => counts.set(t, (counts.get(t) || 0) + 1)));
    state.tags.forEach(t => counts.has(t) || counts.set(t, 0));
    const tags = [...counts.keys()].filter(t => state.tags.has(t) || counts.get(t) > 0).sort();
    tagBox.replaceChildren(...tags.map(t => {
      const b = el('button', { type: 'button', class: 'tag', 'aria-pressed': String(state.tags.has(t)) });
      b.append(t, el('span', { class: 'n' }, String(state.tags.has(t) ? '×' : counts.get(t))));
      b.addEventListener('click', () => toggleTag(t));
      return b;
    }));
    tagBox.hidden = !tags.length;
  }

  function toggleTag(t) {
    state.tags.has(t) ? state.tags.delete(t) : state.tags.add(t);
    render();
  }

  function writeUrl() {
    const p = new URLSearchParams();
    if (source.raw) p.set('source', source.raw);
    if (state.q) p.set('q', state.q);
    if (state.kind) p.set('kind', state.kind);
    if (state.host) p.set('host', state.host);
    if (state.tags.size) p.set('tag', [...state.tags].join(','));
    if (state.lab) p.set('lab', '1');
    if (state.sort !== 'name') p.set('sort', state.sort);
    const qs = p.toString();
    history.replaceState(null, '', location.pathname + (qs ? `?${qs}` : '') + location.hash);
  }

  // --- cards ------------------------------------------------------------------------------------------------------

  function el(tag, attrs = {}, text) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    if (text !== undefined) e.textContent = text;
    return e;
  }

  function card(r) {
    const node = template.content.firstElementChild.cloneNode(true);
    node.id = anchor(r);
    const name = el('a', { href: `#${anchor(r)}` }, r.name);
    $('[data-name]', node).append(name);
    $('[data-lab]', node).hidden = !r.lab;
    $('[data-kind]', node).textContent = KINDS[r.kind] || r.kind;
    $('[data-id]', node).textContent = slug(r);
    if (r.path && source.tree) {
      const src = $('[data-source]', node);
      src.href = source.tree + r.path;
      src.title = 'Source';
      src.setAttribute('aria-label', `Source of ${slug(r)}`);
      src.hidden = false;
    }
    $('[data-desc]', node).textContent = r.description;

    // One line on the closed card: where it runs, then how
    const linux = ['linux-x86_64', 'linux-aarch64'].filter(h => r.hosts.includes(h)).map(h => h.slice(6));
    const facts = [];
    if (r.hosts.includes('mac')) facts.push('Mac');
    if (linux.length) facts.push(`Linux ${linux.join(' · ')}`);
    if (r.defaults.display) facts.push(DISPLAYS[r.defaults.display] || r.defaults.display);
    if (r.defaults.ephemeral) facts.push('Ephemeral');
    $('[data-facts]', node).append(...facts.map(f => el('li', {}, f)));

    const details = $('details', node);
    details.open = opened.has(node.id);
    node.classList.toggle('open', details.open);
    details.addEventListener('toggle', () => {
      node.classList.toggle('open', details.open);
      details.open ? opened.add(node.id) : opened.delete(node.id);
      // One card open at a time: opening this one closes the others
      if (details.open) list.querySelectorAll('.recipe details[open]').forEach(d => { if (d !== details) d.open = false; });
    });
    // A click anywhere on the card opens or closes it – except on its own controls (tags, the source link, the
    // copy button), inside the open details (to select text there) and when text was selected. The name's href is
    // there only to copy a link to the recipe; the summary toggles by itself.
    node.addEventListener('click', e => {
      const t = e.target;
      if (t.closest('summary')) return;
      if (t.closest('.recipe-name a')) e.preventDefault();
      else if (t.closest('a, button') || (details.open && t.closest('details'))) return;
      if (String(getSelection()).trim()) return;
      details.open = !details.open;
    });

    $('[data-card-tags]', node).append(...r.tags.map(t => {
      const b = el('button', { type: 'button', class: 'tag small', 'aria-pressed': String(state.tags.has(t)) }, t);
      b.addEventListener('click', () => toggleTag(t));
      return b;
    }));

    const d = r.defaults;
    const specs = [];
    if (d.cpus) specs.push(['CPUs', String(d.cpus)]);
    if (d.memory_gb) specs.push(['Memory', `${d.memory_gb} GB`]);
    if (d.disk_gb) specs.push(['Disk', `${d.disk_gb} GB`]);
    if (d.display) specs.push(['Display', DISPLAYS[d.display] || String(d.display)]);
    if (d.network) specs.push(['Network', NETWORKS[d.network] || String(d.network)]);
    if (d.share !== undefined) specs.push(['Shared folder', d.share ? 'yes' : 'no']);
    specs.push(['Changes', d.ephemeral ? 'discarded at power-off' : 'kept']);
    const extras = ['audio', 'microphone', 'clipboard', 'camera'].filter(k => d[k] === true);
    if (extras.length) specs.push(['On by default', extras.join(', ')]);
    specs.push(['Systems', r.systems.join(', ') || '–']);
    if (r.requires.length) specs.push(['Requires', r.requires]);
    if (r.license) specs.push(['License', r.license]);
    const bytes = r.files.reduce((n, f) => n + (Number(f && f.size) || 0), 0);
    if (r.files.length) specs.push(['Files', `${r.files.length} · ${size(bytes)}`]);
    if (r.version) specs.push(['Version', r.version.slice(0, 12)]);
    $('[data-specs]', node).append(...specs.flatMap(([k, v]) => {
      const dd = el('dd');
      if (Array.isArray(v)) {
        v.forEach((req, i) => {
          if (i) dd.append(', ');
          const b = el('button', { type: 'button', class: 'link-button' }, req);
          b.addEventListener('click', () => { state.q = req; state.tags.clear(); syncForm(); render(); });
          dd.append(b);
        });
      } else dd.textContent = v;
      return [el('dt', {}, k), dd];
    }));

    const cmd = (source.official ? '' : `omaf sources add ${source.add}\n`) + `omaf recipes install ${slug(r)}`;
    $('[data-cmd]', node).textContent = cmd;
    $('[data-copy]', node).addEventListener('click', e => copy(cmd, e.currentTarget));

    const links = $('[data-links]', node);
    if (/^https:\/\//.test(r.homepage)) links.append(el('a', { href: r.homepage, rel: 'nofollow noopener' }, 'Homepage'));
    links.hidden = !links.childNodes.length;
    return node;
  }

  const size = b => (b < 1024 ? `${b} B` : b < 1048576 ? `${(b / 1024).toFixed(1)} KB` : `${(b / 1048576).toFixed(1)} MB`);

  // The copy button shows a tick for a moment; without clipboard access it selects the command instead
  async function copy(text, button) {
    try {
      await navigator.clipboard.writeText(text);
      button.classList.add('done');
      button.setAttribute('aria-label', 'Copied');
      setTimeout(() => {
        button.classList.remove('done');
        button.setAttribute('aria-label', 'Copy the command');
      }, 1500);
    } catch {
      getSelection().selectAllChildren(button.parentElement.querySelector('code'));
    }
  }

  // --- form -------------------------------------------------------------------------------------------------------

  function syncForm() {
    form.q.value = state.q;
    // RadioNodeList's value setter does not pick a radio whose value is empty ("All", "Any host")
    form.kind.forEach(r => { r.checked = r.value === state.kind; });
    form.host.forEach(r => { r.checked = r.value === state.host; });
    labToggle.setAttribute('aria-pressed', String(state.lab));
    syncSort();
  }

  form.addEventListener('input', () => {
    state.q = form.q.value.trim();
    state.kind = form.kind.value;
    state.host = form.host.value;
    render();
  });

  const labToggle = $('[data-lab-toggle]');
  labToggle.addEventListener('click', () => {
    state.lab = !state.lab;
    labToggle.setAttribute('aria-pressed', String(state.lab));
    render();
  });

  resets.forEach(b => b.addEventListener('click', () => {
    Object.assign(state, { q: '', kind: '', host: '' });
    state.tags.clear();
    syncForm();
    render();
  }));

  document.addEventListener('keydown', e => {
    if (e.key === '/' && !/^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement.tagName)) {
      e.preventDefault();
      form.q.focus();
    }
  });

  // --- sort: a listbox of our own, so it looks the same in every browser ----------------------------------------------

  const sortBox = $('[data-sort]');
  const sortButton = $('.sort-button', sortBox);
  const sortMenu = $('.sort-menu', sortBox);
  const sortOptions = [...sortMenu.querySelectorAll('[role=option]')];
  let active = 0;

  function syncSort() {
    $('[data-sort-value]', sortBox).textContent = SORTS[state.sort];
    sortOptions.forEach(o => o.setAttribute('aria-selected', String(o.dataset.value === state.sort)));
  }

  function highlight(i) {
    active = (i + sortOptions.length) % sortOptions.length;
    sortOptions.forEach((o, j) => o.classList.toggle('active', j === active));
    sortMenu.setAttribute('aria-activedescendant', sortOptions[active].id);
  }

  function openSort() {
    sortMenu.hidden = false;
    sortButton.setAttribute('aria-expanded', 'true');
    highlight(sortOptions.findIndex(o => o.dataset.value === state.sort));
    sortMenu.focus();
  }

  function closeSort(focusButton = true) {
    if (sortMenu.hidden) return;
    sortMenu.hidden = true;
    sortButton.setAttribute('aria-expanded', 'false');
    if (focusButton) sortButton.focus();
  }

  function pickSort(i) {
    state.sort = sortOptions[i].dataset.value;
    syncSort();
    closeSort();
    render();
  }

  sortButton.addEventListener('click', () => (sortMenu.hidden ? openSort() : closeSort()));
  sortButton.addEventListener('keydown', e => {
    if (['ArrowDown', 'ArrowUp'].includes(e.key)) { e.preventDefault(); openSort(); }
  });
  sortMenu.addEventListener('keydown', e => {
    const keys = {
      ArrowDown: () => highlight(active + 1), ArrowUp: () => highlight(active - 1),
      Home: () => highlight(0), End: () => highlight(sortOptions.length - 1),
      Enter: () => pickSort(active), ' ': () => pickSort(active), Escape: () => closeSort(),
    };
    if (keys[e.key]) { e.preventDefault(); keys[e.key](); } else if (e.key === 'Tab') closeSort(false);
  });
  sortOptions.forEach((o, i) => {
    o.addEventListener('click', () => pickSort(i));
    o.addEventListener('mousemove', () => highlight(i));
  });
  document.addEventListener('click', e => { if (!sortBox.contains(e.target)) closeSort(false); });

  // --- load -------------------------------------------------------------------------------------------------------

  function showSource(catalog) {
    const s = catalog && typeof catalog.source === 'object' ? catalog.source : {};
    const line = $('[data-source-line]');
    if (source.official) {
      line.append('Source: ', el('a', { href: source.home }, 'omaflake/recipes'),
        ' – the official catalog, reviewed by the omaflake core team.');
    } else {
      line.classList.add('warn');
      const name = typeof s.name === 'string' && s.name ? s.name : source.label;
      line.append('Source: ', el('a', { href: source.home || source.url }, source.label), ` (${name}) – `,
        el('strong', {}, 'not reviewed by the omaflake team.'), ' Its Nix code runs on your computer when you build it. ',
        el('a', { href: './' }, 'Back to the official recipes'));
      if (typeof s.description === 'string' && s.description) $('[data-source-text]').textContent = s.description;
    }
    line.hidden = false;
  }

  async function load() {
    syncForm();
    if (!source) {
      count.textContent = '';
      error.textContent = 'This source is not one omaflake can show here: use owner/repo, a github.com link or the HTTPS URL of a catalog.json.';
      error.hidden = false;
      return;
    }
    try {
      const res = await fetch(source.url, { cache: 'no-cache' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const catalog = await res.json();
      if (!catalog || !Array.isArray(catalog.recipes)) throw new Error('no recipes in it');
      recipes = catalog.recipes.filter(r => r && typeof r === 'object').map(normalize)
        .filter(r => r.author && r.kind && r.name);
      showSource(catalog);
    } catch (e) {
      count.textContent = '';
      error.textContent = `The catalog could not be loaded from ${source.url} (${e.message}).`;
      error.hidden = false;
      return;
    }
    render();
    showLinked();
  }

  // A link to one recipe (#<author>-<kind>-<name>): open its card, then drop the anchor from the URL so that reloading
  // the page does not open it again. The cards are built after load, so :target never applies.
  function showLinked() {
    const target = location.hash && document.getElementById(decodeURIComponent(location.hash.slice(1)));
    if (!target || !target.classList.contains('recipe')) return;
    $('details', target).open = true;
    target.scrollIntoView();
    history.replaceState(null, '', location.pathname + location.search);
  }

  window.addEventListener('hashchange', showLinked);

  load();
})();
