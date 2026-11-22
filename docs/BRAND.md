# Brand: Nirman (applied to the whole website)

Source: the Nirman Brand Kit supplied by Dhaval (copy kept in `docs/brand/`, including the guidelines sheet and design tokens). The website uses it as follows.

| Thing | Where | Notes |
|---|---|---|
| Logos | `public/identity/logo-horizontal.png` (light), `logo-horizontal-white.png` (dark backgrounds), `logo-stacked.png`, `icon-mark.png` / `.svg` | Horizontal logo in the sidebar and on the sign-in pages; icon mark in the phone top bar. PNGs are used instead of the SVG logos because the SVG wordmark needs fonts that an image cannot load. |
| Favicons and app icons | `public/identity/favicon.*`, `apple-touch-icon.png`, `android-chrome-*.png`, `maskable-512.png` | Linked from every page; the installed app (manifest) uses them. |
| Share image | `public/identity/og-image-1200x630.png` | `og:image` on the sign-in and enquiry pages. |
| Colours | `public/identity/brand-tokens.css` (the kit's own file) mapped in `brand-kit.css` | Navy `#0F2537` for text and structure, Safety Amber `#E86F2C` for the main action (navy text on amber, 4.8:1 contrast), Steel Slate `#2C4A63` for links and secondary, Concrete Light `#F6F8FA` for the page. Status colours: green `#16A34A`, amber `#D97706`, red `#DC2626` (always with a word). |
| Fonts | `public/identity/fonts/` (Inter body, Plus Jakarta Sans headings) | Self-hosted woff2 files (SIL Open Font License, free). The strict content-security rules do not allow Google Fonts, and self-hosting is faster on 4G. |
| Name | "Nirman" in the app, titles and installed-app name | Per the kit. Technical names (the request header, storage keys) still say NirmaanCRM; the legal pages (privacy, terms) keep the name used on the Google consent screen. |

Not changed on purpose: the company's own letterhead on printed documents (PO, demand letter, receipts) still uses the logo and colours in Branding, because those documents are the developer's, not the software's. The old per-brand colour file (`/brand/theme.css`) is no longer loaded by the app.
