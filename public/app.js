// ============================================================
// SpendPulse Frontend — vanilla JS SPA talking to /api backend
// ============================================================
const API = ""; // same-origin on Vercel

let TOKEN = localStorage.getItem("sp_token") || "";
let CURRENT_USER = null;
let ALL_TXNS = [];
let ALL_CONTACTS = [];
let PENDING_SCANS = [];
let CURRENT_PENDING_INDEX = -1;
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
  CURRENT_ROLE = (CURRENT_ROLE || "user").toString().toLowerCase();
  el("loginScreen").classList.add("hidden");
  el("appShell").classList.remove("hidden");
  el("userLabel").textContent = CURRENT_USER || "";
  el("roleBadge").textContent = CURRENT_ROLE.toUpperCase();
  const isAdmin = CURRENT_ROLE === "admin";
  el("adminPanel").classList.toggle("hidden", !isAdmin);
  el("loggedByHead").classList.toggle("hidden", !isAdmin);
  el("filterUser").classList.toggle("hidden", !isAdmin);
  el("profileInfo").textContent = `Username: ${CURRENT_USER}    Role: ${CURRENT_ROLE}`;
  if (isAdmin) {
    try {
      const u = await api("/api/users/list");
      if (u.users) {
        el("filterUser").innerHTML = '<option value="">All users</option>' +
          u.users.map(x => `<option value="${x.username}">${x.username}</option>`).join("");
      }
    } catch (_) {}
  }
  await loadContacts();
  await loadTransactions();
}

async function loadContacts() {
  const data = await api("/api/contacts");
  if (!data.error && data.contacts) {
    ALL_CONTACTS = data.contacts;
    const list = el("receiversList");
    if (list) {
      list.innerHTML = ALL_CONTACTS.map(c => `<option value="${c.name}">${c.phone ? c.phone : ''}</option>`).join("");
    }
  }
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
  CURRENT_ROLE = (data.role || CURRENT_ROLE || "user").toString().toLowerCase();
  if (data.error) {
    showError("filterError", "⚠️ Could not load transactions: " + data.error +
      "  (Check that SPREADSHEET_ID and GOOGLE_CREDENTIALS are set, and the 'transactions' tab exists.)");
    ALL_TXNS = [];
    renderTable();
    return;
  }
  ALL_TXNS = data.transactions || [];
  renderTable();
}

function renderTable() {
  const userFilter = el("filterUser").value;
  let rows = ALL_TXNS.filter(matchesFilter);
  if (CURRENT_ROLE === "admin" && userFilter) {
    rows = rows.filter(r => r.logged_by === userFilter);
  }
  const total = rows.reduce((s, r) => s + (parseFloat(r.amount) || 0), 0);
  const receivers = {};
  rows.forEach(r => {
    const name = (r.receiver_name || "Unknown").trim();
    receivers[name] = (receivers[name] || 0) + (parseFloat(r.amount) || 0);
  });
  const numContacts = Object.keys(receivers).length;

  el("summaryCards").innerHTML = `
    <div class="bg-slate-800 rounded-2xl p-4"><div class="text-slate-400 text-xs">Total Sent</div><div class="text-xl font-bold">PKR ${total.toLocaleString(undefined, {minimumFractionDigits:2})}</div></div>
    <div class="bg-slate-800 rounded-2xl p-4"><div class="text-slate-400 text-xs">Transactions</div><div class="text-xl font-bold">${rows.length}</div></div>
    <div class="bg-slate-800 rounded-2xl p-4"><div class="text-slate-400 text-xs">Avg Amount</div><div class="text-xl font-bold">PKR ${rows.length ? (total/rows.length).toLocaleString(undefined,{minimumFractionDigits:2}) : "0.00"}</div></div>
    <div class="bg-slate-800 rounded-2xl p-4"><div class="text-slate-400 text-xs">Active Contacts</div><div class="text-xl font-bold">${numContacts}</div></div>`;

  el("contactBreakdown").innerHTML = Object.entries(receivers).map(([name, amount]) => `
    <div class="bg-slate-800/50 border border-slate-700 rounded-xl p-3 flex justify-between items-center">
      <div class="text-sm font-semibold truncate pr-2">${name}</div>
      <div class="text-sm text-brand-400 font-bold whitespace-nowrap">PKR ${amount.toLocaleString(undefined, {minimumFractionDigits:2})}</div>
    </div>
  `).join("");

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
  const cols = ["reference_number","date","time","amount","currency","sender_name","sender_account","receiver_name","receiver_account","purpose","transaction_type","receipt_base64","logged_by"];
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

// ---------- OCR auto-extract flow ----------

function renderPendingScans() {
  const sec = el("pendingScansSection");
  const list = el("pendingScansList");
  el("pendingCount").textContent = PENDING_SCANS.length;
  if (PENDING_SCANS.length === 0) {
    sec.classList.add("hidden");
    return;
  }
  sec.classList.remove("hidden");
  list.innerHTML = PENDING_SCANS.map((scan, i) => `
    <div class="flex justify-between items-center bg-slate-900 border border-slate-700 p-3 rounded-lg cursor-pointer hover:bg-slate-700 transition" onclick="loadPendingScan(${i})">
      <div>
        <div class="text-sm font-semibold text-emerald-400">PKR ${scan.amount} &rarr; ${scan.receiver_name}</div>
        <div class="text-xs text-slate-400">File: ${scan._filename}</div>
      </div>
      <button class="bg-brand-600 hover:bg-brand-700 px-3 py-1 rounded text-xs font-semibold">Review</button>
    </div>
  `).join("");
}

window.loadPendingScan = function(index) {
  const data = PENDING_SCANS[index];
  if (!data) return;
  CURRENT_PENDING_INDEX = index;
  
  if (data.date) el("txnDate").value = data.date;
  if (data.time) el("txnTime").value = (data.time || "").length <= 5 ? data.time : data.time.slice(0, 5);
  if (data.sender_name) el("sender").value = data.sender_name;
  if (data.sender_account) el("senderAccount").value = data.sender_account;
  if (data.receiver_name) el("receiver").value = data.receiver_name;
  if (data.receiver_account) el("receiverAccount").value = data.receiver_account;
  if (data.amount) el("amount").value = data.amount;
  if (data.currency) el("currency").value = data.currency;
  if (!el("purpose").value) el("purpose").value = data.purpose || "Auto-extracted from screenshot";
  if (!el("txnType").value && data.transaction_type) {
    const opt = [...el("txnType").options].find(o => o.value.toLowerCase() === data.transaction_type.toLowerCase());
    if (opt) el("txnType").value = opt.value;
  }
  if (!el("ref").value) el("ref").value = "AUTO-" + Date.now().toString().slice(-6);
  
  // Display receipt preview if we have the b64
  if (data.receipt_base64) {
    // Hack: We can't set the file input value, but we can store it in a data attribute or global for saving
    window.__current_receipt_b64 = data.receipt_base64;
    el("receiptPreview").classList.remove("hidden");
    el("receiptImg").src = data.receipt_base64.startsWith("data:") ? data.receipt_base64 : "data:image/png;base64," + data.receipt_base64;
  }
  
  el("txnForm").scrollIntoView({ behavior: "smooth" });
  toast("Loaded pending transaction. Review and Save!");
};

el("ocrBtn").addEventListener("click", async () => {
  const files = el("ocrFile").files;
  const status = el("ocrStatus");
  const progress = el("ocrProgress");
  if (!files || files.length === 0) { 
    status.textContent = "Please choose at least one image first."; 
    status.classList.remove("hidden"); 
    return; 
  }
  
  status.textContent = `⏳ Processing ${files.length} image(s)...`;
  status.className = "text-sm text-slate-400 mt-2";
  status.classList.remove("hidden");
  el("ocrRaw").classList.add("hidden");
  if (progress) {
    progress.innerHTML = "";
    progress.classList.remove("hidden");
  }
  
  let successCount = 0;
  
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    let pItem = null;
    if (progress) {
      pItem = document.createElement("div");
      pItem.className = "text-xs text-slate-300 p-2 bg-slate-900 rounded";
      pItem.textContent = `Scanning file ${i + 1}/${files.length}: ${file.name}...`;
      progress.appendChild(pItem);
    }
    
    try {
      const b64 = await fileToBase64(file);
      const data = await api("/api/extract", "POST", { image_base64: b64 });
      
      if (data.error) {
        if (pItem) {
          pItem.innerHTML = `❌ <b>${file.name}</b> failed: ${data.error}`;
          pItem.classList.add("text-red-400");
        }
        continue;
      }
      
      if (!data.amount || parseFloat(data.amount) === 0 || !data.receiver_name) {
        if (pItem) {
          pItem.innerHTML = `⚠️ <b>${file.name}</b> scanned, but amount/receiver is missing. (Did you set GEMINI_API_KEY?)`;
          pItem.classList.add("text-yellow-400");
        }
      } else {
        if (pItem) {
          pItem.innerHTML = `✅ <b>${file.name}</b> scanned successfully!`;
          pItem.classList.add("text-emerald-400");
        }
      }

      const scanData = {
        ...data,
        receipt_base64: b64,
        _filename: file.name
      };
      
      PENDING_SCANS.push(scanData);
      successCount++;
    } catch (err) {
      if (pItem) {
        pItem.innerHTML = `❌ <b>${file.name}</b> error: ${err.message}`;
        pItem.classList.add("text-red-400");
      }
    }
  }
  
  status.innerHTML = `Finished processing. ${successCount} out of ${files.length} ready for review.`;
  status.className = "text-sm text-emerald-400 mt-2 font-semibold";
  
  el("ocrFile").value = "";
  renderPendingScans();
  
  if (PENDING_SCANS.length > 0 && CURRENT_PENDING_INDEX === -1) {
    loadPendingScan(0);
  }
});

el("txnForm").addEventListener("submit", async e => {
  e.preventDefault();
  showError("txnError", "");
  const file = el("receipt").files[0];
  let b64 = window.__current_receipt_b64 || ""; // use pending b64 if set
  if (file) {
    if (file.size > 2 * 1024 * 1024) { showError("txnError", "Receipt too large (>2MB)."); return; }
    b64 = await fileToBase64(file);
  }
  const payload = {
    reference_number: el("ref").value.trim(),
    date: el("txnDate").value,
    time: el("txnTime").value,
    amount: el("amount").value,
    currency: el("currency").value.trim() || "PKR",
    sender_name: el("sender").value.trim(),
    sender_account: el("senderAccount").value.trim(),
    receiver_name: el("receiver").value.trim(),
    receiver_account: el("receiverAccount").value.trim(),
    purpose: el("purpose").value.trim(),
    transaction_type: el("txnType").value,
    receipt_base64: b64,
  };
  const data = await api("/api/transactions", "POST", payload);
  if (data.error) { showError("txnError", data.error); return; }
  
  // Success!
  el("txnForm").reset();
  el("receiptPreview").classList.add("hidden");
  window.__current_receipt_b64 = "";
  
  if (CURRENT_PENDING_INDEX !== -1) {
    PENDING_SCANS.splice(CURRENT_PENDING_INDEX, 1);
    CURRENT_PENDING_INDEX = -1;
    renderPendingScans();
  }
  
  toast("✅ Transaction saved");
  await loadTransactions();
});

const contactForm = el("contactForm");
if (contactForm) {
  contactForm.addEventListener("submit", async e => {
    e.preventDefault();
    const btn = contactForm.querySelector("button");
    btn.disabled = true;
    const data = await api("/api/contacts", "POST", {
      name: el("contactName").value.trim(),
      phone: el("contactPhone").value.trim(),
      account: el("contactAccount").value.trim(),
    });
    btn.disabled = false;
    const msg = el("contactMsg");
    if (data.error) { 
      msg.textContent = data.error; 
      msg.className = "text-sm text-red-400"; 
      return; 
    }
    msg.textContent = "Contact added ✅";
    msg.className = "text-sm text-emerald-400";
    contactForm.reset();
    await loadContacts();
    setTimeout(() => { msg.textContent = ""; }, 3000);
  });
}

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
