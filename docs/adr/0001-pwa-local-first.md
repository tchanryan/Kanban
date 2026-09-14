# 0001 — Static, local-first PWA

Accepted 2026-09-14. Replace the existing minimal Next.js/MUI prototype with React, strict TypeScript and Vite. No backend, accounts, telemetry or external content requests. GitHub Pages serves static assets; hash routes survive reload at the repository base path. Service worker updates require an explicit restart and flush pending text edits first. Chromium desktop is the primary target.

Live work is scoped to a browser profile and origin. Browser storage is not an encrypted vault. OS account protection and disk encryption are the security boundary. Markdown images are disabled to prevent remote tracking; HTML is never interpreted. Only user-activated links may navigate externally.
