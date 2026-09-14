# Implementation notes

## Release status

Version 1.2.0 is present locally. This is a release candidate until the remaining acceptance review and live deployment validation in WORK_HANDOFF.md are complete. No hosted deployment or GitHub CI result has been claimed. Version 1.2 reflects substantial hardening of the original app; it is not a new product or v2 rewrite.

## Deliberate decisions

- Replaced the existing Next.js/MUI starter instead of treating the repository as empty. The original implementation remains in Git history.
- Used current npm stable dependencies, except TypeScript 6.0: npm's TypeScript 7.0.2 was incompatible with typescript-eslint 8.70.0's supported range (<6.1). Node 24 LTS is recorded in .nvmrc.
- Replace import ships first. Merge is deferred under the explicit allowance in spec section 34.4. JSON IDs/revisions remain stable.
- System fonts and CSS tokens provide the visual system. Native dialogs handle confirmations; the mobile inspector traps keyboard focus. Accessible move/reorder buttons supplement dnd-kit pointer and keyboard sensors.
- Column behaviour changes affect future moves and do not rewrite timestamps. Items created directly in a workflow column remain unstarted until a workflow move, preserving the creation semantics in section 20.1.
- Calendar month views show a bounded number of entries per day; the timeline exposes overlapping work. Planned start-only entries are point markers with an explicit no-end label. Actual incomplete work extends through today. Date arithmetic is DST-safe.
- Persistent storage is requested explicitly in Settings. Browser permission behavior differs; denial never prevents using the app.
- Snapshots are generated before replacement and schema v2/v3 migrations, retaining the latest five. They are not daily snapshots and are not external backups. Database schema v3 adds a private archive ordering index; portable backups continue using the domain data format.
- Descriptions permit Markdown/GFM with raw HTML escaped and images disabled. External links require user activation. Inline style permission is needed for drag transforms, timeline positions and dynamic semantic colors; scripts and network requests remain self-only.
- The full calendar can read all item records when standalone task visibility is enabled; it never reads lifecycle history. The dashboard's default project calendar queries projects and their child tasks, excluding archived standalone task records. Further calendar range indexing and large-list virtualization are follow-up performance work.
- Settings, Archive and Markdown are loaded in separate chunks. The main JavaScript chunk is approximately 544 KB minified / 168 KB gzip, down from 714 KB / 219 KB. A size advisory remains; full calendar and board virtualization are still follow-up work.
- Archive uses an indexed completion/archive date and ID cursor with 50 results per page. All pages are reachable; filtered searches can scan more records. Global search is limited to 100 matches.
- Text autosave compares the original field value within the write transaction. Conflicts preserve the local draft and require explicit resolution. Other metadata uses normal transaction writes; there is no global dataset lock across tabs during replacement. Recovery drafts are in memory and can be downloaded as text, not restored as workspace backups.
- Automated axe checks cover representative routes, dialogs and the mobile inspector. This does not constitute full WCAG or screen-reader certification.
- The test-browser CDN failed during this session. Browser tests ran in installed Chrome using isolated temporary profiles. CI is configured to install Chromium.

See docs/adr for architecture rationale. See WORK_HANDOFF.md for verification evidence and prioritized follow-up work.
