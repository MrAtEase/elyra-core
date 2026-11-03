# Fixes Log

This pass only documented existing localhost/API references and added a contract check script. No production code changes or API base overrides were needed because the frontends already either guard themselves with environment variables (`NEXT_PUBLIC_API_URL`, `window.__MIRA_API_ORIGIN__`) or the localhost references are strictly for dev/testing tools. See `scan-results.md` for the collected hits and acceptability notes.
