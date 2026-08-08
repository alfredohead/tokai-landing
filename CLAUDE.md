# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

`tokai-landing` is the marketing/landing site for TOKAI RWA (tokairwa.com), a real-world-asset tokenization advisory. It is a **static site with no build step**: every page under `public/` is a hand-written, self-contained HTML file (inline `<style>` and `<script>`, no bundler, no framework). The only server-side code is a single Vercel serverless function in `api/`.

Deployment is automatic: pushing to `main` triggers a Vercel build and production deploy (project `tokai-landing` under the `tokai-s-projects1` team). There is no local dev server defined in `package.json` — `package.json` carries no `scripts` at all, and there is no linter or test suite in this repo.

## Repository structure

- `public/index.html` — homepage. Self-contained (all CSS/JS inline), includes the embedded chatbot widget that POSTs to `/api/chat`.
- `public/platform.html` — the investor/issuer platform app. **Do not hand-edit.** It is a compiled build artifact regenerated elsewhere (via `build-front.js` against `tokai-platform_7.html` in the separate `tokai-plataforma` repo) and synced into this repo as a finished, mostly-minified file. Treat changes to it as "resync from upstream," not incremental edits.
- `public/<slug>/index.html` — guide/article pages (e.g. `erc-3643/`, `security-tokens/`, `fideicomiso-vs-spv/`). All follow one template: nav → hero (`eyebrow` + `h1` + `lead`) → `<article class="content">` with three `<h2>` sections → `<p class="note">` disclaimer → `<aside class="side">` with a "Más guías" cross-link list → footer. Shared visual styling lives in `public/seo.css`, loaded by every guide page (the homepage instead inlines its own CSS).
- `public/guias/index.html` — the guides hub/index; lists every guide as a visible `.card` and mirrors that list in a `CollectionPage.hasPart` JSON-LD block.
- `public/sitemap.xml`, `public/robots.txt`, `public/llms.txt` — crawler/AEO surface. `llms.txt` is a plain-English topic/page index aimed at LLM answer engines, separate from the sitemap.
- `api/chat.js` — the only backend code. A single Vercel Function implementing the public chat widget: IP rate-limited (10 req/60s), CORS-restricted to an allowlist of TOKAI domains, and calls a fallback chain of LLM providers in order (Groq → `tokai-backend.fly.dev` → NVIDIA NIM) until one returns a reply.
- `vercel.json` — rewrites `/api/v1/*` to the external Fly.io backend (`tokai-backend.fly.dev`), sets strict security headers (CSP, HSTS, frame-options, etc.) site-wide, and forces no-index/no-cache specifically on `platform.html`.

## Domain-lock pattern (intentional, not a bug)

Both `index.html` and `platform.html` embed an inline `<script>` at the very top of `<head>` that blanks the entire page with an "Error de Integridad" message unless `location.hostname` is in a hardcoded allowlist (`tokairwa.com`, `www.tokairwa.com`, `tokairwa.vercel.app`, `tokai.com.ar`, or any `*.vercel.app`). This is deliberate anti-cloning/anti-embedding protection — when adding a new top-level page that should render on preview deployments, make sure it either reuses this pattern or is deliberately left without it.

## Structured data (JSON-LD) conventions

- Site-wide entities (`Organization`, `WebSite`, `Service`) live **only** in `public/index.html`, keyed by stable `@id`s (`https://tokairwa.com/#organization`, etc.) that other pages could reference but currently don't.
- Every guide page carries its own `Article` + `BreadcrumbList` JSON-LD (Inicio → Guías → page). `Article` includes `image`, `datePublished` (full ISO 8601 with timezone — Google's Rich Results Test flags bare dates as invalid), `author.url`, and `publisher.logo`.
- **Adding a new guide requires touching four files, not just the page itself**: the new `public/<slug>/index.html`, an entry in `public/sitemap.xml`, both the visible `.card` and the `CollectionPage.hasPart` entry in `public/guias/index.html`, and a page/topic line in `public/llms.txt`. Cross-link it from 1-2 topically related existing guides' "Más guías" aside.
- Don't add `FAQPage` markup to a page unless it has actual visible Q&A content matching it — Google's policy (and AEO credibility generally) requires structured data to reflect what's visibly on the page.

## Known issue: hardcoded API credentials in `api/chat.js`

`api/chat.js` contains **live fallback API keys committed directly in source** in a **public** GitHub repo: a Groq key (built via `['gsk_...', ...].join('')` string-splitting, presumably to dodge naive secret scanners) and two NVIDIA NIM keys in plain string literals. These are used only if the corresponding `process.env` var is unset. This is a real, currently-live credential leak — treat it as a standing security issue, not proof the pattern is intentional or safe to replicate in new code.
