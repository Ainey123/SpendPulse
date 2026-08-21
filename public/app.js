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
let currentReport = null;
let selectedFileName = "";

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

    await fetchComments();
    await fetchAndRenderDocuments();
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
    const exportPersonBtn = document.getElementById("exportPersonCsvBtn");
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
            activeDocFilterId = null;
            fetchAndRenderDocuments();
            renderBankLedgerTable();
        };
    }

    if (exportBtn) {
        exportBtn.onclick = exportLedgerToCsv;
    }

    if (exportPersonBtn) {
        exportPersonBtn.onclick = exportPersonCsv;
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

    // Comment Modal Controls
    const closeCommentBtn = document.getElementById("closeCommentModalBtn");
    if (closeCommentBtn) {
        closeCommentBtn.onclick = () => {
            document.getElementById("commentModal")?.classList.add("hidden");
        };
    }

    const addCommentForm = document.getElementById("addCommentForm");
    if (addCommentForm) {
        addCommentForm.onsubmit = (e) => {
            e.preventDefault();
            saveComment();
        };
    }

    const cancelEditBtn = document.getElementById("cancelEditCommentBtn");
    if (cancelEditBtn) {
        cancelEditBtn.onclick = cancelEditComment;
    }

    // PDF Viewer Controls
    setupPdfViewerControls();
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

// -------------------------------------------------------------
// PDF STORE (INDEXEDDB BINARY & METADATA STORAGE)
// -------------------------------------------------------------
class PdfStore {
    static DB_NAME = "SpendPulseDocDB";
    static DB_VERSION = 1;
    static STORE_NAME = "documents";

    static async openDB() {
        return new Promise((resolve, reject) => {
            const req = indexedDB.open(PdfStore.DB_NAME, PdfStore.DB_VERSION);
            req.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains(PdfStore.STORE_NAME)) {
                    const store = db.createObjectStore(PdfStore.STORE_NAME, { keyPath: "document_id" });
                    store.createIndex("file_hash", "file_hash", { unique: false });
                    store.createIndex("file_name", "file_name", { unique: false });
                }
            };
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    }

    static async saveDocument(docRecord) {
        try {
            const db = await PdfStore.openDB();
            return new Promise((resolve, reject) => {
                const tx = db.transaction(PdfStore.STORE_NAME, "readwrite");
                const store = tx.objectStore(PdfStore.STORE_NAME);
                store.put(docRecord);
                tx.oncomplete = () => resolve(true);
                tx.onerror = () => reject(tx.error);
            });
        } catch (err) {
            console.warn("PdfStore saveDocument warning:", err);
            return false;
        }
    }

    static async getDocument(docId) {
        try {
            const db = await PdfStore.openDB();
            return new Promise((resolve, reject) => {
                const tx = db.transaction(PdfStore.STORE_NAME, "readonly");
                const store = tx.objectStore(PdfStore.STORE_NAME);
                const req = store.get(docId);
                req.onsuccess = () => resolve(req.result || null);
                req.onerror = () => reject(req.error);
            });
        } catch (err) {
            console.warn("PdfStore getDocument warning:", err);
            return null;
        }
    }

    static async getDocumentByHash(hash) {
        if (!hash) return null;
        try {
            const db = await PdfStore.openDB();
            return new Promise((resolve, reject) => {
                const tx = db.transaction(PdfStore.STORE_NAME, "readonly");
                const store = tx.objectStore(PdfStore.STORE_NAME);
                const index = store.index("file_hash");
                const req = index.get(hash);
                req.onsuccess = () => resolve(req.result || null);
                req.onerror = () => reject(req.error);
            });
        } catch (err) {
            return null;
        }
    }

    static async getAllDocuments() {
        try {
            const db = await PdfStore.openDB();
            return new Promise((resolve, reject) => {
                const tx = db.transaction(PdfStore.STORE_NAME, "readonly");
                const store = tx.objectStore(PdfStore.STORE_NAME);
                const req = store.getAll();
                req.onsuccess = () => resolve(req.result || []);
                req.onerror = () => reject(req.error);
            });
        } catch (err) {
            console.warn("PdfStore getAllDocuments warning:", err);
            return [];
        }
    }
}

// Compute SHA-256 for duplicate PDF protection
async function computeFileSha256(arrayBuffer) {
    if (window.crypto && window.crypto.subtle) {
        const hashBuffer = await crypto.subtle.digest("SHA-256", arrayBuffer);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    }
    // Fallback hash
    let hash = 0;
    const bytes = new Uint8Array(arrayBuffer);
    for (let i = 0; i < bytes.length; i++) {
        hash = (hash * 31 + bytes[i]) >>> 0;
    }
    return `hash_${hash.toString(16)}_${arrayBuffer.byteLength}`;
}

let stagedFiles = [];
let uploadedDocumentsList = [];
let activeDocFilterId = null;
let currentPreviewDocuments = [];

function initBulkStatementUploader() {
    const dropzone = document.getElementById("bulkStatementDropzone");
    const fileInput = document.getElementById("bulkFileInput");
    const processBtn = document.getElementById("processSelectedFilesBtn");

    if (!dropzone || !fileInput) return;

    dropzone.onclick = () => fileInput.click();

    fileInput.onchange = (e) => {
        if (e.target.files.length) handleSelectedBulkFiles(Array.from(e.target.files));
    };

    dropzone.ondragover = (e) => { e.preventDefault(); dropzone.style.borderColor = "#6366f1"; };
    dropzone.ondragleave = () => dropzone.style.borderColor = "rgba(99, 102, 241, 0.5)";
    dropzone.ondrop = (e) => {
        e.preventDefault();
        dropzone.style.borderColor = "rgba(99, 102, 241, 0.5)";
        if (e.dataTransfer.files.length) handleSelectedBulkFiles(Array.from(e.dataTransfer.files));
    };

    if (processBtn) {
        processBtn.onclick = processAllStagedFiles;
    }

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

function handleSelectedBulkFiles(files) {
    if (!files || files.length === 0) return;
    stagedFiles = files.map((file, idx) => ({
        id: `staged_${Date.now()}_${idx}`,
        file: file,
        name: file.name,
        size: file.size,
        type: file.type,
        status: "Ready for Extraction"
    }));

    renderStagedFilesList();
}

function renderStagedFilesList() {
    const listCard = document.getElementById("selectedFilesList");
    const container = document.getElementById("stagedFilesContainer");
    const countSpan = document.getElementById("stagedFileCount");

    if (!listCard || !container) return;

    if (stagedFiles.length === 0) {
        listCard.classList.add("hidden");
        return;
    }

    listCard.classList.remove("hidden");
    if (countSpan) countSpan.textContent = stagedFiles.length;

    let html = "";
    stagedFiles.forEach((sf, idx) => {
        const sizeStr = sf.size > 1048576 
            ? `${(sf.size / 1048576).toFixed(2)} MB` 
            : `${(sf.size / 1024).toFixed(1)} KB`;

        html += `
            <div class="staged-file-item">
                <div style="display: flex; align-items: center; gap: 10px; flex: 1; min-width: 0;">
                    <span style="font-size: 20px;">📄</span>
                    <div style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                        <b style="color: white; font-size: 13px;">${sf.name}</b>
                        <div style="font-size: 11px; color: #94a3b8;">${sizeStr} • <span style="color: #818cf8;">${sf.status}</span></div>
                    </div>
                </div>
                <button onclick="removeStagedFile(${idx})" class="secondary-btn" style="padding: 4px 8px; font-size: 11px; color: #f87171;">✕ Remove</button>
            </div>
        `;
    });

    container.innerHTML = html;
}

function removeStagedFile(idx) {
    stagedFiles.splice(idx, 1);
    renderStagedFilesList();
}

async function processAllStagedFiles() {
    if (stagedFiles.length === 0) {
        alert("Please select at least one statement PDF file.");
        return;
    }

    const progressBox = document.getElementById("bulkUploadProgress");
    if (progressBox) {
        progressBox.className = "success";
        progressBox.classList.remove("hidden");
    }

    const allExtractedItems = [];
    const allProcessedDocs = [];
    let combinedDebit = 0;
    let combinedCredit = 0;
    let combinedPages = 0;
    let combinedMismatches = 0;
    let combinedReviews = 0;
    let firstOpeningBal = 0;
    let lastClosingBal = 0;

    for (let fIdx = 0; fIdx < stagedFiles.length; fIdx++) {
        const staged = stagedFiles[fIdx];
        const file = staged.file;
        const name = file.name;
        const isPdf = name.toLowerCase().endsWith(".pdf") || file.type === "application/pdf";

        if (progressBox) {
            progressBox.textContent = `⏳ [${fIdx + 1}/${stagedFiles.length}] Processing "${name}"...`;
        }

        try {
            const arrayBuffer = await file.arrayBuffer();
            const fileHash = await computeFileSha256(arrayBuffer);

            // Check if exact same PDF was already uploaded
            const existingDoc = uploadedDocumentsList.find(d => d.file_hash === fileHash);
            const isExactPdfDuplicate = !!existingDoc;

            let fileItems = [];
            let fileReport = null;
            let detectedBank = "Universal Bank";
            let pageCount = 1;

            if (isPdf && window.pdfjsLib) {
                pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js';
                const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer.slice(0) });
                const pdf = await loadingTask.promise;
                pageCount = pdf.numPages;

                const parseRes = await parsePdfBankStatementWithPositions(pdf, progressBox);
                fileItems = parseRes.transactions;
                fileReport = parseRes.report;
                detectedBank = fileReport.bankName || "Universal Bank";
            } else if (name.toLowerCase().endsWith(".csv") || name.toLowerCase().endsWith(".txt")) {
                const text = new TextDecoder().decode(arrayBuffer);
                fileItems = parseCsvBankStatement(text);
                fileReport = generateReconciliationReport(fileItems, 1);
                pageCount = 1;
            }

            // Extract statement period from items
            let periodLabel = "All Dates";
            let startDate = "";
            let endDate = "";
            if (fileItems.length > 0) {
                const sortedDates = fileItems.map(t => t.date).filter(Boolean).sort();
                if (sortedDates.length > 0) {
                    startDate = sortedDates[0];
                    endDate = sortedDates[sortedDates.length - 1];
                    const startM = getMonthYearFullLabel(startDate);
                    const endM = getMonthYearFullLabel(endDate);
                    periodLabel = (startM === endM) ? startM : `${startM} – ${endM}`;
                }
            }

            const docId = `doc_${fileHash.substring(0, 8)}_${Date.now().toString(36)}`;

            // Save PDF arrayBuffer to IndexedDB so it can be viewed at any time
            await PdfStore.saveDocument({
                document_id: docId,
                file_name: name,
                bank_name: detectedBank,
                upload_date: new Date().toISOString().slice(0, 10),
                statement_start_date: startDate,
                statement_end_date: endDate,
                page_count: pageCount,
                file_hash: fileHash,
                processing_status: isExactPdfDuplicate ? "Exact Duplicate PDF (Skipped)" : "Processed",
                file_size: file.size,
                transaction_count: fileItems.length,
                array_buffer: arrayBuffer,
                created_at: new Date().toISOString().replace('T', ' ').slice(0, 16)
            });

            // Tag each transaction with source document info
            fileItems.forEach((tx, txIdx) => {
                tx.source_document_id = docId;
                tx.source_file_name = name;
                tx.pdf_filename = name;
                tx.statement_period = periodLabel;
                tx.source_transaction_identifier = `${docId}_p${tx.source_page || 1}_${txIdx + 1}`;
                if (isExactPdfDuplicate) {
                    tx.validation_status = "SKIPPED_DUPLICATE";
                    tx.possible_duplicate = true;
                    tx.is_duplicate = true;
                }
            });

            const docMetadata = {
                document_id: docId,
                file_name: name,
                bank_name: detectedBank,
                upload_date: new Date().toISOString().slice(0, 10),
                statement_start_date: startDate,
                statement_end_date: endDate,
                page_count: pageCount,
                file_hash: fileHash,
                processing_status: isExactPdfDuplicate ? "Exact Duplicate PDF (Skipped)" : "Completed",
                file_size: file.size,
                transaction_count: fileItems.length,
                is_duplicate: isExactPdfDuplicate,
                period_label: periodLabel,
                created_at: new Date().toISOString().replace('T', ' ').slice(0, 16)
            };

            allProcessedDocs.push(docMetadata);
            allExtractedItems.push(...fileItems);

            combinedPages += pageCount;
            if (fileReport) {
                combinedDebit += fileReport.totalDebit || 0;
                combinedCredit += fileReport.totalCredit || 0;
                combinedMismatches += fileReport.mismatchCount || 0;
                combinedReviews += fileReport.reviewCount || 0;
                if (fIdx === 0) firstOpeningBal = fileReport.openingBalance;
                lastClosingBal = fileReport.closingBalance;
            }

        } catch (fileErr) {
            console.error(`Error processing file ${name}:`, fileErr);
            alert(`Error reading "${name}": ${fileErr.message}`);
        }
    }

    if (progressBox) progressBox.classList.add("hidden");

    if (allExtractedItems.length === 0) {
        alert("No valid statement entries found across the uploaded files.");
        return;
    }

    const combinedReport = {
        totalPages: combinedPages,
        totalExtracted: allExtractedItems.length,
        totalDebit: combinedDebit,
        totalCredit: combinedCredit,
        openingBalance: firstOpeningBal,
        closingBalance: lastClosingBal,
        mismatchCount: combinedMismatches,
        reviewCount: combinedReviews,
        documents: allProcessedDocs
    };

    currentPreviewDocuments = allProcessedDocs;
    openBulkPreviewModal(allExtractedItems, combinedReport);
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
    const pagesData = [];
    let fullRawDocText = "";

    for (let p = 1; p <= totalPages; p++) {
        if (progressBox && p % 5 === 0) {
            progressBox.textContent = `⏳ Reading & extracting coordinates from page ${p} of ${totalPages}...`;
        }

        const page = await pdf.getPage(p);
        const textContent = await page.getTextContent();
        const items = [];
        
        for (const item of textContent.items) {
            if (!item.str || !item.str.trim()) continue;
            const strVal = item.str.trim();
            fullRawDocText += strVal + " ";
            const x0 = item.transform[4];
            const w = item.width || (strVal.length * 5);
            const x1 = x0 + w;
            const xMid = (x0 + x1) / 2;
            const y = item.transform[5];

            items.push({
                page: p,
                str: strVal,
                x0: x0,
                x1: x1,
                xMid: xMid,
                y: y,
                width: w,
                height: item.height || 10
            });
        }
        pagesData.push({ pageNum: p, items });
    }

    const detectedBank = UniversalBankEngine.detectBankName(fullRawDocText);
    const { boundaries, headerYByPage, defaultHeaderY } = detectUniversalColumnBoundaries(pagesData);

    const transactions = [];
    const DATE_REGEX = /^(\d{1,2})[-\/\.]([A-Za-z]{3}|\d{1,2})[-\/\.](\d{2,4})$/;

    const dateLeft = boundaries.DATE ? boundaries.DATE[0] : 0.0;
    const dateRight = boundaries.DATE ? boundaries.DATE[1] : 80.0;

    for (const pData of pagesData) {
        const p = pData.pageNum;
        const pageItems = pData.items;
        const headerY = headerYByPage[p] !== undefined ? headerYByPage[p] : defaultHeaderY;

        // Group page items into visual lines (tolerance <= 3.5pt in Y)
        const linesMap = [];
        for (const item of pageItems) {
            // Ignore items above or on header line (in PDF.js, y >= headerY means on or above header)
            if (headerY > 0 && item.y >= headerY - 2.0) continue;
            // Ignore items in bottom footer area (y <= 50)
            if (item.y <= 50.0) continue;

            let placed = false;
            for (const line of linesMap) {
                if (Math.abs(item.y - line.y) <= 3.5) {
                    line.items.push(item);
                    placed = true;
                    break;
                }
            }
            if (!placed) {
                linesMap.push({ y: item.y, items: [item] });
            }
        }

        // Sort lines top to bottom (descending Y in PDF.js)
        linesMap.sort((a, b) => b.y - a.y);

        const txBlocks = [];
        let currTx = null;

        for (const line of linesMap) {
            // Sort items in this line horizontally left to right
            line.items.sort((a, b) => a.x0 - b.x0);
            const lineText = line.items.map(i => i.str).join(" ").toUpperCase();

            // Skip summary rows
            if (lineText.includes("OPENING BALANCE") || lineText.includes("CLOSING BALANCE")) {
                if (currTx) {
                    txBlocks.push(currTx);
                    currTx = null;
                }
                continue;
            }

            // Check if this line starts with a DATE token in the DATE column
            let dateItem = null;
            for (const item of line.items) {
                if (item.x0 >= dateLeft && item.x0 <= dateRight) {
                    if (DATE_REGEX.test(item.str)) {
                        dateItem = item;
                        break;
                    }
                }
            }

            if (dateItem) {
                if (currTx) txBlocks.push(currTx);
                currTx = {
                    page: p,
                    dateRaw: dateItem.str,
                    items: [...line.items]
                };
            } else if (currTx) {
                currTx.items.push(...line.items);
            }
        }
        if (currTx) txBlocks.push(currTx);

        for (const block of txBlocks) {
            const tx = parseUniversalSingleBlock(block, boundaries, detectedBank);
            if (tx) {
                transactions.push(tx);
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

    const existingFps = new Set(allLedgerTransactions.map(t => makeTxFingerprint(t.date, t.particulars || t.purpose, t.debit, t.credit, t.reference_number, t.balance)));

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

        const fp = makeTxFingerprint(tx.date, tx.particulars, tx.debit, tx.credit, tx.reference_number, tx.balance);
        tx.content_hash = fp;

        if (existingFps.has(fp)) {
            tx.possible_duplicate = true;
            tx.is_duplicate = true;
            tx.validation_status = "SKIPPED_DUPLICATE";
        }

        tx.extraction_confidence = (tx.validation_status === "VALID") ? 0.99 : (tx.validation_status === "SKIPPED_DUPLICATE" ? 0.99 : 0.70);
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

function detectUniversalColumnBoundaries(pagesData) {
    const headerYByPage = {};
    let sampleHeaderWords = [];
    let defaultHeaderY = 0;

    for (const pData of pagesData) {
        const p = pData.pageNum;
        const pageItems = pData.items;

        const linesMap = [];
        for (const item of pageItems) {
            let placed = false;
            for (const line of linesMap) {
                if (Math.abs(item.y - line.y) <= 3.5) {
                    line.items.push(item);
                    placed = true;
                    break;
                }
            }
            if (!placed) {
                linesMap.push({ y: item.y, items: [item] });
            }
        }

        for (const line of linesMap) {
            const words = line.items.sort((a, b) => a.x0 - b.x0);
            const lineTokens = words.map(w => w.str.toUpperCase());
            const hasDate = lineTokens.some(t => ['DATE', 'TXN DATE', 'VALUE DATE', 'POSTING DATE'].includes(t));
            const hasDebit = lineTokens.some(t => ['DEBIT', 'WITHDRAWAL', 'WITHDRAWALS', 'DR', 'PAID OUT'].includes(t));
            const hasCredit = lineTokens.some(t => ['CREDIT', 'DEPOSIT', 'DEPOSITS', 'CR', 'PAID IN'].includes(t));
            const hasBalance = lineTokens.some(t => t.includes('BALANCE'));

            if (hasDate && (hasDebit || hasCredit) && hasBalance) {
                headerYByPage[p] = line.y;
                if (sampleHeaderWords.length === 0) {
                    sampleHeaderWords = words;
                    defaultHeaderY = line.y;
                }
                break;
            }
        }
    }

    const headerMap = {};
    for (const w of sampleHeaderWords) {
        const t = w.str.toUpperCase();
        if (['DATE', 'TXN DATE', 'VALUE DATE', 'POSTING DATE', 'PST DATE'].includes(t)) {
            headerMap.DATE = w;
        } else if (['PARTICULARS', 'DESCRIPTION', 'NARRATION', 'DETAILS', 'DETAIL'].includes(t)) {
            headerMap.DESCRIPTION = w;
        } else if (['INST.', 'NO.', 'INST. NO.', 'CHEQ/INST#', 'CHEQ/INST', 'REF', 'REF NO', 'CHQ NO', 'TRANSACTION REF'].includes(t)) {
            if (!headerMap.REF) {
                headerMap.REF = { ...w };
            } else {
                headerMap.REF.x0 = Math.min(headerMap.REF.x0, w.x0);
                headerMap.REF.x1 = Math.max(headerMap.REF.x1, w.x1);
            }
        } else if (['DEBIT', 'WITHDRAWAL', 'WITHDRAWALS', 'DR', 'PAID OUT'].includes(t)) {
            headerMap.DEBIT = w;
        } else if (['CREDIT', 'DEPOSIT', 'DEPOSITS', 'CR', 'PAID IN'].includes(t)) {
            headerMap.CREDIT = w;
        } else if (t.includes('BALANCE')) {
            headerMap.BALANCE = w;
        }
    }

    const dateHw = headerMap.DATE;
    const descHw = headerMap.DESCRIPTION;
    const refHw = headerMap.REF;
    const debitHw = headerMap.DEBIT;
    const creditHw = headerMap.CREDIT;
    const balanceHw = headerMap.BALANCE;

    const boundaries = {};
    const dateRight = (dateHw && descHw) ? Math.min(descHw.x0 - 2.0, Math.max(dateHw.x1 + 25.0, (dateHw.x1 + descHw.x0) / 2.0)) : 80.0;
    boundaries.DATE = [0.0, dateRight];

    const descLeft = dateRight;
    let finStart = 250.0;

    if (descHw) {
        if (refHw) {
            const descRight = refHw.x0 - 2.0;
            boundaries.DESCRIPTION = [descLeft, descRight];
            const refRight = debitHw ? (refHw.x1 + debitHw.x0) / 2.0 : refHw.x1 + 30.0;
            boundaries.REF = [descRight, refRight];
            finStart = refRight;
        } else if (debitHw) {
            const descRight = (descHw.x1 + debitHw.x0) / 2.0;
            boundaries.DESCRIPTION = [descLeft, descRight];
            finStart = descRight;
        } else {
            boundaries.DESCRIPTION = [descLeft, 250.0];
            finStart = 250.0;
        }
    } else {
        boundaries.DESCRIPTION = [descLeft, 230.0];
        finStart = 230.0;
    }

    if (debitHw && creditHw && balanceHw) {
        if (debitHw.x0 < creditHw.x0) {
            const debCredMid = (debitHw.x1 + creditHw.x0) / 2.0;
            const credBalMid = (creditHw.x1 + balanceHw.x0) / 2.0;
            boundaries.DEBIT = [finStart, debCredMid];
            boundaries.CREDIT = [debCredMid, credBalMid];
            boundaries.BALANCE = [credBalMid, 99999.0];
        } else {
            const credDebMid = (creditHw.x1 + debitHw.x0) / 2.0;
            const debBalMid = (debitHw.x1 + balanceHw.x0) / 2.0;
            boundaries.CREDIT = [finStart, credDebMid];
            boundaries.DEBIT = [credDebMid, debBalMid];
            boundaries.BALANCE = [debBalMid, 99999.0];
        }
    } else {
        boundaries.DEBIT = [300.0, 380.0];
        boundaries.CREDIT = [380.0, 460.0];
        boundaries.BALANCE = [460.0, 99999.0];
    }

    return { boundaries, headerYByPage, defaultHeaderY };
}

function parseUniversalSingleBlock(block, boundaries, bankName) {
    const txCols = {
        DATE: [],
        DESCRIPTION: [],
        REF: [],
        DEBIT: [],
        CREDIT: [],
        BALANCE: []
    };

    for (const item of block.items) {
        const xMid = item.xMid;
        for (const [cName, [cLeft, cRight]] of Object.entries(boundaries)) {
            if (xMid >= cLeft && xMid < cRight) {
                if (txCols[cName]) txCols[cName].push(item);
                break;
            }
        }
    }

    const parseFinancialAmount = (itemsList) => {
        if (!itemsList || itemsList.length === 0) return 0.0;
        const raw = itemsList.map(i => i.str).join(" ").replace(/,/g, '').trim();
        if (!raw) return 0.0;
        const m = raw.match(/\b\d+(?:\.\d+)?\b/);
        if (m) {
            const v = parseFloat(m[0]);
            return isNaN(v) ? 0.0 : v;
        }
        return 0.0;
    };

    const debit = parseFinancialAmount(txCols.DEBIT);
    const credit = parseFinancialAmount(txCols.CREDIT);
    const balance = parseFinancialAmount(txCols.BALANCE);

    // Reconstruct description strictly from DESCRIPTION column items
    // Sort items by Y descending (top to bottom), then X ascending (left to right)
    const descItems = (txCols.DESCRIPTION || []).sort((a, b) => {
        const yDiff = b.y - a.y;
        if (Math.abs(yDiff) > 3.0) return yDiff;
        return a.x0 - b.x0;
    });
    const particularsText = descItems.map(i => i.str).join(" ").replace(/\s+/g, ' ').trim();

    // Reconstruct reference strictly from REF column items
    const refItems = (txCols.REF || []).sort((a, b) => {
        const yDiff = b.y - a.y;
        if (Math.abs(yDiff) > 3.0) return yDiff;
        return a.x0 - b.x0;
    });
    let referenceText = refItems.map(i => i.str).join(" ").replace(/\s+/g, ' ').trim();

    const dateRes = UniversalBankEngine.parseUniversalDate(block.dateRaw);

    // Extract structured fields from particulars
    let receiverName = "";
    const toMatch = particularsText.match(/\bTo\s+([A-Z][A-Za-z0-9\s\/\(\)\.\&\-]{2,40}?)\s*[-–]\s*(?:[A-Z][A-Za-z\s]+(?:Bank|Easypaisa|JazzCash|Telenor|Meezan|Allied|MCB|HBL|UBL|Faysal|Silk|Limited|Askari|Soneri|BankIslami|JS Bank|Dubai Islamic|Standard Chartered|Microfinance))/i)
                 || particularsText.match(/\bTo\s+([A-Z][A-Z\s]{2,35}?)\s*[-–]/)
                 || particularsText.match(/\bpaid to\s+([A-Z][A-Za-z0-9\s]{2,35})/i)
                 || particularsText.match(/\bbeneficiary:\s*([A-Z][A-Za-z0-9\s]{2,35})/i)
                 || particularsText.match(/\bto\s+([A-Z][A-Za-z0-9\s\/\(\)\.\&]{2,35}?)\s+PK\d{2}/i)
                 || particularsText.match(/\bTO\s+([A-Z][A-Za-z0-9\s]{2,35}?)(?:\s+JAZZCASH|\s+EASYPAISA|\s+ACCT|\s+MSGID|$)/i)
                 || particularsText.match(/\bINTERNAL FUNDS TRANSFER TO\s+([A-Z][A-Za-z0-9\s]{2,35}?)(?:\s+\(A\/C|$)/i);
    if (toMatch) {
        receiverName = toMatch[1].trim().toUpperCase().replace(/\s+/g, ' ');
    }

    let accountNumber = "";
    const phoneMatch = particularsText.match(/\b(0[23]\d{9})\b/);
    const ibanMatch = particularsText.match(/\b(PK\d{2}[A-Z]{4}[\*0-9]{16})\b/) || particularsText.match(/\b(PK\d{2}[A-Z]{4}\d{16})\b/);
    const maskedAcctMatch = particularsText.match(/\bACCT:\s*([A-Z0-9\*]{10,25})/i) || particularsText.match(/\b\(A\/C\s*([0-9\*]{8,20})\)/i);
    if (maskedAcctMatch) accountNumber = maskedAcctMatch[1];
    else if (ibanMatch) accountNumber = ibanMatch[1];
    else if (phoneMatch) accountNumber = phoneMatch[1];

    if (!referenceText) {
        const refMatch = particularsText.match(/\bMSGID:\s*([A-Z0-9]{10,30})/i) || particularsText.match(/\b(FT\d{8,18}[A-Z0-9]*)\b/) || particularsText.match(/\bCheq\/Inst#?\s*([0-9A-Z]{6,20})/i);
        if (refMatch) referenceText = refMatch[1];
        else referenceText = `ref_${Math.random().toString(36).substr(2,7)}`;
    }

    const txType = UniversalBankEngine.classifyTransactionType(particularsText, credit);
    let valStatus = dateRes.status;
    if (debit === 0.0 && credit === 0.0 && balance > 0.0) {
        valStatus = "DEBIT_CREDIT_REVIEW_REQUIRED";
    }

    return {
        source_page: block.page,
        bank_name: bankName,
        date: dateRes.isoDate,
        particulars: particularsText.substring(0, 300),
        receiver_name: receiverName,
        account_number: accountNumber,
        reference_number: referenceText,
        debit: debit,
        credit: credit,
        balance: balance,
        amount: (credit > 0 ? credit : debit).toString(),
        transaction_type: txType,
        validation_status: valStatus,
        raw_text: particularsText
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

// -------------------------------------------------------------
// COMMENTS SYSTEM CONTROLLER
// -------------------------------------------------------------
let allComments = [];
let commentsByTxId = {};
let activeCommentTxId = null;

async function fetchComments() {
    try {
        const res = await fetch("/api/comments");
        if (res.ok) {
            const data = await res.json();
            allComments = data.comments || [];
            commentsByTxId = {};
            allComments.forEach(c => {
                const txId = c.transaction_id;
                if (!commentsByTxId[txId]) commentsByTxId[txId] = [];
                commentsByTxId[txId].push(c);
            });
        }
    } catch (err) {
        console.warn("fetchComments error:", err);
    }
}

function openCommentModal(txId) {
    activeCommentTxId = txId;
    const tx = allLedgerTransactions.find(t => t.id === txId) || (parsedBulkItems || []).find(t => t.id === txId) || {};
    const modal = document.getElementById("commentModal");
    const infoBox = document.getElementById("commentTxInfoBox");
    const editInput = document.getElementById("editingCommentId");
    const textInput = document.getElementById("commentTextInput");
    const cancelEditBtn = document.getElementById("cancelEditCommentBtn");

    if (!modal) return;

    if (editInput) editInput.value = "";
    if (textInput) textInput.value = "";
    if (cancelEditBtn) cancelEditBtn.classList.add("hidden");

    const particulars = tx.particulars || tx.purpose || "Transaction Details";
    const debVal = strToFloat(tx.debit);
    const credVal = strToFloat(tx.credit);
    const srcDoc = tx.pdf_filename || tx.source_file_name || "statement.pdf";
    const srcPage = tx.source_page || "1";

    if (infoBox) {
        infoBox.innerHTML = `
            <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
                <b style="color: white;">${tx.date || '-'}</b>
                <span style="color: ${credVal > 0 ? '#34d399' : '#f87171'}; font-weight: 700;">
                    ${credVal > 0 ? `+ Rs. ${credVal.toLocaleString(undefined, {minimumFractionDigits: 2})} (CREDIT)` : `- Rs. ${debVal.toLocaleString(undefined, {minimumFractionDigits: 2})} (DEBIT)`}
                </span>
            </div>
            <div style="color: #cbd5e1; margin-bottom: 6px;">${particulars}</div>
            <div style="font-size: 11px; color: #94a3b8;">
                Source: <span style="color: #38bdf8;">${srcDoc} (Page ${srcPage})</span> • Ref: <code>${tx.reference_number || tx.id || '-'}</code>
            </div>
        `;
    }

    renderModalCommentsList(txId);
    modal.classList.remove("hidden");
}

function renderModalCommentsList(txId) {
    const listContainer = document.getElementById("commentsListContainer");
    if (!listContainer) return;

    const txComments = commentsByTxId[txId] || [];
    if (txComments.length === 0) {
        listContainer.innerHTML = `<div style="color: #94a3b8; font-size: 12px; text-align: center; padding: 12px;">No comments recorded yet. Add the first audit note below.</div>`;
        return;
    }

    let html = "";
    txComments.forEach(c => {
        html += `
            <div class="comment-item" id="cmt_item_${c.comment_id}">
                <div class="comment-header">
                    <span class="comment-author">👤 ${c.created_by || 'Admin'}</span>
                    <span class="comment-time">${c.created_at || ''}</span>
                </div>
                <div class="comment-text">${c.comment_text}</div>
                <div class="comment-actions">
                    <button type="button" onclick="startEditComment('${c.comment_id}', '${c.comment_text.replace(/'/g, "\\'")}')" class="comment-btn-link">✏️ Edit</button>
                    <button type="button" onclick="deleteComment('${c.comment_id}')" class="comment-btn-link delete">🗑️ Delete</button>
                </div>
            </div>
        `;
    });
    listContainer.innerHTML = html;
}

function startEditComment(commentId, commentText) {
    const editInput = document.getElementById("editingCommentId");
    const textInput = document.getElementById("commentTextInput");
    const cancelEditBtn = document.getElementById("cancelEditCommentBtn");
    const label = document.getElementById("commentInputLabel");

    if (editInput) editInput.value = commentId;
    if (textInput) {
        textInput.value = commentText;
        textInput.focus();
    }
    if (cancelEditBtn) cancelEditBtn.classList.remove("hidden");
    if (label) label.textContent = "Edit Comment:";
}

function cancelEditComment() {
    const editInput = document.getElementById("editingCommentId");
    const textInput = document.getElementById("commentTextInput");
    const cancelEditBtn = document.getElementById("cancelEditCommentBtn");
    const label = document.getElementById("commentInputLabel");

    if (editInput) editInput.value = "";
    if (textInput) textInput.value = "";
    if (cancelEditBtn) cancelEditBtn.classList.add("hidden");
    if (label) label.textContent = "Add New Comment / Audit Note:";
}

async function saveComment() {
    if (!activeCommentTxId) return;
    const commentId = document.getElementById("editingCommentId")?.value || "";
    const text = document.getElementById("commentTextInput")?.value.trim() || "";

    if (!text) {
        alert("Please enter comment text.");
        return;
    }

    const saveBtn = document.getElementById("saveCommentBtn");
    if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = "⏳ Saving..."; }

    try {
        const res = await fetch("/api/comments", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                comment_id: commentId,
                transaction_id: activeCommentTxId,
                comment_text: text,
                created_by: currentUser ? currentUser.name : "System Admin"
            })
        });

        if (res.ok) {
            cancelEditComment();
            await fetchComments();
            renderModalCommentsList(activeCommentTxId);
            renderBankLedgerTable();
        } else {
            const errData = await res.json();
            alert("Failed to save comment: " + (errData.error || "Unknown error"));
        }
    } catch (err) {
        alert("Error saving comment: " + err.message);
    } finally {
        if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = "💬 Save Comment"; }
    }
}

async function deleteComment(commentId) {
    if (!confirm("Are you sure you want to delete this comment?")) return;

    try {
        const res = await fetch("/api/delete-comment", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ comment_id: commentId })
        });
        if (res.ok) {
            await fetchComments();
            if (activeCommentTxId) renderModalCommentsList(activeCommentTxId);
            renderBankLedgerTable();
        } else {
            alert("Failed to delete comment.");
        }
    } catch (err) {
        alert("Error deleting comment: " + err.message);
    }
}

// -------------------------------------------------------------
// INTERACTIVE PDF VIEWER MODAL CONTROLLER
// -------------------------------------------------------------
let activePdfDoc = null;
let activePdfCurrentPage = 1;
let activePdfTotalPages = 1;
let activePdfScale = 1.35;
let activePdfBlobUrl = null;

async function openPdfViewer(docIdOrFileName, targetPage = 1) {
    const modal = document.getElementById("pdfViewerModal");
    const title = document.getElementById("pdfViewerTitle");
    const subtitle = document.getElementById("pdfViewerSubtitle");
    if (!modal) return;

    modal.classList.remove("hidden");
    if (title) title.textContent = `📄 Loading: ${docIdOrFileName}...`;

    try {
        let arrayBuffer = null;
        let fileName = docIdOrFileName;

        // 1. Try to find in IndexedDB
        let docRecord = await PdfStore.getDocument(docIdOrFileName);
        if (!docRecord) {
            const allDocs = await PdfStore.getAllDocuments();
            docRecord = allDocs.find(d => d.document_id === docIdOrFileName || d.file_name === docIdOrFileName);
        }

        if (docRecord && docRecord.array_buffer) {
            arrayBuffer = docRecord.array_buffer;
            fileName = docRecord.file_name;
        } else {
            // 2. Try to find in staged files
            const staged = stagedFiles.find(sf => sf.name === docIdOrFileName);
            if (staged) {
                arrayBuffer = await staged.file.arrayBuffer();
                fileName = staged.name;
            }
        }

        if (!arrayBuffer) {
            alert(`Original PDF file content not found in local cache for "${docIdOrFileName}". Please re-upload or select file.`);
            modal.classList.add("hidden");
            return;
        }

        // Create Blob URL for external viewing
        if (activePdfBlobUrl) URL.revokeObjectURL(activePdfBlobUrl);
        const blob = new Blob([arrayBuffer], { type: "application/pdf" });
        activePdfBlobUrl = URL.createObjectURL(blob);

        if (title) title.textContent = `📄 ${fileName}`;
        if (subtitle) subtitle.textContent = `Source Statement Document • Navigating to Page ${targetPage}`;

        pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js';
        const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer.slice(0) });
        activePdfDoc = await loadingTask.promise;
        activePdfTotalPages = activePdfDoc.numPages;
        activePdfCurrentPage = Math.max(1, Math.min(targetPage, activePdfTotalPages));
        activePdfScale = 1.35;

        await renderPdfViewerPage();
    } catch (err) {
        alert("Failed to render PDF: " + err.message);
        modal.classList.add("hidden");
    }
}

async function renderPdfViewerPage() {
    if (!activePdfDoc) return;
    const canvas = document.getElementById("pdfViewerCanvas");
    const indicator = document.getElementById("pdfPageIndicator");
    if (!canvas) return;

    if (indicator) {
        indicator.textContent = `Page ${activePdfCurrentPage} / ${activePdfTotalPages}`;
    }

    try {
        const page = await activePdfDoc.getPage(activePdfCurrentPage);
        const viewport = page.getViewport({ scale: activePdfScale });
        const ctx = canvas.getContext("2d");

        canvas.height = viewport.height;
        canvas.width = viewport.width;

        const renderContext = {
            canvasContext: ctx,
            viewport: viewport
        };
        await page.render(renderContext).promise;
    } catch (err) {
        console.warn("renderPdfViewerPage error:", err);
    }
}

function setupPdfViewerControls() {
    const prevBtn = document.getElementById("pdfPrevPageBtn");
    const nextBtn = document.getElementById("pdfNextPageBtn");
    const zoomInBtn = document.getElementById("pdfZoomInBtn");
    const zoomOutBtn = document.getElementById("pdfZoomOutBtn");
    const extBtn = document.getElementById("pdfOpenExternalBtn");
    const closeBtn = document.getElementById("closePdfViewerBtn");

    if (prevBtn) {
        prevBtn.onclick = () => {
            if (activePdfCurrentPage > 1) {
                activePdfCurrentPage--;
                renderPdfViewerPage();
            }
        };
    }
    if (nextBtn) {
        nextBtn.onclick = () => {
            if (activePdfCurrentPage < activePdfTotalPages) {
                activePdfCurrentPage++;
                renderPdfViewerPage();
            }
        };
    }
    if (zoomInBtn) {
        zoomInBtn.onclick = () => {
            activePdfScale += 0.2;
            renderPdfViewerPage();
        };
    }
    if (zoomOutBtn) {
        zoomOutBtn.onclick = () => {
            if (activePdfScale > 0.6) {
                activePdfScale -= 0.2;
                renderPdfViewerPage();
            }
        };
    }
    if (extBtn) {
        extBtn.onclick = () => {
            if (activePdfBlobUrl) window.open(activePdfBlobUrl, "_blank");
        };
    }
    if (closeBtn) {
        closeBtn.onclick = () => {
            document.getElementById("pdfViewerModal")?.classList.add("hidden");
        };
    }
}

// -------------------------------------------------------------
// DOCUMENT SOURCES GALLERY
// -------------------------------------------------------------
async function fetchAndRenderDocuments() {
    const grid = document.getElementById("documentsCardGrid");
    const badge = document.getElementById("docCountBadge");
    const clearBtn = document.getElementById("clearDocFilterBtn");

    try {
        const res = await fetch("/api/documents");
        let serverDocs = [];
        if (res.ok) {
            const data = await res.json();
            serverDocs = data.documents || [];
        }

        const localDocs = await PdfStore.getAllDocuments();
        const docMap = new Map();

        serverDocs.forEach(d => docMap.set(d.document_id, d));
        localDocs.forEach(d => {
            if (!docMap.has(d.document_id)) {
                docMap.set(d.document_id, d);
            }
        });

        uploadedDocumentsList = Array.from(docMap.values());

        if (badge) badge.textContent = `${uploadedDocumentsList.length} Documents`;
        if (clearBtn) {
            if (activeDocFilterId) clearBtn.classList.remove("hidden");
            else clearBtn.classList.add("hidden");
            clearBtn.onclick = () => {
                activeDocFilterId = null;
                fetchAndRenderDocuments();
                renderBankLedgerTable();
            };
        }

        if (!grid) return;

        if (uploadedDocumentsList.length === 0) {
            grid.innerHTML = `<div style="grid-column: 1 / -1; color: #94a3b8; font-size: 13px; text-align: center; padding: 20px;">No statement documents uploaded yet. Upload PDF statements above to view sources.</div>`;
            return;
        }

        let html = "";
        uploadedDocumentsList.forEach(doc => {
            const isActive = activeDocFilterId === doc.document_id;
            const sizeStr = doc.file_size ? (doc.file_size > 1048576 ? `${(doc.file_size/1048576).toFixed(2)} MB` : `${(doc.file_size/1024).toFixed(1)} KB`) : "PDF Document";
            const periodStr = doc.statement_start_date && doc.statement_end_date ? `${doc.statement_start_date} → ${doc.statement_end_date}` : (doc.period_label || "All Dates");

            html += `
                <div class="doc-card ${isActive ? 'active-doc-filter' : ''}">
                    <div>
                        <div class="doc-header">
                            <span class="doc-icon">🏛️</span>
                            <div style="flex: 1; min-width: 0;">
                                <div class="doc-title">${doc.file_name}</div>
                                <div style="font-size: 11px; color: #818cf8; font-weight: 600; margin-top: 2px;">${doc.bank_name || 'Universal Bank'}</div>
                            </div>
                        </div>
                        <div class="doc-meta">
                            <div class="doc-meta-row">
                                <span>Pages:</span>
                                <b style="color: white;">${doc.page_count || 1} Pages</b>
                            </div>
                            <div class="doc-meta-row">
                                <span>Period:</span>
                                <b style="color: #38bdf8;">${periodStr}</b>
                            </div>
                            <div class="doc-meta-row">
                                <span>Transactions:</span>
                                <b style="color: #34d399;">${doc.transaction_count || 0} Recorded</b>
                            </div>
                            <div class="doc-meta-row">
                                <span>Size:</span>
                                <span>${sizeStr}</span>
                            </div>
                        </div>
                    </div>
                    <div class="doc-actions">
                        <button onclick="openPdfViewer('${doc.document_id}', 1)" class="btn-primary" style="flex: 1; padding: 6px 10px; font-size: 11px; background: #6366f1;">📄 View PDF</button>
                        <button onclick="toggleDocFilter('${doc.document_id}')" class="secondary-btn" style="flex: 1; padding: 6px 10px; font-size: 11px; ${isActive ? 'background: rgba(99,102,241,0.3); color: #c7d2fe;' : ''}">
                            ${isActive ? '✓ Filtering' : '🔍 Filter Ledger'}
                        </button>
                    </div>
                </div>
            `;
        });

        grid.innerHTML = html;
    } catch (err) {
        console.warn("fetchAndRenderDocuments error:", err);
    }
}

function toggleDocFilter(docId) {
    if (activeDocFilterId === docId) {
        activeDocFilterId = null;
    } else {
        activeDocFilterId = docId;
    }
    fetchAndRenderDocuments();
    renderBankLedgerTable();
}

function openBulkPreviewModal(items, report) {
    parsedBulkItems = items;
    currentReport = report;
    const modal = document.getElementById("bulkPreviewModal");
    const tbody = document.getElementById("bulkPreviewTableBody");
    const docsContainer = document.getElementById("previewNewDocsContainer");
    const docsCountBadge = document.getElementById("previewDocCountBadge");

    if (!modal || !tbody) return;

    // Render NEW DOCUMENTS cards in preview
    if (docsContainer) {
        const docs = report.documents || currentPreviewDocuments || [];
        if (docsCountBadge) docsCountBadge.textContent = `${docs.length} Files`;
        
        let docsHtml = "";
        docs.forEach((d, idx) => {
            const sizeStr = d.file_size ? (d.file_size > 1048576 ? `${(d.file_size/1048576).toFixed(2)} MB` : `${(d.file_size/1024).toFixed(1)} KB`) : "";
            docsHtml += `
                <div style="background: #1e293b; border: 1px solid rgba(255,255,255,0.08); border-radius: 8px; padding: 10px 12px; font-size: 12px;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
                        <b style="color: #818cf8;">PDF ${idx + 1}: ${d.file_name}</b>
                        <span style="font-size: 10px; color: ${d.is_duplicate ? '#60a5fa' : '#34d399'}; background: rgba(255,255,255,0.05); padding: 2px 6px; border-radius: 4px;">
                            ${d.is_duplicate ? 'DUPLICATE (SKIP)' : 'NEW'}
                        </span>
                    </div>
                    <div style="color: #94a3b8; font-size: 11px;">
                        ${d.page_count} Pages • <b style="color: white;">${d.bank_name}</b> • <span style="color: #38bdf8;">${d.period_label || 'All Dates'}</span> ${sizeStr ? `• ${sizeStr}` : ''}
                    </div>
                </div>
            `;
        });
        docsContainer.innerHTML = docsHtml;
    }

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
        if (item.validation_status === "SKIPPED_DUPLICATE" || item.is_duplicate) {
            valBadge = `<span style="color: #60a5fa; font-size: 11px;">🔵 DUPLICATE (SKIP)</span>`;
        } else if (item.validation_status === "BALANCE_MISMATCH") {
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

        const dVal = strToFloat(item.debit);
        const cVal = strToFloat(item.credit);
        const bVal = strToFloat(item.balance);
        const isDup = item.validation_status === "SKIPPED_DUPLICATE" || item.is_duplicate;
        const srcFile = item.source_file_name || item.pdf_filename || "statement.pdf";

        html += `
            <tr>
                <td><input type="checkbox" class="bulk-row-cb" data-idx="${idx}" ${isDup ? '' : 'checked'} onchange="updateBulkSelectedCount()" /></td>
                <td><code>P.${item.source_page || 1}</code></td>
                <td>${item.date}</td>
                <td><b>${item.particulars}</b> ${item.bank_name ? `<span style="font-size: 10px; color: #94a3b8; display: block;">🏛️ ${item.bank_name}</span>` : ''}</td>
                <td><code>${item.reference_number || 'Auto-ID'}</code></td>
                <td style="text-align: right; color: #f87171;">${dVal > 0 ? dVal.toLocaleString(undefined, {minimumFractionDigits: 2}) : '-'}</td>
                <td style="text-align: right; color: #34d399;">${cVal > 0 ? cVal.toLocaleString(undefined, {minimumFractionDigits: 2}) : '-'}</td>
                <td style="text-align: right; color: #818cf8;">${bVal > 0 ? bVal.toLocaleString(undefined, {minimumFractionDigits: 2}) : '-'}</td>
                <td style="font-size: 11px; color: #38bdf8;">${srcFile}</td>
                <td>${valBadge}</td>
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
        const docsToSave = currentPreviewDocuments || [];
        const res = await fetch("/api/bulk-upload-statement", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                transactions: itemsToImport,
                documents: docsToSave,
                logged_by: currentUser ? currentUser.name : "Admin Statement Importer",
                pages_processed: currentReport ? currentReport.totalPages : 1,
                review_count: currentReport ? currentReport.reviewCount : 0,
                pdf_filename: docsToSave.length > 0 ? docsToSave.map(d => d.file_name).join(", ") : "statement.pdf"
            })
        });
        const data = await res.json();
        if (res.ok) {
            const summaryMsg = `=========================================\nSTATEMENT IMPORT SUMMARY\n=========================================\nDocuments Processed:         ${docsToSave.length || 1}\nPages Processed:             ${data.pages_processed || 1}\nTransactions Detected:       ${data.total_detected || itemsToImport.length}\nNew Transactions Imported:   ${data.new_imported || 0}\nDuplicate Skipped:           ${data.duplicates_skipped || 0}\nReview Required:             ${data.review_required || 0}\nValidation Errors:           ${data.validation_errors || 0}\n=========================================`;
            alert(summaryMsg);
            modal.classList.add("hidden");
            stagedFiles = [];
            renderStagedFilesList();

            // Refresh transactions & documents gallery
            const txRes = await fetch("/api/transactions?role=admin");
            if (txRes.ok) {
                const txData = await txRes.json();
                allLedgerTransactions = txData.transactions || [];
                await fetchComments();
                await fetchAndRenderDocuments();
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
    const personPeriodText = document.getElementById("personPeriodText");

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

        // Apply document filter
        if (activeDocFilterId && t.source_document_id && t.source_document_id !== activeDocFilterId) {
            return;
        }

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
                    <td colspan="9" style="color: #a5b4fc; font-weight: bold;">🔍 ${groupTitle} (${list.length} Records)</td>
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
            const srcFileStr = t.pdf_filename || t.source_file_name || "statement.pdf";
            const txComments = commentsByTxId[t.id] || [];
            const hasComments = txComments.length > 0;
            const cmtBtnLabel = hasComments ? `💬 ${txComments.length}` : `💬 Add`;

            html += `
                <tr>
                    <td style="font-weight: 600;">${formattedDate} <span style="font-size: 10px; color: #38bdf8;">[P.${srcPageStr}]</span></td>
                    <td>
                        <b>${particularsText}</b>
                        ${t.sender_name || t.receiver_name ? `<br/><span style="font-size: 11px; color: #94a3b8;">Person: ${t.receiver_name || t.sender_name || 'N/A'} ${t.account_number ? `| Account/Phone: ${t.account_number}` : ''}</span>` : ''}
                    </td>
                    <td><code>${instNo}</code></td>
                    <td class="debit-val" style="text-align: right; color: #f87171;">${t._calcDebit > 0 ? t._calcDebit.toLocaleString(undefined, {minimumFractionDigits: 2}) : '-'}</td>
                    <td class="credit-val" style="text-align: right; color: #34d399;">${t._calcCredit > 0 ? t._calcCredit.toLocaleString(undefined, {minimumFractionDigits: 2}) : '-'}</td>
                    <td class="running-bal" style="text-align: right; color: #818cf8;">${t._calcBalance.toLocaleString(undefined, {minimumFractionDigits: 2})}</td>
                    <td style="text-align: center;">
                        <button onclick="openPdfViewer('${t.source_document_id || srcFileStr}', ${t.source_page || 1})" class="source-pdf-btn" title="View in Source PDF (Page ${srcPageStr})">
                            📄 ${srcFileStr} P.${srcPageStr}
                        </button>
                    </td>
                    <td style="text-align: center;">
                        <button onclick="openCommentModal('${t.id}')" class="comment-badge-btn ${hasComments ? 'has-comments' : ''}" title="${hasComments ? `${txComments.length} comment(s)` : 'Add comment'}">
                            ${cmtBtnLabel}
                        </button>
                    </td>
                    <td style="text-align: center;">
                        <button onclick="deleteTransactionRow('${t.id}', '${particularsText.replace(/'/g, "\\'")}')" class="logout-btn" style="padding: 2px 6px; font-size: 10px;">🗑️</button>
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
        rowsHtml = `<tr><td colspan="9" style="text-align: center; color: #94a3b8;">No statement transactions match the selected filters.</td></tr>`;
    }

    tbody.innerHTML = rowsHtml;

    // Person & Tenure Summary Calculations
    if (searchQuery && banner) {
        banner.classList.remove("hidden");
        if (bannerTitle) bannerTitle.innerHTML = `👤 Person Summary: <span style="color: #a5b4fc;">${searchQuery}</span>`;
        if (bannerCount) bannerCount.textContent = `${renderedCount} Transactions`;
        
        let periodDisplay = "All Recorded Dates";
        if (dateFromStr && dateToStr) periodDisplay = `${dateFromStr} → ${dateToStr}`;
        else if (dateFromStr) periodDisplay = `From ${dateFromStr}`;
        else if (dateToStr) periodDisplay = `Until ${dateToStr}`;
        else if (selectedMonth !== "all") periodDisplay = `Month: ${selectedMonth}`;

        if (personPeriodText) personPeriodText.textContent = `Period: ${periodDisplay}`;

        if (bannerDebit) bannerDebit.textContent = `Rs. ${totalDebit.toLocaleString(undefined, {minimumFractionDigits: 2})}`;
        if (bannerCredit) bannerCredit.textContent = `Rs. ${totalCredit.toLocaleString(undefined, {minimumFractionDigits: 2})}`;
        
        // NET AMOUNT = TOTAL DEBIT - TOTAL CREDIT
        const netAmt = totalDebit - totalCredit;
        if (bannerNet) bannerNet.textContent = `Rs. ${netAmt.toLocaleString(undefined, {minimumFractionDigits: 2})}`;
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
    document.getElementById("modalSourceFileName").textContent = t.pdf_filename || t.source_file_name || "statement.pdf";
    document.getElementById("modalSourcePageNum").textContent = `Page ${t.source_page || 1}`;
    document.getElementById("modalSourceDate").textContent = t.date || "-";
    document.getElementById("modalSourceRawText").textContent = t.raw_text || t.particulars || "Raw PDF text stored in system record";
    document.getElementById("rawSourceModal").classList.remove("hidden");
}

function strToFloat(val) {
    if (!val) return 0.0;
    const num = parseFloat(String(val).replace(/,/g, "").trim());
    return isNaN(num) ? 0.0 : num;
}

function makeTxFingerprint(dateStr, descStr, debitVal, creditVal, refStr, balanceVal) {
    const d = String(dateStr || "").trim();
    const desc = String(descStr || "").toLowerCase().replace(/[^a-z0-9]/g, "");
    const deb = strToFloat(debitVal).toFixed(2);
    const cred = strToFloat(creditVal).toFixed(2);
    const bal = strToFloat(balanceVal).toFixed(2);
    const ref = String(refStr || "").trim().toLowerCase();

    if (ref && !ref.startsWith("ref_") && !ref.startsWith("auto-id") && !ref.startsWith("tx_")) {
        return `${d}|${desc}|${deb}|${cred}|${ref}`;
    } else {
        return `${d}|${desc}|${deb}|${cred}|${bal}`;
    }
}

// -------------------------------------------------------------
// CSV EXPORT FUNCTIONS (PERSON & ALL PEOPLE)
// -------------------------------------------------------------
function exportPersonCsv() {
    const searchQuery = (document.getElementById("ledgerSearchInput")?.value || "").toUpperCase().trim();
    if (!searchQuery) {
        alert("Please enter a person's name in the search box to export individual person CSV.");
        return;
    }

    const selectedMonth = document.getElementById("ledgerMonthSelect")?.value || "all";
    const dateFromStr = document.getElementById("ledgerDateFrom")?.value || "";
    const dateToStr = document.getElementById("ledgerDateTo")?.value || "";

    const sorted = [...allLedgerTransactions].sort((a, b) => {
        const ta = getTimestampFromDateAndTime(a.date, a.time);
        const tb = getTimestampFromDateAndTime(b.date, b.time);
        return ta - tb;
    });

    const matchingTxs = [];
    let totDebit = 0.0;
    let totCredit = 0.0;

    sorted.forEach((t) => {
        const dVal = strToFloat(t.debit);
        const cVal = strToFloat(t.credit);
        const aVal = strToFloat(t.amount);
        const bVal = strToFloat(t.balance);
        const isCredit = (t.transaction_type || "").toLowerCase().includes("credit") || (t.transaction_type || "").toLowerCase().includes("deposit");
        
        const debitVal = dVal > 0 ? dVal : (!isCredit && aVal > 0 ? aVal : 0.0);
        const creditVal = cVal > 0 ? cVal : (isCredit && aVal > 0 ? aVal : 0.0);

        t._calcDebit = debitVal;
        t._calcCredit = creditVal;
        t._calcBalance = bVal;

        const shortM = getMonthYearShortLabel(t.date);
        let passesDateFilter = true;

        if (selectedMonth !== "all" && shortM !== selectedMonth) passesDateFilter = false;
        if (dateFromStr && t.date < dateFromStr) passesDateFilter = false;
        if (dateToStr && t.date > dateToStr) passesDateFilter = false;
        if (!passesDateFilter) return;

        const rUpper = (t.receiver_name || "").toUpperCase();
        const sUpper = (t.sender_name || "").toUpperCase();
        const purpUpper = (t.purpose || t.particulars || "").toUpperCase();
        const rawUpper = (t.raw_text || "").toUpperCase();
        const refUpper = (t.reference_number || "").toUpperCase();

        const fullHaystack = `${rUpper} ${sUpper} ${purpUpper} ${rawUpper} ${refUpper}`;

        if (rUpper.includes(searchQuery) || sUpper.includes(searchQuery) || fullHaystack.includes(searchQuery)) {
            matchingTxs.push(t);
            totDebit += debitVal;
            totCredit += creditVal;
        }
    });

    if (matchingTxs.length === 0) {
        alert(`No transactions found for "${searchQuery}" in the selected tenure.`);
        return;
    }

    let periodStr = "All Recorded Dates";
    if (dateFromStr && dateToStr) periodStr = `${dateFromStr} to ${dateToStr}`;
    else if (dateFromStr) periodStr = `From ${dateFromStr}`;
    else if (dateToStr) periodStr = `Until ${dateToStr}`;
    else if (selectedMonth !== "all") periodStr = selectedMonth;

    const netAmount = totDebit - totCredit;

    let csv = "";
    // Summary Section at Top
    csv += `"PERSON FINANCIAL STATEMENT REPORT"\n`;
    csv += `"Person Name:", "${searchQuery.replace(/"/g, '""')}"\n`;
    csv += `"Statement Period:", "${periodStr}"\n`;
    csv += `"Total Debit (Paid Out):", "${totDebit.toFixed(2)}"\n`;
    csv += `"Total Credit (Received In):", "${totCredit.toFixed(2)}"\n`;
    csv += `"Net Amount (Debit - Credit):", "${netAmount.toFixed(2)}"\n`;
    csv += `"Total Transactions:", "${matchingTxs.length}"\n\n`;

    // Table Header
    csv += `Date,Particulars,Reference,Debit,Credit,Running Balance,Source PDF,Source Page,Comment,Bank,Statement Period\n`;

    matchingTxs.forEach(t => {
        const dStr = t.date || "";
        const descStr = `"${(t.particulars || t.purpose || "").replace(/"/g, '""')}"`;
        const refStr = `"${(t.reference_number || t.id || "").replace(/"/g, '""')}"`;
        const debStr = t._calcDebit > 0 ? t._calcDebit.toFixed(2) : "0.00";
        const credStr = t._calcCredit > 0 ? t._calcCredit.toFixed(2) : "0.00";
        const balStr = (t._calcBalance || 0).toFixed(2);
        const srcDoc = `"${(t.pdf_filename || t.source_file_name || "statement.pdf").replace(/"/g, '""')}"`;
        const srcPage = t.source_page || "1";
        
        const txCmts = commentsByTxId[t.id] || [];
        const cmtText = `"${txCmts.map(c => c.comment_text).join(" | ").replace(/"/g, '""')}"`;
        const bankName = `"${(t.bank_name || "Universal Bank").replace(/"/g, '""')}"`;
        const stmtPeriod = `"${(t.statement_period || periodStr).replace(/"/g, '""')}"`;

        csv += `${dStr},${descStr},${refStr},${debStr},${credStr},${balStr},${srcDoc},${srcPage},${cmtText},${bankName},${stmtPeriod}\n`;
    });

    const sanitize = (s) => s.replace(/[^a-zA-Z0-9_\-]/g, "_").replace(/_+/g, "_").replace(/^_+|_+$/g, "");
    const filename = `${sanitize(searchQuery)}_Statement_${sanitize(periodStr)}.csv`;

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
}

function exportLedgerToCsv() {
    if (allLedgerTransactions.length === 0) {
        alert("No ledger statement data available to export.");
        return;
    }

    const searchQuery = (document.getElementById("ledgerSearchInput")?.value || "").toUpperCase().trim();
    if (searchQuery) {
        exportPersonCsv();
        return;
    }

    const selectedMonth = document.getElementById("ledgerMonthSelect")?.value || "all";
    const dateFromStr = document.getElementById("ledgerDateFrom")?.value || "";
    const dateToStr = document.getElementById("ledgerDateTo")?.value || "";

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
    const matchingTxs = [];

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

        if (activeDocFilterId && t.source_document_id && t.source_document_id !== activeDocFilterId) {
            return;
        }

        const shortM = getMonthYearShortLabel(t.date);
        let passesDateFilter = true;
        if (selectedMonth !== "all" && shortM !== selectedMonth) passesDateFilter = false;
        if (dateFromStr && t.date < dateFromStr) passesDateFilter = false;
        if (dateToStr && t.date > dateToStr) passesDateFilter = false;

        if (!passesDateFilter) return;
        matchingTxs.push(t);
    });

    if (matchingTxs.length === 0) {
        alert("No transaction records found matching the active filters.");
        return;
    }

    let csvContent = "Date,Person,Particulars,Reference,Debit,Credit,Running Balance,Source PDF,Source Page,Comment,Bank\n";

    matchingTxs.forEach(t => {
        const dStr = t.date || "";
        const personStr = `"${(t.receiver_name || t.sender_name || "").replace(/"/g, '""')}"`;
        const descStr = `"${(t.particulars || t.purpose || "").replace(/"/g, '""')}"`;
        const refStr = `"${(t.reference_number || t.id || "").replace(/"/g, '""')}"`;
        const debStr = t._calcDebit > 0 ? t._calcDebit.toFixed(2) : "0.00";
        const credStr = t._calcCredit > 0 ? t._calcCredit.toFixed(2) : "0.00";
        const balStr = (t._calcBalance || 0).toFixed(2);
        const srcDoc = `"${(t.pdf_filename || t.source_file_name || "statement.pdf").replace(/"/g, '""')}"`;
        const srcPage = t.source_page || "1";

        const txCmts = commentsByTxId[t.id] || [];
        const cmtText = `"${txCmts.map(c => c.comment_text).join(" | ").replace(/"/g, '""')}"`;
        const bankName = `"${(t.bank_name || "Universal Bank").replace(/"/g, '""')}"`;

        csvContent += `${dStr},${personStr},${descStr},${refStr},${debStr},${credStr},${balStr},${srcDoc},${srcPage},${cmtText},${bankName}\n`;
    });

    const filename = `All_Statement_Transactions_${new Date().toISOString().slice(0, 10)}.csv`;
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
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
