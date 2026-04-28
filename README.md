# Audit Baba

Inventory audit MVP for Aroura Achar — Lucknow's pickle brand since 1944.

Replaces the paper-based monthly outlet audit with a mobile-first counting tool. HQ + outlet auditor count together on a phone; the system computes variance vs `(Opening + Dispatched − Sold)` live and produces a signed-off shortfall report.

## Stack

Single-page HTML app — no build step. Open [app/index.html](app/index.html) in a browser.

- Tailwind CSS (CDN)
- Alpine.js (CDN)
- Vanilla JS, localStorage persistence
- Brand fonts: Bricolage Grotesque, Poppins, Baloo 2

## Files

| File | Purpose |
|---|---|
| [app/index.html](app/index.html) | UI — brand-aligned views (dashboard, audit capture, outlets, SKUs, dispatches, POS, settings) |
| [app/app.js](app/app.js) | Audit logic, variance math, CSV import/export |
| [app/seed.js](app/seed.js) | 213 SKUs auto-generated from the source Excel |
| [audit-baba-design.html](audit-baba-design.html) | Standalone brand mockup gallery (6 phone screens + design system panel) |
| [AIRTABLE_SETUP.md](AIRTABLE_SETUP.md) | Steps to graduate from this prototype to a real Airtable backend |
| [sku_import.csv](sku_import.csv) | Cleaned SKU master from `StockSummaryReport_15_04_26-1.xlsx` |

## Running locally

```sh
open app/index.html
```

That's it. Everything runs in the browser. Data is stored in `localStorage`.

To try the flow with sample data: Settings → Load demo data, then Audits → New audit.

## Audit equation

```
Expected = Opening + Dispatched − Sold − Adjustments
Variance = Physical − Expected
Loss     = Variance × Sale price        (negative variance = outlet shortfall)
```

## Data model

9 entities, all in localStorage as JSON arrays:

`Outlets · SKUs · Dispatches · Dispatch_Lines · POS_Imports · POS_Lines · Audits · Audit_Lines · Adjustments`

The schema ports 1:1 to Postgres when the prototype outgrows browser storage (trigger: >50 outlets or >100k audit lines).

## Brand

Colors and typography pulled from the Aroura Achar brand style guide.

| Color | Hex | Use |
|---|---|---|
| Lal Mirch Red | `#E63946` | Primary CTA, alerts, shortfall |
| Amritsar Yellow | `#FFCE3D` | Highlights, sparkle motif |
| Green Mango | `#6CA653` | Success, on-track |
| Tamarind Brown | `#4B2E2E` | Body text, dark surfaces |
| Papad White | `#FAF9F6` | Background |

> हर गिनती का हिसाब — *account for every count.*
