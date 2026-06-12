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
  - **Adaptive**: applies aliases, collection key matching, nested penetration + normalizers
- Adaptive root detection (prefers `TcBspFrameworkResponse/ResponseData/Transaction/TransactionData/Invoice`)
- Rules editor JSON with built-in **NetSuite SOAP-to-REST Invoice Compatibility** preset
- Summary counts + compatibility score
- Detailed report table (severity/status/path/values/reason)
- Search and filters by severity and status
- Export report as JSON and CSV

## Built-in invoice preset rules

Included defaults:

- Collection matching
  - `Invoice.itemList.item` matchBy: `line`, `internalId`, `item`, `orderLine`
  - `Invoice.shipGroupList.shipGroup` matchBy: `id`
  - `Invoice.taxList.tax` matchBy: `taxCode`, `taxRate`
- Nested penetration alias
  - `Invoice.itemList.item.tcDiscountItem.item -> Invoice.itemList.item`
- Path aliases
  - `subTotal -> subtotal`
  - `transactionBillAddress.billPhone -> transactionBillAddress.billAddrPhone`
  - `billingAddress.phone -> billingAddress.addrPhone`
  - `transactionShipAddress.shipPhone -> transactionShipAddress.shipAddrPhone`
  - `shippingAddress.phone -> shippingAddress.addrPhone`
- Value alias examples
  - `_unitedStates`, `USA -> United States`
- Normalization options
  - whitespace trimming/collapsing
  - numeric (`10` vs `10.00`)
  - percent handling (`-100` vs `-100.00%`)
  - boolean (`True/False` vs `true/false`)
  - date normalization (including date-only equivalence)
  - phone normalization (`+18153893606`, `(815) 389-3606`, `815-389-3606`)
  - configurable empty vs zero relationship (`strict`/`warning`)

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
