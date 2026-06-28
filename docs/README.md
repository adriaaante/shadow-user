# Driftly — website (`docs/`)

Static, dependency-free marketing & download site for Driftly, plus a **no-install web
app** under `app/`. Bilingual (RU primary / EN toggle), SEO-complete, with an animated
self-running demo. This folder is the **GitHub Pages publish root**.

## Live URL (GitHub Pages)

```
https://adriaaante.github.io/shadow-user/
```

The no-install web app: `https://adriaaante.github.io/shadow-user/app/`

## Enable GitHub Pages (matches Settings → Pages)

1. Make sure this `docs/` folder exists on the branch you publish from. Either **merge**
   `claude/sharp-fermi-t803lf` into `main`, or pick the feature branch in step 2.
2. Settings → Pages → **Build and deployment**:
   - **Source:** Deploy from a branch
   - **Branch:** `main` (or `claude/sharp-fermi-t803lf`) · **Folder:** `/docs`
   - **Save**
3. Wait ~1 min; the site goes live at the URL above.

All local asset paths are **relative**, so the site works at this project subpath, at a
custom domain root, or when opened locally.

## Custom domain (optional)

The canonical URL in `index.html`/`sitemap.xml` is `https://driftly.site/`. To use it, add a
`CNAME` file here containing `driftly.site` and point DNS at GitHub Pages (same pattern as
the owner's other sites). If you instead keep the `github.io` URL, update the canonical and
Open Graph URLs to match.

## Preview locally

```bash
python3 -m http.server 8080   # http://localhost:8080
```

## Downloads

Download buttons point at `https://github.com/adriaaante/shadow-user/releases/latest`.
Publish the installers built by `app/ → npm run dist` to GitHub Releases and they go live.

## SEO assets

`robots.txt`, `sitemap.xml`, `site.webmanifest`, OG image `assets/img/og.svg`, and inline
JSON-LD (`SoftwareApplication` + `FAQPage`).
