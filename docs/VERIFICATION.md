# Verification performed

The latest UI and usability verification is recorded in [UI_IMPROVEMENTS.md](UI_IMPROVEMENTS.md), including **38 passing tests**, actual Edge browser scenarios, screenshot names, and remaining limits.

Run the backend and focused presentation suite:

```powershell
npm.cmd test
```

Run the actual browser walkthrough on this Windows machine:

```powershell
node tests/browser-qa.mjs
```

Browser QA uses the installed Microsoft Edge and a temporary profile under the project’s `data/` directory. It starts its own ephemeral local server and in-memory demo database, creates test orders through the supported workflow, captures `data/screenshots/ui-*.png`, and closes its browser/server afterward. It does not alter the persistent `data/demo.sqlite` demonstration database.

MySQL, real service integrations, and production hosting have not been verified. See [DECISIONS.md](DECISIONS.md) for integration blockers.
