# Call Tracking & Drop Detection Dashboard

This is a static GitHub Pages-ready dashboard. Put the published Google Sheets CSV URLs in `config.js`, commit the files, and serve the repo with GitHub Pages.

Open `index.html` directly, or run the local static server:

```powershell
powershell -ExecutionPolicy Bypass -File .\serve.ps1
```

Then visit:

```text
http://127.0.0.1:5173/
```

Paste the two published Google Sheets CSV URLs into `config.js`, or enter them in the data-source fields and click **Save & Load**. Browser-entered values override `config.js` on that machine. Explicit shop/task mappings can also be committed in `config.js`; any edits made in the Mapping tab are saved in browser local storage.

For GitHub Pages, use the repository root as the Pages source. The sheets must be published as CSV links that allow public read access.
