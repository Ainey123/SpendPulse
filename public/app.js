// ============================================================
// SpendPulse Frontend — vanilla JS SPA talking to /api backend
// ============================================================
const API = ""; // same-origin on Vercel

let TOKEN = localStorage.getItem("sp_token") || "";
let CURRENT_USER = null;
let ALL_TXNS = [];
let CURRENT_ROLE = "user";

// ---------- helpers ----------
function el(id) { return document.getElementById(id); }
function toast(msg) {
  const t = el("toast");
  t.textContent = msg;
  t.classList.remove("hidden");
  setTimeout(() => t.classList.add("hidden"), 2500);
}
function authHeader() { return { "Content-Type": "application/json", Authorization: "Bearer " + TOKEN }; }

async function api(path, method = "GET", body = null) {
  const opts = { method, headers: authHeader() };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(API + path, opts);
  let data = {};
  try { data = await res.json(); } catch (_) {}
  if (res.status === 401 && path !== "/api/login") {
    logout();
    return { error: "Session expired. Please login again." };
  }
  return data;
}

function showError(id, msg) {
  const e = el(id);
  if (!msg) { e.classList.add("hidden"); return; }
  e.textContent = msg;
  e.classList.remove("hidden");
}

// ---------- auth ----------
async function login(user, pass) {
  const data = await api("/api/login", "POST", { username: user, password: pass });
  if (data.error) { showError("loginError", data.error); return; }
  TOKEN = data.token;
  CURRENT_USER = data.username;
  CURRENT_ROLE = data.role;
  localStorage.setItem("sp_token", TOKEN);
  enterApp();
}

function logout() {
  api("/api/logout", "POST").catch(() => {});
  TOKEN = ""; CURRENT_USER = null; CURRENT_ROLE = "user";
  localStorage.removeItem("sp_token");
  el("appShell").classList.add("hidden");
  el("loginScreen").classList.remove("hidden");
}

async function enterApp() {
  el("loginScreen").classList.add("hidden");
  el("appShell").classList.remove("hidden");
  el("userLabel").textContent = CURRENT_USER;
  el("roleBadge").textContent = CURRENT_ROLE.toUpperCase();
  const isAdmin = CURRENT_ROLE === "admin";
  el("adminPanel").classList.toggle("hidden", !isAdmin);
  el("loggedByHead").classList.toggle("hidden", !isAdmin);
  el("filterUser").classList.toggle("hidden", !isAdmin);
  el("profileInfo").textContent = `Username: ${CURRENT_USER}    Role: ${CURRENT_ROLE}`;
  if (isAdmin) {
    const u = await api("/api/users/list");
    if (u.users) {
      el("filterUser").innerHTML = '<option value="">All users</option>' +
        u.users.map(x => `<option value="${x.username}">${x.username}</option>`).join("");
    }
  }
  await loadTransactions();
}

// ---------- data ----------
function matchesFilter(t) {
  const mode = el("filterMode").value;
  const d = t.date;
  if (mode === "all") return true;
  if (mode === "day") return d === el("filterDay").value;
  if (mode === "month") {
    const y = el("filterYear").value, m = el("filterMonth").value.padStart(2, "0");
    return d.startsWith(`${y}-${m}`);
  }
  if (mode === "custom") {
    const s = el("filterStart").value, e = el("filterEnd").value;
    return d >= s && d <= e;
  }
  return true;
}

async function loadTransactions() {
  const data = await api("/api/transactions");
  if (data.error) { toast(data.error); return; }
  ALL_TXNS = data.transactions || [];
  CURRENT_ROLE = data.role || CURRENT_ROLE;
  renderTable();
}

function renderTable() {
  const userFilter = el("filterUser").value;
  let rows = ALL_TXNS.filter(matchesFilter);
  if (CURRENT_ROLE === "admin" && userFilter) {
    rows = rows.filter(r => r.logged_by === userFilter);
  }
  const total = rows.reduce((s, r) => s + (parseFloat(r.amount) || 0), 0);
  el("summaryCards").innerHTML = `
    <div class="bg-slate-800 rounded-2xl p-4"><div class="text-slate-400 text-xs">Total Sent</div><div class="text-xl font-bold">PKR ${total.toLocaleString(undefined, {minimumFractionDigits:2})}</div></div>
    <div class="bg-slate-800 rounded-2xl p-4"><div class="text-slate-400 text-xs">Transactions</div><div class="text-xl font-bold">${rows.length}</div></div>
    <div class="bg-slate-800 rounded-2xl p-4"><div class="text-slate-400 text-xs">Avg Amount</div><div class="text-xl font-bold">PKR ${rows.length ? (total/rows.length).toLocaleString(undefined,{minimumFractionDigits:2}) : "0.00"}</div></div>`;

  const body = el("txnBody");
  body.innerHTML = "";
  el("emptyState").classList.toggle("hidden", rows.length > 0);
  rows.forEach(r => {
    const tr = document.createElement("tr");
    tr.className = "hover:bg-slate-700/40";
    const receipt = r.receipt_base64
      ? `<button class="text-brand-400 underline" onclick="showReceipt('${encodeURIComponent(r.receipt_base64)}')">View</button>`
      : "—";
    const logged = CURRENT_ROLE === "admin" ? `<td class="px-2 py-2">${r.logged_by || ""}</td>` : "";
    tr.innerHTML = `
      <td class="px-2 py-2">${r.reference_number || ""}</td>
      <td class="px-2 py-2">${r.date || ""}</td>
      <td class="px-2 py-2">${r.time || ""}</td>
      <td class="px-2 py-2 text-right">PKR ${(parseFloat(r.amount)||0).toLocaleString(undefined,{minimumFractionDigits:2})}</td>
      <td class="px-2 py-2">${r.sender_name || ""}</td>
      <td class="px-2 py-2">${r.receiver_name || ""}</td>
      <td class="px-2 py-2">${r.purpose || ""}</td>
      <td class="px-2 py-2">${r.transaction_type || ""}</td>
      ${logged}
      <td class="px-2 py-2">${receipt}</td>`;
    body.appendChild(tr);
  });
  window.__filtered = rows;
}

window.showReceipt = function (b64) {
  const img = "data:image/png;base64," + decodeURIComponent(b64).replace(/^data:.*,/, "");
  const w = window.open("", "_blank");
  w.document.write(`<img src="${img}" style="max-width:100%">`);
};

// ---------- CSV export ----------
function downloadCSV() {
  const rows = window.__filtered || [];
  const cols = ["reference_number","date","time","amount","sender_name","receiver_name","purpose","transaction_type","receipt_base64","logged_by"];
  const head = cols.join(",");
  const esc = v => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const lines = rows.map(r => cols.map(c => esc(r[c])).join(","));
  const csv = "﻿" + [head, ...lines].join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `spendpulse_${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

// ---------- events ----------
el("loginForm").addEventListener("submit", e => {
  e.preventDefault();
  showError("loginError", "");
  login(el("loginUser").value.trim(), el("loginPass").value);
});

el("logoutBtn").addEventListener("click", logout);

el("filterMode").addEventListener("change", () => {
  const m = el("filterMode").value;
  el("filterDay").classList.toggle("hidden", m !== "day");
  el("filterMonthWrap").classList.toggle("hidden", m !== "month");
  el("filterMonthWrap").classList.toggle("flex", m === "month");
  el("filterCustomWrap").classList.toggle("hidden", m !== "custom");
  el("filterCustomWrap").classList.toggle("flex", m === "custom");
  renderTable();
});

el("applyFilter").addEventListener("click", renderTable);
el("filterUser").addEventListener("change", renderTable);
el("exportBtn").addEventListener("click", downloadCSV);

// receipt preview + base64
el("receipt").addEventListener("change", e => {
  const file = e.target.files[0];
  if (!file) { el("receiptPreview").classList.add("hidden"); return; }
  const reader = new FileReader();
  reader.onload = () => { el("receiptImg").src = reader.result; el("receiptPreview").classList.remove("hidden"); };
  reader.readAsDataURL(file);
});

async function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result.split(",")[1]);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

el("txnForm").addEventListener("submit", async e => {
  e.preventDefault();
  showError("txnError", "");
  const file = el("receipt").files[0];
  let b64 = "";
  if (file) {
    if (file.size > 2 * 1024 * 1024) { showError("txnError", "Receipt too large (>2MB)."); return; }
    b64 = await fileToBase64(file);
  }
  const payload = {
    reference_number: el("ref").value.trim(),
    date: el("txnDate").value,
    time: el("txnTime").value,
    amount: el("amount").value,
    sender_name: el("sender").value.trim(),
    receiver_name: el("receiver").value.trim(),
    purpose: el("purpose").value.trim(),
    transaction_type: el("txnType").value,
    receipt_base64: b64,
  };
  const data = await api("/api/transactions", "POST", payload);
  if (data.error) { showError("txnError", data.error); return; }
  el("txnForm").reset();
  el("receiptPreview").classList.add("hidden");
  toast("✅ Transaction saved");
  await loadTransactions();
});

el("userForm").addEventListener("submit", async e => {
  e.preventDefault();
  const data = await api("/api/users", "POST", {
    username: el("newUser").value.trim(),
    password: el("newPass").value,
    role: el("newRole").value,
  });
  if (data.error) { el("userMsg").textContent = data.error; el("userMsg").className = "text-sm text-red-400"; return; }
  el("userMsg").textContent = "User created ✅";
  el("userMsg").className = "text-sm text-emerald-400";
  el("userForm").reset();
  await enterApp();
});

// profile
el("profileBtn").addEventListener("click", () => el("profileModal").classList.remove("hidden"));
el("closeProfile").addEventListener("click", () => el("profileModal").classList.add("hidden"));
el("resetForm").addEventListener("submit", async e => {
  e.preventDefault();
  showError("resetError", "");
  const cur = el("curPass").value, n1 = el("newPass1").value, n2 = el("newPass2").value;
  if (n1.length < 4) { showError("resetError", "Password must be at least 4 characters."); return; }
  if (n1 !== n2) { showError("resetError", "Passwords do not match."); return; }
  const data = await api("/api/reset-password", "POST", { current_password: cur, new_password: n1 });
  if (data.error) { showError("resetError", data.error); return; }
  toast("✅ Password updated");
  el("resetForm").reset();
  el("profileModal").classList.add("hidden");
});

// ---------- init ----------
(function init() {
  const today = new Date().toISOString().slice(0, 10);
  el("filterDay").value = today;
  el("filterStart").value = today.slice(0, 8) + "01";
  el("filterEnd").value = today;
  if (TOKEN) {
    api("/api/me").then(d => {
      if (d.username) { CURRENT_USER = d.username; CURRENT_ROLE = d.role; enterApp(); }
      else logout();
    }).catch(() => logout());
  }
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }
})();
