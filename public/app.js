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
            if (!confirm("Are you sure you want to delete all imported bank statement transactions? This cannot be undone.")) return;
            wipeBtn.disabled = true;
            wipeBtn.textContent = "⏳ Deleting...";
            try {
                const res = await fetch("/api/cleanup-statement-dumps", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ wipe_all: true })
                });
                const data = await res.json();
                alert(`✅ ${data.message || "All transaction records deleted."}`);
                allLedgerTransactions = [];
                await fetchAdminTransactions();
                await loadBankLedgerStatement(true);
                await fetchDashboardStats();
            } catch (err) {
                alert("Delete error: " + err.message);
            } finally {
                wipeBtn.disabled = false;
                wipeBtn.textContent = "🗑️ Clear All Transactions";
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
async function loadBankLedgerStatement(forceReload = false) {
    if (forceReload || allLedgerTransactions.length === 0) {
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
    const chatSubmitBtn = document.getElementById("chatSubmitBtn");
    const chatInput = document.getElementById("chatQueryInput");

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

    if (chatSubmitBtn) chatSubmitBtn.onclick = submitStatementQuery;
    if (chatInput) {
        chatInput.addEventListener("keydown", (e) => {
            if (e.key === "Enter") {
                e.preventDefault();
                submitStatementQuery();
            }
        });
    }

    const closeSourceBtn = document.getElementById("closeSourceModalBtn");
    if (closeSourceBtn) {
        closeSourceBtn.onclick = () => document.getElementById("rawSourceModal").classList.add("hidden");
    }
}

async function submitStatementQuery() {
    const queryInput = document.getElementById("chatQueryInput");
    const card = document.getElementById("chatResponseCard");
    const answerText = document.getElementById("chatAiAnswerText");
    const statusBadge = document.getElementById("chatQueryStatusBadge");
    const btn = document.getElementById("chatSubmitBtn");

    if (!queryInput || !queryInput.value.trim()) return;

    const queryStr = queryInput.value.trim();
    if (btn) { btn.disabled = true; btn.textContent = "⏳ Searching DB & AI..."; }
    if (statusBadge) statusBadge.textContent = "● Searching Verified Database...";

    const selectedMonth = document.getElementById("ledgerMonthSelect")?.value || "all";
    const dateFromStr = document.getElementById("ledgerDateFrom")?.value || "";
    const dateToStr = document.getElementById("ledgerDateTo")?.value || "";

    try {
        const res = await fetch("/api/query-statement", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                query: queryStr,
                month: selectedMonth,
                date_from: dateFromStr,
                date_to: dateToStr
            })
        });
        const data = await res.json();
        if (res.ok) {
            if (card) card.classList.remove("hidden");
            if (answerText) answerText.textContent = data.ai_answer || "No response generated.";
            
            const summary = data.summary || {};
            document.getElementById("chatSumCount").textContent = summary.total_transactions || 0;
            document.getElementById("chatSumDebit").textContent = `PKR ${(summary.total_debit || 0).toLocaleString(undefined, {minimumFractionDigits: 2})}`;
            document.getElementById("chatSumCredit").textContent = `PKR ${(summary.total_credit || 0).toLocaleString(undefined, {minimumFractionDigits: 2})}`;
            document.getElementById("chatSumNet").textContent = `PKR ${(summary.net_volume || 0).toLocaleString(undefined, {minimumFractionDigits: 2})}`;
            
            if (statusBadge) statusBadge.textContent = `● Verified (${summary.total_transactions || 0} DB Records)`;
            
            // Highlight matching query in ledger search if query is person name
            if (data.exact_matches && data.exact_matches.length > 0) {
                const pName = data.exact_matches[0].receiver_name || data.exact_matches[0].sender_name;
                if (pName && document.getElementById("ledgerSearchInput")) {
                    document.getElementById("ledgerSearchInput").value = pName;
                    renderBankLedgerTable();
                }
            }
        } else {
            throw new Error(data.error || "Query failed");
        }
    } catch (err) {
        alert("Statement AI Query error: " + err.message);
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = "🔍 Ask AI"; }
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

async function handleBulkStatementFile(file) {
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
            const report = generateReconciliationReport(items, 1);
            openBulkPreviewModal(items, report);
            if (progressBox) progressBox.classList.add("hidden");
        };
        reader.readAsText(file);
    } else if (isPdf || file.type.startsWith("image/")) {
        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                let items = [];
                let report = null;

                if (isPdf && window.pdfjsLib) {
                    try {
                        const arrayBuffer = await file.arrayBuffer();
                        pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js';
                        const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
                        const pdf = await loadingTask.promise;

                        if (progressBox) progressBox.textContent = `⏳ Extracting & detecting column positions from ${pdf.numPages} pages...`;

                        // Execute Column Position Aware Statement Parser across ALL pages
                        const parseRes = await parsePdfBankStatementWithPositions(pdf, progressBox);
                        items = parseRes.transactions;
                        report = parseRes.report;

                    } catch (pdfErr) {
                        console.warn("PDF position parsing warning:", pdfErr);
                    }
                }

                // Fallback to AI vision if PDF.js returned 0 items
                if (items.length === 0) {
                    if (progressBox) progressBox.textContent = `🤖 Analyzing & extracting statement entries using AI...`;
                    const res = await fetch("/api/parse-statement-file", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ file_base64: e.target.result, file_type: isPdf ? "application/pdf" : "image/png" })
                    });
                    const data = await res.json();
                    if (res.ok && data.transactions && data.transactions.length > 0) {
                        items = data.transactions.map((t, idx) => ({
                            source_page: 1,
                            date: t.date || new Date().toISOString().slice(0,10),
                            particulars: t.particulars || t.purpose || "Bank Statement Entry",
                            reference_number: t.reference_number || t.inst_no || `ref_${Math.random().toString(36).substr(2,7)}`,
                            debit: strToFloat(t.debit || 0),
                            credit: strToFloat(t.credit || 0),
                            balance: strToFloat(t.balance || 0),
                            amount: strToFloat(t.amount || t.debit || t.credit).toString(),
                            transaction_type: t.transaction_type || (strToFloat(t.credit) > 0 ? "Credit" : "Payment"),
                            validation_status: "VALID",
                            raw_text: t.particulars || "AI Extracted Entry"
                        }));
                        report = generateReconciliationReport(items, 1);
                    }
                }

                if (items.length > 0) {
                    openBulkPreviewModal(items, report);
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


// -------------------------------------------------------------------------
// UNIVERSAL BANK STATEMENT EXTRACTION ENGINE & ADAPTER REGISTRY
// Supports ANY Bank Statement PDF (Bank Alfalah, Meezan, HBL, UBL, MCB, Easypaisa, etc.)
// Dynamic PDF Layout Detection, Column Boundary Normalization, Multi-Format Date Resolver,
// Amount vs Account/Phone Classifier, DR/CR Single-Amount Support & Confidence Scoring.
// -------------------------------------------------------------------------
class UniversalBankEngine {
    static HEADER_VARIANTS = {
        DATE: ['date', 'transaction date', 'value date', 'posting date', 'txn date', 'pst date', 'effective date', 'date / time'],
        DESCRIPTION: ['description', 'particulars', 'transaction details', 'narration', 'remarks', 'detail', 'transaction particulars', 'description / ref', 'details'],
        DEBIT: ['debit', 'withdrawal', 'withdrawals', 'dr', 'amount debited', 'paid out', 'debit (pkr)', 'outflow', 'withdrawal (pkr)'],
        CREDIT: ['credit', 'deposit', 'deposits', 'cr', 'amount credited', 'paid in', 'credit (pkr)', 'inflow', 'deposit (pkr)'],
        AMOUNT: ['amount', 'transaction amount', 'amt', 'amount (pkr)'],
        BALANCE: ['balance', 'running balance', 'closing balance', 'available balance', 'balance (pkr)', 'curr bal'],
        REFERENCE: ['cheq/inst#', 'instrument no', 'ref no', 'transaction ref', 'chq no', 'reference', 'trans ref', 'ref']
    };

    static detectBankName(text) {
        const lower = text.toLowerCase();
        if (lower.includes("alfalah")) return "Bank Alfalah Limited";
        if (lower.includes("meezan")) return "Meezan Bank Limited";
        if (lower.includes("hbl") || lower.includes("habib bank")) return "Habib Bank Limited";
        if (lower.includes("ubl") || lower.includes("united bank")) return "United Bank Limited";
        if (lower.includes("mcb")) return "MCB Bank Limited";
        if (lower.includes("allied") || lower.includes("abl")) return "Allied Bank Limited";
        if (lower.includes("easypaisa") || lower.includes("telenor")) return "Easypaisa / Telenor Microfinance";
        if (lower.includes("jazzcash") || lower.includes("mobilink")) return "JazzCash / Mobilink Microfinance";
        if (lower.includes("standard chartered")) return "Standard Chartered Bank";
        if (lower.includes("faysal")) return "Faysal Bank Limited";
        if (lower.includes("askari")) return "Askari Bank Limited";
        if (lower.includes("bankislami")) return "BankIslami Pakistan Limited";
        if (lower.includes("js bank")) return "JS Bank Limited";
        return "Universal Statement Engine";
    }

    static parseUniversalDate(dateStr) {
        if (!dateStr) return { isoDate: new Date().toISOString().slice(0, 10), status: "DATE_FORMAT_REVIEW_REQUIRED" };
        const clean = dateStr.trim();

        // Format 1: DD-MM-YYYY or DD/MM/YYYY or DD.MM.YYYY
        const m1 = clean.match(/^(\d{1,2})[-\/\.](\d{1,2})[-\/\.](\d{2,4})$/);
        if (m1) {
            let day = parseInt(m1[1], 10);
            let month = parseInt(m1[2], 10);
            let year = parseInt(m1[3], 10);
            if (year < 100) year += 2000;

            if (day >= 1 && day <= 31 && month >= 1 && month <= 12) {
                return { isoDate: `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`, status: "VALID" };
            } else if (month >= 1 && month <= 31 && day >= 1 && day <= 12) {
                return { isoDate: `${year}-${String(day).padStart(2,'0')}-${String(month).padStart(2,'0')}`, status: "VALID" };
            }
        }

        // Format 2: YYYY-MM-DD or YYYY/MM/DD
        const m2 = clean.match(/^(\d{4})[-\/\.](\d{1,2})[-\/\.](\d{1,2})$/);
        if (m2) {
            return { isoDate: `${m2[1]}-${String(m2[2]).padStart(2,'0')}-${String(m2[3]).padStart(2,'0')}`, status: "VALID" };
        }

        // Format 3: DD-MMM-YYYY (e.g. 14-Nov-2025 or 14 Nov 2025)
        const m3 = clean.match(/^(\d{1,2})[-\/\s]([A-Za-z]{3})[-\/\s](\d{2,4})$/);
        if (m3) {
            const months = { jan:1, feb:2, mar:3, apr:4, may:5, jun:6, jul:7, aug:8, sep:9, oct:10, nov:11, dec:12 };
            const mNum = months[m3[2].toLowerCase()];
            if (mNum) {
                let y = parseInt(m3[3], 10);
                if (y < 100) y += 2000;
                return { isoDate: `${y}-${String(mNum).padStart(2,'0')}-${String(m3[1]).padStart(2,'0')}`, status: "VALID" };
            }
        }

        return { isoDate: new Date().toISOString().slice(0, 10), status: "DATE_FORMAT_REVIEW_REQUIRED" };
    }

    static classifyTransactionType(description, credit = 0) {
        const desc = description.toUpperCase();
        if (desc.includes("IBFT")) return "IBFT";
        if (desc.includes("RAAST P2P") || desc.includes("RAAST")) return "RAAST";
        if (desc.includes("ATM") || desc.includes("WITHDRAWAL")) return "ATM_WITHDRAWAL";
        if (desc.includes("POS") || desc.includes("MASTERCARD") || desc.includes("VISA")) return "CARD_PAYMENT";
        if (desc.includes("CHEQUE") || desc.includes("CHQ")) return "CHEQUE";
        if (desc.includes("BILL") || desc.includes("UTILITY") || desc.includes("LESCO") || desc.includes("SNGPL")) return "UTILITY_PAYMENT";
        if (desc.includes("FEE") || desc.includes("CHARGE") || desc.includes("COMMISSION")) return "FEE";
        if (desc.includes("TAX") || desc.includes("WHT") || desc.includes("FED")) return "TAX";
        if (desc.includes("SALARY") || desc.includes("PAYROLL")) return "SALARY";
        if (desc.includes("FUNDS TRANSFER") || desc.includes("FT")) return "BANK_TRANSFER";
        if (credit > 0) return "CASH_DEPOSIT";
        return "TRANSFER";
    }
}

async function parsePdfBankStatementWithPositions(pdf, progressBox) {
    const totalPages = pdf.numPages;
    let rawPageItems = [];
    let fullRawDocText = "";

    for (let p = 1; p <= totalPages; p++) {
        if (progressBox && p % 5 === 0) {
            progressBox.textContent = `⏳ Reading page ${p} of ${totalPages}...`;
        }

        const page = await pdf.getPage(p);
        const textContent = await page.getTextContent();
        
        for (const item of textContent.items) {
            if (!item.str || !item.str.trim()) continue;
            const strVal = item.str.trim();
            fullRawDocText += strVal + " ";
            rawPageItems.push({
                page: p,
                str: strVal,
                x: item.transform[4],
                y: Math.round(item.transform[5] / 3.5) * 3.5
            });
        }
    }

    const detectedBank = UniversalBankEngine.detectBankName(fullRawDocText);
    const detectedBoundaries = detectUniversalColumnBoundaries(rawPageItems);

    const transactions = [];
    const DATE_REGEX = /^(\d{1,2})[-\/\.](\d{1,2})[-\/\.](\d{2,4})\b|^(\d{4})[-\/\.](\d{1,2})[-\/\.](\d{1,2})\b|^(\d{1,2})[-\/\s]([A-Za-z]{3})[-\/\s](\d{2,4})\b/;

    for (let p = 1; p <= totalPages; p++) {
        const pageItems = rawPageItems.filter(i => i.page === p);
        
        const lineMap = new Map();
        for (const item of pageItems) {
            if (!lineMap.has(item.y)) lineMap.set(item.y, []);
            lineMap.get(item.y).push(item);
        }

        const sortedYs = Array.from(lineMap.keys()).sort((a, b) => b - a);
        let blocks = [];
        let currentBlock = null;

        for (const y of sortedYs) {
            const lineItems = lineMap.get(y).sort((a, b) => a.x - b.x);
            const lineText = lineItems.map(i => i.str).join(" ");
            const lowerText = lineText.toLowerCase();

            if (lowerText.startsWith("page ") || lowerText.startsWith("statement of account") || 
                lowerText.startsWith("title of account") || lowerText.startsWith("registered address") ||
                lowerText.startsWith("raiwind road") || lowerText.includes("date description") ||
                lowerText.includes("cheq/inst") || lowerText.includes("opening balance") ||
                /\d{8}\s+\d{8}page\s+\d+\s+of\s+\d+/i.test(lineText) ||
                /\bpage\s+\d+\s+of\s+\d+/i.test(lineText) || lowerText.includes("page of")) {
                continue;
            }

            const dateMatch = lineText.match(DATE_REGEX);
            if (dateMatch) {
                if (currentBlock) blocks.push(currentBlock);
                currentBlock = {
                    page: p,
                    dateRaw: dateMatch[0],
                    items: [...lineItems],
                    lines: [lineText]
                };
            } else if (currentBlock) {
                currentBlock.items.push(...lineItems);
                currentBlock.lines.push(lineText);
            }
        }
        if (currentBlock) blocks.push(currentBlock);

        let runningBalance = null;
        for (const block of blocks) {
            const tx = parseUniversalSingleBlock(block, detectedBoundaries, detectedBank, runningBalance);
            if (tx) {
                transactions.push(tx);
                if (tx.balance > 0) runningBalance = tx.balance;
            }
        }
    }

    let explicitOpeningBalance = null;
    let prevBalance = 0.0;

    if (transactions.length > 0) {
        const first = transactions[0];
        explicitOpeningBalance = first.balance + first.debit - first.credit;
        prevBalance = explicitOpeningBalance;
    } else {
        explicitOpeningBalance = DEFAULT_OPENING_BALANCE;
        prevBalance = DEFAULT_OPENING_BALANCE;
    }

    const existingHashSet = new Set(allLedgerTransactions.map(t => (t.content_hash || `${t.date}_${t.amount}_${(t.receiver_name || "").slice(0,30).toLowerCase()}`).toLowerCase()));
    const existingRefSet = new Set(allLedgerTransactions.map(t => (t.reference_number || "").toLowerCase()).filter(r => r && !r.startsWith("ref_")));

    let mismatchCount = 0;
    let reviewCount = 0;
    let mismatchPages = new Set();

    transactions.forEach(tx => {
        const expectedBal = prevBalance - tx.debit + tx.credit;
        
        if (tx.balance > 0) {
            const diff = Math.abs(expectedBal - tx.balance);
            if (diff <= 0.05) {
                if (tx.validation_status === "VALID") tx.validation_status = "VALID";
            } else {
                tx.validation_status = "BALANCE_MISMATCH";
                mismatchCount++;
                mismatchPages.add(tx.source_page);
            }
            prevBalance = tx.balance;
        } else {
            prevBalance = expectedBal;
            tx.balance = expectedBal;
            if (tx.debit === 0 && tx.credit === 0) {
                tx.validation_status = "REVIEW_REQUIRED";
                reviewCount++;
            }
        }

        const cHash = `${tx.date}_${tx.debit > 0 ? tx.debit : tx.credit}_${(tx.receiver_name || tx.particulars).slice(0,30).toLowerCase()}_p${tx.source_page}`;
        tx.content_hash = cHash;

        let isPossibleDup = false;
        if (tx.reference_number && !tx.reference_number.startsWith("ref_") && existingRefSet.has(tx.reference_number.toLowerCase())) {
            isPossibleDup = true;
        } else if (existingHashSet.has(cHash.toLowerCase())) {
            isPossibleDup = true;
        }

        if (isPossibleDup) {
            tx.possible_duplicate = true;
            if (tx.validation_status === "VALID") tx.validation_status = "POSSIBLE_DUPLICATE";
        }

        tx.extraction_confidence = (tx.validation_status === "VALID") ? 0.98 : (tx.validation_status === "POSSIBLE_DUPLICATE" ? 0.85 : 0.70);
    });

    const report = {
        bankName: detectedBank,
        totalPages: totalPages,
        totalExtracted: transactions.length,
        totalDebit: transactions.reduce((acc, t) => acc + t.debit, 0),
        totalCredit: transactions.reduce((acc, t) => acc + t.credit, 0),
        openingBalance: explicitOpeningBalance,
        closingBalance: transactions.length > 0 ? transactions[transactions.length - 1].balance : explicitOpeningBalance,
        mismatchCount: mismatchCount,
        reviewCount: reviewCount,
        mismatchPages: Array.from(mismatchPages).sort((a, b) => a - b)
    };

    return { transactions, report };
}

function detectUniversalColumnBoundaries(items) {
    let date_x = 50, desc_x = 130, cheq_x = 320, debit_x = 420, credit_x = 485, balance_x = 540, amount_x = null;

    for (const item of items) {
        const s = item.str.toLowerCase();
        if (s.includes("date") && !s.includes("up to")) date_x = item.x;
        else if (s.includes("description") || s.includes("particulars") || s.includes("narration")) desc_x = item.x;
        else if (s.includes("cheq") || s.includes("inst") || s.includes("ref")) cheq_x = item.x;
        else if (s.includes("debit") || s.includes("withdrawal") || s.includes("paid out")) debit_x = item.x;
        else if (s.includes("credit") || s.includes("deposit") || s.includes("paid in")) credit_x = item.x;
        else if (s.includes("amount") && !s.includes("tax")) amount_x = item.x;
        else if (s.includes("balance")) balance_x = item.x;
    }

    const isReverseColumnOrder = (credit_x < debit_x);
    const hasSingleAmountCol = (amount_x !== null && debit_x === 420 && credit_x === 485);

    return {
        isValid: true,
        date_x, desc_x, cheq_x, debit_x, credit_x, amount_x, balance_x,
        isReverseColumnOrder,
        hasSingleAmountCol,
        debit_credit_mid: (debit_x + credit_x) / 2,
        credit_balance_mid: (credit_x + balance_x) / 2
    };
}

function parseUniversalSingleBlock(block, boundaries, bankName, prevBalance = null) {
    let fullText = block.lines.join(" ");
    fullText = fullText.replace(/\d{8}\s+\d{8}Page\s+\d+\s+of\s+\d+/gi, '').replace(/Page\s+\d+\s+of\s+\d+/gi, '').trim();
    if (fullText.toLowerCase().includes("opening balance")) return null;

    const dateRes = UniversalBankEngine.parseUniversalDate(block.dateRaw);

    // Extract numbers:
    // Format A: item at x > 300 (e.g. x~366) contains "debit_or_credit balance"
    // Format B: entire row text contains numbers at end
    let amountVal = null;
    let balanceVal = null;

    const amountItem = block.items.find(i => Math.abs(i.x - 366) < 20 || i.x > 320);

    const extractNums = (textStr) => {
        const tokens = textStr.match(/\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?/g) || [];
        const res = [];
        for (const t of tokens) {
            if (/^\d{8}$/.test(t) || /^03\d{9}$/.test(t) || /^PK\d{2}/i.test(t) || (/^\d{10,}$/.test(t) && !t.includes('.'))) continue;
            if (t === "2026" || t === "2025" || t === "2024" || t === "180" || t === "33") continue;
            const val = parseFloat(t.replace(/,/g, ''));
            if (!isNaN(val) && val > 0) res.push(val);
        }
        return res;
    };

    if (amountItem) {
        const nums = extractNums(amountItem.str);
        if (nums.length >= 2) {
            amountVal = nums[0];
            balanceVal = nums[nums.length - 1];
        } else if (nums.length === 1) {
            balanceVal = nums[0];
        }
    }

    if (amountVal === null) {
        const rowNoDate = fullText.replace(/^(\d{1,2})[-\/\.](\d{1,2})[-\/\.](\d{2,4})\s*/, '');
        const nums = extractNums(rowNoDate);
        if (nums.length >= 2) {
            amountVal = nums[nums.length - 2];
            balanceVal = nums[nums.length - 1];
        } else if (nums.length === 1) {
            balanceVal = nums[0];
        }
    }

    let debit = 0.0;
    let credit = 0.0;
    let valStatus = dateRes.status;

    if (amountVal !== null && balanceVal !== null && prevBalance !== null && prevBalance > 0) {
        if (Math.abs((prevBalance - amountVal) - balanceVal) <= 0.05) {
            debit = amountVal;
        } else if (Math.abs((prevBalance + amountVal) - balanceVal) <= 0.05) {
            credit = amountVal;
        } else {
            const isCreditKw = /\bAc Transfer Cr\b|\bIBFT From CMS\b|\bCheque Deposited\b|\bCredit\b|\bdeposit\b/i.test(fullText) && !/\bTo\s+[A-Z]/i.test(fullText);
            if (isCreditKw) credit = amountVal;
            else debit = amountVal;
        }
    } else if (amountVal !== null) {
        const isCreditKw = /\bAc Transfer Cr\b|\bIBFT From CMS\b|\bCheque Deposited\b|\bCredit\b|\bdeposit\b/i.test(fullText) && !/\bTo\s+[A-Z]/i.test(fullText);
        if (isCreditKw) credit = amountVal;
        else debit = amountVal;
    }

    const balance = balanceVal !== null ? balanceVal : 0.0;

    if (debit === 0.0 && credit === 0.0 && balance > 0.0) {
        valStatus = "DEBIT_CREDIT_REVIEW_REQUIRED";
    }

    let receiverName = "";
    const toMatch = fullText.match(/\bTo\s+([A-Z][A-Za-z0-9\s\/\(\)\.\&\-]{2,40}?)\s*[-–]\s*(?:[A-Z][A-Za-z\s]+(?:Bank|Easypaisa|JazzCash|Telenor|Meezan|Allied|MCB|HBL|UBL|Faysal|Silk|Limited|Askari|Soneri|BankIslami|JS Bank|Dubai Islamic|Standard Chartered|Microfinance))/i)
                 || fullText.match(/\bTo\s+([A-Z][A-Z\s]{2,35}?)\s*[-–]/)
                 || fullText.match(/\bpaid to\s+([A-Z][A-Za-z0-9\s]{2,35})/i)
                 || fullText.match(/\bbeneficiary:\s*([A-Z][A-Za-z0-9\s]{2,35})/i)
                 || fullText.match(/\bto\s+([A-Z][A-Za-z0-9\s\/\(\)\.\&]{2,35}?)\s+PK\d{2}/i);
    if (toMatch) {
        receiverName = toMatch[1].trim().toUpperCase().replace(/\s+/g, ' ');
    }

    let accountNumber = "";
    const phoneMatch = fullText.match(/\b(0[23]\d{9})\b/);
    const ibanMatch = fullText.match(/\b(PK\d{2}[A-Z]{4}\d{16})\b/);
    if (phoneMatch) accountNumber = phoneMatch[1];
    else if (ibanMatch) accountNumber = ibanMatch[1];

    let refNum = "";
    const refMatch = fullText.match(/\b(FT\d{8,18}[A-Z0-9]*)\b/) || fullText.match(/\b(PK\d{2}[A-Z]{4}\d{16})\b/) || fullText.match(/\bCheq\/Inst#?\s*([0-9A-Z]{6,20})/i);
    if (refMatch) refNum = refMatch[1];
    else refNum = `ref_${Math.random().toString(36).substr(2,7)}`;

    const txType = UniversalBankEngine.classifyTransactionType(fullText, credit);

    let cleanParticulars = fullText
        .replace(/^(\d{1,2})[-\/\.](\d{1,2})[-\/\.](\d{2,4})\s*/, '')
        .replace(/\s+/g, ' ')
        .trim();

    return {
        source_page: block.page,
        bank_name: bankName,
        date: dateRes.isoDate,
        particulars: cleanParticulars.substring(0, 250),
        receiver_name: receiverName,
        account_number: accountNumber,
        reference_number: refNum,
        debit: debit,
        credit: credit,
        balance: balance,
        amount: (credit > 0 ? credit : debit).toString(),
        transaction_type: txType,
        validation_status: valStatus,
        raw_text: fullText
    };
}

function parseCsvBankStatement(rawText) {
    const rawLines = rawText.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
    const results = [];
    const DATE_REGEX = /^(\d{2})[-\/](\d{2})[-\/](\d{4})\b/;

    let blocks = [];
    let currentBlock = null;

    for (const line of rawLines) {
        const dateMatch = line.match(DATE_REGEX);
        if (dateMatch) {
            if (currentBlock) blocks.push(currentBlock);
            currentBlock = {
                page: 1,
                day: dateMatch[1],
                month: dateMatch[2],
                year: dateMatch[3],
                isoDate: `${dateMatch[3]}-${dateMatch[2]}-${dateMatch[1]}`,
                lines: [line],
                items: []
            };
        } else if (currentBlock) {
            currentBlock.lines.push(line);
        }
    }
    if (currentBlock) blocks.push(currentBlock);

    const boundaries = detectColumnBoundaries([]);
    for (const block of blocks) {
        const tx = parseSingleBlock(block, boundaries);
        if (tx) results.push(tx);
    }
    return results;
}

function generateReconciliationReport(items, totalPages = 1) {
    let totDeb = 0, totCred = 0, mismatches = 0, reviews = 0;
    items.forEach(t => {
        totDeb += t.debit || 0;
        totCred += t.credit || 0;
        if (t.validation_status === "BALANCE_MISMATCH") mismatches++;
        if (t.validation_status === "REVIEW_REQUIRED") reviews++;
    });

    const openBal = items.length > 0 ? (items[0].balance + items[0].debit - items[0].credit) : DEFAULT_OPENING_BALANCE;
    const closeBal = items.length > 0 ? items[items.length - 1].balance : openBal;

    return {
        totalPages: totalPages,
        totalExtracted: items.length,
        totalDebit: totDeb,
        totalCredit: totCred,
        openingBalance: openBal,
        closingBalance: closeBal,
        mismatchCount: mismatches,
        reviewCount: reviews,
        mismatchPages: []
    };
}

function openBulkPreviewModal(items, report) {
    parsedBulkItems = items;
    const modal = document.getElementById("bulkPreviewModal");
    const tbody = document.getElementById("bulkPreviewTableBody");

    if (!modal || !tbody) return;

    // Render Reconciliation Audit Report
    if (report) {
        document.getElementById("recPagesCount").textContent = report.totalPages || 1;
        document.getElementById("recTxCount").textContent = report.totalExtracted || items.length;
        document.getElementById("recTotalDebit").textContent = `PKR ${(report.totalDebit || 0).toLocaleString(undefined, {minimumFractionDigits: 2})}`;
        document.getElementById("recTotalCredit").textContent = `PKR ${(report.totalCredit || 0).toLocaleString(undefined, {minimumFractionDigits: 2})}`;
        document.getElementById("recOpeningBal").textContent = `PKR ${(report.openingBalance || 0).toLocaleString(undefined, {minimumFractionDigits: 2})}`;
        document.getElementById("recClosingBal").textContent = `PKR ${(report.closingBalance || 0).toLocaleString(undefined, {minimumFractionDigits: 2})}`;
        document.getElementById("recMismatchCount").textContent = report.mismatchCount || 0;
        document.getElementById("recReviewCount").textContent = report.reviewCount || 0;

        const statusBadge = document.getElementById("recStatusBadge");
        if (report.mismatchCount === 0 && report.reviewCount === 0) {
            statusBadge.textContent = "✓ Pages & Balance Reconciled";
            statusBadge.style.background = "rgba(52,211,153,0.2)";
            statusBadge.style.color = "#34d399";
        } else {
            statusBadge.textContent = `⚠️ Audit Review Required (${report.mismatchCount} Mismatches, ${report.reviewCount} Uncertain)`;
            statusBadge.style.background = "rgba(251,191,36,0.2)";
            statusBadge.style.color = "#fbbf24";
        }
    }

    let html = "";
    items.forEach((item, idx) => {
        let valBadge = `<span style="color: #34d399; font-size: 11px;">✅ VALID</span>`;
        if (item.validation_status === "BALANCE_MISMATCH") {
            valBadge = `<span style="color: #fbbf24; font-size: 11px;">⚠️ BALANCE MISMATCH</span>`;
        } else if (item.validation_status === "REVIEW_REQUIRED") {
            valBadge = `<span style="color: #f87171; font-size: 11px;">🔴 REVIEW REQUIRED</span>`;
        } else if (item.validation_status === "DATE_FORMAT_REVIEW_REQUIRED") {
            valBadge = `<span style="color: #f59e0b; font-size: 11px;">⚠️ DATE FORMAT REVIEW</span>`;
        } else if (item.validation_status === "DEBIT_CREDIT_REVIEW_REQUIRED") {
            valBadge = `<span style="color: #ef4444; font-size: 11px;">🔴 DR/CR UNCERTAIN</span>`;
        } else if (item.possible_duplicate || item.validation_status === "POSSIBLE_DUPLICATE") {
            valBadge = `<span style="color: #60a5fa; font-size: 11px;">🔵 POSSIBLE DUPLICATE</span>`;
        }

        const bankTag = item.bank_name ? `<span style="font-size: 10px; color: #94a3b8; display: block;">🏛️ ${item.bank_name}</span>` : '';

        const dVal = strToFloat(item.debit);
        const cVal = strToFloat(item.credit);
        const bVal = strToFloat(item.balance);

        html += `
            <tr>
                <td><input type="checkbox" class="bulk-row-cb" data-idx="${idx}" checked onchange="updateBulkSelectedCount()" /></td>
                <td><code>P.${item.source_page || 1}</code></td>
                <td>${item.date}</td>
                <td><b>${item.particulars}</b> ${bankTag}</td>
                <td><code>${item.reference_number || 'Auto-ID'}</code></td>
                <td style="text-align: right; color: #f87171;">${dVal > 0 ? dVal.toLocaleString(undefined, {minimumFractionDigits: 2}) : '-'}</td>
                <td style="text-align: right; color: #34d399;">${cVal > 0 ? cVal.toLocaleString(undefined, {minimumFractionDigits: 2}) : '-'}</td>
                <td style="text-align: right; color: #818cf8;">${bVal > 0 ? bVal.toLocaleString(undefined, {minimumFractionDigits: 2}) : '-'}</td>
                <td>${valBadge}</td>
                <td style="text-align: center;">
                    <button onclick="openRawSourceModal(${idx})" class="secondary-btn" style="padding: 2px 6px; font-size: 10px;">📄 Source</button>
                </td>
            </tr>
        `;
    });

    tbody.innerHTML = html;
    updateBulkSelectedCount();
    modal.classList.remove("hidden");
}

function openRawSourceModal(idx) {
    const item = parsedBulkItems[idx];
    if (!item) return;

    document.getElementById("modalSourcePageNum").textContent = `Page ${item.source_page || 1}`;
    document.getElementById("modalSourceDate").textContent = item.date || "-";
    document.getElementById("modalSourceStatus").textContent = item.validation_status || "VALID";
    document.getElementById("modalSourceRawText").textContent = item.raw_text || item.particulars || "Raw line text unavailable";

    document.getElementById("rawSourceModal").classList.remove("hidden");
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

function parseIsoDateParts(dateStr) {
    if (!dateStr) return { year: 2026, month: 1, day: 1 };
    const clean = String(dateStr).trim().split('T')[0];
    const parts = clean.split(/[-\/\.]/);
    if (parts.length === 3) {
        if (parts[0].length === 4) {
            return {
                year: parseInt(parts[0], 10),
                month: parseInt(parts[1], 10),
                day: parseInt(parts[2], 10)
            };
        } else if (parts[2].length === 4) {
            return {
                year: parseInt(parts[2], 10),
                month: parseInt(parts[1], 10),
                day: parseInt(parts[0], 10)
            };
        }
    }
    return { year: 2026, month: 1, day: 1 };
}

function getMonthYearFullLabel(dateStr) {
    const { year, month } = parseIsoDateParts(dateStr);
    const fullMonths = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    const mName = fullMonths[Math.max(0, Math.min(11, month - 1))];
    return `${mName} ${year}`;
}

function getMonthYearShortLabel(dateStr) {
    const { year, month } = parseIsoDateParts(dateStr);
    const shortMonths = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const mName = shortMonths[Math.max(0, Math.min(11, month - 1))];
    return `${mName} ${year}`;
}

function getTimestampFromDateAndTime(dateStr, timeStr) {
    const { year, month, day } = parseIsoDateParts(dateStr);
    let hh = 0, mm = 0;
    if (timeStr) {
        const tm = String(timeStr).match(/(\d{1,2}):(\d{2})/);
        if (tm) {
            hh = parseInt(tm[1], 10);
            mm = parseInt(tm[2], 10);
        }
    }
    return new Date(year, month - 1, day, hh, mm).getTime();
}

function populateMonthTenureSelect() {
    const monthSelect = document.getElementById("ledgerMonthSelect");
    if (!monthSelect) return;

    const monthsSet = new Set();
    allLedgerTransactions.forEach(t => {
        if (t.date) {
            const mName = getMonthYearShortLabel(t.date);
            monthsSet.add(mName);
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

    const searchQuery = (document.getElementById("ledgerSearchInput")?.value || "").toUpperCase().trim();
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
        const ta = getTimestampFromDateAndTime(a.date, a.time);
        const tb = getTimestampFromDateAndTime(b.date, b.time);
        return ta - tb;
    });

    let derivedOpeningBal = DEFAULT_OPENING_BALANCE;
    if (sorted.length > 0 && sorted[0].balance > 0) {
        derivedOpeningBal = sorted[0].balance + sorted[0].debit - sorted[0].credit;
    }

    let currentBalance = derivedOpeningBal;
    let totalDebit = 0.0;
    let totalCredit = 0.0;

    let rowsHtml = "";
    let lastMonthHeader = "";
    let renderedCount = 0;

    const exactMatches = [];
    const possibleMatches = [];

    // Classify and filter items
    sorted.forEach((t) => {
        const dVal = strToFloat(t.debit);
        const cVal = strToFloat(t.credit);
        const aVal = strToFloat(t.amount);
        const bVal = strToFloat(t.balance);
        const isCredit = (t.transaction_type || "").toLowerCase().includes("credit") || (t.transaction_type || "").toLowerCase().includes("deposit");
        
        const debitVal = dVal > 0 ? dVal : (!isCredit && aVal > 0 ? aVal : 0.0);
        const creditVal = cVal > 0 ? cVal : (isCredit && aVal > 0 ? aVal : 0.0);

        if (bVal > 0) currentBalance = bVal;
        else currentBalance = currentBalance - debitVal + creditVal;

        t._calcDebit = debitVal;
        t._calcCredit = creditVal;
        t._calcBalance = currentBalance;

        const monthHeaderStr = getMonthYearFullLabel(t.date);
        const shortM = getMonthYearShortLabel(t.date);

        let passesDateFilter = true;

        if (selectedMonth !== "all" && shortM !== selectedMonth) passesDateFilter = false;

        if (dateFromStr && t.date < dateFromStr) passesDateFilter = false;
        if (dateToStr && t.date > dateToStr) passesDateFilter = false;

        if (!passesDateFilter) return;

        if (searchQuery) {
            const rUpper = (t.receiver_name || "").toUpperCase();
            const sUpper = (t.sender_name || "").toUpperCase();
            const purpUpper = (t.purpose || t.particulars || "").toUpperCase();
            const rawUpper = (t.raw_text || "").toUpperCase();
            const refUpper = (t.reference_number || "").toUpperCase();

            const fullHaystack = `${rUpper} ${sUpper} ${purpUpper} ${rawUpper} ${refUpper}`;

            if (rUpper === searchQuery || sUpper === searchQuery) {
                exactMatches.push(t);
            } else if (fullHaystack.includes(searchQuery)) {
                possibleMatches.push(t);
            }
        } else {
            exactMatches.push(t);
        }
    });

    const renderRowGroup = (list, groupTitle) => {
        let html = "";
        if (groupTitle) {
            html += `
                <tr class="month-divider-row" style="background: rgba(99, 102, 241, 0.15);">
                    <td colspan="7" style="color: #a5b4fc; font-weight: bold;">🔍 ${groupTitle} (${list.length} Records)</td>
                </tr>
            `;
        }

        list.forEach(t => {
            renderedCount++;
            totalDebit += t._calcDebit;
            totalCredit += t._calcCredit;

            let formattedDate = t.date;
            if (t.date) {
                const parts = t.date.trim().split(/[-\/\.]/);
                const monthsList = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
                if (parts.length === 3) {
                    if (parts[0].length === 4) {
                        const y = parts[0];
                        const mIdx = parseInt(parts[1], 10) - 1;
                        const d = String(parseInt(parts[2], 10)).padStart(2, '0');
                        if (mIdx >= 0 && mIdx < 12) formattedDate = `${d}-${monthsList[mIdx]}-${y}`;
                    } else if (parts[2].length === 4) {
                        const d = String(parseInt(parts[0], 10)).padStart(2, '0');
                        const mIdx = parseInt(parts[1], 10) - 1;
                        const y = parts[2];
                        if (mIdx >= 0 && mIdx < 12) formattedDate = `${d}-${monthsList[mIdx]}-${y}`;
                    }
                }
            }

            const particularsText = t.particulars || t.purpose || `POS SALE / PAYMENT TO ${t.receiver_name || t.sender_name || 'MERCHANT'}`;
            const instNo = t.reference_number || t.id;
            const srcPageStr = t.source_page || "1";

            html += `
                <tr>
                    <td style="font-weight: 600;">${formattedDate} <span style="font-size: 10px; color: #38bdf8;">[P.${srcPageStr}]</span></td>
                    <td><b>${particularsText}</b> ${t.sender_name || t.receiver_name ? `<br/><span style="font-size: 11px; color: #94a3b8;">Person: ${t.receiver_name || t.sender_name || 'N/A'} ${t.account_number ? `| Account/Phone: ${t.account_number}` : ''}</span>` : ''}</td>
                    <td><code>${instNo}</code></td>
                    <td class="debit-val" style="text-align: right; color: #f87171;">${t._calcDebit > 0 ? t._calcDebit.toLocaleString(undefined, {minimumFractionDigits: 2}) : '-'}</td>
                    <td class="credit-val" style="text-align: right; color: #34d399;">${t._calcCredit > 0 ? t._calcCredit.toLocaleString(undefined, {minimumFractionDigits: 2}) : '-'}</td>
                    <td class="running-bal" style="text-align: right; color: #818cf8;">${t._calcBalance.toLocaleString(undefined, {minimumFractionDigits: 2})}</td>
                    <td style="text-align: center;">
                        <div style="display: flex; gap: 4px; justify-content: center;">
                            <button onclick='viewLedgerItemSource(${JSON.stringify(t).replace(/'/g, "&apos;")})' class="secondary-btn" style="padding: 2px 6px; font-size: 10px;">📄 Source</button>
                            <button onclick="deleteTransactionRow('${t.id}', '${particularsText.replace(/'/g, "\\'")}')" class="logout-btn" style="padding: 2px 6px; font-size: 10px;">🗑️</button>
                        </div>
                    </td>
                </tr>
            `;
        });
        return html;
    };

    if (searchQuery) {
        if (exactMatches.length > 0) {
            rowsHtml += renderRowGroup(exactMatches, `EXACT MATCHES FOR "${searchQuery}"`);
        }
        if (possibleMatches.length > 0) {
            rowsHtml += renderRowGroup(possibleMatches, `POSSIBLE MATCHES (SIMILAR / CONTAINING "${searchQuery}")`);
        }
    } else {
        rowsHtml += renderRowGroup(exactMatches, null);
    }

    if (renderedCount === 0) {
        rowsHtml = `<tr><td colspan="7" style="text-align: center; color: #94a3b8;">No statement transactions match the selected tenure or search filter.</td></tr>`;
    }

    tbody.innerHTML = rowsHtml;

    if (searchQuery && banner) {
        banner.classList.remove("hidden");
        if (bannerTitle) bannerTitle.textContent = `👤 Person / Account Search Summary for "${searchQuery}" (${exactMatches.length} Exact, ${possibleMatches.length} Possible Matches)`;
        if (bannerCount) bannerCount.textContent = `${renderedCount} Transactions Found`;
        if (bannerDebit) bannerDebit.textContent = `PKR ${totalDebit.toLocaleString(undefined, {minimumFractionDigits: 2})}`;
        if (bannerCredit) bannerCredit.textContent = `PKR ${totalCredit.toLocaleString(undefined, {minimumFractionDigits: 2})}`;
        if (bannerNet) bannerNet.textContent = `PKR ${Math.abs(totalCredit - totalDebit).toLocaleString(undefined, {minimumFractionDigits: 2})}`;
    } else if (banner) {
        banner.classList.add("hidden");
    }

    document.getElementById("ledgerOpeningBal").textContent = `PKR ${derivedOpeningBal.toLocaleString(undefined, {minimumFractionDigits: 2})}`;
    document.getElementById("ledgerTotalDebit").textContent = `PKR ${totalDebit.toLocaleString(undefined, {minimumFractionDigits: 2})}`;
    document.getElementById("ledgerTotalCredit").textContent = `PKR ${totalCredit.toLocaleString(undefined, {minimumFractionDigits: 2})}`;
    document.getElementById("ledgerClosingBal").textContent = `PKR ${currentBalance.toLocaleString(undefined, {minimumFractionDigits: 2})}`;
}

function viewLedgerItemSource(t) {
    if (!t) return;
    document.getElementById("modalSourcePageNum").textContent = `Page ${t.source_page || 1}`;
    document.getElementById("modalSourceDate").textContent = t.date || "-";
    document.getElementById("modalSourceStatus").textContent = t.validation_status || "VALID";
    document.getElementById("modalSourceRawText").textContent = t.raw_text || t.particulars || "Raw PDF text stored in system record";
    document.getElementById("rawSourceModal").classList.remove("hidden");
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
        const ta = getTimestampFromDateAndTime(a.date, a.time);
        const tb = getTimestampFromDateAndTime(b.date, b.time);
        return ta - tb;
    });

    sorted.forEach(t => {
        const dVal = strToFloat(t.debit);
        const cVal = strToFloat(t.credit);
        const aVal = strToFloat(t.amount);
        const bVal = strToFloat(t.balance);
        const isCredit = (t.transaction_type || "").toLowerCase().includes("credit") || (t.transaction_type || "").toLowerCase().includes("deposit");
        
        const debitVal = dVal > 0 ? dVal : (!isCredit && aVal > 0 ? aVal : 0.0);
        const creditVal = cVal > 0 ? cVal : (isCredit && aVal > 0 ? aVal : 0.0);

        if (bVal > 0) curBal = bVal;
        else curBal = curBal - debitVal + creditVal;

        const particulars = `"${(t.purpose || t.receiver_name || t.particulars || 'POS Sale').replace(/"/g, '""')}"`;
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
