// SpendPulse Enterprise Dual-Portal SPA Controller

// State Management
let currentUser = null;
let currentPin = "";
let activeRoleTab = "admin"; // 'admin' or 'employee'

// Multi-image batches for upload
let adminImageBatch = [];
let empImageBatch = [];

// Currently selected transaction for status update
let selectedTxId = null;

// Ledger Statement Cache
let allLedgerTransactions = [];
const DEFAULT_OPENING_BALANCE = 1000000.00;
let parsedBulkItems = [];

// Initialize App
document.addEventListener("DOMContentLoaded", () => {
    initAuthView();
    initPinPad();
    initMultiImageDropzones();
    initAdminSubTabs();
    initLedgerFilters();
    initBulkStatementUploader();
    checkExistingSession();
});

// -------------------------------------------------------------
// 1. SESSION & VIEW SWITCHING
// -------------------------------------------------------------
function checkExistingSession() {
    const raw = localStorage.getItem("spendpulse_user");
    if (raw) {
        try {
            currentUser = JSON.parse(raw);
            if (currentUser && currentUser.token) {
                renderUserHeader();
                if (currentUser.role === "admin") {
                    showAdminView();
                } else {
                    showEmployeeView();
                }
                return;
            }
        } catch (e) {
            localStorage.removeItem("spendpulse_user");
        }
    }
    showAuthView();
}

function renderUserHeader() {
    const nav = document.getElementById("userHeaderNav");
    const roleBadge = document.getElementById("userRoleBadge");
    const nameDisplay = document.getElementById("userNameDisplay");
    
    if (currentUser) {
        nav.classList.remove("hidden");
        nameDisplay.textContent = currentUser.name || currentUser.username;
        if (currentUser.role === "admin") {
            roleBadge.textContent = "Admin";
            roleBadge.className = "role-badge admin";
        } else {
            roleBadge.textContent = "Employee";
            roleBadge.className = "role-badge employee";
        }
    } else {
        nav.classList.add("hidden");
    }
}

document.getElementById("logoutBtn").addEventListener("click", () => {
    localStorage.removeItem("spendpulse_user");
    currentUser = null;
    currentPin = "";
    updatePinDots();
    renderUserHeader();
    showAuthView();
});

function showAuthView() {
    document.getElementById("authView").classList.remove("hidden");
    document.getElementById("adminView").classList.add("hidden");
    document.getElementById("employeeView").classList.add("hidden");
    renderUserHeader();
}

function showAdminView() {
    document.getElementById("authView").classList.add("hidden");
    document.getElementById("adminView").classList.remove("hidden");
    document.getElementById("employeeView").classList.add("hidden");
    renderUserHeader();
    loadAdminDashboard();
}

function showEmployeeView() {
    document.getElementById("authView").classList.add("hidden");
    document.getElementById("adminView").classList.add("hidden");
    document.getElementById("employeeView").classList.remove("hidden");
    renderUserHeader();
    loadEmployeeDashboard();
}

// -------------------------------------------------------------
// 2. ADMIN SUB-PANEL NAVIGATION
// -------------------------------------------------------------
function initAdminSubTabs() {
    const tabOverview = document.getElementById("adminTabOverview");
    const tabLedger = document.getElementById("adminTabLedger");
    const tabTeam = document.getElementById("adminTabTeam");

    const panelOverview = document.getElementById("adminOverviewPanel");
    const panelLedger = document.getElementById("adminLedgerPanel");
    const panelTeam = document.getElementById("adminTeamPanel");

    tabOverview.onclick = () => {
        tabOverview.className = "auth-tab active";
        tabLedger.className = "auth-tab";
        tabTeam.className = "auth-tab";
        panelOverview.classList.remove("hidden");
        panelLedger.classList.add("hidden");
        panelTeam.classList.add("hidden");
    };

    tabLedger.onclick = () => {
        tabOverview.className = "auth-tab";
        tabLedger.className = "auth-tab active";
        tabTeam.className = "auth-tab";
        panelOverview.classList.add("hidden");
        panelLedger.classList.remove("hidden");
        panelTeam.classList.add("hidden");
        loadBankLedgerStatement();
    };

    tabTeam.onclick = () => {
        tabOverview.className = "auth-tab";
        tabLedger.className = "auth-tab";
        tabTeam.className = "auth-tab active";
        panelOverview.classList.add("hidden");
        panelLedger.classList.add("hidden");
        panelTeam.classList.remove("hidden");
        fetchEmployeesList();
    };
}

// -------------------------------------------------------------
// 3. AUTHENTICATION & PIN KEYPAD CONTROLLER
// -------------------------------------------------------------
function initAuthView() {
    const tabAdmin = document.getElementById("tabAdmin");
    const tabEmployee = document.getElementById("tabEmployee");
    const authTitle = document.getElementById("authTitle");
    const authSubtitle = document.getElementById("authSubtitle");
    const loginUsername = document.getElementById("loginUsername");

    tabAdmin.addEventListener("click", () => {
        activeRoleTab = "admin";
        tabAdmin.classList.add("active");
        tabEmployee.classList.remove("active");
        authTitle.textContent = "Shield Admin Login";
        authSubtitle.textContent = "Enter your admin username and 4-digit security PIN.";
        loginUsername.placeholder = "e.g. admin";
        loginUsername.value = "admin";
        resetPin();
    });

    tabEmployee.addEventListener("click", () => {
        activeRoleTab = "employee";
        tabEmployee.classList.add("active");
        tabAdmin.classList.remove("active");
        authTitle.textContent = "Employee Portal Login";
        authSubtitle.textContent = "Enter your employee name/ID and PIN code.";
        loginUsername.placeholder = "e.g. employee or John Employee";
        loginUsername.value = "employee";
        resetPin();
    });

    document.getElementById("togglePasswordFallback").addEventListener("click", (e) => {
        e.preventDefault();
        const grp = document.getElementById("passwordFallbackGroup");
        grp.classList.toggle("hidden");
    });

    document.getElementById("loginForm").addEventListener("submit", handleLoginSubmit);
}

function initPinPad() {
    const keys = document.querySelectorAll(".pin-key[data-val]");
    keys.forEach(k => {
        k.addEventListener("click", () => {
            if (currentPin.length < 4) {
                currentPin += k.getAttribute("data-val");
                updatePinDots();
                if (currentPin.length === 4) {
                    handleLoginSubmit();
                }
            }
        });
    });

    document.getElementById("pinClear").addEventListener("click", resetPin);
    document.getElementById("pinBack").addEventListener("click", () => {
        if (currentPin.length > 0) {
            currentPin = currentPin.slice(0, -1);
            updatePinDots();
        }
    });

    document.addEventListener("keydown", (e) => {
        const authView = document.getElementById("authView");
        if (authView && !authView.classList.contains("hidden")) {
            if (document.activeElement.id === "loginUsername" || document.activeElement.id === "loginPassword") {
                return;
            }
            if (/^[0-9]$/.test(e.key)) {
                if (currentPin.length < 4) {
                    currentPin += e.key;
                    updatePinDots();
                    if (currentPin.length === 4) {
                        handleLoginSubmit();
                    }
                }
            } else if (e.key === "Backspace") {
                if (currentPin.length > 0) {
                    currentPin = currentPin.slice(0, -1);
                    updatePinDots();
                }
            } else if (e.key === "Escape") {
                resetPin();
            }
        }
    });
}

function resetPin() {
    currentPin = "";
    updatePinDots();
}

function updatePinDots() {
    for (let i = 1; i <= 4; i++) {
        const dot = document.getElementById(`dot${i}`);
        if (i <= currentPin.length) {
            dot.classList.add("filled");
        } else {
            dot.classList.remove("filled");
        }
    }
}

async function handleLoginSubmit(e) {
    if (e) e.preventDefault();
    const username = document.getElementById("loginUsername").value.trim();
    const password = document.getElementById("loginPassword").value.trim();
    const errBox = document.getElementById("authError");
    
    errBox.classList.add("hidden");

    if (!username) {
        errBox.textContent = "Please enter your Username or Employee ID.";
        errBox.classList.remove("hidden");
        return;
    }

    try {
        const res = await fetch("/api/login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                username: username,
                pin_code: currentPin,
                password: password
            })
        });
        const data = await res.json();
        
        if (res.ok && data.token) {
            currentUser = data;
            localStorage.setItem("spendpulse_user", JSON.stringify(currentUser));
            renderUserHeader();
            if (currentUser.role === "admin") {
                showAdminView();
            } else {
                showEmployeeView();
            }
        } else {
            throw new Error(data.error || "Invalid credentials or PIN code.");
        }
    } catch (err) {
        resetPin();
        errBox.textContent = err.message;
        errBox.classList.remove("hidden");
    }
}

// -------------------------------------------------------------
// 4. ADMIN DASHBOARD & EMPLOYEE MANAGEMENT CONTROLLER
// -------------------------------------------------------------
async function loadAdminDashboard() {
    fetchDashboardStats();
    fetchEmployeesList();
    fetchAdminTransactions();
    initAdminFormEvents();
}

async function fetchDashboardStats() {
    try {
        const res = await fetch("/api/dashboard-stats");
        if (res.ok) {
            const stats = await res.json();
            document.getElementById("statEmployees").textContent = stats.total_employees || 0;
            document.getElementById("statActiveTasks").textContent = stats.active_tasks || 0;
            document.getElementById("statCompleted").textContent = stats.completed_tasks || 0;
            document.getElementById("statPendingPayments").textContent = stats.pending_payments || 0;
            document.getElementById("statPaymentsSent").textContent = stats.payments_sent || 0;
            document.getElementById("statTotalSpend").textContent = `PKR ${Number(stats.total_spend_amount || 0).toLocaleString()}`;
        }
    } catch (e) {
        console.warn("Stats fetch failed:", e);
    }
}

async function fetchEmployeesList() {
    try {
        const res = await fetch("/api/users");
        if (res.ok) {
            const data = await res.json();
            const users = data.users || [];
            
            // Populate Employee Tables & Selects
            const tbody1 = document.getElementById("employeeTableBody");
            const tbody2 = document.getElementById("employeeTableBody2");
            const select = document.getElementById("adminAssignSelect");
            const modalSelect = document.getElementById("modalEmpSelect");

            select.innerHTML = `<option value="">Unassigned (General Queue)</option>`;
            modalSelect.innerHTML = `<option value="">Unassigned</option>`;

            if (users.length === 0) {
                const emptyRow = `<tr><td colspan="7" style="text-align: center; color: #94a3b8;">No registered employees found.</td></tr>`;
                if (tbody1) tbody1.innerHTML = emptyRow;
                if (tbody2) tbody2.innerHTML = emptyRow;
                return;
            }

            let html = "";
            users.forEach((u, index) => {
                const opt = `<option value="${u.user_id}">${u.name} (@${u.username})</option>`;
                select.innerHTML += opt;
                modalSelect.innerHTML += opt;

                const pinVal = u.pin_code || '1234';
                const passVal = u.password || 'pass123';

                html += `
                    <tr>
                        <td><code>${u.user_id}</code></td>
                        <td><b>${u.name}</b></td>
                        <td>@${u.username}</td>
                        <td><b style="color: #fbbf24; letter-spacing: 0.1em;">${pinVal}</b></td>
                        <td>
                            <span id="pwdText_${index}" style="font-family: monospace; color: #38bdf8;">${passVal}</span>
                        </td>
                        <td><span class="role-badge ${u.role}">${u.role}</span></td>
                        <td>
                            <button onclick="deleteEmployee('${u.user_id}', '${u.name}')" class="logout-btn" style="padding: 4px 8px; font-size: 11px;">🗑️ Delete</button>
                        </td>
                    </tr>
                `;
            });

            if (tbody1) tbody1.innerHTML = html;
            if (tbody2) tbody2.innerHTML = html;
        }
    } catch (e) {
        console.warn("Users fetch failed:", e);
    }
}

function initAdminFormEvents() {
    const bindForm = (toggleId, formId, nameId, unameId, pinId, passId, autoBtnId, msgId) => {
        const toggleBtn = document.getElementById(toggleId);
        const form = document.getElementById(formId);
        if (!toggleBtn || !form) return;

        toggleBtn.onclick = () => form.classList.toggle("hidden");

        const autoBtn = document.getElementById(autoBtnId);
        if (autoBtn) {
            autoBtn.onclick = () => {
                const randPin = Math.floor(1000 + Math.random() * 9000).toString();
                const randPass = "Emp#" + Math.floor(1000 + Math.random() * 9000);
                document.getElementById(pinId).value = randPin;
                document.getElementById(passId).value = randPass;
            };
        }

        form.onsubmit = async (e) => {
            e.preventDefault();
            const name = document.getElementById(nameId).value.trim();
            const username = document.getElementById(unameId).value.trim();
            const pin_code = document.getElementById(pinId).value.trim();
            const password = document.getElementById(passId).value.trim();
            const msg = document.getElementById(msgId);

            try {
                const res = await fetch("/api/users", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ name, username, pin_code, password, role: "employee" })
                });
                const data = await res.json();
                if (res.ok) {
                    msg.textContent = "✅ Employee created successfully!";
                    msg.className = "success";
                    msg.classList.remove("hidden");
                    form.reset();
                    fetchEmployeesList();
                    fetchDashboardStats();
                    setTimeout(() => msg.classList.add("hidden"), 4000);
                } else {
                    throw new Error(data.error || "Failed to create user");
                }
            } catch (err) {
                msg.textContent = err.message;
                msg.className = "error";
                msg.classList.remove("hidden");
            }
        };
    };

    bindForm("toggleCreateEmpBtn", "createEmpForm", "newEmpName", "newEmpUsername", "newEmpPin", "newEmpPassword", "autoGenCredentialsBtn", "createEmpMsg");
    bindForm("toggleCreateEmpBtn2", "createEmpForm2", "newEmpName2", "newEmpUsername2", "newEmpPin2", "newEmpPassword2", "autoGenCredentialsBtn2", "createEmpMsg2");

    const refBtn = document.getElementById("refreshAdminTableBtn");
    if (refBtn) refBtn.onclick = () => fetchAdminTransactions();

    // 🧹 Smart Cleanup — remove junk/bad rows only
    const cleanupBtn = document.getElementById("cleanupDumpsBtn");
    if (cleanupBtn) {
        cleanupBtn.onclick = async () => {
            if (!confirm("Remove junk rows (wrong amounts like 33, 180, 2026, raw statement text dumps)? Real payment records will be kept.")) return;
            cleanupBtn.disabled = true;
            cleanupBtn.textContent = "⏳ Cleaning...";
            try {
                const res = await fetch("/api/cleanup-statement-dumps", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ wipe_all: false })
                });
                const data = await res.json();
                alert(`✅ ${data.message}`);
                allLedgerTransactions = [];
                fetchAdminTransactions();
                loadBankLedgerStatement();
                fetchDashboardStats();
            } catch (err) {
                alert("Cleanup error: " + err.message);
            } finally {
                cleanupBtn.disabled = false;
                cleanupBtn.textContent = "🧹 Remove Junk Rows";
            }
        };
    }

    // 🗑️ Wipe ALL — delete every transaction row
    const wipeBtn = document.getElementById("wipeAllDataBtn");
    if (wipeBtn) {
        wipeBtn.onclick = async () => {
            if (!confirm("⚠️ WARNING: This will permanently delete ALL transaction records from Google Sheets. This cannot be undone. Are you absolutely sure?")) return;
            if (!confirm("Last chance — click OK to permanently wipe ALL data.")) return;
            wipeBtn.disabled = true;
            wipeBtn.textContent = "⏳ Wiping...";
            try {
                const res = await fetch("/api/cleanup-statement-dumps", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ wipe_all: true })
                });
                const data = await res.json();
                alert(`✅ ${data.message}`);
                allLedgerTransactions = [];
                fetchAdminTransactions();
                loadBankLedgerStatement();
                fetchDashboardStats();
            } catch (err) {
                alert("Wipe error: " + err.message);
            } finally {
                wipeBtn.disabled = false;
                wipeBtn.textContent = "🗑️ Wipe ALL Data";
            }
        };
    }
}

async function deleteEmployee(userId, name) {
    if (!confirm(`Are you sure you want to delete employee "${name}"?`)) return;
    try {
        const res = await fetch("/api/delete-user", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ user_id: userId })
        });
        if (res.ok) {
            alert(`Employee ${name} deleted successfully.`);
            fetchEmployeesList();
            fetchDashboardStats();
        } else {
            alert("Failed to delete user.");
        }
    } catch (e) {
        alert(e.message);
    }
}

async function fetchAdminTransactions() {
    const tbody = document.getElementById("adminTxTableBody");
    try {
        const res = await fetch("/api/transactions?role=admin");
        if (res.ok) {
            const data = await res.json();
            const txs = data.transactions || [];
            // Filter out raw statement header dumps from Master Tasks Table
            const cleanTxs = txs.filter(t => {
                const text = `${t.purpose} ${t.receiver_name} ${t.sender_name} ${t.reference_number}`.toLowerCase();
                return !text.includes("statement of account") && !text.includes("page of date description");
            });

            if (cleanTxs.length === 0) {
                tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; color: #94a3b8;">No task or payment records found.</td></tr>`;
                return;
            }

            let html = "";
            cleanTxs.forEach(t => {
                const statusPill = getStatusPill(t.status);
                const pct = parseInt(t.progress_pct) || (t.status === "Completed" ? 100 : 0);
                
                html += `
                    <tr>
                        <td><code>${t.reference_number || t.id}</code></td>
                        <td>${t.date} <span style="font-size: 11px; color: #94a3b8;">${t.time}</span></td>
                        <td><b>${t.receiver_name || t.sender_name || 'General Task'}</b></td>
                        <td><b style="color: #34d399;">${t.amount ? `${t.amount} ${t.currency}` : 'N/A'}</b></td>
                        <td>${t.employee_id ? `<code>${t.employee_id}</code>` : `<span style="color:#94a3b8;">Unassigned</span>`}</td>
                        <td>${statusPill}</td>
                        <td>
                            <div class="progress-container">
                                <div style="font-size: 11px; margin-bottom: 2px;">${pct}%</div>
                                <div class="progress-bar-bg">
                                    <div class="progress-bar-fill emerald" style="width: ${pct}%;"></div>
                                </div>
                            </div>
                        </td>
                        <td>
                            <div style="display: flex; gap: 4px;">
                                <button onclick="openStatusModal('${t.id}', '${t.status}', '${t.progress_pct}', '${t.employee_id}')" class="btn-primary" style="padding: 4px 8px; font-size: 11px;">⚙️ Status</button>
                                <button onclick="deleteTransactionRow('${t.id}', '${t.reference_number || t.receiver_name}')" class="logout-btn" style="padding: 4px 8px; font-size: 11px;">🗑️ Delete</button>
                            </div>
                        </td>
                    </tr>
                `;
            });
            tbody.innerHTML = html;
        }
    } catch (e) {
        tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; color: #ef4444;">Failed to load records.</td></tr>`;
    }
}

async function deleteTransactionRow(txId, name) {
    if (!confirm(`Are you sure you want to delete record "${name || txId}"?`)) return;
    try {
        const res = await fetch("/api/delete-transaction", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ transaction_id: txId })
        });
        const data = await res.json();
        if (res.ok) {
            alert("✅ Record deleted successfully.");
            const txRes = await fetch("/api/transactions?role=admin");
            if (txRes.ok) {
                const txData = await txRes.json();
                allLedgerTransactions = txData.transactions || [];
                renderBankLedgerTable();
                fetchAdminTransactions();
                fetchDashboardStats();
            }
        } else {
            alert("Failed to delete record: " + (data.error || "Unknown error"));
        }
    } catch (e) {
        alert("Delete error: " + e.message);
    }
}

function getStatusPill(st) {
    const s = (st || "Pending").toLowerCase().replace(" ", "");
    let cls = "pending";
    if (s.includes("process")) cls = "processing";
    else if (s.includes("sent")) cls = "sent";
    else if (s.includes("complete")) cls = "completed";
    else if (s.includes("fail")) cls = "failed";

    return `<span class="status-pill ${cls}">● ${st || "Pending"}</span>`;
}

// -------------------------------------------------------------
// 5. CONTINUOUS BANK LEDGER STATEMENT & BULK UPLOADER CONTROLLER
// -------------------------------------------------------------
async function loadBankLedgerStatement() {
    if (allLedgerTransactions.length === 0) {
        try {
            const res = await fetch("/api/transactions?role=admin");
            if (res.ok) {
                const data = await res.json();
                allLedgerTransactions = data.transactions || [];
            }
        } catch (e) {
            console.warn("Ledger fetch failed:", e);
        }
    }

    populateMonthTenureSelect();
    renderBankLedgerTable();
}

function initLedgerFilters() {
    const searchInput = document.getElementById("ledgerSearchInput");
    const monthSelect = document.getElementById("ledgerMonthSelect");
    const dateFrom = document.getElementById("ledgerDateFrom");
    const dateTo = document.getElementById("ledgerDateTo");
    const resetBtn = document.getElementById("resetLedgerBtn");
    const exportBtn = document.getElementById("exportLedgerCsvBtn");

    if (searchInput) searchInput.oninput = renderBankLedgerTable;
    if (monthSelect) monthSelect.onchange = renderBankLedgerTable;
    if (dateFrom) dateFrom.onchange = renderBankLedgerTable;
    if (dateTo) dateTo.onchange = renderBankLedgerTable;

    if (resetBtn) {
        resetBtn.onclick = () => {
            if (searchInput) searchInput.value = "";
            if (monthSelect) monthSelect.value = "all";
            if (dateFrom) dateFrom.value = "";
            if (dateTo) dateTo.value = "";
            renderBankLedgerTable();
        };
    }

    if (exportBtn) {
        exportBtn.onclick = exportLedgerToCsv;
    }
}

function initBulkStatementUploader() {
    const dropzone = document.getElementById("bulkStatementDropzone");
    const fileInput = document.getElementById("bulkFileInput");

    if (!dropzone || !fileInput) return;

    dropzone.onclick = () => fileInput.click();

    fileInput.onchange = (e) => {
        if (e.target.files.length) handleBulkStatementFile(e.target.files[0]);
    };

    dropzone.ondragover = (e) => { e.preventDefault(); dropzone.style.borderColor = "#6366f1"; };
    dropzone.ondragleave = () => dropzone.style.borderColor = "rgba(99, 102, 241, 0.5)";
    dropzone.ondrop = (e) => {
        e.preventDefault();
        dropzone.style.borderColor = "rgba(99, 102, 241, 0.5)";
        if (e.dataTransfer.files.length) handleBulkStatementFile(e.dataTransfer.files[0]);
    };

    const confirmBtn = document.getElementById("confirmBulkImportBtn");
    const cancelBtn = document.getElementById("cancelBulkImportBtn");
    const selectAll = document.getElementById("bulkSelectAll");

    if (confirmBtn) confirmBtn.onclick = confirmBulkImport;
    if (cancelBtn) cancelBtn.onclick = () => document.getElementById("bulkPreviewModal").classList.add("hidden");
    if (selectAll) {
        selectAll.onchange = (e) => {
            const cbs = document.querySelectorAll(".bulk-row-cb");
            cbs.forEach(cb => cb.checked = e.target.checked);
            updateBulkSelectedCount();
        };
    }
}

function handleBulkStatementFile(file) {
    const progressBox = document.getElementById("bulkUploadProgress");
    if (progressBox) {
        progressBox.textContent = `⏳ Reading & parsing "${file.name}"...`;
        progressBox.className = "success";
        progressBox.classList.remove("hidden");
    }

    const name = file.name.toLowerCase();
    const isPdf = name.endsWith(".pdf") || file.type === "application/pdf";

    if (name.endsWith(".csv") || name.endsWith(".txt")) {
        const reader = new FileReader();
        reader.onload = (e) => {
            const items = parseCsvBankStatement(e.target.result);
            if (items.length === 0) {
                alert("Could not find valid statement rows in the CSV file.");
                if (progressBox) progressBox.classList.add("hidden");
                return;
            }
            openBulkPreviewModal(items);
            if (progressBox) progressBox.classList.add("hidden");
        };
        reader.readAsText(file);
    } else if (isPdf || file.type.startsWith("image/")) {
        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                let items = [];
                const b64 = e.target.result;

                if (isPdf && window.pdfjsLib) {
                    try {
                        const arrayBuffer = await file.arrayBuffer();
                        pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js';
                        const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
                        const pdf = await loadingTask.promise;
                        let extractedText = "";

                        if (progressBox) progressBox.textContent = `⏳ Extracting text from ${pdf.numPages} pages...`;

                        for (let p = 1; p <= pdf.numPages; p++) {
                            const page = await pdf.getPage(p);
                            const textContent = await page.getTextContent();

                            // ── Y-position aware line grouping ──────────────────────────────
                            // PDF coordinate Y increases upward. Group text items that share
                            // the same Y (±4px tolerance) into one visual "line", then sort
                            // each group left→right by X so column order is preserved.
                            const lineMap = new Map();
                            for (const item of textContent.items) {
                                if (!item.str || !item.str.trim()) continue;
                                const y = Math.round(item.transform[5] / 4) * 4; // bucket to 4px
                                const x = item.transform[4];
                                if (!lineMap.has(y)) lineMap.set(y, []);
                                lineMap.get(y).push({ str: item.str, x });
                            }

                            // Sort lines top→bottom (descending Y) then items left→right
                            const sortedYs = Array.from(lineMap.keys()).sort((a, b) => b - a);
                            for (const y of sortedYs) {
                                const lineItems = lineMap.get(y).sort((a, b) => a.x - b.x);
                                const lineText = lineItems.map(i => i.str.trim()).filter(Boolean).join("  ");
                                if (lineText.trim()) extractedText += lineText + "\n";
                            }
                            extractedText += "\n"; // blank line between pages
                        }

                        if (progressBox) progressBox.textContent = `⚙️ Parsing ${pdf.numPages} pages of statement...`;
                        if (extractedText.trim()) {
                            items = parseCsvBankStatement(extractedText);
                        }
                    } catch (pdfErr) {
                        console.warn("Client PDF.js text extraction notice:", pdfErr);
                    }
                }


                // If client-side parsing extracted 0 items, send base64 to /api/parse-statement-file for AI multi-row extraction
                if (items.length === 0) {
                    if (progressBox) progressBox.textContent = `🤖 Analyzing & extracting all statement rows using AI...`;
                    const res = await fetch("/api/parse-statement-file", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ file_base64: b64, file_type: isPdf ? "application/pdf" : "image/png" })
                    });
                    const data = await res.json();
                    if (res.ok && data.transactions && data.transactions.length > 0) {
                        items = data.transactions.map(t => ({
                            date: t.date || new Date().toISOString().slice(0,10),
                            particulars: t.particulars || t.purpose || "Bank Statement Entry",
                            reference_number: t.reference_number || t.inst_no || `ref_${Math.random().toString(36).substr(2,7)}`,
                            debit: strToFloat(t.debit || (t.transaction_type === "Credit" ? 0 : t.amount)),
                            credit: strToFloat(t.credit || (t.transaction_type === "Credit" ? t.amount : 0)),
                            amount: strToFloat(t.amount || t.debit || t.credit).toString(),
                            transaction_type: t.transaction_type || (strToFloat(t.credit) > 0 ? "Credit" : "Payment")
                        }));
                    }
                }

                if (items.length > 0) {
                    openBulkPreviewModal(items);
                } else {
                    alert("Could not extract statement entries from file. Please ensure document has readable statement rows.");
                }
            } catch (err) {
                alert("Failed to parse statement document: " + err.message);
            }
            if (progressBox) progressBox.classList.add("hidden");
        };
        reader.readAsDataURL(file);
    } else {
        alert("Supported statement formats: PDF (.pdf), CSV (.csv), Plain Text (.txt), or Statement Image (JPG, PNG).");
        if (progressBox) progressBox.classList.add("hidden");
    }
}


// ---------------------------------------------------------------
// UNIVERSAL BANK STATEMENT PARSER
// Works with Bank Alfalah, HBL, Meezan, UBL, MCB, Allied, etc.
// Handles multiline date-blocks correctly (Bank Alfalah style)
// ---------------------------------------------------------------
function parseCsvBankStatement(rawText) {
    const rawLines = rawText.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
    const results = [];

    const isJunkHeader = (l) => {
        const s = l.toLowerCase();
        return s.startsWith("page ") || s.startsWith("statement of account") || 
               s.startsWith("raiwind road") || s.startsWith("title of account") ||
               s.startsWith("registered address") || s.startsWith("registered contact") ||
               s.startsWith("date description") || s.startsWith("opening balance") ||
               s.startsWith("from date:") || s.startsWith("to date:") || s.startsWith("iban");
    };

    const cleanLines = rawLines.filter(l => !isJunkHeader(l));

    const DATE_REGEX = /^(\d{1,2}[-/\s]\d{1,2}[-/\s]\d{2,4})\b/;
    const blocks = [];
    let currentBlock = null;

    for (const line of cleanLines) {
        const dateMatch = line.match(DATE_REGEX);
        if (dateMatch) {
            if (currentBlock) blocks.push(currentBlock);
            currentBlock = {
                date: dateMatch[1],
                lines: [line]
            };
        } else if (currentBlock) {
            currentBlock.lines.push(line);
        }
    }
    if (currentBlock) blocks.push(currentBlock);

    for (const block of blocks) {
        const dateStr = formatDateIso(block.date);
        const fullText = block.lines.join(" ");

        if (fullText.toLowerCase().includes("opening balance")) continue;

        const isCredit = /\bac transfer cr\b|\bcredit\b|\bdeposit\b|\breceived\b/i.test(fullText);

        let receiverName = "";
        let accountNumber = "";

        const toMatch = fullText.match(/\bTo\s+([A-Z\s]{2,40}?)\s*[-–]/i);
        if (toMatch) receiverName = toMatch[1].trim();

        const phoneMatch = fullText.match(/\b(0[23]\d{9})\b/);
        const ibanMatch = fullText.match(/\b(PK\d{2}[A-Z]{4}\d{16})\b/);
        const longNumMatch = fullText.match(/\b(\d{10,16})\b/);
        if (phoneMatch) accountNumber = phoneMatch[1];
        else if (ibanMatch) accountNumber = ibanMatch[1];
        else if (longNumMatch) accountNumber = longNumMatch[1];

        // Parse numbers from fullText (Bank Alfalah has Debit/Credit + Running Balance)
        const numMatches = (fullText.match(/\b\d+(?:\.\d{1,2})?\b/g) || [])
            .map(n => parseFloat(n))
            .filter(n => {
                if (isNaN(n) || n < 100) return false;
                if (n === 2026 || n === 2025 || n === 2024 || n === 180 || n === 33) return false;
                if (n > 1000000000) return false; // Ignore long account/phone numbers
                return true;
            });

        let debit = 0.0;
        let credit = 0.0;
        let txAmt = 0.0;

        if (numMatches.length >= 2) {
            // First number is Tx Amount, second is Running Balance
            txAmt = numMatches[0];
        } else if (numMatches.length === 1) {
            txAmt = numMatches[0];
        }

        if (isCredit) {
            credit = txAmt;
            debit = 0.0;
        } else {
            debit = txAmt;
            credit = 0.0;
        }

        const amtVal = credit > 0 ? credit : debit;
        if (amtVal === 0 && !receiverName) continue;

        let cleanParticulars = fullText
            .replace(/\b0[23]\d{9}\b/g, '')
            .replace(/\bPK\d{2}[A-Z]{4}\d{16}\b/g, '')
            .replace(/\b\d{10,16}\b/g, '')
            .replace(/\b\d+(?:\.\d{1,2})?\b/g, '')
            .replace(/\s+/g, ' ')
            .trim();

        if (!cleanParticulars) cleanParticulars = isCredit ? "Account Transfer Credit" : "IBFT Transfer Payment";

        results.push({
            date: dateStr,
            particulars: cleanParticulars.substring(0, 200),
            receiver_name: receiverName,
            account_number: accountNumber,
            reference_number: `ref_${Math.random().toString(36).substr(2,7)}`,
            debit: debit,
            credit: credit,
            amount: amtVal.toString(),
            transaction_type: isCredit ? "Credit" : "Payment"
        });
    }

    // Step 5: Fallback to simple CSV parsing if no date-blocks were found
    if (results.length === 0) {
        for (const line of cleanLines) {
            const parts = line.split(/,|\t/).map(p => p.trim());
            if (parts.length < 3) continue;
            const dateStr = parts[0];
            const dateTest = dateStr.match(/\d{1,2}[-\/]\d{1,2}[-\/]\d{2,4}/);
            if (!dateTest) continue;
            const desc = parts[1] || 'Bank Entry';
            const nums = parts.slice(2).map(p => parseFloat(p.replace(/,/g,''))).filter(n => !isNaN(n) && n >= 100);
            if (nums.length === 0) continue;
            const debitVal = nums[0] || 0;
            const creditVal = nums[1] || 0;
            const amt = creditVal > 0 ? creditVal : debitVal;
            results.push({
                date: formatDateIso(dateStr),
                particulars: desc,
                receiver_name: '',
                account_number: '',
                reference_number: `ref_${Math.random().toString(36).substr(2,7)}`,
                debit: debitVal,
                credit: creditVal,
                amount: amt.toString(),
                transaction_type: creditVal > 0 ? 'Credit' : 'Payment'
            });
        }
    }

    return results;
}

function formatDateIso(dStr) {
    if (!dStr) return new Date().toISOString().slice(0,10);
    try {
        const parsed = new Date(dStr);
        if (!isNaN(parsed.getTime())) {
            return parsed.toISOString().slice(0,10);
        }
    } catch(e) {}
    return new Date().toISOString().slice(0,10);
}

function openBulkPreviewModal(items) {
    parsedBulkItems = items;
    const modal = document.getElementById("bulkPreviewModal");
    const tbody = document.getElementById("bulkPreviewTableBody");

    if (!modal || !tbody) return;

    let html = "";
    const existingSet = new Set(allLedgerTransactions.map(t => (t.reference_number || t.id).toLowerCase()));

    items.forEach((item, idx) => {
        const isDup = existingSet.has((item.reference_number || "").toLowerCase());
        const dupBadge = isDup ? `<span style="color: #fbbf24; font-size: 10px;">⚠️ Existing</span>` : `<span style="color: #34d399; font-size: 10px;">✅ New</span>`;
        const checked = isDup ? "" : "checked";

        html += `
            <tr>
                <td><input type="checkbox" class="bulk-row-cb" data-idx="${idx}" ${checked} onchange="updateBulkSelectedCount()" /></td>
                <td>${item.date}</td>
                <td><b>${item.particulars}</b></td>
                <td><code>${item.reference_number || 'Auto-ID'}</code></td>
                <td style="text-align: right; color: #f87171;">${item.debit > 0 ? item.debit.toLocaleString() : '-'}</td>
                <td style="text-align: right; color: #34d399;">${item.credit > 0 ? item.credit.toLocaleString() : '-'}</td>
                <td>${dupBadge}</td>
            </tr>
        `;
    });

    tbody.innerHTML = html;
    updateBulkSelectedCount();
    modal.classList.remove("hidden");
}

function updateBulkSelectedCount() {
    const selected = document.querySelectorAll(".bulk-row-cb:checked").length;
    const total = parsedBulkItems.length;
    const summaryText = document.getElementById("bulkParsedSummaryText");
    if (summaryText) {
        summaryText.textContent = `${selected} of ${total} transactions selected for continuous ledger import`;
    }
}

async function confirmBulkImport() {
    const selectedCbs = document.querySelectorAll(".bulk-row-cb:checked");
    if (selectedCbs.length === 0) {
        alert("Please select at least one transaction to import.");
        return;
    }

    const itemsToImport = [];
    selectedCbs.forEach(cb => {
        const idx = parseInt(cb.getAttribute("data-idx"));
        if (parsedBulkItems[idx]) {
            itemsToImport.push(parsedBulkItems[idx]);
        }
    });

    const modal = document.getElementById("bulkPreviewModal");
    const confirmBtn = document.getElementById("confirmBulkImportBtn");
    confirmBtn.disabled = true;
    confirmBtn.textContent = "⏳ Importing to Ledger...";

    try {
        const res = await fetch("/api/bulk-upload-statement", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                transactions: itemsToImport,
                logged_by: currentUser ? currentUser.name : "Admin Statement Importer"
            })
        });
        const data = await res.json();
        if (res.ok) {
            alert(`✅ ${data.message}`);
            modal.classList.add("hidden");
            // Automatically reload transactions & re-render continuous bank ledger table on the same page!
            const txRes = await fetch("/api/transactions?role=admin");
            if (txRes.ok) {
                const txData = await txRes.json();
                allLedgerTransactions = txData.transactions || [];
                loadBankLedgerStatement();
                fetchAdminTransactions();
                fetchDashboardStats();
            }
        } else {
            throw new Error(data.error || "Bulk import failed");
        }
    } catch (err) {
        alert("Import Error: " + err.message);
    } finally {
        confirmBtn.disabled = false;
        confirmBtn.textContent = "📥 Import Selected Transactions";
    }
}

function populateMonthTenureSelect() {
    const monthSelect = document.getElementById("ledgerMonthSelect");
    if (!monthSelect) return;

    const monthsSet = new Set();
    allLedgerTransactions.forEach(t => {
        if (t.date) {
            try {
                const d = new Date(t.date);
                if (!isNaN(d.getTime())) {
                    const mName = d.toLocaleString('en-US', { month: 'short', year: 'numeric' });
                    monthsSet.add(mName);
                }
            } catch (e) {}
        }
    });

    let optHtml = `<option value="all">All Months (Continuous Ledger)</option>`;
    monthsSet.forEach(m => {
        optHtml += `<option value="${m}">${m}</option>`;
    });
    monthSelect.innerHTML = optHtml;
}

function renderBankLedgerTable() {
    const tbody = document.getElementById("bankLedgerTableBody");
    if (!tbody) return;

    const searchQuery = (document.getElementById("ledgerSearchInput")?.value || "").toLowerCase().trim();
    const selectedMonth = document.getElementById("ledgerMonthSelect")?.value || "all";
    const dateFromStr = document.getElementById("ledgerDateFrom")?.value || "";
    const dateToStr = document.getElementById("ledgerDateTo")?.value || "";

    const banner = document.getElementById("ledgerSearchSummaryBanner");
    const bannerTitle = document.getElementById("searchSummaryTitle");
    const bannerCount = document.getElementById("searchSummaryCount");
    const bannerDebit = document.getElementById("searchSummaryDebit");
    const bannerCredit = document.getElementById("searchSummaryCredit");
    const bannerNet = document.getElementById("searchSummaryNet");

    const sorted = [...allLedgerTransactions].sort((a, b) => {
        const da = new Date(a.date + " " + (a.time || "00:00"));
        const db = new Date(b.date + " " + (b.time || "00:00"));
        return da - db;
    });

    let currentBalance = DEFAULT_OPENING_BALANCE;
    let totalDebit = 0.0;
    let totalCredit = 0.0;

    let rowsHtml = "";
    let lastMonthHeader = "";
    let renderedCount = 0;

    sorted.forEach((t) => {
        const amtStr = strToFloat(t.amount);
        const isCredit = (t.transaction_type || "").toLowerCase().includes("credit") || (t.transaction_type || "").toLowerCase().includes("deposit");
        
        const debitVal = (typeof t.debit === "number" && t.debit > 0) ? t.debit : (isCredit ? 0.0 : amtStr);
        const creditVal = (typeof t.credit === "number" && t.credit > 0) ? t.credit : (isCredit ? amtStr : 0.0);

        currentBalance = currentBalance - debitVal + creditVal;

        let tDateObj = new Date(t.date);
        let monthHeaderStr = "";
        let formattedDate = t.date;

        if (!isNaN(tDateObj.getTime())) {
            monthHeaderStr = tDateObj.toLocaleString('en-US', { month: 'long', year: 'numeric' });
            formattedDate = tDateObj.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
        }

        let matches = true;

        if (searchQuery) {
            const particulars = `${t.sender_name} ${t.receiver_name} ${t.purpose} ${t.particulars} ${t.account_number} ${t.transaction_type} ${t.reference_number}`.toLowerCase();
            if (!particulars.includes(searchQuery)) matches = false;
        }

        if (selectedMonth !== "all" && monthHeaderStr) {
            const shortM = tDateObj.toLocaleString('en-US', { month: 'short', year: 'numeric' });
            if (shortM !== selectedMonth) matches = false;
        }

        if (dateFromStr) {
            if (new Date(t.date) < new Date(dateFromStr)) matches = false;
        }

        if (dateToStr) {
            if (new Date(t.date) > new Date(dateToStr)) matches = false;
        }

        if (matches) {
            renderedCount++;
            totalDebit += debitVal;
            totalCredit += creditVal;

            if (monthHeaderStr && monthHeaderStr !== lastMonthHeader) {
                lastMonthHeader = monthHeaderStr;
                rowsHtml += `
                    <tr class="month-divider-row">
                        <td colspan="7">🗓️ --- ${monthHeaderStr.toUpperCase()} STATEMENT TENURE ---</td>
                    </tr>
                `;
            }

            const particularsText = t.particulars || t.purpose || `POS SALE / PAYMENT TO ${t.receiver_name || t.sender_name || 'MERCHANT'}`;
            const instNo = t.reference_number || t.id;

            rowsHtml += `
                <tr>
                    <td style="font-weight: 600;">${formattedDate}</td>
                    <td><b>${particularsText}</b> ${t.sender_name || t.receiver_name ? `<br/><span style="font-size: 11px; color: #94a3b8;">Person: ${t.receiver_name || t.sender_name || 'N/A'} ${t.account_number ? `| Account/Phone: ${t.account_number}` : ''}</span>` : ''}</td>
                    <td><code>${instNo}</code></td>
                    <td class="debit-val" style="text-align: right;">${debitVal > 0 ? debitVal.toLocaleString(undefined, {minimumFractionDigits: 2}) : '-'}</td>
                    <td class="credit-val" style="text-align: right;">${creditVal > 0 ? creditVal.toLocaleString(undefined, {minimumFractionDigits: 2}) : '-'}</td>
                    <td class="running-bal" style="text-align: right;">${currentBalance.toLocaleString(undefined, {minimumFractionDigits: 2})}</td>
                    <td style="text-align: center;">
                        <button onclick="deleteTransactionRow('${t.id}', '${particularsText.replace(/'/g, "\\'")}')" class="logout-btn" style="padding: 3px 6px; font-size: 11px;">🗑️ Delete</button>
                    </td>
                </tr>
            `;
        }
    });

    if (renderedCount === 0) {
        rowsHtml = `<tr><td colspan="7" style="text-align: center; color: #94a3b8;">No statement transactions match the selected tenure or search filter.</td></tr>`;
    }

    tbody.innerHTML = rowsHtml;

    // Show Recipient & Account Live Search Summary Banner if search term or filter is active
    if (searchQuery && banner) {
        banner.classList.remove("hidden");
        if (bannerTitle) bannerTitle.textContent = `👤 Person / Account Search Summary for "${searchQuery.toUpperCase()}"`;
        if (bannerCount) bannerCount.textContent = `${renderedCount} Transactions Found`;
        if (bannerDebit) bannerDebit.textContent = `PKR ${totalDebit.toLocaleString(undefined, {minimumFractionDigits: 2})}`;
        if (bannerCredit) bannerCredit.textContent = `PKR ${totalCredit.toLocaleString(undefined, {minimumFractionDigits: 2})}`;
        if (bannerNet) bannerNet.textContent = `PKR ${Math.abs(totalCredit - totalDebit).toLocaleString(undefined, {minimumFractionDigits: 2})}`;
    } else if (banner) {
        banner.classList.add("hidden");
    }

    document.getElementById("ledgerOpeningBal").textContent = `PKR ${DEFAULT_OPENING_BALANCE.toLocaleString(undefined, {minimumFractionDigits: 2})}`;
    document.getElementById("ledgerTotalDebit").textContent = `PKR ${totalDebit.toLocaleString(undefined, {minimumFractionDigits: 2})}`;
    document.getElementById("ledgerTotalCredit").textContent = `PKR ${totalCredit.toLocaleString(undefined, {minimumFractionDigits: 2})}`;
    document.getElementById("ledgerClosingBal").textContent = `PKR ${currentBalance.toLocaleString(undefined, {minimumFractionDigits: 2})}`;
}

function strToFloat(val) {
    if (!val) return 0.0;
    const num = parseFloat(String(val).replace(/,/g, "").trim());
    return isNaN(num) ? 0.0 : num;
}

function exportLedgerToCsv() {
    if (allLedgerTransactions.length === 0) {
        alert("No ledger statement data available to export.");
        return;
    }

    let csvContent = "DATE,PARTICULARS,INST NO / REF,DEBIT,CREDIT,RUNNING BALANCE\n";
    let curBal = DEFAULT_OPENING_BALANCE;

    const sorted = [...allLedgerTransactions].sort((a, b) => {
        const da = new Date(a.date + " " + (a.time || "00:00"));
        const db = new Date(b.date + " " + (b.time || "00:00"));
        return da - db;
    });

    sorted.forEach(t => {
        const amtStr = strToFloat(t.amount);
        const isCredit = (t.transaction_type || "").toLowerCase().includes("credit") || (t.transaction_type || "").toLowerCase().includes("deposit");
        const debitVal = isCredit ? 0.0 : amtStr;
        const creditVal = isCredit ? amtStr : 0.0;
        curBal = curBal - debitVal + creditVal;

        const particulars = `"${(t.purpose || t.receiver_name || 'POS Sale').replace(/"/g, '""')}"`;
        const ref = `"${(t.reference_number || t.id).replace(/"/g, '""')}"`;

        csvContent += `${t.date},${particulars},${ref},${debitVal},${creditVal},${curBal}\n`;
    });

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `SpendPulse_Bank_Ledger_Statement_${new Date().toISOString().slice(0,10)}.csv`;
    link.click();
}

// -------------------------------------------------------------
// 6. EMPLOYEE DASHBOARD CONTROLLER
// -------------------------------------------------------------
async function loadEmployeeDashboard() {
    fetchEmployeeTransactions();
    const refEmpBtn = document.getElementById("refreshEmpTableBtn");
    if (refEmpBtn) refEmpBtn.onclick = () => fetchEmployeeTransactions();
}

async function fetchEmployeeTransactions() {
    const tbody = document.getElementById("empTxTableBody");
    try {
        const empId = currentUser ? currentUser.user_id : "";
        const empName = currentUser ? currentUser.name : "";
        
        const res = await fetch(`/api/transactions?role=employee&employee_id=${encodeURIComponent(empId)}&user_name=${encodeURIComponent(empName)}`);
        if (res.ok) {
            const data = await res.json();
            const txs = data.transactions || [];

            let assignedCount = txs.length;
            let pendingCount = 0;
            let completedCount = 0;

            txs.forEach(t => {
                if (t.status === "Completed") completedCount++;
                else pendingCount++;
            });

            document.getElementById("empStatAssigned").textContent = assignedCount;
            document.getElementById("empStatPending").textContent = pendingCount;
            document.getElementById("empStatCompleted").textContent = completedCount;

            if (txs.length === 0) {
                tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: #94a3b8;">No tasks or work currently assigned to you.</td></tr>`;
                return;
            }

            let html = "";
            txs.forEach(t => {
                const statusPill = getStatusPill(t.status);
                const pct = parseInt(t.progress_pct) || (t.status === "Completed" ? 100 : 0);

                html += `
                    <tr>
                        <td><code>${t.reference_number || t.id}</code></td>
                        <td>${t.date} <span style="font-size: 11px; color: #94a3b8;">${t.time}</span></td>
                        <td><b>${t.receiver_name || t.purpose || 'Assigned Task'}</b></td>
                        <td><b style="color: #34d399;">${t.amount ? `${t.amount} ${t.currency}` : 'N/A'}</b></td>
                        <td>${statusPill}</td>
                        <td>
                            <div class="progress-container">
                                <div style="font-size: 11px; margin-bottom: 2px;">${pct}%</div>
                                <div class="progress-bar-bg">
                                    <div class="progress-bar-fill emerald" style="width: ${pct}%;"></div>
                                </div>
                            </div>
                        </td>
                        <td>
                            <button onclick='exportReceiptPdf(${JSON.stringify(t)})' class="secondary-btn" style="padding: 4px 8px; font-size: 11px;">📄 Export PDF</button>
                        </td>
                    </tr>
                `;
            });
            tbody.innerHTML = html;
        }
    } catch (e) {
        tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: #ef4444;">Failed to load assigned tasks.</td></tr>`;
    }
}

// -------------------------------------------------------------
// 7. MULTI-IMAGE DROPZONES & PREVIEWS
// -------------------------------------------------------------
function initMultiImageDropzones() {
    const adminDropzone = document.getElementById("adminDropzone");
    const adminFileInput = document.getElementById("adminFileInput");
    const adminUploadBtn = document.getElementById("adminUploadBtn");

    if (adminDropzone && adminFileInput) {
        adminDropzone.onclick = () => adminFileInput.click();
        adminFileInput.onchange = (e) => handleImageFiles(e.target.files, "admin");

        adminDropzone.ondragover = (e) => { e.preventDefault(); adminDropzone.style.borderColor = "#6366f1"; };
        adminDropzone.ondragleave = () => adminDropzone.style.borderColor = "rgba(99, 102, 241, 0.4)";
        adminDropzone.ondrop = (e) => {
            e.preventDefault();
            adminDropzone.style.borderColor = "rgba(99, 102, 241, 0.4)";
            if (e.dataTransfer.files.length) handleImageFiles(e.dataTransfer.files, "admin");
        };
    }

    if (adminUploadBtn) {
        adminUploadBtn.onclick = () => submitImageBatch("admin");
    }

    const empDropzone = document.getElementById("empDropzone");
    const empFileInput = document.getElementById("empFileInput");
    const empUploadBtn = document.getElementById("empUploadBtn");

    if (empDropzone && empFileInput) {
        empDropzone.onclick = () => empFileInput.click();
        empFileInput.onchange = (e) => handleImageFiles(e.target.files, "employee");

        empDropzone.ondragover = (e) => { e.preventDefault(); empDropzone.style.borderColor = "#34d399"; };
        empDropzone.ondragleave = () => empDropzone.style.borderColor = "rgba(16, 185, 129, 0.4)";
        empDropzone.ondrop = (e) => {
            e.preventDefault();
            empDropzone.style.borderColor = "rgba(16, 185, 129, 0.4)";
            if (e.dataTransfer.files.length) handleImageFiles(e.dataTransfer.files, "employee");
        };
    }

    if (empUploadBtn) {
        empUploadBtn.onclick = () => submitImageBatch("employee");
    }
}

function handleImageFiles(files, role) {
    const batch = role === "admin" ? adminImageBatch : empImageBatch;
    let containsPdf = false;

    Array.from(files).forEach(file => {
        const isImg = file.type.startsWith("image/");
        const isPdf = file.name.toLowerCase().endsWith(".pdf") || file.type === "application/pdf";

        if (isPdf) containsPdf = true;

        if (!isImg && !isPdf) {
            alert(`File "${file.name}" is not a supported image or PDF document.`);
            return;
        }

        const reader = new FileReader();
        reader.onload = (e) => {
            batch.push({ 
                id: Math.random().toString(36).substr(2, 9), 
                name: file.name, 
                base64: e.target.result,
                isPdf: isPdf 
            });
            renderImagePreviews(role);
        };
        reader.readAsDataURL(file);
    });

    if (role === "admin" && containsPdf) {
        setTimeout(() => {
            if (confirm("💡 Notice: Bank Statement PDFs have multi-row transactions. Would you like to switch to the 🏦 Continuous Bank Ledger tab to parse all statement rows cleanly?")) {
                const tabLedger = document.getElementById("adminTabLedger");
                if (tabLedger) tabLedger.click();
            }
        }, 300);
    }
}

function renderImagePreviews(role) {
    const batch = role === "admin" ? adminImageBatch : empImageBatch;
    const grid = document.getElementById(role === "admin" ? "adminPreviewGrid" : "empPreviewGrid");
    const btn = document.getElementById(role === "admin" ? "adminUploadBtn" : "empUploadBtn");

    if (!grid || !btn) return;

    if (batch.length > 0) {
        btn.classList.remove("hidden");
    } else {
        btn.classList.add("hidden");
    }

    grid.innerHTML = "";
    batch.forEach((imgObj, idx) => {
        const div = document.createElement("div");
        div.className = "thumb-card";
        if (imgObj.isPdf) {
            div.innerHTML = `
                <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; padding: 8px; text-align: center; background: #1e1b4b; color: #a5b4fc;">
                    <div style="font-size: 24px;">📄</div>
                    <div style="font-size: 10px; font-weight: bold; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 90px; margin-top: 4px;">${imgObj.name}</div>
                </div>
                <button class="thumb-remove-btn" onclick="removeThumbImage('${role}', ${idx})">✕</button>
            `;
        } else {
            div.innerHTML = `
                <img src="${imgObj.base64}" alt="${imgObj.name}" />
                <button class="thumb-remove-btn" onclick="removeThumbImage('${role}', ${idx})">✕</button>
            `;
        }
        grid.appendChild(div);
    });
}

window.removeThumbImage = function(role, index) {
    if (role === "admin") {
        adminImageBatch.splice(index, 1);
        renderImagePreviews("admin");
    } else {
        empImageBatch.splice(index, 1);
        renderImagePreviews("employee");
    }
};

async function submitImageBatch(role) {
    const batch = role === "admin" ? adminImageBatch : empImageBatch;
    const statusBox = document.getElementById(role === "admin" ? "adminUploadStatus" : "empUploadStatus");
    const btn = document.getElementById(role === "admin" ? "adminUploadBtn" : "empUploadBtn");

    if (batch.length === 0) return;

    btn.classList.add("hidden");
    statusBox.textContent = `⏳ Processing and uploading ${batch.length} images...`;
    statusBox.className = "success";
    statusBox.classList.remove("hidden");

    const images_b64 = batch.map(b => b.base64);
    const assignEmpId = role === "admin" ? document.getElementById("adminAssignSelect").value : (currentUser ? currentUser.user_id : "");
    const initStatus = role === "admin" ? document.getElementById("adminInitialStatus").value : "Pending";
    const loggedName = currentUser ? currentUser.name : "Employee User";

    try {
        const res = await fetch("/api/scan", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                images_base64: images_b64,
                employee_id: assignEmpId,
                logged_by: loggedName,
                status: initStatus
            })
        });
        const data = await res.json();
        if (res.ok) {
            statusBox.textContent = `✅ Successfully processed & saved transaction! Amount: ${data.amount || 'N/A'}`;
            if (role === "admin") {
                adminImageBatch = [];
                renderImagePreviews("admin");
                loadAdminDashboard();
            } else {
                empImageBatch = [];
                renderImagePreviews("employee");
                loadEmployeeDashboard();
            }
            setTimeout(() => statusBox.classList.add("hidden"), 5000);
        } else {
            throw new Error(data.error || "Image upload failed");
        }
    } catch (err) {
        btn.classList.remove("hidden");
        statusBox.textContent = err.message;
        statusBox.className = "error";
    }
}

// -------------------------------------------------------------
// 8. UPDATE STATUS MODAL CONTROLLER (ADMIN)
// -------------------------------------------------------------
function openStatusModal(txId, currentStatus, currentProgress, currentEmpId) {
    selectedTxId = txId;
    const modal = document.getElementById("updateStatusModal");
    const select = document.getElementById("modalStatusSelect");
    const range = document.getElementById("modalProgressRange");
    const progressVal = document.getElementById("modalProgressVal");
    const empSelect = document.getElementById("modalEmpSelect");

    select.value = currentStatus || "Pending";
    const pVal = parseInt(currentProgress) || (currentStatus === "Completed" ? 100 : 0);
    range.value = pVal;
    progressVal.textContent = `${pVal}%`;
    if (currentEmpId) empSelect.value = currentEmpId;

    range.oninput = () => {
        progressVal.textContent = `${range.value}%`;
    };

    modal.classList.remove("hidden");
}

const closeBtn = document.getElementById("closeStatusModalBtn");
if (closeBtn) {
    closeBtn.onclick = () => {
        document.getElementById("updateStatusModal").classList.add("hidden");
    };
}

const saveBtn = document.getElementById("saveStatusBtn");
if (saveBtn) {
    saveBtn.onclick = async () => {
        if (!selectedTxId) return;
        const modal = document.getElementById("updateStatusModal");
        const newStatus = document.getElementById("modalStatusSelect").value;
        const newProgress = `${document.getElementById("modalProgressRange").value}%`;
        const newEmpId = document.getElementById("modalEmpSelect").value;

        try {
            const res = await fetch("/api/update-status", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    transaction_id: selectedTxId,
                    status: newStatus,
                    progress_pct: newProgress,
                    employee_id: newEmpId
                })
            });
            if (res.ok) {
                modal.classList.add("hidden");
                loadAdminDashboard();
            } else {
                alert("Failed to update status.");
            }
        } catch (e) {
            alert(e.message);
        }
    };
}

// Export Receipt PDF helper
async function exportReceiptPdf(data) {
    try {
        const { PDFDocument, rgb, StandardFonts } = PDFLib;
        const pdfDoc = await PDFDocument.create();
        const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
        const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
        const page = pdfDoc.addPage([595.28, 841.89]);

        page.drawRectangle({ x: 0, y: 771.89, width: 595.28, height: 70, color: rgb(0.38, 0.4, 0.94) });
        page.drawText('SpendPulse - Official Transaction Record', { x: 30, y: 800, size: 18, font: fontBold, color: rgb(1, 1, 1) });

        let y = 720;
        const fields = [
            ["Reference ID", data.reference_number || data.id],
            ["Date & Time", `${data.date} ${data.time}`],
            ["Amount", `${data.amount} ${data.currency}`],
            ["Recipient", data.receiver_name || "N/A"],
            ["Sender", data.sender_name || "N/A"],
            ["Status", data.status],
            ["Progress", data.progress_pct]
        ];

        fields.forEach(([lbl, val]) => {
            page.drawText(`${lbl}:`, { x: 40, y: y, size: 12, font: fontBold, color: rgb(0.2, 0.2, 0.3) });
            page.drawText(String(val), { x: 180, y: y, size: 12, font: font, color: rgb(0.1, 0.1, 0.1) });
            y -= 30;
        });

        const pdfBytes = await pdfDoc.save();
        const blob = new Blob([pdfBytes], { type: 'application/pdf' });
        const url = URL.createObjectURL(blob);
        window.open(url, '_blank');
    } catch (e) {
        alert("Could not export PDF: " + e.message);
    }
}
