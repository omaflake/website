# omaflake website

Static site for [omaflake](https://omaflake.app), deployed to GitHub Pages by `.github/workflows/pages.yml` on every push to `main`, under the
custom domain in `CNAME`. No build step: plain HTML, CSS and one small script.

- `index.html`, `style.css` – the page
- `download.js` – fills the download section from `update.json`; without it the page says the alpha is on its way
- `catalog/` – the catalog: `catalog.js` loads `catalog.json` of omaflake/catalog (or of the public source in
  `?source=owner/repo`) at view time and shows its three catalogs – recipes, modules with key bindings, looks – with
  one set of filters; a new entry needs no commit here. `recipes/` sends old links there.
- `update.json` – the release feed (spec §11.6): written by omaflake's release workflow, also read by the app's
  update check. Format: `{"version": "0.1.0", "url": "…/omaflake-0.1.0-unsigned.zip", "sha256": "…", "notes": null, "page": "…"}`.
  `url` must be publicly downloadable, and `<url>.sha256` must exist next to it (the install snippet checks it).
- `NOTICE` – third-party material the site embeds (a Lucide icon, ISC; the Apple logo from Simple Icons)
- favicons, `site.webmanifest`, `assets/` – copied from `omaflake/brand/` (edit there, regenerate, copy here)

Publishing a release: attach the zip and its `.sha256` to a public GitHub release, then commit its `update.json` here.

Preview locally:

```sh
python3 -m http.server 8000
```

All paths are relative, so the site also works at `https://omaflake.github.io/website/`.
