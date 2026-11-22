# Nirman — Construction CRM Brand Asset Kit

Cloud-ready, website-ready brand identity package for **Nirman**.

## Folder Structure

- **`01-Logos/SVG-Vector/`** — Resolution-independent vector logos (`horizontal`, `stacked`, `compact`, `icon-mark`, `monochrome`) for website headers, footers, and print.
- **`01-Logos/PNG-HighRes/`** — High-DPI transparent PNG exports (`1680px` horizontal, `1200px` stacked, `1024px` icon marks).
- **`02-Web-Favicons/`** — Complete web & PWA icon suite (`favicon.ico`, `favicon.svg`, `16x16`, `32x32`, `48x48`, `apple-touch-icon.png`, `android-chrome-192x192.png`, `android-chrome-512x512.png`, and `site.webmanifest`).
- **`03-Social-And-OG-Banners/`** — Website OpenGraph preview card (`1200x630`), LinkedIn company cover (`1584x396`), X/Twitter header (`1500x500`), and email signature banner (`600x150`).
- **`04-UI-Website-Assets/`** — Seamless architectural blueprint SVG background pattern (`hero-blueprint-pattern.svg`), CSS variables (`brand-tokens.css`), and JSON design tokens (`brand-tokens.json`).
- **`05-Brand-Guidelines/`** — Interactive HTML brand guideline sheet (`Nirman-Brand-Guidelines.html`) and documentation.

## Quick Cloud & Website Setup

1. Upload the entire folder to your Cloud bucket (e.g., AWS S3, Cloudflare R2, Google Cloud Storage, or Vercel/Netlify `/public/brand/`).
2. Copy the contents of `02-Web-Favicons/` into your website root `/` so browsers and mobile devices auto-discover `favicon.ico` and `site.webmanifest`.
3. Import `04-UI-Website-Assets/brand-tokens.css` into your main stylesheet.
