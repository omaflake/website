// The catalog: loads a source's catalog.json (by default omaflake/catalog on GitHub) and shows its three catalogs –
// recipes, modules (with key bindings) and looks – each a list of its own, with one set of filters (search, platform,
// where it runs, appearance, tags, sort). The catalog is the file omaflake itself reads to browse a source (schema:
// omaflake.dev/schema/catalog/). Everything from a catalog is shown as text – a source other than the official one is
// not trusted.
(() => {
  const OFFICIAL = { owner: 'omaflake', repo: 'catalog' };
  // Which hosts run a recipe: a Mac runs macOS (aarch64-darwin) and NixOS aarch64-linux guests, a Linux host NixOS
  // guests of its own architecture.
  const HOSTS = {
    mac: r => r.systems.includes(r.platform === 'macos' ? 'aarch64-darwin' : 'aarch64-linux'),
    'linux-x86_64': r => r.platform === 'nixos' && r.systems.includes('x86_64-linux'),
    'linux-aarch64': r => r.platform === 'nixos' && r.systems.includes('aarch64-linux'),
  };
  const PLATFORMS = { nixos: 'NixOS', macos: 'macOS' };
  // The platforms' symbols, as in omaflake's apps. NixOS: Lucide 1.61.0 "snowflake" – copyright Lucide Contributors
  // (portions Cole Bemis, Feather), ISC License; full notice in this repository's NOTICE. macOS: the Apple logo from
  // Simple Icons 16.35.0 (the package is CC0; the logo is Apple's trademark), drawn filled.
  const ICONS = {
    nixos: { paths: ['m10 20-1.25-2.5L6 18', 'M10 4 8.75 6.5 6 6', 'm14 20 1.25-2.5L18 18', 'm14 4 1.25 2.5L18 6',
      'm17 21-3-6h-4', 'm17 3-3 6 1.5 3', 'M2 12h6.5L10 9', 'm20 10-1.5 2 1.5 2', 'M22 12h-6.5L14 15', 'm4 10 1.5 2L4 14',
      'm7 21 3-6-1.5-3', 'm7 3 3 6h4'] },
    macos: { filled: true, size: 16, paths: ['M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 ' +
      '3.014-2.117 3.675-.546 9.103 1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.039 1.52-.065 2.09-.987 3.935-.987 1.831 0 ' +
      '2.35.987 3.96.948 1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-' +
      '4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.61 1.09zM15.53 ' +
      '3.83c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662.805-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 ' +
      '2.715-.688 3.559-1.701'] },
    // Lucide 1.61.0 "keyboard" (ISC, as above)
    keymap: { paths: ['M10 8h.01', 'M12 12h.01', 'M14 8h.01', 'M16 12h.01', 'M18 8h.01', 'M6 8h.01', 'M7 16h10', 'M8 12h.01',
      'M2 6a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2z'] },
  };
  const DISPLAYS = { gpu: '3D window', window: 'Window', none: 'Headless' };
  const NETWORKS = { shared: 'Shared (NAT)', isolated: 'Isolated', none: 'None' };

  // --- the three catalogs: what each takes from catalog.json, its filters, sorts and card -------------------------

  const CATALOGS = {
    recipes: {
      noun: ['recipe', 'recipes'],
      intro: 'A recipe is what a VM is: a platform, the modules in it, a suggested look and key bindings, what it needs and how it runs.',
      filters: ['platform', 'host'],
      lab: true,
      sorts: { name: 'Name', platform: 'Platform', size: 'Smallest VM first' },
    },
    modules: {
      noun: ['entry', 'entries'],
      intro: 'Modules are the pieces recipes are made of – a desktop, a terminal, an editor, LaTeX … – in Nix, reviewed in their catalog. Key bindings give their actions keys.',
      filters: ['platform', 'part'],
      lab: false,
      sorts: { name: 'Name', platform: 'Platform', recipes: 'Most used first' },
    },
    looks: {
      noun: ['look', 'looks'],
      intro: 'A look is how a guest looks – colours for the desktop, the terminal and the editors, macOS’ appearance. It is data, installed like a recipe; the build chooses one.',
      filters: ['appearance'],
      lab: false,
      sorts: { name: 'Name', appearance: 'Dark first' },
    },
  };

  const $ = (sel, root = document) => root.querySelector(sel);
  const form = $('[data-filters]');
  const list = $('[data-list]');
  const tagBox = $('[data-tags]');
  const count = $('[data-count]');
  const empty = $('[data-empty]');
  const error = $('[data-error]');
  const resets = document.querySelectorAll('[data-reset]');
  const template = $('template[data-card]');
  const tabs = [...document.querySelectorAll('[data-tab]')];

  const params = new URLSearchParams(location.search);
  const source = parseSource(params.get('source'));
  const tab0 = CATALOGS[params.get('tab')] ? params.get('tab') : 'recipes';
  const state = {
    tab: tab0,
    q: params.get('q') || '',
    platform: PLATFORMS[params.get('platform')] ? params.get('platform') : '',
    host: HOSTS[params.get('host')] ? params.get('host') : '',
    part: ['module', 'keymap'].includes(params.get('part')) ? params.get('part') : '',
    appearance: ['dark', 'light', 'plain'].includes(params.get('appearance')) ? params.get('appearance') : '',
    sort: CATALOGS[tab0].sorts[params.get('sort')] ? params.get('sort') : 'name',
    lab: params.get('lab') === '1',
    tags: new Set((params.get('tag') || '').split(',').filter(Boolean)),
  };
  const items = { recipes: [], modules: [], looks: [] };
  const opened = new Set(); // cards with their details open – kept when the list is drawn again

  // A source: nothing (the official one), "owner/repo[@ref]", a github.com URL, or the HTTPS URL of a catalog.json.
  function parseSource(raw) {
    const text = (raw || '').trim();
    if (!text) return github(OFFICIAL.owner, OFFICIAL.repo, 'HEAD', '');
    const repo = text.replace(/^(https?:\/\/)?(www\.)?github\.com\//, '');
    const gh = repo.match(/^([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:@([\w./-]+)|\/tree\/([\w./-]+))?\/?$/);
    if (gh) return github(gh[1], gh[2], gh[3] || gh[4] || 'HEAD', text);
    // A catalog served next to this page (a path on this site: `/<folder>/catalog.json`) – for trying one locally
    if (/^\/[\w./-]*catalog\.json$/.test(text)) {
      const base = text.replace(/catalog\.json$/, '');
      return { url: text, base, tree: '', label: text, add: '<its folder or URL>', official: false, raw: text };
    }
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

  // --- reading the catalog: every value checked for its type ------------------------------------------------------

  const str = v => (typeof v === 'string' ? v : '');
  const arr = v => (Array.isArray(v) ? v.filter(x => typeof x === 'string') : []);
  const obj = v => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
  // A reference as catalog.json writes it ({id, version?, min?, max?}, or a string in older catalogs) → its label
  function refLabel(v) {
    if (typeof v === 'string') return v;
    const r = obj(v);
    if (!str(r.id)) return '';
    return [r.id, str(r.version), r.min ? `≥ ${str(r.min)}` : '', r.max ? `≤ ${str(r.max)}` : ''].filter(Boolean).join(' ');
  }
  const bare = label => label.split(' ')[0];

  function normRecipe(r) {
    const req = obj(r.requirements);
    const old = obj(r.defaults); // catalog v3: the VM's values flat
    const vm = Object.keys(obj(r.vm)).length ? obj(r.vm) : old;
    const out = {
      kind: 'recipe',
      author: str(r.author), platform: str(r.kind), name: str(r.name), path: str(r.path),
      title: str(r.name), description: str(r.description), tags: arr(r.tags), systems: arr(r.systems),
      license: str(r.license), homepage: str(r.homepage), version: str(r.version), lab: r.lab === true,
      modules: (Array.isArray(r.modules) ? r.modules : arr(r.requires)).map(refLabel).filter(Boolean),
      look: refLabel(r.look), keymaps: (Array.isArray(r.keymaps) ? r.keymaps : []).map(refLabel).filter(Boolean),
      cpus: Number(req.cpus || old.cpus) || 0, memory: Number(req.memory_gb || old.memory_gb) || 0,
      disk: Number(req.disk_gb || old.disk_gb) || 0, vm,
      locales: obj(r.locales), files: Array.isArray(r.files) ? r.files : [],
    };
    out.slug = `${out.author}/${out.platform}/${out.name}`;
    out.hosts = Object.keys(HOSTS).filter(h => HOSTS[h](out));
    out.haystack = [out.slug, out.description, out.tags.join(' '), out.license, out.modules.join(' '), out.look]
      .join(' ').toLowerCase();
    return out;
  }

  function normModule(m) {
    // module v2 (catalog v5): a key or mode may be one or several; after is the mode afterwards
    const several = v => (typeof v === 'string' ? [v] : arr(v));
    const actions = Object.entries(obj(m.actions)).map(([id, a]) => ({ id, title: str(obj(a).title),
      key: several(obj(a).key).join(' / '), mode: several(obj(a).mode).join(', '), after: str(obj(a).after) }));
    const out = {
      kind: 'module',
      author: str(m.author), platform: str(m.platform), name: str(m.name), path: str(m.path), title: str(m.title) || str(m.name),
      description: str(m.description), tags: arr(m.tags), license: str(m.license), homepage: str(m.homepage),
      version: str(m.version), provides: arr(m.provides), needs: arr(m.needs), enhances: arr(m.enhances),
      unfree: m.unfree === true, actions, files: Array.isArray(m.files) ? m.files : [],
    };
    out.ref = `${out.author}/${out.name}`;
    out.slug = `${out.author}/${out.platform}/${out.name}`;
    out.haystack = [out.slug, out.ref, out.title, out.description, out.tags.join(' '), out.provides.join(' ')].join(' ').toLowerCase();
    return out;
  }

  function normKeymap(k) {
    const keys = [];
    for (const [module, actions] of Object.entries(obj(k.keys))) {
      for (const [action, key] of Object.entries(obj(actions))) keys.push({ module, action, key: str(key) });
    }
    const out = {
      kind: 'keymap',
      author: str(k.author), platform: '', name: str(k.name), path: str(k.path), title: str(k.title) || str(k.name),
      description: str(k.description), tags: [], license: str(k.license), version: str(k.version), keys,
      files: Array.isArray(k.files) ? k.files : [],
    };
    out.ref = `${out.author}/${out.name}`;
    out.slug = out.ref;
    out.haystack = [out.slug, out.title, out.description, keys.map(x => x.module).join(' ')].join(' ').toLowerCase();
    return out;
  }

  function normLook(l) {
    const sw = obj(l.swatches);
    const out = {
      kind: 'look',
      author: str(l.author), platform: '', name: str(l.name), path: str(l.path), title: str(l.title) || str(l.name),
      description: str(l.description), tags: arr(l.tags), license: str(l.license), homepage: str(l.homepage),
      version: str(l.version), plain: l.plain === true, appearance: l.plain === true ? 'plain' : str(l.appearance) || 'dark',
      colors: l.plain === true ? [] : [sw.background, sw.surface, sw.text, sw.accent, sw.urgent, ...arr(sw.terminal).slice(1, 7)]
        .filter(c => typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c)),
      terminal: arr(sw.terminal).filter(c => /^#[0-9a-f]{6}$/i.test(c)),
      files: Array.isArray(l.files) ? l.files : [],
    };
    out.ref = `${out.author}/${out.name}`;
    out.slug = out.ref;
    out.haystack = [out.slug, out.title, out.description, out.tags.join(' '), out.appearance].join(' ').toLowerCase();
    return out;
  }

  // The recipes made of a module, key binding set or look (their names)
  function usedBy(item) {
    return items.recipes.filter(r => {
      if (item.kind === 'module') return r.platform === item.platform && r.modules.some(m => bare(m) === item.ref);
      if (item.kind === 'keymap') return r.keymaps.some(k => bare(k) === item.ref);
      return bare(r.look) === item.ref;
    });
  }

  // --- filtering --------------------------------------------------------------------------------------------------

  function matches(x, ignoreTags = false) {
    const c = CATALOGS[state.tab];
    if (x.lab && !state.lab) return false;
    if (c.filters.includes('platform') && state.platform && x.platform && x.platform !== state.platform) return false;
    if (c.filters.includes('platform') && state.platform && !x.platform && state.tab === 'modules') return false;
    if (c.filters.includes('host') && state.host && !x.hosts.includes(state.host)) return false;
    if (c.filters.includes('part') && state.part && x.kind !== state.part) return false;
    if (c.filters.includes('appearance') && state.appearance && x.appearance !== state.appearance) return false;
    if (!ignoreTags) for (const t of state.tags) if (!x.tags.includes(t)) return false;
    const words = state.q.toLowerCase().split(/\s+/).filter(Boolean);
    return words.every(w => x.haystack.includes(w));
  }

  function sorted(xs) {
    const name = (a, b) => a.title.localeCompare(b.title) || a.author.localeCompare(b.author);
    const by = {
      name,
      platform: (a, b) => a.platform.localeCompare(b.platform) || name(a, b),
      size: (a, b) => a.memory - b.memory || a.disk - b.disk || name(a, b),
      recipes: (a, b) => usedBy(b).length - usedBy(a).length || name(a, b),
      appearance: (a, b) => ['dark', 'light', 'plain'].indexOf(a.appearance) - ['dark', 'light', 'plain'].indexOf(b.appearance) || name(a, b),
    }[state.sort] || name;
    return [...xs].sort(by);
  }

  function render() {
    const c = CATALOGS[state.tab];
    const all = items[state.tab];
    const shown = sorted(all.filter(x => matches(x)));
    list.replaceChildren(...shown.map(card));
    const total = all.filter(x => state.lab || !x.lab).length;
    const noun = total === 1 ? c.noun[0] : c.noun[1];
    count.textContent = all.length ? `${shown.length} of ${total} ${noun}` : (loaded ? `No ${c.noun[1]} in this source` : '');
    empty.hidden = !all.length || shown.length > 0;
    const filtered = state.q || state.tags.size || c.filters.some(f => state[f]);
    resets.forEach(b => { b.hidden = !filtered; });
    renderTags();
    renderTabs();
    writeUrl();
  }

  function renderTabs() {
    for (const t of tabs) {
      const on = t.dataset.tab === state.tab;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
      const n = items[t.dataset.tab].filter(x => state.lab || !x.lab).length;
      $('[data-tab-count]', t).textContent = loaded ? String(n) : '';
    }
    const c = CATALOGS[state.tab];
    $('[data-intro]').textContent = c.intro;
    $('[data-panel]').setAttribute('aria-labelledby', `tab-${state.tab}`);
    form.querySelectorAll('[data-filter]').forEach(f => { f.hidden = !c.filters.includes(f.dataset.filter); });
    document.querySelectorAll('[data-help]').forEach(h => { h.hidden = h.dataset.help !== state.tab; });
    labToggle.hidden = !c.lab;
    form.q.placeholder = { recipes: 'Search name, description, tag, module …', modules: 'Search name, description, capability …',
      looks: 'Search name, description, tag …' }[state.tab];
  }

  // Tags with how many entries they would leave, given the other filters; a tag that leaves none is hidden.
  function renderTags() {
    const all = items[state.tab];
    const pool = all.filter(x => matches(x, true) && [...state.tags].every(t => x.tags.includes(t)));
    const counts = new Map();
    all.filter(x => matches(x, true)).forEach(x => x.tags.forEach(t => counts.set(t, 0)));
    pool.forEach(x => x.tags.forEach(t => counts.set(t, (counts.get(t) || 0) + 1)));
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
    if (state.tab !== 'recipes') p.set('tab', state.tab);
    if (state.q) p.set('q', state.q);
    for (const f of CATALOGS[state.tab].filters) if (state[f]) p.set(f, state[f]);
    if (state.tags.size) p.set('tag', [...state.tags].join(','));
    if (state.lab) p.set('lab', '1');
    if (state.sort !== 'name') p.set('sort', state.sort);
    const qs = p.toString();
    history.replaceState(null, '', location.pathname + (qs ? `?${qs}` : '') + location.hash);
  }

  // Switches to another catalog: its own filters start empty (a link from a recipe keeps its platform), the search is
  // what the link searches for
  function switchTo(tab, q, platform = '') {
    if (!CATALOGS[tab]) return;
    state.tab = tab;
    Object.assign(state, { platform, host: '', part: '', appearance: '', sort: 'name' });
    state.tags.clear();
    if (q !== undefined) state.q = q;
    syncForm();
    render();
  }

  // --- cards ------------------------------------------------------------------------------------------------------

  function el(tag, attrs = {}, text) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    if (text !== undefined) e.textContent = text;
    return e;
  }

  // A link to entries of another catalog: switches there and searches for it (a module: on the recipe's platform)
  function jump(tab, label, q, platform = '') {
    const b = el('button', { type: 'button', class: 'link-button' }, label);
    b.addEventListener('click', () => { switchTo(tab, q, platform); window.scrollTo({ top: $('[data-tabs]').offsetTop - 8 }); });
    return b;
  }

  function card(x) {
    const node = template.content.firstElementChild.cloneNode(true);
    node.id = `${x.kind}-${x.slug.replaceAll('/', '-')}`;
    $('[data-name]', node).append(el('a', { href: `#${node.id}` }, x.title));
    const badge = $('[data-badge]', node);
    if (x.lab) { badge.textContent = 'lab'; badge.hidden = false; }
    if (x.unfree) { badge.textContent = 'unfree'; badge.classList.add('warn'); badge.hidden = false; }
    const chip = $('[data-kind]', node);
    const iconOf = x.kind === 'keymap' ? 'keymap' : x.platform;
    chip.title = x.kind === 'keymap' ? 'Key bindings' : PLATFORMS[x.platform] || (x.kind === 'look' ? x.appearance : '');
    if (ICONS[iconOf]) chip.append(icon(ICONS[iconOf]), el('span', { class: 'visually-hidden' }, chip.title));
    else chip.textContent = chip.title;
    $('[data-id]', node).textContent = x.slug;
    if (x.path && source.tree) {
      const src = $('[data-source]', node);
      src.href = source.tree + x.path;
      src.title = 'Source';
      src.setAttribute('aria-label', `Source of ${x.slug}`);
      src.hidden = false;
    }
    $('[data-desc]', node).textContent = x.description;
    if (x.kind === 'look' && x.colors.length) {
      const strip = $('[data-swatches]', node);
      strip.append(...x.colors.map(c => el('span', { style: `background:${c}`, title: c })));
      strip.hidden = false;
    }

    const facts = [];
    const specs = [];
    let cmd = '';
    if (x.kind === 'recipe') {
      const linux = ['linux-x86_64', 'linux-aarch64'].filter(h => x.hosts.includes(h)).map(h => h.slice(6));
      if (x.hosts.includes('mac')) facts.push('Mac');
      if (linux.length) facts.push(`Linux ${linux.join(' · ')}`);
      if (x.vm.display) facts.push(DISPLAYS[x.vm.display] || String(x.vm.display));
      if (x.vm.ephemeral) facts.push('Ephemeral');
      if (x.modules.length) facts.push(`${x.modules.length} module${x.modules.length === 1 ? '' : 's'}`);
      if (x.modules.length) {
        specs.push(['Modules', x.modules.map(m => () => jump('modules', m, bare(m), x.platform))]);
      }
      if (x.look) specs.push(['Look', [() => jump('looks', x.look, bare(x.look))]]);
      if (x.keymaps.length) specs.push(['Key bindings', x.keymaps.map(k => () => jump('modules', k, bare(k)))]);
      if (x.cpus) specs.push(['Needs at least', `${x.cpus} CPU · ${x.memory} GB RAM · ${x.disk} GB disk`]);
      if (x.vm.display) specs.push(['Display', DISPLAYS[x.vm.display] || String(x.vm.display)]);
      if (x.vm.network) specs.push(['Network', NETWORKS[x.vm.network] || String(x.vm.network)]);
      if (x.vm.share !== undefined) specs.push(['Shared folder', x.vm.share ? 'yes' : 'no']);
      specs.push(['Changes', x.vm.ephemeral ? 'discarded at power-off' : 'kept']);
      const extras = ['audio', 'microphone', 'clipboard', 'camera'].filter(k => x.vm[k] === true);
      if (extras.length) specs.push(['On by default', extras.join(', ')]);
      const loc = x.locales;
      if (Array.isArray(loc.languages) && loc.languages.length) specs.push(['Languages', arr(loc.languages).join(', ')]);
      if (loc.rtl === false) specs.push(['Right-to-left', 'not made for it']);
      specs.push(['Systems', x.systems.join(', ') || '–']);
      cmd = `omaf recipes install ${x.slug}`;
    } else if (x.kind === 'module') {
      facts.push(x.version);
      facts.push(...x.provides);
      const users = usedBy(x);
      if (users.length) facts.push(`${users.length} recipe${users.length === 1 ? '' : 's'}`);
      if (x.provides.length) specs.push(['Provides', x.provides.join(', ')]);
      if (x.needs.length) specs.push(['Needs', x.needs.join(', ')]);
      if (x.enhances.length) specs.push(['Works with', x.enhances.map(e => () => jump('modules', e, e, x.platform))]);
      if (x.actions.length) specs.push(['Keys', x.actions.map(a => `${a.key} – ${a.title}${a.mode ? ` (${a.mode} mode${a.after ? `, then ${a.after}` : ''})` : ''}`).join('\n')]);
      if (users.length) specs.push(['Used by', users.map(r => () => jump('recipes', r.name, r.slug))]);
      cmd = `omaf modules install ${x.slug}`;
    } else if (x.kind === 'keymap') {
      facts.push(x.version, `${x.keys.length} keys`);
      const users = usedBy(x);
      if (users.length) facts.push(`${users.length} recipe${users.length === 1 ? '' : 's'}`);
      const byModule = new Map();
      x.keys.forEach(k => byModule.set(k.module, [...(byModule.get(k.module) || []), `${k.key} – ${k.action}`]));
      for (const [m, keys] of byModule) specs.push([m, keys.join('\n')]);
      if (users.length) specs.push(['Used by', users.map(r => () => jump('recipes', r.name, r.slug))]);
      cmd = `omaf modules install ${x.slug}`;
    } else {
      facts.push({ dark: 'Dark', light: 'Light', plain: 'Plain – each program its own colours' }[x.appearance] || x.appearance);
      if (x.version) facts.push(x.version);
      const users = usedBy(x);
      if (users.length) facts.push(`${users.length} recipe${users.length === 1 ? '' : 's'}`);
      if (x.terminal.length) specs.push(['Terminal', [() => palette(x.terminal)]]);
      if (users.length) specs.push(['Suggested by', users.map(r => () => jump('recipes', r.name, r.slug))]);
      cmd = `omaf looks install ${x.slug}`;
    }
    if (x.license) specs.push(['License', x.license]);
    const bytes = x.files.reduce((n, f) => n + (Number(f && f.size) || 0), 0);
    if (x.files.length) specs.push(['Files', `${x.files.length} · ${size(bytes)}`]);
    if (x.version && x.kind === 'recipe') specs.push(['Version', x.version.slice(0, 12)]);
    $('[data-facts]', node).append(...facts.filter(Boolean).map(f => el('li', {}, f)));

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
    // copy button), inside the open details (to select text there) and when text was selected.
    node.addEventListener('click', e => {
      const t = e.target;
      if (t.closest('summary')) return;
      if (t.closest('.recipe-name a')) e.preventDefault();
      else if (t.closest('a, button') || (details.open && t.closest('details'))) return;
      if (String(getSelection()).trim()) return;
      details.open = !details.open;
    });

    $('[data-card-tags]', node).append(...x.tags.map(t => {
      const b = el('button', { type: 'button', class: 'tag small', 'aria-pressed': String(state.tags.has(t)) }, t);
      b.addEventListener('click', () => toggleTag(t));
      return b;
    }));

    $('[data-specs]', node).append(...specs.flatMap(([k, v]) => {
      const dd = el('dd');
      if (Array.isArray(v)) {
        v.forEach((make, i) => {
          if (i) dd.append(', ');
          dd.append(make());
        });
      } else {
        dd.textContent = v;
        if (v.includes('\n')) dd.classList.add('lines');
      }
      return [el('dt', {}, k), dd];
    }));

    const full = (source.official ? '' : `omaf sources add ${source.add}\n`) + cmd;
    $('[data-cmd]', node).textContent = full;
    $('[data-copy]', node).addEventListener('click', e => copy(full, e.currentTarget));

    const links = $('[data-links]', node);
    if (/^https:\/\//.test(x.homepage || '')) links.append(el('a', { href: x.homepage, rel: 'nofollow noopener' }, 'Homepage'));
    links.hidden = !links.childNodes.length;
    return node;
  }

  // A look's 16 terminal colours as small squares
  function palette(colors) {
    const p = el('span', { class: 'palette' });
    p.append(...colors.map(c => el('span', { style: `background:${c}`, title: c })));
    return p;
  }

  // A 24×24 symbol: outlined like Lucide, or filled
  function icon({ paths, filled = false, size = 18 }) {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    const paint = filled ? { fill: 'currentColor' } : { fill: 'none', stroke: 'currentColor', 'stroke-width': 2,
      'stroke-linecap': 'round', 'stroke-linejoin': 'round' };
    for (const [k, v] of Object.entries({ viewBox: '0 0 24 24', width: size, height: size, 'aria-hidden': 'true', ...paint })) {
      svg.setAttribute(k, v);
    }
    for (const d of paths) {
      const path = document.createElementNS(ns, 'path');
      path.setAttribute('d', d);
      svg.append(path);
    }
    return svg;
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

  // --- form and tabs ----------------------------------------------------------------------------------------------

  function syncForm() {
    form.q.value = state.q;
    // RadioNodeList's value setter does not pick a radio whose value is empty ("All", "Any host")
    for (const f of ['platform', 'host', 'part', 'appearance']) form[f].forEach(r => { r.checked = r.value === state[f]; });
    labToggle.setAttribute('aria-pressed', String(state.lab));
    syncSort();
  }

  form.addEventListener('input', () => {
    state.q = form.q.value.trim();
    for (const f of ['platform', 'host', 'part', 'appearance']) state[f] = form[f].value;
    render();
  });

  tabs.forEach((t, i) => {
    t.addEventListener('click', () => { if (t.dataset.tab !== state.tab) switchTo(t.dataset.tab, ''); });
    t.addEventListener('keydown', e => {
      const next = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: tabs.length - 1 }[e.key];
      if (next === undefined) return;
      e.preventDefault();
      const to = tabs[(next + tabs.length) % tabs.length];
      switchTo(to.dataset.tab, '');
      to.focus();
    });
  });

  const labToggle = $('[data-lab-toggle]');
  labToggle.addEventListener('click', () => {
    state.lab = !state.lab;
    labToggle.setAttribute('aria-pressed', String(state.lab));
    render();
  });

  resets.forEach(b => b.addEventListener('click', () => {
    Object.assign(state, { q: '', platform: '', host: '', part: '', appearance: '' });
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

  // --- sort: a listbox of our own, so it looks the same in every browser; its options are the catalog's ------------

  const sortBox = $('[data-sort]');
  const sortButton = $('.sort-button', sortBox);
  const sortMenu = $('.sort-menu', sortBox);
  let active = 0;
  const options = () => [...sortMenu.querySelectorAll('[role=option]')];

  function syncSort() {
    const sorts = CATALOGS[state.tab].sorts;
    if (!sorts[state.sort]) state.sort = 'name';
    sortMenu.replaceChildren(...Object.entries(sorts).map(([value, label]) => {
      const o = el('li', { role: 'option', id: `sort-${value}`, 'data-value': value }, label);
      o.addEventListener('click', () => pickSort(options().indexOf(o)));
      o.addEventListener('mousemove', () => highlight(options().indexOf(o)));
      return o;
    }));
    $('[data-sort-value]', sortBox).textContent = sorts[state.sort];
    options().forEach(o => o.setAttribute('aria-selected', String(o.dataset.value === state.sort)));
  }

  function highlight(i) {
    const os = options();
    active = (i + os.length) % os.length;
    os.forEach((o, j) => o.classList.toggle('active', j === active));
    sortMenu.setAttribute('aria-activedescendant', os[active].id);
  }

  function openSort() {
    sortMenu.hidden = false;
    sortButton.setAttribute('aria-expanded', 'true');
    highlight(options().findIndex(o => o.dataset.value === state.sort));
    sortMenu.focus();
  }

  function closeSort(focusButton = true) {
    if (sortMenu.hidden) return;
    sortMenu.hidden = true;
    sortButton.setAttribute('aria-expanded', 'false');
    if (focusButton) sortButton.focus();
  }

  function pickSort(i) {
    state.sort = options()[i].dataset.value;
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
      Home: () => highlight(0), End: () => highlight(options().length - 1),
      Enter: () => pickSort(active), ' ': () => pickSort(active), Escape: () => closeSort(),
    };
    if (keys[e.key]) { e.preventDefault(); keys[e.key](); } else if (e.key === 'Tab') closeSort(false);
  });
  document.addEventListener('click', e => { if (!sortBox.contains(e.target)) closeSort(false); });

  // --- load -------------------------------------------------------------------------------------------------------

  let loaded = false;

  function showSource(catalog) {
    const s = obj(catalog.source);
    const line = $('[data-source-line]');
    if (source.official) {
      line.append('Source: ', el('a', { href: source.home }, 'omaflake/catalog'),
        ' – the official catalog, reviewed by the omaflake core team.');
    } else {
      line.classList.add('warn');
      const name = str(s.name) || source.label;
      line.append('Source: ', el('a', { href: source.home || source.url }, source.label), ` (${name}) – `,
        el('strong', {}, 'not reviewed by the omaflake team.'), ' Its modules’ Nix code runs on your computer when you build. ',
        el('a', { href: './' }, 'Back to the official catalog'));
      if (str(s.description)) $('[data-source-text]').textContent = s.description;
    }
    line.hidden = false;
  }

  async function load() {
    syncForm();
    renderTabs();
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
      if (!catalog || typeof catalog !== 'object') throw new Error('not a catalog');
      const list = k => (Array.isArray(catalog[k]) ? catalog[k].filter(x => x && typeof x === 'object') : []);
      items.recipes = list('recipes').map(normRecipe).filter(r => r.author && r.platform && r.name);
      items.modules = [...list('modules').map(normModule).filter(m => m.author && m.platform && m.name),
        ...list('keymaps').map(normKeymap).filter(k => k.author && k.name)];
      items.looks = list('looks').map(normLook).filter(l => l.author && l.name);
      showSource(catalog);
    } catch (e) {
      count.textContent = '';
      error.textContent = `The catalog could not be loaded from ${source.url} (${e.message}).`;
      error.hidden = false;
      return;
    }
    loaded = true;
    render();
    showLinked();
  }

  // A link to one entry (#<kind>-<author>-…): open its card (in its catalog), then drop the anchor from the URL so
  // that reloading the page does not open it again. The cards are built after load, so :target never applies.
  // The old recipes page's anchors (#<author>-<kind>-<name>) are recipes.
  function showLinked() {
    let id = location.hash && decodeURIComponent(location.hash.slice(1));
    if (!id) return;
    if (!/^(recipe|module|keymap|look)-/.test(id)) id = `recipe-${id}`;
    const tab = { recipe: 'recipes', module: 'modules', keymap: 'modules', look: 'looks' }[id.split('-')[0]];
    if (tab !== state.tab) switchTo(tab, '');
    const target = document.getElementById(id);
    if (!target) return;
    $('details', target).open = true;
    target.scrollIntoView();
    history.replaceState(null, '', location.pathname + location.search);
  }

  window.addEventListener('hashchange', showLinked);

  load();
})();
