# tc-framework-netsuite-soap-vs-rest-xml-adaptive-comparer

Static GitHub Pages web tool for adaptively comparing NetSuite SOAP vs REST final XML.

## Privacy/Security

**All XML processing happens locally in your browser.** This app does not upload XML to any backend service.

## Features

- Browser-only static app (GitHub Pages friendly)
- Side-by-side SOAP (baseline) and REST (candidate) XML inputs
- Paste or load local `.xml` files
- Compare / Clear / Load Sample actions
- Modes:
  - **Strict**: exact path/value comparison after XML parsing, order-independent
  - **Normalized**: applies normalizers without deep structural remapping
  - **Adaptive**: reserved for structure-aware matching without built-in compatibility aliases
- Adaptive root detection (prefers `TcBspFrameworkResponse/ResponseData/Transaction/TransactionData/Invoice`)
- No compatibility/ignore preset rules; the default comparison does not hide paths or apply SOAP-to-REST aliases
- Summary counts + compatibility score
- CodeMirror-highlighted sorted XML comparison first, followed by a detailed flat report table
- Search and filters by severity and status
- Export report as JSON and CSV

## Default comparison behavior

- Same-level XML nodes and attributes are sorted alphabetically in the XML difference view.
- No path aliases, value aliases, ignore paths, collection matching rules, or nested path aliases are applied by default.
- Normalization still supports whitespace, numeric, percent, boolean, date, and phone value formatting comparisons.

## Local development

```bash
npm ci
npm run dev
```

Open the URL shown by Vite.

## Build and test

```bash
npm run lint
npm test
npm run build
```

Build output is in `dist/` and is static-hosting compatible.

## GitHub Pages deployment

This repo includes `.github/workflows/deploy-pages.yml` to build and publish `dist/` on pushes to `main`.

After merging to `main`:

1. In repository settings, enable **Pages** and set source to **GitHub Actions**.
2. Wait for the **Deploy GitHub Pages** workflow to complete.
3. Access site at `https://<owner>.github.io/<repo>/`.
