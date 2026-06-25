# Driftly — website

Static, dependency-free marketing & download site for Driftly. Bilingual (RU primary /
EN toggle), SEO-complete, with an animated self-running demo of the app.

## Preview locally

```bash
python3 -m http.server 8080   # then open http://localhost:8080
```

All local asset references are **relative**, so the site works when opened directly, from
a project subpath, or from a domain root.

## Deploy (GitHub Pages)

1. Enable Pages for this repository (Settings → Pages), serving from the `website/` folder
   (or copy `website/` to the publish root).
2. For a custom domain (the canonical URL is `https://driftly.app/`), add a `CNAME` file
   with the domain and configure DNS — same pattern as the owner's other sites.
3. The download buttons point at `https://github.com/adriaaante/shadow-user/releases/latest`.
   Publish the installers built by `app/ → npm run dist` to GitHub Releases and they go live.

## SEO assets

- `robots.txt`, `sitemap.xml`, `site.webmanifest`
- Open Graph / Twitter card image: `assets/img/og.svg`
- JSON-LD: `SoftwareApplication` + `FAQPage` (inline in `index.html`)

> Update the canonical/OG URLs in `index.html` and `sitemap.xml` if you host on a different
> domain than `driftly.app`.
