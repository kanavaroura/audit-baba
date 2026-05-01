// Inventory Audit — single-page app logic
// Persistence: localStorage. Designed for desktop + mobile.

const LS = {
  get(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key)) ?? fallback; }
    catch { return fallback; }
  },
  set(key, val) { localStorage.setItem(key, JSON.stringify(val)); },
};

// Expose helpers on window so Alpine x-text/x-show expressions can call them.
window.uid = (prefix) => prefix + "-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
window.todayISO = () => new Date().toISOString().slice(0, 10);
window.fmtINR = (n) => {
  if (n == null || isNaN(n)) return "—";
  return "₹" + (Math.round(n * 100) / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};
window.fmtQty = (n) => {
  if (n == null || n === "" || isNaN(n)) return "—";
  return (Math.round(n * 1000) / 1000).toLocaleString("en-IN");
};
const uid = window.uid, todayISO = window.todayISO, fmtINR = window.fmtINR, fmtQty = window.fmtQty;

function app() {
  return {
    // ---------- state ----------
    view: "dashboard",
    sidebarOpen: false,

    skus: LS.get("skus", []),
    outlets: LS.get("outlets", []),
    dispatches: LS.get("dispatches", []),
    dispatchLines: LS.get("dispatchLines", []),
    posImports: LS.get("posImports", []),
    posLines: LS.get("posLines", []),
    audits: LS.get("audits", []),
    auditLines: LS.get("auditLines", []),
    adjustments: LS.get("adjustments", []),

    // page-local state
    skuSearch: "",
    skuFilterCategory: "",
    skuEditingId: null,

    outletDraft: null, // { id?, name, location, manager_name, manager_phone, status, excluded_skus }
    outletDetailId: null,
    outletDetailFilter: "",
    outletDetailHideZero: true,
    outletDetailSort: "value_desc", // value_desc | qty_desc | name_asc

    dispatchDraft: null, // { outlet, dispatched_on, dispatched_by, status, lines: [...] }
    dispatchAckId: null, // dispatch being acknowledged by outlet

    posUpload: { outlet: "", period_start: "", period_end: "", parsed: null, error: "", unmatched: [] },
    stockImport: { outlet: "", period_start: "", closing_date: "", parsed: null, error: "", unmatched: [] },
    _ackLines: [],

    auditDraft: null,
    auditCaptureId: null,
    auditFilter: "",
    auditCategory: "",

    toast: "",

    // ---------- auth ----------
    users: LS.get("users", []),
    currentUserId: LS.get("currentUserId", null),
    loginUsername: "",
    loginPassword: "",
    loginError: "",
    userDraft: null,
    skuImport: { parsed: null, error: "", added: 0, skipped: 0 },

    get currentUser() { return this.users.find(u => u.id === this.currentUserId) || null; },
    get currentRole() { return this.currentUser?.role || null; },

    // ---------- init ----------
    init() {
      if (!this.skus.length && window.SEED_SKUS) {
        this.skus = window.SEED_SKUS.map(s => ({ id: s.sku_id, ...s, packed: true }));
        this.persist("skus");
        this.notify(`Loaded ${this.skus.length} SKUs from seed`);
      }
      // Migrate: stamp packed:true on existing SKUs that pre-date this field
      let skuMigrated = false;
      for (const s of this.skus) { if (s.packed === undefined) { s.packed = true; skuMigrated = true; } }
      if (skuMigrated) this.persist("skus");
      // Migrate: stamp outlet_type on existing outlets
      let outletMigrated = false;
      for (const o of this.outlets) { if (!o.outlet_type) { o.outlet_type = "regular"; outletMigrated = true; } }
      if (outletMigrated) this.persist("outlets");
      // Seed default users if none exist
      if (!this.users.length) {
        this.users = [
          { id: "usr-owner",   name: "Owner",   username: "owner",   password: "0000", role: "owner" },
          { id: "usr-manager", name: "Manager", username: "manager", password: "1111", role: "manager" },
          { id: "usr-auditor", name: "Auditor", username: "auditor", password: "2222", role: "auditor" },
        ];
        this.persist("users");
      }
      // route via hash if present
      const h = location.hash.slice(1);
      if (h) this.view = h;
      window.addEventListener("hashchange", () => {
        const nh = location.hash.slice(1);
        if (nh) this.view = nh;
      });
    },

    persist(key) { LS.set(key, this[key]); },
    persistAll() {
      ["skus","outlets","dispatches","dispatchLines","posImports","posLines","audits","auditLines","adjustments","users"]
        .forEach(k => this.persist(k));
    },

    go(view) {
      this.view = view;
      this.sidebarOpen = false;
      location.hash = view;
      window.scrollTo(0, 0);
    },

    login() {
      const user = this.users.find(u => u.username === this.loginUsername.trim() && u.password === this.loginPassword);
      if (!user) { this.loginError = "Wrong username or password."; return; }
      this.currentUserId = user.id;
      LS.set("currentUserId", user.id);
      this.loginUsername = "";
      this.loginPassword = "";
      this.loginError = "";
    },
    logout() {
      this.currentUserId = null;
      LS.set("currentUserId", null);
      this.view = "dashboard";
    },
    newUserDraft() {
      this.userDraft = { id: null, name: "", username: "", password: "", role: "auditor" };
    },
    editUserDraft(id) {
      this.userDraft = JSON.parse(JSON.stringify(this.users.find(u => u.id === id)));
    },
    saveUserDraft() {
      const d = this.userDraft;
      if (!d.name.trim() || !d.username.trim() || !d.password.trim()) { this.notify("Name, username and password required"); return; }
      if (!d.id && this.users.find(u => u.username === d.username.trim())) { this.notify("Username already taken"); return; }
      d.username = d.username.trim();
      if (d.id) {
        const i = this.users.findIndex(u => u.id === d.id);
        this.users[i] = { ...d };
      } else {
        d.id = uid("USR");
        this.users.push({ ...d });
      }
      this.persist("users");
      this.userDraft = null;
      this.notify("User saved");
    },
    deleteUser(id) {
      if (this.currentUserId === id) { this.notify("Cannot delete yourself"); return; }
      if (!confirm("Delete this user?")) return;
      this.users = this.users.filter(u => u.id !== id);
      this.persist("users");
      this.notify("User deleted");
    },

    notify(msg) {
      this.toast = msg;
      clearTimeout(this._toastT);
      this._toastT = setTimeout(() => this.toast = "", 2500);
    },

    // ---------- helpers ----------
    skuById(id) { return this.skus.find(s => s.id === id); },
    outletById(id) { return this.outlets.find(o => o.id === id); },
    auditById(id) { return this.audits.find(a => a.id === id); },

    get categories() {
      return [...new Set(this.skus.map(s => s.category))].sort();
    },

    get filteredSkus() {
      const q = this.skuSearch.trim().toLowerCase();
      return this.skus.filter(s => {
        if (this.skuFilterCategory && s.category !== this.skuFilterCategory) return false;
        if (q && !s.item_name.toLowerCase().includes(q) && !s.id.toLowerCase().includes(q)) return false;
        return true;
      });
    },

    activeOutletSkus(outletId) {
      const outlet = this.outletById(outletId);
      const excluded = new Set(outlet?.excluded_skus || []);
      const isKiosk = outlet?.outlet_type === "express_kiosk";
      return this.skus.filter(s => s.active && !excluded.has(s.id) && (!isKiosk || s.packed));
    },

    // ---------- DASHBOARD ----------
    get dashboardStats() {
      const thisMonth = todayISO().slice(0, 7);
      const monthAudits = this.audits.filter(a => a.audit_date.startsWith(thisMonth));
      const monthLines = this.auditLines.filter(l => monthAudits.some(a => a.id === l.audit_id));
      const totalShortfall = monthLines.reduce((s, l) => {
        const vv = this.auditLineVarianceValue(l);
        return s + (vv !== null && vv < 0 ? vv : 0);
      }, 0);
      const byOutlet = {};
      for (const l of monthLines) {
        const a = monthAudits.find(x => x.id === l.audit_id);
        if (!a) continue;
        const vv = this.auditLineVarianceValue(l);
        byOutlet[a.outlet_id] = (byOutlet[a.outlet_id] || 0) + (vv !== null && vv < 0 ? vv : 0);
      }
      const bySku = {};
      for (const l of this.auditLines) {
        const vv = this.auditLineVarianceValue(l);
        if (vv !== null && vv < 0) bySku[l.sku_id] = (bySku[l.sku_id] || 0) + vv;
      }
      const topLossSkus = Object.entries(bySku)
        .sort((a, b) => a[1] - b[1])
        .slice(0, 10)
        .map(([sku_id, val]) => ({ sku: this.skuById(sku_id), value: val }));
      return {
        totalShortfall,
        auditsThisMonth: monthAudits.length,
        outletShortfalls: Object.entries(byOutlet)
          .map(([id, v]) => ({ outlet: this.outletById(id), value: v }))
          .sort((a, b) => a.value - b.value),
        topLossSkus,
        recentAudits: [...this.audits].sort((a, b) => b.audit_date.localeCompare(a.audit_date)).slice(0, 5),
      };
    },

    // ---------- SKU import ----------
    skuSheetSelected(ev) {
      const file = ev.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (e) => {
        try { this.parseSkuSheet(e.target.result); }
        catch (err) { this.skuImport.error = err.message; this.skuImport.parsed = null; }
      };
      reader.readAsText(file);
    },
    parseSkuSheet(text) {
      const lines = text.split(/\r?\n/).filter(l => l.trim());
      if (!lines.length) throw new Error("Empty file");
      const rawHeader = lines[0].split(",").map(s => s.trim().replace(/^"|"$/g, "").toLowerCase());
      const findCol = (...names) => {
        for (const n of names) { const i = rawHeader.findIndex(h => h.includes(n)); if (i >= 0) return i; }
        return -1;
      };
      const idxName  = findCol("item name", "item_name");
      if (idxName < 0) throw new Error("CSV must have an 'Item Name' column");
      const idxUnit  = findCol("unit");
      const idxPrice = findCol("sale price", "sale_price", "price");
      const idxCat   = findCol("category");
      const parsed = [];
      for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split(",").map(s => s.trim().replace(/^"|"$/g, ""));
        if (!cols[idxName]) continue;
        parsed.push({
          item_name:  cols[idxName],
          unit:       idxUnit  >= 0 ? (cols[idxUnit]  || "piece") : "piece",
          sale_price: idxPrice >= 0 ? (parseFloat(cols[idxPrice]) || 0) : 0,
          category:   idxCat   >= 0 ? (cols[idxCat]   || "Other") : "Other",
        });
      }
      this.skuImport.parsed = parsed;
      this.skuImport.error = "";
    },
    confirmSkuImport() {
      if (!this.skuImport.parsed?.length) return;
      const existing = new Set(this.skus.map(s => s.item_name.toLowerCase()));
      let added = 0, skipped = 0;
      for (const row of this.skuImport.parsed) {
        if (existing.has(row.item_name.toLowerCase())) { skipped++; continue; }
        const id = uid("SKU");
        this.skus.push({ id, sku_id: id, item_name: row.item_name, unit: row.unit, sale_price: row.sale_price, category: row.category, active: true, packed: true });
        existing.add(row.item_name.toLowerCase());
        added++;
      }
      this.persist("skus");
      this.skuImport = { parsed: null, error: "", added, skipped };
      this.notify(`${added} SKUs added, ${skipped} duplicates skipped`);
    },

    // ---------- SKUs ----------
    saveSkuEdit(sku) {
      this.persist("skus");
      this.skuEditingId = null;
      this.notify("SKU updated");
    },
    deleteSku(id) {
      if (!confirm("Delete this SKU? Audit lines referencing it will lose their item name.")) return;
      this.skus = this.skus.filter(s => s.id !== id);
      this.persist("skus");
      this.notify("SKU deleted");
    },
    addSku() {
      const sku = { id: uid("SKU"), sku_id: uid("SKU"), item_name: "New item", unit: "piece", sale_price: 0, category: "Other", active: true, packed: true };
      this.skus.unshift(sku);
      this.persist("skus");
      this.skuEditingId = sku.id;
    },

    // ---------- Outlets ----------
    newOutletDraft() {
      this.outletDraft = { id: null, name: "", location: "", manager_name: "", manager_phone: "", status: "active", outlet_type: "regular", started_on: todayISO(), excluded_skus: [] };
    },
    editOutlet(id) {
      const o = this.outletById(id);
      this.outletDraft = JSON.parse(JSON.stringify(o));
    },
    saveOutletDraft() {
      const d = this.outletDraft;
      if (!d.name.trim()) { this.notify("Outlet name required"); return; }
      if (d.id) {
        const i = this.outlets.findIndex(o => o.id === d.id);
        this.outlets[i] = d;
      } else {
        d.id = uid("OUT");
        this.outlets.push(d);
      }
      this.persist("outlets");
      this.outletDraft = null;
      this.notify("Outlet saved");
    },
    deleteOutlet(id) {
      if (!confirm("Delete this outlet? Linked dispatches/audits will become orphaned.")) return;
      this.outlets = this.outlets.filter(o => o.id !== id);
      this.persist("outlets");
    },
    openOutletDetail(id) {
      this.outletDetailId = id;
      this.go("outlet-detail");
    },

    // ---------- Outlet stock (current book stock) ----------
    // Returns rows with computed current qty for every active, non-excluded SKU at the outlet.
    // qty = opening_at_last_finalized_audit + dispatched_since - sold_since - adjustments_since.
    // If no prior audit, opening = 0 and "since" starts at outlet.started_on.
    currentBookStock(outletId) {
      const outlet = this.outletById(outletId);
      if (!outlet) return [];
      const excluded = new Set(outlet.excluded_skus || []);
      const today = todayISO();

      const lastAudit = [...this.audits]
        .filter(a => a.outlet_id === outletId && a.status === "finalized")
        .sort((a, b) => b.audit_date.localeCompare(a.audit_date))[0];
      const periodStart = lastAudit ? lastAudit.audit_date : (outlet.started_on || "1970-01-01");

      // Pre-index audit lines by sku for the last audit (avoids 213 array scans)
      const openingBySku = {};
      if (lastAudit) {
        for (const ln of this.auditLines) {
          if (ln.audit_id === lastAudit.id) openingBySku[ln.sku_id] = ln.physical_qty ?? 0;
        }
      }

      const rows = [];
      for (const sku of this.skus) {
        if (!sku.active || excluded.has(sku.id)) continue;
        const opening = openingBySku[sku.id] || 0;
        const dispatched = this.computeDispatched(outletId, sku.id, periodStart, today);
        const sold = this.computeSold(outletId, sku.id, periodStart, today);
        const adj = this.computeAdjustments(outletId, sku.id, periodStart, today);
        const qty = opening + dispatched - sold - adj;
        const value = qty * (sku.sale_price || 0);
        rows.push({
          sku_id: sku.id, item_name: sku.item_name, category: sku.category,
          unit: sku.unit, sale_price: sku.sale_price,
          opening, dispatched, sold, adj, qty, value,
        });
      }
      return rows;
    },

    get filteredOutletStock() {
      if (!this.outletDetailId) return [];
      const all = this.currentBookStock(this.outletDetailId);
      const q = this.outletDetailFilter.trim().toLowerCase();
      let filtered = all.filter(r => {
        if (this.outletDetailHideZero && Math.abs(r.qty) < 0.001) return false;
        if (q && !r.item_name.toLowerCase().includes(q) && !r.sku_id.toLowerCase().includes(q)) return false;
        return true;
      });
      const sort = this.outletDetailSort;
      if (sort === "value_desc") filtered.sort((a, b) => b.value - a.value);
      else if (sort === "qty_desc") filtered.sort((a, b) => b.qty - a.qty);
      else if (sort === "name_asc") filtered.sort((a, b) => a.item_name.localeCompare(b.item_name));
      return filtered;
    },

    get outletDetailStats() {
      if (!this.outletDetailId) return null;
      const all = this.currentBookStock(this.outletDetailId);
      const totalValue = all.reduce((s, r) => s + r.value, 0);
      const inStockCount = all.filter(r => Math.abs(r.qty) > 0.001).length;
      const lastAudit = [...this.audits]
        .filter(a => a.outlet_id === this.outletDetailId)
        .sort((a, b) => b.audit_date.localeCompare(a.audit_date))[0];
      const lastDispatch = [...this.dispatches]
        .filter(d => d.outlet_id === this.outletDetailId && d.status === "received")
        .sort((a, b) => (b.received_on || "").localeCompare(a.received_on || ""))[0];
      return {
        totalValue,
        inStockCount,
        activeSkuCount: all.length,
        lastAuditDate: lastAudit?.audit_date,
        lastAuditStatus: lastAudit?.status,
        lastDispatchDate: lastDispatch?.received_on,
      };
    },

    exportOutletStockCsv(outletId) {
      const outlet = this.outletById(outletId);
      const rows = this.currentBookStock(outletId).sort((a, b) => b.value - a.value);
      const header = ["sku_id","item_name","unit","sale_price","opening","dispatched","sold","adjustments","qty","value"];
      const lines = [header.join(",")];
      for (const r of rows) {
        lines.push([
          r.sku_id, `"${r.item_name.replace(/"/g,'""')}"`, r.unit, r.sale_price,
          r.opening, r.dispatched, r.sold, r.adj, r.qty, Math.round(r.value*100)/100,
        ].join(","));
      }
      const blob = new Blob([lines.join("\n")], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `stock-${outlet?.name || outletId}-${todayISO()}.csv`;
      link.click();
      URL.revokeObjectURL(url);
    },

    // ---------- Dispatches ----------
    newDispatchDraft() {
      this.dispatchDraft = {
        id: null,
        outlet_id: this.outlets[0]?.id || "",
        dispatched_on: todayISO(),
        dispatched_by: "",
        status: "draft",
        lines: [],
      };
    },
    addDispatchLine() {
      this.dispatchDraft.lines.push({ id: uid("DL"), sku_id: "", qty_dispatched: 0, qty_received: null });
    },
    removeDispatchLine(idx) {
      this.dispatchDraft.lines.splice(idx, 1);
    },
    saveDispatch(status) {
      const d = this.dispatchDraft;
      if (!d.outlet_id) { this.notify("Pick an outlet"); return; }
      if (!d.lines.length) { this.notify("Add at least one line"); return; }
      for (const ln of d.lines) {
        if (!ln.sku_id || ln.qty_dispatched <= 0) { this.notify("Each line needs SKU and qty > 0"); return; }
      }
      d.status = status;
      if (!d.id) {
        d.id = uid("DSP");
        this.dispatches.unshift({
          id: d.id, outlet_id: d.outlet_id, dispatched_on: d.dispatched_on,
          dispatched_by: d.dispatched_by, status: d.status, received_on: null, received_by: ""
        });
        for (const ln of d.lines) {
          this.dispatchLines.push({ id: ln.id, dispatch_id: d.id, sku_id: ln.sku_id,
            qty_dispatched: ln.qty_dispatched, qty_received: ln.qty_received });
        }
      } else {
        const idx = this.dispatches.findIndex(x => x.id === d.id);
        this.dispatches[idx] = { ...this.dispatches[idx], status: d.status };
      }
      this.persistAll();
      this.dispatchDraft = null;
      this.notify(status === "draft" ? "Saved as draft" : "Dispatch sent");
    },
    openAckDispatch(id) {
      const dl = this.dispatchLines.filter(l => l.dispatch_id === id)
        .map(l => ({ ...l, qty_received: l.qty_received ?? l.qty_dispatched }));
      this.dispatchAckId = id;
      this._ackLines = dl;
    },
    confirmAckDispatch() {
      const d = this.dispatches.find(x => x.id === this.dispatchAckId);
      d.status = "received";
      d.received_on = todayISO();
      for (const ln of this._ackLines) {
        const orig = this.dispatchLines.find(l => l.id === ln.id);
        orig.qty_received = ln.qty_received;
      }
      this.persistAll();
      this.dispatchAckId = null;
      this.notify("Receipt confirmed");
    },
    dispatchLinesFor(id) { return this.dispatchLines.filter(l => l.dispatch_id === id); },

    // ---------- POS ----------
    posCsvSelected(ev) {
      const file = ev.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (e) => {
        try { this.parsePosCsv(e.target.result); }
        catch (err) { this.posUpload.error = err.message; this.posUpload.parsed = null; }
      };
      reader.readAsText(file);
    },
    parsePosCsv(text) {
      // Accept either: sku_id,qty_sold,revenue  OR  item_name,qty_sold,revenue
      const lines = text.split(/\r?\n/).filter(l => l.trim());
      if (!lines.length) throw new Error("Empty file");
      const header = lines[0].split(",").map(s => s.trim().toLowerCase());
      const hasSkuId = header.includes("sku_id");
      const hasItemName = header.includes("item_name");
      if (!hasSkuId && !hasItemName) throw new Error("CSV must have sku_id or item_name column");
      if (!header.includes("qty_sold")) throw new Error("CSV must have qty_sold column");
      const idxSku = header.indexOf("sku_id");
      const idxName = header.indexOf("item_name");
      const idxQty = header.indexOf("qty_sold");
      const idxRev = header.indexOf("revenue");
      const parsed = []; const unmatched = [];
      for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split(",").map(s => s.trim());
        let sku = null;
        if (hasSkuId && cols[idxSku]) sku = this.skus.find(s => s.id === cols[idxSku] || s.sku_id === cols[idxSku]);
        if (!sku && hasItemName && cols[idxName]) sku = this.skus.find(s => s.item_name.toLowerCase() === cols[idxName].toLowerCase());
        if (!sku) { unmatched.push(cols[idxName] || cols[idxSku] || `(row ${i+1})`); continue; }
        parsed.push({
          sku_id: sku.id,
          item_name: sku.item_name,
          qty_sold: parseFloat(cols[idxQty]) || 0,
          revenue: idxRev >= 0 ? (parseFloat(cols[idxRev]) || 0) : 0,
        });
      }
      this.posUpload.parsed = parsed;
      this.posUpload.unmatched = unmatched;
      this.posUpload.error = "";
    },
    confirmPosImport() {
      const u = this.posUpload;
      if (!u.outlet || !u.period_start || !u.period_end || !u.parsed?.length) {
        this.notify("Fill outlet, period, and upload a valid CSV");
        return;
      }
      const importId = uid("PIM");
      this.posImports.unshift({
        id: importId, outlet_id: u.outlet, period_start: u.period_start, period_end: u.period_end,
        uploaded_on: new Date().toISOString(), line_count: u.parsed.length,
      });
      for (const p of u.parsed) {
        this.posLines.push({ id: uid("PL"), pos_import_id: importId, sku_id: p.sku_id, qty_sold: p.qty_sold, revenue: p.revenue });
      }
      this.persistAll();
      Object.assign(this.posUpload, { outlet: "", period_start: "", period_end: "", parsed: null, error: "", unmatched: [] });
      this.notify("POS data imported");
    },

    // ---------- STOCK IMPORT ----------
    stockCsvSelected(ev) {
      const file = ev.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (e) => {
        try { this.parseStockCsv(e.target.result); }
        catch (err) { this.stockImport.error = err.message; this.stockImport.parsed = null; }
      };
      reader.readAsText(file);
    },

    parseStockCsv(text) {
      const lines = text.split(/\r?\n/).filter(l => l.trim());
      if (!lines.length) throw new Error("Empty file");
      const rawHeader = lines[0].split(",").map(s => s.trim().replace(/^"|"$/g, "").toLowerCase());

      const findCol = (...names) => {
        for (const n of names) {
          const idx = rawHeader.findIndex(h => h.includes(n));
          if (idx >= 0) return idx;
        }
        return -1;
      };

      const idxName  = findCol("item name", "item_name");
      const idxOpen  = findCol("opening quantity", "opening", "open");
      const idxIn    = findCol("quantity in", "stock in", "qty_in", "stock_in");
      const idxOut   = findCol("quantity out", "stock out", "qty_out", "stock_out");
      const idxClose = findCol("closing quantity", "closing", "close");

      if (idxName  < 0) throw new Error("CSV must have an 'Item Name' column");
      if (idxOpen  < 0) throw new Error("CSV must have an 'Opening Quantity' column");
      if (idxIn    < 0) throw new Error("CSV must have a 'Quantity In' column");
      if (idxOut   < 0) throw new Error("CSV must have a 'Quantity Out' column");
      if (idxClose < 0) throw new Error("CSV must have a 'Closing Quantity' column");

      const parsed = [], unmatched = [];
      for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split(",").map(s => s.trim().replace(/^"|"$/g, ""));
        const name = cols[idxName];
        if (!name) continue;
        const sku = this.skus.find(s => s.item_name.toLowerCase() === name.toLowerCase());
        if (!sku) { unmatched.push(name); continue; }
        parsed.push({
          sku_id:    sku.id,
          item_name: sku.item_name,
          opening:   parseFloat(cols[idxOpen])  || 0,
          qty_in:    parseFloat(cols[idxIn])     || 0,
          qty_out:   parseFloat(cols[idxOut])    || 0,
          closing:   parseFloat(cols[idxClose])  || 0,
        });
      }
      this.stockImport.parsed = parsed;
      this.stockImport.unmatched = unmatched;
      this.stockImport.error = "";
    },

    confirmStockImport() {
      const si = this.stockImport;
      if (!si.outlet || !si.closing_date || !si.period_start || !si.parsed?.length) {
        this.notify("Fill outlet, period start, closing date, and upload a valid CSV");
        return;
      }
      const auditId = uid("AUD");
      this.audits.unshift({
        id: auditId, outlet_id: si.outlet,
        audit_date: si.closing_date, period_start: si.period_start,
        hq_auditor: "", outlet_witness: "", status: "in_progress",
        signed_off_at: null,
      });
      for (const row of si.parsed) {
        this.auditLines.push({
          id: uid("AL"), audit_id: auditId, sku_id: row.sku_id,
          opening_qty: row.opening,
          dispatched_in_period: row.qty_in,
          sold_in_period: row.qty_out,
          adjustments_in_period: 0,
          physical_qty: row.closing,
          notes: "",
        });
      }
      this.persistAll();
      const count = si.parsed.length;
      Object.assign(this.stockImport, { outlet: "", period_start: "", closing_date: "", parsed: null, error: "", unmatched: [] });
      this.auditCaptureId = auditId;
      this.go("audit-capture");
      this.notify(`Audit ready: ${count} SKUs pre-filled from CSV`);
    },

    // ---------- AUDITS ----------
    newAuditDraft() {
      this.auditDraft = {
        id: null, outlet_id: this.outlets[0]?.id || "",
        audit_date: todayISO(), period_start: this.suggestedPeriodStart(this.outlets[0]?.id),
        hq_auditor: "", outlet_witness: "",
      };
    },
    suggestedPeriodStart(outletId) {
      if (!outletId) return todayISO();
      const last = [...this.audits].filter(a => a.outlet_id === outletId && a.status === "finalized")
        .sort((a, b) => b.audit_date.localeCompare(a.audit_date))[0];
      if (last) return last.audit_date;
      const o = this.outletById(outletId);
      return o?.started_on || todayISO();
    },
    onDraftOutletChange() {
      this.auditDraft.period_start = this.suggestedPeriodStart(this.auditDraft.outlet_id);
    },
    startAudit() {
      const d = this.auditDraft;
      if (!d.outlet_id || !d.audit_date || !d.period_start) { this.notify("Fill all fields"); return; }
      const auditId = uid("AUD");
      const audit = {
        id: auditId, outlet_id: d.outlet_id, audit_date: d.audit_date, period_start: d.period_start,
        hq_auditor: d.hq_auditor, outlet_witness: d.outlet_witness, status: "in_progress",
        signed_off_at: null,
      };
      this.audits.unshift(audit);
      // pre-fill lines
      const skus = this.activeOutletSkus(d.outlet_id);
      for (const sku of skus) {
        const opening = this.computeOpening(d.outlet_id, sku.id, d.period_start);
        const dispatched = this.computeDispatched(d.outlet_id, sku.id, d.period_start, d.audit_date);
        const sold = this.computeSold(d.outlet_id, sku.id, d.period_start, d.audit_date);
        const adjustments = this.computeAdjustments(d.outlet_id, sku.id, d.period_start, d.audit_date);
        this.auditLines.push({
          id: uid("AL"), audit_id: auditId, sku_id: sku.id,
          opening_qty: opening, dispatched_in_period: dispatched,
          sold_in_period: sold, adjustments_in_period: adjustments,
          physical_qty: null, notes: "",
        });
      }
      this.persistAll();
      this.auditDraft = null;
      this.auditCaptureId = auditId;
      this.go("audit-capture");
      this.notify(`Audit ready: ${skus.length} SKUs to count`);
    },

    computeOpening(outletId, skuId, periodStart) {
      const prev = [...this.audits]
        .filter(a => a.outlet_id === outletId && a.status === "finalized" && a.audit_date <= periodStart)
        .sort((a, b) => b.audit_date.localeCompare(a.audit_date))[0];
      if (!prev) return 0;
      const ln = this.auditLines.find(l => l.audit_id === prev.id && l.sku_id === skuId);
      return ln?.physical_qty ?? 0;
    },
    computeDispatched(outletId, skuId, start, end) {
      const validDispatches = new Set(this.dispatches
        .filter(d => d.outlet_id === outletId && d.status === "received" && d.received_on >= start && d.received_on <= end)
        .map(d => d.id));
      return this.dispatchLines
        .filter(l => validDispatches.has(l.dispatch_id) && l.sku_id === skuId)
        .reduce((s, l) => s + (l.qty_received ?? l.qty_dispatched ?? 0), 0);
    },
    computeSold(outletId, skuId, start, end) {
      const validImports = new Set(this.posImports
        .filter(p => p.outlet_id === outletId && p.period_end >= start && p.period_start <= end)
        .map(p => p.id));
      return this.posLines
        .filter(l => validImports.has(l.pos_import_id) && l.sku_id === skuId)
        .reduce((s, l) => s + (l.qty_sold || 0), 0);
    },
    computeAdjustments(outletId, skuId, start, end) {
      return this.adjustments
        .filter(a => a.outlet_id === outletId && a.sku_id === skuId &&
                     a.approved_on >= start && a.approved_on <= end)
        .reduce((s, a) => s + (a.qty || 0), 0);
    },

    auditLineExpected(l) {
      return l.opening_qty + l.dispatched_in_period - l.sold_in_period - l.adjustments_in_period;
    },
    auditLineVariance(l) {
      if (l.physical_qty === null || l.physical_qty === "" || l.physical_qty === undefined) return null;
      return parseFloat(l.physical_qty) - this.auditLineExpected(l);
    },
    auditLineVarianceValue(l) {
      const v = this.auditLineVariance(l);
      if (v === null) return null;
      const sku = this.skuById(l.sku_id);
      return v * (sku?.sale_price || 0);
    },

    auditLinesFor(auditId) {
      return this.auditLines.filter(l => l.audit_id === auditId);
    },

    get currentCaptureAudit() { return this.auditById(this.auditCaptureId); },
    get currentCaptureTotals() { return this.auditCaptureId ? this.auditTotals(this.auditCaptureId) : { total:0, counted:0, shortfall:0, overage:0 }; },

    auditTotals(auditId) {
      const lines = this.auditLinesFor(auditId);
      const counted = lines.filter(l => l.physical_qty !== null && l.physical_qty !== "" && l.physical_qty !== undefined);
      const shortfall = counted.reduce((s, l) => {
        const vv = this.auditLineVarianceValue(l);
        return s + (vv && vv < 0 ? vv : 0);
      }, 0);
      const overage = counted.reduce((s, l) => {
        const vv = this.auditLineVarianceValue(l);
        return s + (vv && vv > 0 ? vv : 0);
      }, 0);
      return { total: lines.length, counted: counted.length, shortfall, overage };
    },

    saveAuditLineQty(line) {
      // x-model.number gives us a number or empty-string; normalize
      if (line.physical_qty === "" || line.physical_qty === undefined) line.physical_qty = null;
      this.persist("auditLines");
    },

    submitAudit(auditId) {
      const lines = this.auditLinesFor(auditId);
      const uncounted = lines.filter(l => l.physical_qty === null || l.physical_qty === "" || l.physical_qty === undefined);
      if (uncounted.length) {
        if (!confirm(`${uncounted.length} SKUs not counted. Treat them as 0 and submit anyway?`)) return;
        for (const l of uncounted) {
          const orig = this.auditLines.find(x => x.id === l.id);
          orig.physical_qty = 0;
        }
      }
      const audit = this.auditById(auditId);
      audit.status = "submitted";
      audit.signed_off_at = new Date().toISOString();
      this.persistAll();
      this.notify("Audit submitted");
      this.go("audits");
    },

    finalizeAudit(auditId) {
      const a = this.auditById(auditId);
      a.status = "finalized";
      this.persist("audits");
      this.notify("Audit finalized");
    },
    reopenAudit(auditId) {
      if (!confirm("Reopen this finalized audit for editing?")) return;
      const a = this.auditById(auditId);
      a.status = "in_progress";
      this.persist("audits");
      this.notify("Audit reopened");
    },

    deleteAudit(auditId) {
      if (!confirm("Delete this audit and all its lines?")) return;
      this.audits = this.audits.filter(a => a.id !== auditId);
      this.auditLines = this.auditLines.filter(l => l.audit_id !== auditId);
      this.persistAll();
    },

    get filteredCaptureLines() {
      if (!this.auditCaptureId) return [];
      const lines = this.auditLinesFor(this.auditCaptureId);
      const q = this.auditFilter.trim().toLowerCase();
      return lines.filter(l => {
        const sku = this.skuById(l.sku_id);
        if (!sku) return false;
        if (this.auditCategory && sku.category !== this.auditCategory) return false;
        if (q && !sku.item_name.toLowerCase().includes(q)) return false;
        return true;
      });
    },

    // ---------- export ----------
    exportAuditCsv(auditId) {
      const a = this.auditById(auditId);
      const o = this.outletById(a.outlet_id);
      const lines = this.auditLinesFor(auditId);
      const header = ["sku_id","item_name","unit","sale_price","opening","dispatched","sold","adjustments","expected","physical","variance_qty","variance_value","notes"];
      const rows = [header.join(",")];
      for (const l of lines) {
        const sku = this.skuById(l.sku_id);
        const exp = this.auditLineExpected(l);
        const vq = this.auditLineVariance(l);
        const vv = this.auditLineVarianceValue(l);
        rows.push([
          sku?.id, `"${(sku?.item_name || "").replace(/"/g,'""')}"`, sku?.unit, sku?.sale_price,
          l.opening_qty, l.dispatched_in_period, l.sold_in_period, l.adjustments_in_period,
          exp, l.physical_qty ?? "", vq ?? "", vv ?? "", `"${(l.notes||"").replace(/"/g,'""')}"`,
        ].join(","));
      }
      const blob = new Blob([rows.join("\n")], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `audit-${o?.name || a.outlet_id}-${a.audit_date}.csv`;
      link.click();
      URL.revokeObjectURL(url);
    },

    exportSkusCsv() {
      const header = ["sku_id","item_name","unit","sale_price","category","packed","active"];
      const rows = [header.join(",")];
      for (const s of this.skus) {
        rows.push([
          s.id,
          `"${(s.item_name || "").replace(/"/g,'""')}"`,
          `"${(s.unit || "").replace(/"/g,'""')}"`,
          s.sale_price ?? "",
          `"${(s.category || "").replace(/"/g,'""')}"`,
          s.packed ? "yes" : "no",
          s.active ? "yes" : "no",
        ].join(","));
      }
      const blob = new Blob([rows.join("\n")], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `aroura-skus-${todayISO()}.csv`;
      link.click();
      URL.revokeObjectURL(url);
    },

    // ---------- danger ----------
    resetAll() {
      if (!confirm("Wipe ALL data and reseed SKUs?")) return;
      localStorage.clear();
      location.reload();
    },

    // ---------- demo seed ----------
    loadDemoData() {
      if (this.outlets.length && !confirm("Add demo outlets/dispatches/POS/audit on top of existing data?")) return;
      const o1 = { id: uid("OUT"), name: "Outlet A — Connaught Place", location: "Delhi", manager_name: "Rahul", manager_phone: "9810000001", status: "active", started_on: "2026-01-01", excluded_skus: [] };
      const o2 = { id: uid("OUT"), name: "Outlet B — Saket", location: "Delhi", manager_name: "Priya", manager_phone: "9810000002", status: "active", started_on: "2026-01-01", excluded_skus: [] };
      const o3 = { id: uid("OUT"), name: "Outlet C — Gurgaon", location: "Gurgaon", manager_name: "Amit", manager_phone: "9810000003", status: "active", started_on: "2026-01-01", excluded_skus: [] };
      this.outlets.push(o1, o2, o3);
      // pick a few popular-looking SKUs
      const pickedSkus = this.skus.filter(s => s.sale_price > 0).slice(0, 8);
      // dispatches received this month
      for (const o of [o1, o2, o3]) {
        const dispId = uid("DSP");
        this.dispatches.unshift({ id: dispId, outlet_id: o.id, dispatched_on: "2026-04-02", dispatched_by: "Godown", status: "received", received_on: "2026-04-03", received_by: o.manager_name });
        for (const sku of pickedSkus) {
          const qty = Math.floor(Math.random() * 30) + 10;
          this.dispatchLines.push({ id: uid("DL"), dispatch_id: dispId, sku_id: sku.id, qty_dispatched: qty, qty_received: qty });
        }
      }
      // POS sales (about 50–70% of dispatched)
      for (const o of [o1, o2, o3]) {
        const importId = uid("PIM");
        this.posImports.unshift({ id: importId, outlet_id: o.id, period_start: "2026-04-03", period_end: "2026-04-27", uploaded_on: new Date().toISOString(), line_count: pickedSkus.length });
        for (const sku of pickedSkus) {
          const dispLine = this.dispatchLines.find(l => l.sku_id === sku.id && this.dispatches.find(d => d.id === l.dispatch_id && d.outlet_id === o.id));
          const sold = Math.floor((dispLine?.qty_received || 10) * (0.5 + Math.random() * 0.3));
          this.posLines.push({ id: uid("PL"), pos_import_id: importId, sku_id: sku.id, qty_sold: sold, revenue: sold * sku.sale_price });
        }
      }
      this.persistAll();
      this.notify("Demo data loaded — go to Audits and start one");
    },
  };
}
