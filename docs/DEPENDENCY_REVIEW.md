# Dependency review — 16 September 2026

Reviewed the available Dependabot branches and applied compatible workflow updates locally. Hosted Actions execution remains necessary after pushing these changes; local application tests do not execute GitHub Actions themselves.

| Dependency            | Decision                   | Compatibility notes                                                                                                                                                                                |
| --------------------- | -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| checkout              | v4 → v6                    | Credentials move to a separate file. These workflows do not read Git credentials or run authenticated Git in containers. [Release notes](https://github.com/actions/checkout/releases/tag/v6.0.0). |
| setup-node            | v4 → v6                    | Explicit npm caching remains appropriate; the new automatic-cache restriction concerns other package managers. [Release notes](https://github.com/actions/setup-node/releases/tag/v6.0.0).         |
| upload-artifact       | v4 → v7                    | Keep default ZIP uploads for the Playwright report directory. The new direct-file option is opt-in. [Action inputs](https://github.com/actions/upload-artifact/blob/v7/action.yml).                |
| configure-pages       | v5 → v6                    | Node 24 runtime update; workflows use GitHub-hosted Ubuntu runners. [Release notes](https://github.com/actions/configure-pages/releases/tag/v6.0.0).                                               |
| upload-pages-artifact | v3 → v5                    | Updated Pages helper uses upload-artifact v7. Keep the existing dist directory input. [Release notes](https://github.com/actions/upload-pages-artifact/releases/tag/v5.0.0).                       |
| deploy-pages          | v4 → v5                    | Node 24 runtime update; deployment permissions and environment remain configured. [Release notes](https://github.com/actions/deploy-pages/releases/tag/v5.0.0).                                    |
| codeql-action         | v3 → v4                    | Both init and analyze updated together; JavaScript/TypeScript input remains supported. [Action definition](https://github.com/github/codeql-action/blob/v4/init/action.yml).                       |
| TypeScript            | Defer 7.0.2; retain ~6.0.0 | Installed typescript-eslint 8.70.0 parser declares TypeScript >=4.8.4 <6.1.0. Upgrade once the parser supports TypeScript 7, then run the full pipeline.                                           |

The earlier Pages deployment failure was repository configuration, not an E2E failure. Pages source was explicitly changed to GitHub Actions on 17 September 2026. Deployment of these changes awaits merge of PR #9. No remote dependency PRs were merged or closed during this review.

## Remaining manual accessibility acceptance

Use NVDA with Chrome on Windows or VoiceOver with Safari on macOS. Check capture, search, desktop details and narrow-screen details. Verify dialog names and initial focus are spoken, Escape restores the invoking control, nested confirmation has a clear description, save errors and recovery actions are understandable, and drag operations announce useful state. Record browser/screen-reader versions and findings. Automated keyboard and axe checks cannot validate actual speech output.
