# Airtable Setup — Inventory Audit Base

This is a step-by-step guide to build the **Inventory Audit** base in Airtable, matching the plan at `/Users/aditya/.claude/plans/i-want-to-create-mossy-penguin.md`.

Total time: ~2–3 hours for first-time build.

> **About Airtable rollups & this design:** Airtable can't do "sum from a linked table filtered by date AND outlet AND SKU" in a single rollup field. So `dispatched_in_period`, `sold_in_period`, and `adjustments_in_period` on Audit_Lines are filled by a small **pre-fill script** that runs when an audit is created. Formulas only run after that. This is the standard Airtable pattern for cross-table aggregation.

---

## Step 0 — Account & base

1. Sign up at [airtable.com](https://airtable.com). The **Free** plan works for setup/testing; you'll need **Team** (₹2,000/user/mo billed annually as of 2026) to comfortably handle 213 SKUs × hundreds of outlets × monthly audits and to use Scripting + Automations at full power.
2. Create a new **Workspace** called "Kanav Audit". Inside it create an empty **Base** called "Inventory Audit".

---

## Step 1 — Build the 9 tables

Create each table in this order (link fields can only point to tables that already exist).

### 1.1 SKUs

| Field | Type | Notes |
|---|---|---|
| `sku_id` | Single line text (primary) | e.g. `SKU-0001` |
| `item_name` | Single line text | |
| `unit` | Single select | options: `piece`, `kg`, `g`, `ml` |
| `sale_price` | Currency | symbol `₹`, precision 2 |
| `category` | Single select | options: `Pickle`, `Papad`, `Namkeen`, `Sweets`, `Spices`, `Chutney`, `Chips`, `Pulses`, `Flour`, `Condiments`, `Beverages`, `Biscuits`, `Other` |
| `active` | Checkbox | |

**Import data:** click the dropdown on the SKUs tab → **Import data** → **CSV file** → upload `/Users/aditya/Kanav Audit Baba/sku_import.csv`. Map columns 1:1.

After import, fix the **11 SKUs with sale_price = 0** (Goli Dana Bottles, Aloo Papad Box 250g, Mix Fruit Jam 500g, Mango Heeng Pickle, Mango Sabut Masala Pickle, Missi Roti Atta 500g, Orus Dark Soya Sauce, Orus Green Chilli Sauce, Orus White Vinegar, Sweet Chilli Thai Sauce, Yatis Aloo Chips). The 65 "Other"-category items can stay until you decide a finer category scheme.

### 1.2 Outlets

| Field | Type | Notes |
|---|---|---|
| `outlet_id` | Autonumber (primary) | |
| `name` | Single line text | |
| `location` | Long text | |
| `manager_name` | Single line text | |
| `manager_phone` | Phone number | |
| `status` | Single select | `active`, `inactive` |
| `started_on` | Date | |
| `excluded_skus` | Link to SKUs | allow multiple records |

Add your 3 current outlets here.

### 1.3 Dispatches

| Field | Type | Notes |
|---|---|---|
| `dispatch_id` | Autonumber (primary) | |
| `outlet` | Link to Outlets | single record |
| `dispatched_on` | Date | |
| `dispatched_by` | Single line text | |
| `status` | Single select | `draft`, `sent`, `received`, `disputed` |
| `received_on` | Date | |
| `received_by` | Single line text | |

(The link to Dispatch_Lines is auto-created when we build that table next.)

### 1.4 Dispatch_Lines

| Field | Type | Notes / Formula |
|---|---|---|
| `line_id` | Autonumber (primary) | |
| `dispatch` | Link to Dispatches | single record |
| `sku` | Link to SKUs | single record |
| `qty_dispatched` | Number | precision 3 (handles kg fractions) |
| `qty_received` | Number | precision 3 |
| `line_variance` | Formula | `{qty_received} - {qty_dispatched}` |
| `outlet` (lookup) | Lookup | from `dispatch` → `outlet`. **Critical** — used by audit pre-fill. |
| `dispatched_on` (lookup) | Lookup | from `dispatch` → `dispatched_on` |

### 1.5 POS_Imports

| Field | Type |
|---|---|
| `import_id` | Autonumber (primary) |
| `outlet` | Link to Outlets |
| `period_start` | Date |
| `period_end` | Date |
| `uploaded_on` | Created time |
| `csv_attachment` | Attachment |

### 1.6 POS_Lines

| Field | Type | Notes |
|---|---|---|
| `pos_line_id` | Autonumber (primary) | |
| `pos_import` | Link to POS_Imports | |
| `sku` | Link to SKUs | |
| `qty_sold` | Number | precision 3 |
| `revenue` | Currency | optional sanity check |
| `outlet` (lookup) | Lookup | from `pos_import` → `outlet` |
| `period_start` (lookup) | Lookup | from `pos_import` → `period_start` |
| `period_end` (lookup) | Lookup | from `pos_import` → `period_end` |

### 1.7 Audits

| Field | Type |
|---|---|
| `audit_id` | Autonumber (primary) |
| `outlet` | Link to Outlets |
| `audit_date` | Date |
| `period_start` | Date |
| `hq_auditor` | Single line text |
| `outlet_witness` | Single line text |
| `status` | Single select: `in_progress`, `submitted`, `finalized`, `disputed` |
| `signed_off_at` | Date & time |
| `total_shortfall_value` | Rollup → from Audit_Lines.variance_value, function: `SUM(values)` |

### 1.8 Audit_Lines

| Field | Type | Notes / Formula |
|---|---|---|
| `audit_line_id` | Autonumber (primary) | |
| `audit` | Link to Audits | |
| `sku` | Link to SKUs | |
| `opening_qty` | Number | precision 3, filled by pre-fill script |
| `dispatched_in_period` | Number | precision 3, filled by pre-fill script |
| `sold_in_period` | Number | precision 3, filled by pre-fill script |
| `adjustments_in_period` | Number | precision 3, filled by pre-fill script |
| `expected_qty` | Formula | `{opening_qty} + {dispatched_in_period} - {sold_in_period} - {adjustments_in_period}` |
| `physical_qty` | Number | precision 3, **entered live during count** |
| `variance_qty` | Formula | `IF({physical_qty}, {physical_qty} - {expected_qty}, BLANK())` |
| `sale_price` (lookup) | Lookup | from `sku` → `sale_price` |
| `variance_value` | Formula | `{variance_qty} * {sale_price}` |
| `notes` | Long text | |

### 1.9 Adjustments

| Field | Type |
|---|---|
| `adjustment_id` | Autonumber (primary) |
| `outlet` | Link to Outlets |
| `sku` | Link to SKUs |
| `qty` | Number, precision 3 |
| `reason` | Single select: `damage`, `expiry`, `godown_return`, `internal_use`, `other` |
| `approved_by` | Single line text |
| `approved_on` | Date |
| `evidence_photo` | Attachment |

---

## Step 2 — The audit pre-fill script

This is the heart of the system. It runs whenever an Audit record is created and pre-populates one Audit_Line per active SKU for that outlet, with `opening_qty`, `dispatched_in_period`, `sold_in_period`, and `adjustments_in_period` filled in correctly.

### 2.1 Create the automation

1. Top bar → **Automations** → **Create automation**.
2. Name it: `Pre-fill audit lines on new audit`.
3. Trigger: **When record matches conditions** → Table: Audits → Conditions: `status` is `in_progress` AND `audit_date` is not empty.
4. Action: **Run a script**.

### 2.2 Paste this script

```javascript
// Inputs from the trigger
let auditRecordId = input.config().auditRecordId;

let auditTable = base.getTable("Audits");
let outletTable = base.getTable("Outlets");
let skuTable = base.getTable("SKUs");
let dispatchLineTable = base.getTable("Dispatch_Lines");
let posLineTable = base.getTable("POS_Lines");
let adjustmentTable = base.getTable("Adjustments");
let auditLineTable = base.getTable("Audit_Lines");

let audit = await auditTable.selectRecordAsync(auditRecordId, {
    fields: ["outlet", "audit_date", "period_start"]
});
if (!audit) { return; }

let outletLink = audit.getCellValue("outlet");
if (!outletLink || outletLink.length === 0) { return; }
let outletId = outletLink[0].id;
let auditDate = new Date(audit.getCellValue("audit_date"));
let periodStart = new Date(audit.getCellValue("period_start"));

// Load outlet's excluded SKUs
let outlet = await outletTable.selectRecordAsync(outletId, { fields: ["excluded_skus"] });
let excludedSet = new Set((outlet.getCellValue("excluded_skus") || []).map(r => r.id));

// Load active SKUs not excluded
let skuQuery = await skuTable.selectRecordsAsync({ fields: ["sku_id", "item_name", "active"] });
let activeSkus = skuQuery.records.filter(r => r.getCellValue("active") && !excludedSet.has(r.id));

// Helper to check date in [periodStart, auditDate]
let inPeriod = (d) => {
    if (!d) return false;
    let dt = new Date(d);
    return dt >= periodStart && dt <= auditDate;
};

// Load opening: previous finalized audit for this outlet, get its physical_qty per SKU
let prevAuditQuery = await auditTable.selectRecordsAsync({
    fields: ["outlet", "audit_date", "status"],
    sorts: [{ field: "audit_date", direction: "desc" }]
});
let prevAudit = prevAuditQuery.records.find(r => {
    let o = r.getCellValue("outlet");
    let s = r.getCellValue("status");
    let d = new Date(r.getCellValue("audit_date"));
    return o && o[0] && o[0].id === outletId && s && s.name === "finalized" && d < auditDate;
});

let openingBySku = {};
if (prevAudit) {
    let prevLines = await auditLineTable.selectRecordsAsync({
        fields: ["audit", "sku", "physical_qty"]
    });
    for (let ln of prevLines.records) {
        let a = ln.getCellValue("audit");
        if (a && a[0] && a[0].id === prevAudit.id) {
            let s = ln.getCellValue("sku");
            if (s && s[0]) {
                openingBySku[s[0].id] = ln.getCellValue("physical_qty") || 0;
            }
        }
    }
}

// Sum dispatched_in_period per SKU for this outlet
let dispLines = await dispatchLineTable.selectRecordsAsync({
    fields: ["sku", "qty_received", "outlet", "dispatched_on"]
});
let dispatchedBySku = {};
for (let ln of dispLines.records) {
    let o = ln.getCellValue("outlet");
    let d = ln.getCellValue("dispatched_on");
    if (o && o[0] && o[0].id === outletId && inPeriod(d)) {
        let s = ln.getCellValue("sku");
        if (s && s[0]) {
            dispatchedBySku[s[0].id] = (dispatchedBySku[s[0].id] || 0) + (ln.getCellValue("qty_received") || 0);
        }
    }
}

// Sum sold_in_period per SKU
let posLines = await posLineTable.selectRecordsAsync({
    fields: ["sku", "qty_sold", "outlet", "period_end"]
});
let soldBySku = {};
for (let ln of posLines.records) {
    let o = ln.getCellValue("outlet");
    let d = ln.getCellValue("period_end");
    if (o && o[0] && o[0].id === outletId && inPeriod(d)) {
        let s = ln.getCellValue("sku");
        if (s && s[0]) {
            soldBySku[s[0].id] = (soldBySku[s[0].id] || 0) + (ln.getCellValue("qty_sold") || 0);
        }
    }
}

// Sum adjustments_in_period per SKU
let adjLines = await adjustmentTable.selectRecordsAsync({
    fields: ["sku", "qty", "outlet", "approved_on"]
});
let adjBySku = {};
for (let ln of adjLines.records) {
    let o = ln.getCellValue("outlet");
    let d = ln.getCellValue("approved_on");
    if (o && o[0] && o[0].id === outletId && inPeriod(d)) {
        let s = ln.getCellValue("sku");
        if (s && s[0]) {
            adjBySku[s[0].id] = (adjBySku[s[0].id] || 0) + (ln.getCellValue("qty") || 0);
        }
    }
}

// Create one Audit_Line per active SKU (chunked at 50 — Airtable script limit)
let toCreate = activeSkus.map(sku => ({
    fields: {
        audit: [{ id: auditRecordId }],
        sku: [{ id: sku.id }],
        opening_qty: openingBySku[sku.id] || 0,
        dispatched_in_period: dispatchedBySku[sku.id] || 0,
        sold_in_period: soldBySku[sku.id] || 0,
        adjustments_in_period: adjBySku[sku.id] || 0,
    }
}));
while (toCreate.length > 0) {
    let chunk = toCreate.slice(0, 50);
    await auditLineTable.createRecordsAsync(chunk);
    toCreate = toCreate.slice(50);
}
```

### 2.3 Wire the input variable

In the script step, click **Add input variable** → name `auditRecordId` → value: the trigger's **Airtable record ID**.

### 2.4 Test

1. Add an Outlet, a few Dispatch_Lines (with received_on dates), and one POS_Import + lines.
2. Create an Audit: pick the outlet, set `period_start` and `audit_date`, status `in_progress`.
3. Wait ~30 seconds. The automation should fire and create one Audit_Line per active SKU. Verify `opening_qty`, `dispatched_in_period`, `sold_in_period` look right against the test data.

---

## Step 3 — Interfaces

### 3.1 HQ Dashboard interface

Top bar → **Interfaces** → **Build an interface** → **Dashboard** template. Pages to add:

1. **Overview** — number widget: total `total_shortfall_value` across audits this month. Bar chart: shortfall value by outlet.
2. **Per-outlet** — record picker: Outlet. Below it: filtered grid of that outlet's audits (sorted by audit_date desc); a chart showing shortfall trend over time.
3. **SKU heat map** — grid of Audit_Lines grouped by SKU, summing variance_value across all outlets. Items at the top are systemic losses (likely POS issue, not theft); items appearing in only one outlet are localised.
4. **Outlet leaderboard** — Outlets sorted by sum of shortfall this month (rollup field on Outlets).

### 3.2 Audit Capture interface (mobile-optimised)

Build → **Form** layout, but use Interfaces, not the legacy Form view, so it's structured.

Page 1 — "Start Audit": form to create an Audits record (outlet, period_start, audit_date defaults to today, hq_auditor, outlet_witness, status=in_progress).

Page 2 — "Count": grid of Audit_Lines filtered by current audit. Show columns: `sku.item_name`, `expected_qty`, `physical_qty` (editable), `variance_qty` (read-only, shows live as they type). Group by `category`. Sort by `item_name`.

Page 3 — "Submit": button that updates the Audit's `status` to `submitted` and `signed_off_at` to now.

Test on a phone — Airtable's interface preview is responsive.

---

## Step 4 — Automations (alerts)

In **Automations**, add three more:

### 4.1 Shortfall alert
- **Trigger:** When record updated (Audits) → status changes to `submitted`.
- **Condition:** `total_shortfall_value < -5000` (rupees, negative since shortfall is negative variance × price).
- **Action:** Send email to you with audit_id, outlet name, shortfall value, link to record.

### 4.2 Single-SKU spike
- **Trigger:** When record updated (Audit_Lines) → `variance_qty < -20`.
- **Action:** Send email with SKU name, outlet, qty, value.

### 4.3 Audit-stale reminder
- **Trigger:** At a scheduled time (daily 9 AM).
- **Action (script):** Find Audits with `status = in_progress` and `audit_date < TODAY() - 1`. Email reminder for each.

---

## Step 5 — First real audit (verification)

Run the verification checklist from the plan against your real data:

1. **SKU import sanity** — assign 1–2 `excluded_skus` to one outlet → create a test audit → confirm those SKUs don't appear in Audit_Lines.
2. **Dispatch flow** — create one real dispatch, mark received from a phone with one mismatched qty. Confirm `line_variance` shows.
3. **POS import** — upload last month's POS for one outlet. Verify POS_Lines populated.
4. **Live audit dry run** — pick your best outlet, do this month's audit on the phone using this app AND have the existing paper process running in parallel. Compare numbers at the end. They must match to the rupee. Any mismatch → fix the formula or pre-fill script before scaling.
5. **Dashboard** — confirm shortfall numbers match what you'd hand-calc.

Once the dry run matches paper, retire the paper process for that outlet. Repeat for the other two. After three clean monthly cycles you're ready to onboard the next outlets.

---

## Migration trigger to Postgres / Next.js

Stop adding outlets to Airtable when:
- Audit_Lines table is approaching 100k rows (Airtable Team plan cap), OR
- Audit Capture interface load time exceeds 3 seconds on a phone, OR
- You hire a dev and need fine-grained role permissions (outlet sees only their data).

The data model maps 1:1 to Postgres tables; export each Airtable table to CSV, define the Postgres schema, import. The script logic above becomes a Postgres trigger or an API endpoint.
