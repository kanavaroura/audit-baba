// Inventory Audit — Firebase-backed SPA (ES module)

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-app.js";
import {
  getFirestore, collection, doc,
  onSnapshot, setDoc, deleteDoc, writeBatch,
} from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyBIQ4RF4T4Nq-DTPJ04BpXbYG9Py68Deto",
  authDomain: "audit-baba.firebaseapp.com",
  projectId: "audit-baba",
  storageBucket: "audit-baba.firebasestorage.app",
  messagingSenderId: "95661337867",
  appId: "1:95661337867:web:278fd519a9924a20b2460e",
};

const fbApp = initializeApp(firebaseConfig);
const db = getFirestore(fbApp);

const SESSION_KEY = "currentUserId";
const COLLECTIONS = ["skus","outlets","dispatches","dispatchLines","posImports","posLines","audits","auditLines","adjustments","users"];

function clean(obj) {
  return JSON.parse(JSON.stringify(obj));
}

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
const uid = window.uid, todayISO = window.todayISO;

document.addEventListener("alpine:init", () => {
  Alpine.data("app", () => ({

    // ---------- loading ----------
    loading: true,
    _loadedNames: {},
    _saving: false,

    // ---------- UI state ----------
    view: "dashboard",
    sidebarOpen: false,
    toast: "",

    // ---------- data (populated by Firestore) ----------
    skus: [],
    outlets: [],
    dispatches: [],
    dispatchLines: [],
    posImports: [],
    posLines: [],
    audits: [],
    auditLines: [],
    adjustments: [],

    // ---------- page-local state ----------
    skuSearch: "",
    skuFilterCategory: "",
    skuEditingId: null,

    outletDraft: null,
    outletDetailId: null,
    outletDetailFilter: "",
    outletDetailHideZero: true,
    outletDetailSort: "value_desc",

    dispatchDraft: null,
    dispatchAckId: null,
    posUpload: { outlet: "", period_start: "", period_end: "", parsed: null, error: "", unmatched: [] },
    stockImport: { outlet: "", period_start: "", closing_date: "", parsed: null, error: "", unmatched: [] },
    _ackLines: [],

    auditDraft: null,
    auditCaptureId: null,
    auditFilter: "",
    auditCategory: "",

    // ---------- auth ----------
    users: [],
    currentUserId: localStorage.getItem(SESSION_KEY) || null,
    loginUsername: "",
    loginPassword: "",
    loginError: "",
    userDraft: null,
    skuImport: { parsed: null, error: "", added: 0, skipped: 0 },

    get currentUser() { return this.users.find(u => u.id === this.currentUserId) || null; },
    get currentRole() { return this.currentUser?.role || null; },

    // ---------- init ----------
    init() {
      for (const name of COLLECTIONS) {
        this._subscribeCollection(name);
      }
      const h = location.hash.slice(1);
      if (h) this.view = h;
      window.addEventListener("hashchange", () => {
        const nh = location.hash.slice(1);
        if (nh) this.view = nh;
      });
    },

    _subscribeCollection(name) {
      const applySnap = (snap) => {
        if (!this._loadedNames[name]) {
          this[name] = snap.docs.map(d => ({ id: d.id, ...d.data() }));
          this._onCollectionLoaded(name);
        } else {
          const arr = this[name];
          for (const change of snap.docChanges()) {
            const data = { id: change.doc.id, ...change.doc.data() };
            const idx = arr.findIndex(x => x.id === data.id);
            if (change.type === "removed") { if (idx >= 0) arr.splice(idx, 1); }
            else if (change.type === "modified") { if (idx >= 0) arr.splice(idx, 1, data); }
            else if (change.type === "added") { if (idx < 0) arr.push(data); }
          }
        }
      };
      onSnapshot(collection(db, name), applySnap, () => {
        this._onCollectionLoaded(name);
      });
    },

    async _onCollectionLoaded(name) {
      if (this._loadedNames[name]) return;
      this._loadedNames[name] = true;
      if (Object.keys(this._loadedNames).length < COLLECTIONS.length) return;
      try {
        this._runMigrations();
        await this._seedDefaultUsers();
        this._validateSession();
      } catch(e) {}
      this.loading = false;
    },

    _runMigrations() {
      for (const s of this.skus) {
        if (s.packed === undefined) setDoc(doc(db, "skus", s.id), clean({ ...s, packed: true }));
      }
      for (const o of this.outlets) {
        if (!o.outlet_type) setDoc(doc(db, "outlets", o.id), clean({ ...o, outlet_type: "regular" }));
      }
    },

    async _seedDefaultUsers() {
      if (this.users.length) return;
      const batch = writeBatch(db);
      const defaults = [
        { id: "usr-owner",   name: "Owner",   username: "owner",   password: "0000", role: "owner" },
        { id: "usr-manager", name: "Manager", username: "manager", password: "1111", role: "manager" },
        { id: "usr-auditor", name: "Auditor", username: "auditor", password: "2222", role: "auditor" },
      ];
      for (const u of defaults) batch.set(doc(db, "users", u.id), u);
      await batch.commit();
    },

    _validateSession() {
      if (this.currentUserId && !this.users.find(u => u.id === this.currentUserId)) {
        this.currentUserId = null;
        localStorage.removeItem(SESSION_KEY);
      }
    },

    go(view) {
      this.view = view;
      this.sidebarOpen = false;
      location.hash = view;
      window.scrollTo(0, 0);
    },

    notify(msg) {
      this.toast = msg;
      clearTimeout(this._toastT);
      this._toastT = setTimeout(() => this.toast = "", 2500);
    },

    // ---------- auth ----------
    login() {
      const user = this.users.find(u => u.username === this.loginUsername.trim() && u.password === this.loginPassword.trim());
      if (!user) { this.loginError = "Wrong username or password."; return; }
      this.currentUserId = user.id;
      localStorage.setItem(SESSION_KEY, user.id);
      this.loginUsername = "";
      this.loginPassword = "";
      this.loginError = "";
    },
    logout() {
      this.currentUserId = null;
      localStorage.removeItem(SESSION_KEY);
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
      if (!d.id) d.id = uid("USR");
      setDoc(doc(db, "users", d.id), clean(d));
      this.userDraft = null;
      this.notify("User saved");
    },
    deleteUser(id) {
      if (this.currentUserId === id) { this.notify("Cannot delete yourself"); return; }
      if (!confirm("Delete this user?")) return;
      deleteDoc(doc(db, "users", id));
      this.notify("User deleted");
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

    // Reactive getter for the outlet form's excluded-SKU selector.
    // Using a getter avoids Alpine reactivity issues with inline ternaries
    // inside nested <template x-if> + <template x-for>.
    get outletFormSkus() {
      if (!this.outletDraft) return this.skus;
      return this.outletDraft.outlet_type === "express_kiosk"
        ? this.skus.filter(s => s.packed)
        : this.skus;
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
        .sort((a, b) => a[1] - b[1]).slice(0, 10)
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
    async confirmSkuImport() {
      if (!this.skuImport.parsed?.length) return;
      if (this._saving) return;
      this._saving = true;
      try {
        const existing = new Set(this.skus.map(s => s.item_name.toLowerCase()));
        const batch = writeBatch(db);
        let added = 0, skipped = 0;
        for (const row of this.skuImport.parsed) {
          if (existing.has(row.item_name.toLowerCase())) { skipped++; continue; }
          const id = uid("SKU");
          batch.set(doc(db, "skus", id), { id, sku_id: id, item_name: row.item_name, unit: row.unit, sale_price: row.sale_price, category: row.category, active: true, packed: true });
          existing.add(row.item_name.toLowerCase());
          added++;
        }
        if (added === 0) {
          this.skuImport.error = skipped ? `All ${skipped} items already exist — no new SKUs added` : "No valid rows found in CSV";
          return;
        }
        await batch.commit();
        this.skuImport = { parsed: null, error: "", added, skipped };
        this.notify(`${added} SKUs added${skipped ? `, ${skipped} duplicates skipped` : ""}`);
      } catch(e) {
        this.skuImport.error = "Save failed: " + (e.message || e.code || "unknown error");
      } finally {
        this._saving = false;
      }
    },

    // ---------- SKUs ----------
    saveSkuEdit(sku) {
      setDoc(doc(db, "skus", sku.id), clean(sku));
      this.skuEditingId = null;
      this.notify("SKU updated");
    },
    deleteSku(id) {
      if (!confirm("Delete this SKU? Audit lines referencing it will lose their item name.")) return;
      deleteDoc(doc(db, "skus", id));
      this.notify("SKU deleted");
    },
    addSku() {
      const id = uid("SKU");
      const sku = { id, sku_id: id, item_name: "New item", unit: "piece", sale_price: 0, category: "Other", active: true, packed: true };
      setDoc(doc(db, "skus", id), sku);
      this.skuEditingId = id;
    },

    // ---------- Outlets ----------
    newOutletDraft() {
      this.outletDraft = { id: null, name: "", location: "", manager_name: "", manager_phone: "", status: "active", outlet_type: "regular", started_on: todayISO(), excluded_skus: [] };
    },
    editOutlet(id) {
      this.outletDraft = JSON.parse(JSON.stringify(this.outletById(id)));
    },
    saveOutletDraft() {
      const d = this.outletDraft;
      if (!d.name.trim()) { this.notify("Outlet name required"); return; }
      if (!d.id) d.id = uid("OUT");
      setDoc(doc(db, "outlets", d.id), clean(d));
      this.outletDraft = null;
      this.notify("Outlet saved");
    },
    deleteOutlet(id) {
      if (!confirm("Delete this outlet? Linked dispatches/audits will become orphaned.")) return;
      deleteDoc(doc(db, "outlets", id));
    },
    openOutletDetail(id) {
      this.outletDetailId = id;
      this.go("outlet-detail");
    },

    // ---------- Outlet stock ----------
    currentBookStock(outletId) {
      const outlet = this.outletById(outletId);
      if (!outlet) return [];
      const excluded = new Set(outlet.excluded_skus || []);
      const today = todayISO();
      const lastAudit = [...this.audits]
        .filter(a => a.outlet_id === outletId && a.status === "finalized")
        .sort((a, b) => b.audit_date.localeCompare(a.audit_date))[0];
      const periodStart = lastAudit ? lastAudit.audit_date : (outlet.started_on || "1970-01-01");
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
        rows.push({ sku_id: sku.id, item_name: sku.item_name, category: sku.category, unit: sku.unit, sale_price: sku.sale_price, opening, dispatched, sold, adj, qty, value: qty * (sku.sale_price || 0) });
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
      if (this.outletDetailSort === "value_desc") filtered.sort((a, b) => b.value - a.value);
      else if (this.outletDetailSort === "qty_desc") filtered.sort((a, b) => b.qty - a.qty);
      else if (this.outletDetailSort === "name_asc") filtered.sort((a, b) => a.item_name.localeCompare(b.item_name));
      return filtered;
    },

    get outletDetailStats() {
      if (!this.outletDetailId) return null;
      const all = this.currentBookStock(this.outletDetailId);
      const lastAudit = [...this.audits].filter(a => a.outlet_id === this.outletDetailId).sort((a, b) => b.audit_date.localeCompare(a.audit_date))[0];
      const lastDispatch = [...this.dispatches].filter(d => d.outlet_id === this.outletDetailId && d.status === "received").sort((a, b) => (b.received_on || "").localeCompare(a.received_on || ""))[0];
      return {
        totalValue: all.reduce((s, r) => s + r.value, 0),
        inStockCount: all.filter(r => Math.abs(r.qty) > 0.001).length,
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
        lines.push([r.sku_id, `"${r.item_name.replace(/"/g,'""')}"`, r.unit, r.sale_price, r.opening, r.dispatched, r.sold, r.adj, r.qty, Math.round(r.value*100)/100].join(","));
      }
      const blob = new Blob([lines.join("\n")], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url; link.download = `stock-${outlet?.name || outletId}-${todayISO()}.csv`; link.click();
      URL.revokeObjectURL(url);
    },

    // ---------- Dispatches ----------
    newDispatchDraft() {
      this.dispatchDraft = { id: null, outlet_id: this.outlets[0]?.id || "", dispatched_on: todayISO(), dispatched_by: "", status: "draft", lines: [] };
    },
    addDispatchLine() {
      this.dispatchDraft.lines.push({ id: uid("DL"), sku_id: "", qty_dispatched: 0, qty_received: null });
    },
    removeDispatchLine(idx) { this.dispatchDraft.lines.splice(idx, 1); },
    async saveDispatch(status) {
      const d = this.dispatchDraft;
      if (!d.outlet_id) { this.notify("Pick an outlet"); return; }
      if (!d.lines.length) { this.notify("Add at least one line"); return; }
      for (const ln of d.lines) {
        if (!ln.sku_id || ln.qty_dispatched <= 0) { this.notify("Each line needs SKU and qty > 0"); return; }
      }
      if (this._saving) return;
      this._saving = true;
      try {
        d.status = status;
        const batch = writeBatch(db);
        if (!d.id) {
          d.id = uid("DSP");
          batch.set(doc(db, "dispatches", d.id), clean({ id: d.id, outlet_id: d.outlet_id, dispatched_on: d.dispatched_on, dispatched_by: d.dispatched_by, status: d.status, received_on: null, received_by: "" }));
          for (const ln of d.lines) {
            batch.set(doc(db, "dispatchLines", ln.id), clean({ id: ln.id, dispatch_id: d.id, sku_id: ln.sku_id, qty_dispatched: ln.qty_dispatched, qty_received: ln.qty_received }));
          }
        } else {
          batch.update(doc(db, "dispatches", d.id), { status: d.status });
        }
        await batch.commit();
        this.dispatchDraft = null;
        this.notify(status === "draft" ? "Saved as draft" : "Dispatch sent");
      } finally {
        this._saving = false;
      }
    },
    openAckDispatch(id) {
      this._ackLines = this.dispatchLines.filter(l => l.dispatch_id === id).map(l => ({ ...l, qty_received: l.qty_received ?? l.qty_dispatched }));
      this.dispatchAckId = id;
    },
    async confirmAckDispatch() {
      if (this._saving) return;
      this._saving = true;
      try {
        const batch = writeBatch(db);
        batch.update(doc(db, "dispatches", this.dispatchAckId), { status: "received", received_on: todayISO() });
        for (const ln of this._ackLines) {
          batch.update(doc(db, "dispatchLines", ln.id), { qty_received: ln.qty_received });
        }
        await batch.commit();
        this.dispatchAckId = null;
        this.notify("Receipt confirmed");
      } finally {
        this._saving = false;
      }
    },
    dispatchLinesFor(id) { return this.dispatchLines.filter(l => l.dispatch_id === id); },

    // ---------- POS ----------
    posCsvSelected(ev) {
      const file = ev.target.files[0]; if (!file) return;
      const reader = new FileReader();
      reader.onload = (e) => { try { this.parsePosCsv(e.target.result); } catch (err) { this.posUpload.error = err.message; this.posUpload.parsed = null; } };
      reader.readAsText(file);
    },
    parsePosCsv(text) {
      const lines = text.split(/\r?\n/).filter(l => l.trim());
      if (!lines.length) throw new Error("Empty file");
      const header = lines[0].split(",").map(s => s.trim().toLowerCase());
      const hasSkuId = header.includes("sku_id"), hasItemName = header.includes("item_name");
      if (!hasSkuId && !hasItemName) throw new Error("CSV must have sku_id or item_name column");
      if (!header.includes("qty_sold")) throw new Error("CSV must have qty_sold column");
      const idxSku = header.indexOf("sku_id"), idxName = header.indexOf("item_name"), idxQty = header.indexOf("qty_sold"), idxRev = header.indexOf("revenue");
      const parsed = [], unmatched = [];
      for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split(",").map(s => s.trim());
        let sku = null;
        if (hasSkuId && cols[idxSku]) sku = this.skus.find(s => s.id === cols[idxSku] || s.sku_id === cols[idxSku]);
        if (!sku && hasItemName && cols[idxName]) sku = this.skus.find(s => s.item_name.toLowerCase() === cols[idxName].toLowerCase());
        if (!sku) { unmatched.push(cols[idxName] || cols[idxSku] || `(row ${i+1})`); continue; }
        parsed.push({ sku_id: sku.id, item_name: sku.item_name, qty_sold: parseFloat(cols[idxQty]) || 0, revenue: idxRev >= 0 ? (parseFloat(cols[idxRev]) || 0) : 0 });
      }
      this.posUpload.parsed = parsed; this.posUpload.unmatched = unmatched; this.posUpload.error = "";
    },
    async confirmPosImport() {
      const u = this.posUpload;
      if (!u.outlet || !u.period_start || !u.period_end || !u.parsed?.length) { this.notify("Fill outlet, period, and upload a valid CSV"); return; }
      if (this._saving) return;
      this._saving = true;
      try {
        const importId = uid("PIM");
        const batch = writeBatch(db);
        batch.set(doc(db, "posImports", importId), clean({ id: importId, outlet_id: u.outlet, period_start: u.period_start, period_end: u.period_end, uploaded_on: new Date().toISOString(), line_count: u.parsed.length }));
        for (const p of u.parsed) {
          const id = uid("PL");
          batch.set(doc(db, "posLines", id), clean({ id, pos_import_id: importId, sku_id: p.sku_id, qty_sold: p.qty_sold, revenue: p.revenue }));
        }
        await batch.commit();
        Object.assign(this.posUpload, { outlet: "", period_start: "", period_end: "", parsed: null, error: "", unmatched: [] });
        this.notify("POS data imported");
      } finally {
        this._saving = false;
      }
    },

    // ---------- STOCK IMPORT ----------
    stockCsvSelected(ev) {
      const file = ev.target.files[0]; if (!file) return;
      const reader = new FileReader();
      reader.onload = (e) => { try { this.parseStockCsv(e.target.result); } catch (err) { this.stockImport.error = err.message; this.stockImport.parsed = null; } };
      reader.readAsText(file);
    },
    parseStockCsv(text) {
      const lines = text.split(/\r?\n/).filter(l => l.trim());
      if (!lines.length) throw new Error("Empty file");
      const rawHeader = lines[0].split(",").map(s => s.trim().replace(/^"|"$/g, "").toLowerCase());
      const findCol = (...names) => { for (const n of names) { const idx = rawHeader.findIndex(h => h.includes(n)); if (idx >= 0) return idx; } return -1; };
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
        const name = cols[idxName]; if (!name) continue;
        const sku = this.skus.find(s => s.item_name.toLowerCase() === name.toLowerCase());
        if (!sku) { unmatched.push(name); continue; }
        parsed.push({ sku_id: sku.id, item_name: sku.item_name, opening: parseFloat(cols[idxOpen]) || 0, qty_in: parseFloat(cols[idxIn]) || 0, qty_out: parseFloat(cols[idxOut]) || 0, closing: parseFloat(cols[idxClose]) || 0 });
      }
      this.stockImport.parsed = parsed; this.stockImport.unmatched = unmatched; this.stockImport.error = "";
    },
    async confirmStockImport() {
      const si = this.stockImport;
      if (!si.outlet || !si.closing_date || !si.period_start || !si.parsed?.length) { this.notify("Fill outlet, period start, closing date, and upload a valid CSV"); return; }
      if (this._saving) return;
      this._saving = true;
      try {
        const auditId = uid("AUD");
        const batch = writeBatch(db);
        batch.set(doc(db, "audits", auditId), clean({ id: auditId, outlet_id: si.outlet, audit_date: si.closing_date, period_start: si.period_start, hq_auditor: "", outlet_witness: "", status: "in_progress", signed_off_at: null }));
        for (let i = 0; i < si.parsed.length; i++) {
          const row = si.parsed[i], lineId = uid("AL");
          batch.set(doc(db, "auditLines", lineId), clean({ id: lineId, audit_id: auditId, sku_id: row.sku_id, opening_qty: row.opening, dispatched_in_period: row.qty_in, sold_in_period: row.qty_out, adjustments_in_period: 0, physical_qty: row.closing, notes: "", sort_order: i }));
        }
        await batch.commit();
        const count = si.parsed.length;
        Object.assign(this.stockImport, { outlet: "", period_start: "", closing_date: "", parsed: null, error: "", unmatched: [] });
        this.auditCaptureId = auditId;
        this.go("audit-capture");
        this.notify(`Audit ready: ${count} SKUs pre-filled from CSV`);
      } finally {
        this._saving = false;
      }
    },

    // ---------- AUDITS ----------
    newAuditDraft() {
      this.auditDraft = { id: null, outlet_id: this.outlets[0]?.id || "", audit_date: todayISO(), period_start: this.suggestedPeriodStart(this.outlets[0]?.id), hq_auditor: "", outlet_witness: "" };
    },
    suggestedPeriodStart(outletId) {
      if (!outletId) return todayISO();
      const last = [...this.audits].filter(a => a.outlet_id === outletId && a.status === "finalized").sort((a, b) => b.audit_date.localeCompare(a.audit_date))[0];
      if (last) return last.audit_date;
      return this.outletById(outletId)?.started_on || todayISO();
    },
    onDraftOutletChange() { this.auditDraft.period_start = this.suggestedPeriodStart(this.auditDraft.outlet_id); },
    async startAudit() {
      const d = this.auditDraft;
      if (!d.outlet_id || !d.audit_date || !d.period_start) { this.notify("Fill all fields"); return; }
      if (this._saving) return;
      this._saving = true;
      try {
        const auditId = uid("AUD");
        const skus = this.activeOutletSkus(d.outlet_id);
        const batch = writeBatch(db);
        batch.set(doc(db, "audits", auditId), clean({ id: auditId, outlet_id: d.outlet_id, audit_date: d.audit_date, period_start: d.period_start, hq_auditor: d.hq_auditor, outlet_witness: d.outlet_witness, status: "in_progress", signed_off_at: null }));
        for (let i = 0; i < skus.length; i++) {
          const sku = skus[i], lineId = uid("AL");
          batch.set(doc(db, "auditLines", lineId), clean({ id: lineId, audit_id: auditId, sku_id: sku.id, opening_qty: this.computeOpening(d.outlet_id, sku.id, d.period_start), dispatched_in_period: this.computeDispatched(d.outlet_id, sku.id, d.period_start, d.audit_date), sold_in_period: this.computeSold(d.outlet_id, sku.id, d.period_start, d.audit_date), adjustments_in_period: this.computeAdjustments(d.outlet_id, sku.id, d.period_start, d.audit_date), physical_qty: null, notes: "", sort_order: i }));
        }
        await batch.commit();
        this.auditDraft = null;
        this.auditCaptureId = auditId;
        this.go("audit-capture");
        this.notify(`Audit ready: ${skus.length} SKUs to count`);
      } finally {
        this._saving = false;
      }
    },

    computeOpening(outletId, skuId, periodStart) {
      const prev = [...this.audits].filter(a => a.outlet_id === outletId && a.status === "finalized" && a.audit_date <= periodStart).sort((a, b) => b.audit_date.localeCompare(a.audit_date))[0];
      if (!prev) return 0;
      return this.auditLines.find(l => l.audit_id === prev.id && l.sku_id === skuId)?.physical_qty ?? 0;
    },
    computeDispatched(outletId, skuId, start, end) {
      const ids = new Set(this.dispatches.filter(d => d.outlet_id === outletId && d.status === "received" && d.received_on >= start && d.received_on <= end).map(d => d.id));
      return this.dispatchLines.filter(l => ids.has(l.dispatch_id) && l.sku_id === skuId).reduce((s, l) => s + (l.qty_received ?? l.qty_dispatched ?? 0), 0);
    },
    computeSold(outletId, skuId, start, end) {
      const ids = new Set(this.posImports.filter(p => p.outlet_id === outletId && p.period_end >= start && p.period_start <= end).map(p => p.id));
      return this.posLines.filter(l => ids.has(l.pos_import_id) && l.sku_id === skuId).reduce((s, l) => s + (l.qty_sold || 0), 0);
    },
    computeAdjustments(outletId, skuId, start, end) {
      return this.adjustments.filter(a => a.outlet_id === outletId && a.sku_id === skuId && a.approved_on >= start && a.approved_on <= end).reduce((s, a) => s + (a.qty || 0), 0);
    },

    auditLineExpected(l) { return (l.opening_qty || 0) + (l.dispatched_in_period || 0) - (l.sold_in_period || 0) - (l.adjustments_in_period || 0); },
    auditLineVariance(l) {
      if (l.physical_qty === null || l.physical_qty === "" || l.physical_qty === undefined) return null;
      return parseFloat(l.physical_qty) - this.auditLineExpected(l);
    },
    auditLineVarianceValue(l) {
      const v = this.auditLineVariance(l); if (v === null) return null;
      return v * (this.skuById(l.sku_id)?.sale_price || 0);
    },
    auditLinesFor(auditId) { return this.auditLines.filter(l => l.audit_id === auditId); },

    get currentCaptureAudit() { return this.auditById(this.auditCaptureId); },
    get currentCaptureTotals() { return this.auditCaptureId ? this.auditTotals(this.auditCaptureId) : { total:0, counted:0, shortfall:0, overage:0 }; },

    auditTotals(auditId) {
      const lines = this.auditLinesFor(auditId);
      const counted = lines.filter(l => l.physical_qty !== null && l.physical_qty !== "" && l.physical_qty !== undefined);
      return {
        total: lines.length,
        counted: counted.length,
        shortfall: counted.reduce((s, l) => { const vv = this.auditLineVarianceValue(l); return s + (vv && vv < 0 ? vv : 0); }, 0),
        overage:   counted.reduce((s, l) => { const vv = this.auditLineVarianceValue(l); return s + (vv && vv > 0 ? vv : 0); }, 0),
      };
    },

    saveAuditLineQty(line) {
      if (line.physical_qty === "" || line.physical_qty === undefined) line.physical_qty = null;
      const saved = { ...line };
      clearTimeout(this._lineDebounce);
      this._lineDebounce = setTimeout(() => {
        setDoc(doc(db, "auditLines", saved.id), clean(saved));
      }, 600);
    },

    async submitAudit(auditId) {
      if (this._saving) return;
      const lines = this.auditLinesFor(auditId);
      const uncounted = lines.filter(l => l.physical_qty === null || l.physical_qty === "" || l.physical_qty === undefined);
      if (uncounted.length) {
        if (!confirm(`${uncounted.length} SKUs not counted. Treat them as 0 and submit anyway?`)) return;
      }
      this._saving = true;
      try {
        const batch = writeBatch(db);
        for (const l of uncounted) batch.update(doc(db, "auditLines", l.id), { physical_qty: 0 });
        batch.update(doc(db, "audits", auditId), { status: "submitted", signed_off_at: new Date().toISOString() });
        await batch.commit();
        this.notify("Audit submitted");
        this.go("audits");
      } finally {
        this._saving = false;
      }
    },

    finalizeAudit(auditId) {
      setDoc(doc(db, "audits", auditId), clean({ ...this.auditById(auditId), status: "finalized" }));
      this.notify("Audit finalized");
    },
    reopenAudit(auditId) {
      if (!confirm("Reopen this finalized audit for editing?")) return;
      setDoc(doc(db, "audits", auditId), clean({ ...this.auditById(auditId), status: "in_progress" }));
      this.notify("Audit reopened");
    },
    async deleteAudit(auditId) {
      if (!confirm("Delete this audit and all its lines?")) return;
      if (this._saving) return;
      this._saving = true;
      try {
        const batch = writeBatch(db);
        batch.delete(doc(db, "audits", auditId));
        for (const l of this.auditLines.filter(l => l.audit_id === auditId)) batch.delete(doc(db, "auditLines", l.id));
        await batch.commit();
      } finally {
        this._saving = false;
      }
    },

    get filteredCaptureLines() {
      if (!this.auditCaptureId) return [];
      const q = this.auditFilter.trim().toLowerCase();
      return this.auditLinesFor(this.auditCaptureId)
        .filter(l => {
          const sku = this.skuById(l.sku_id); if (!sku) return false;
          if (this.auditCategory && sku.category !== this.auditCategory) return false;
          if (q && !sku.item_name.toLowerCase().includes(q)) return false;
          return true;
        })
        .sort((a, b) => (a.sort_order ?? 99999) - (b.sort_order ?? 99999));
    },

    // ---------- export ----------
    exportAuditCsv(auditId) {
      const a = this.auditById(auditId), o = this.outletById(a.outlet_id), lines = this.auditLinesFor(auditId);
      const header = ["sku_id","item_name","unit","sale_price","opening","dispatched","sold","adjustments","expected","physical","variance_qty","variance_value","notes"];
      const rows = [header.join(",")];
      for (const l of lines) {
        const sku = this.skuById(l.sku_id);
        rows.push([sku?.id, `"${(sku?.item_name||"").replace(/"/g,'""')}"`, sku?.unit, sku?.sale_price, l.opening_qty, l.dispatched_in_period, l.sold_in_period, l.adjustments_in_period, this.auditLineExpected(l), l.physical_qty??"", this.auditLineVariance(l)??'', this.auditLineVarianceValue(l)??'', `"${(l.notes||"").replace(/"/g,'""')}"`].join(","));
      }
      const blob = new Blob([rows.join("\n")], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url; link.download = `audit-${o?.name||a.outlet_id}-${a.audit_date}.csv`; link.click();
      URL.revokeObjectURL(url);
    },

    exportSkusCsv() {
      const header = ["sku_id","item_name","unit","sale_price","category","packed","active"];
      const rows = [header.join(",")];
      for (const s of this.skus) {
        rows.push([s.id, `"${(s.item_name||"").replace(/"/g,'""')}"`, `"${(s.unit||"").replace(/"/g,'""')}"`, s.sale_price??"", `"${(s.category||"").replace(/"/g,'""')}"`, s.packed?"yes":"no", s.active?"yes":"no"].join(","));
      }
      const blob = new Blob([rows.join("\n")], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url; link.download = `aroura-skus-${todayISO()}.csv`; link.click();
      URL.revokeObjectURL(url);
    },

    // ---------- danger ----------
    async resetAll() {
      if (!confirm("Wipe ALL data from Firestore? This cannot be undone.")) return;
      if (this._saving) return;
      this._saving = true;
      try {
        const batch = writeBatch(db);
        for (const name of COLLECTIONS) {
          for (const item of this[name]) batch.delete(doc(db, name, item.id));
        }
        await batch.commit();
        localStorage.removeItem(SESSION_KEY);
        location.reload();
      } finally {
        this._saving = false;
      }
    },

    // ---------- demo seed ----------
    async loadDemoData() {
      if (this.outlets.length && !confirm("Add demo outlets/dispatches/POS/audit on top of existing data?")) return;
      if (this._saving) return;
      this._saving = true;
      try {
        const o1 = { id: uid("OUT"), name: "Outlet A — Connaught Place", location: "Delhi", manager_name: "Rahul", manager_phone: "9810000001", status: "active", outlet_type: "regular", started_on: "2026-01-01", excluded_skus: [] };
        const o2 = { id: uid("OUT"), name: "Outlet B — Saket", location: "Delhi", manager_name: "Priya", manager_phone: "9810000002", status: "active", outlet_type: "regular", started_on: "2026-01-01", excluded_skus: [] };
        const o3 = { id: uid("OUT"), name: "Outlet C — Gurgaon", location: "Gurgaon", manager_name: "Amit", manager_phone: "9810000003", status: "active", outlet_type: "regular", started_on: "2026-01-01", excluded_skus: [] };
        const pickedSkus = this.skus.filter(s => s.sale_price > 0).slice(0, 8);
        const b1 = writeBatch(db);
        for (const o of [o1, o2, o3]) {
          b1.set(doc(db, "outlets", o.id), clean(o));
          const dispId = uid("DSP");
          b1.set(doc(db, "dispatches", dispId), clean({ id: dispId, outlet_id: o.id, dispatched_on: "2026-04-02", dispatched_by: "Godown", status: "received", received_on: "2026-04-03", received_by: o.manager_name }));
          for (const sku of pickedSkus) {
            const qty = Math.floor(Math.random() * 30) + 10, dlId = uid("DL");
            b1.set(doc(db, "dispatchLines", dlId), { id: dlId, dispatch_id: dispId, sku_id: sku.id, qty_dispatched: qty, qty_received: qty });
          }
        }
        await b1.commit();
        const b2 = writeBatch(db);
        for (const o of [o1, o2, o3]) {
          const importId = uid("PIM");
          b2.set(doc(db, "posImports", importId), clean({ id: importId, outlet_id: o.id, period_start: "2026-04-03", period_end: "2026-04-27", uploaded_on: new Date().toISOString(), line_count: pickedSkus.length }));
          for (const sku of pickedSkus) {
            const sold = Math.floor(5 + Math.random() * 15), plId = uid("PL");
            b2.set(doc(db, "posLines", plId), { id: plId, pos_import_id: importId, sku_id: sku.id, qty_sold: sold, revenue: sold * sku.sale_price });
          }
        }
        await b2.commit();
        this.notify("Demo data loaded — go to Audits and start one");
      } finally {
        this._saving = false;
      }
    },

  }));
});
