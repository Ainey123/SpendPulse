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

// Initialize App
document.addEventListener("DOMContentLoaded", () => {
    initAuthView();
    initPinPad();
    initMultiImageDropzones();
    initAdminSubTabs();
    initLedgerFilters();
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
            users.forEach(u => {
                const opt = `<option value="${u.user_id}">${u.name} (@${u.username})</option>`;
                select.innerHTML += opt;
                modalSelect.innerHTML += opt;

                html += `
                    <tr>
                        <td><code>${u.user_id}</code></td>
                        <td><b>${u.name}</b></td>
                        <td>@${u.username}</td>
                        <td><code>${u.pin_code || '****'}</code></td>
                        <td><code>${u.password || '****'}</code></td>
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
            allLedgerTransactions = txs;

            if (txs.length === 0) {
                tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; color: #94a3b8;">No task or payment records found.</td></tr>`;
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
                            <button onclick="openStatusModal('${t.id}', '${t.status}', '${t.progress_pct}', '${t.employee_id}')" class="btn-primary" style="padding: 4px 10px; font-size: 11px;">⚙️ Status</button>
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
// 5. CONTINUOUS BANK LEDGER STATEMENT CONTROLLER (MATCHES USER EXCEL REFERENCE)
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

    // Sort transactions chronologically (oldest to newest for continuous ledger)
    const sorted = [...allLedgerTransactions].sort((a, b) => {
        const da = new Date(a.date + " " + (a.time || "00:00"));
        const db = new Date(b.date + " " + (b.time || "00:00"));
        return da - db;
    });

    let currentBalance = DEFAULT_OPENING_BALANCE;
    let openingBalForFilter = DEFAULT_OPENING_BALANCE;
    let totalDebit = 0.0;
    let totalCredit = 0.0;

    let rowsHtml = "";
    let lastMonthHeader = "";
    let renderedCount = 0;

    // Line-by-line ledger calculation
    sorted.forEach((t, idx) => {
        const amtStr = strToFloat(t.amount);
        const isCredit = (t.transaction_type || "").toLowerCase().includes("credit") || (t.transaction_type || "").toLowerCase().includes("deposit");
        
        const debitVal = isCredit ? 0.0 : amtStr;
        const creditVal = isCredit ? amtStr : 0.0;

        currentBalance = currentBalance - debitVal + creditVal;

        // Date formatting & Month boundary header
        let tDateObj = new Date(t.date);
        let monthHeaderStr = "";
        let formattedDate = t.date;

        if (!isNaN(tDateObj.getTime())) {
            monthHeaderStr = tDateObj.toLocaleString('en-US', { month: 'long', year: 'numeric' });
            formattedDate = tDateObj.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
        }

        // Apply Search & Tenure filters
        let matches = true;

        if (searchQuery) {
            const particulars = `${t.sender_name} ${t.receiver_name} ${t.purpose} ${t.transaction_type} ${t.reference_number}`.toLowerCase();
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

            // Render month boundary divider row when month changes!
            if (monthHeaderStr && monthHeaderStr !== lastMonthHeader) {
                lastMonthHeader = monthHeaderStr;
                rowsHtml += `
                    <tr class="month-divider-row">
                        <td colspan="6">🗓️ --- ${monthHeaderStr.toUpperCase()} STATEMENT TENURE ---</td>
                    </tr>
                `;
            }

            const particularsText = t.purpose || `POS SALE / PAYMENT TO ${t.receiver_name || t.sender_name || 'MERCHANT'}`;
            const instNo = t.reference_number || t.id;

            rowsHtml += `
                <tr>
                    <td style="font-weight: 600;">${formattedDate}</td>
                    <td><b>${particularsText}</b> ${t.sender_name ? `<br/><span style="font-size: 11px; color: #94a3b8;">From: ${t.sender_name} | To: ${t.receiver_name || 'N/A'}</span>` : ''}</td>
                    <td><code>${instNo}</code></td>
                    <td class="debit-val" style="text-align: right;">${debitVal > 0 ? debitVal.toLocaleString(undefined, {minimumFractionDigits: 2}) : '-'}</td>
                    <td class="credit-val" style="text-align: right;">${creditVal > 0 ? creditVal.toLocaleString(undefined, {minimumFractionDigits: 2}) : '-'}</td>
                    <td class="running-bal" style="text-align: right;">${currentBalance.toLocaleString(undefined, {minimumFractionDigits: 2})}</td>
                </tr>
            `;
        }
    });

    if (renderedCount === 0) {
        rowsHtml = `<tr><td colspan="6" style="text-align: center; color: #94a3b8;">No statement transactions match the selected tenure or search filter.</td></tr>`;
    }

    tbody.innerHTML = rowsHtml;

    // Update Summary Header Cards
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
    Array.from(files).forEach(file => {
        if (!file.type.startsWith("image/")) {
            alert(`File "${file.name}" is not an image (JPG, PNG, WEBP allowed).`);
            return;
        }
        const reader = new FileReader();
        reader.onload = (e) => {
            batch.push({ id: Math.random().toString(36).substr(2, 9), name: file.name, base64: e.target.result });
            renderImagePreviews(role);
        };
        reader.readAsDataURL(file);
    });
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
        div.innerHTML = `
            <img src="${imgObj.base64}" alt="${imgObj.name}" />
            <button class="thumb-remove-btn" onclick="removeThumbImage('${role}', ${idx})">✕</button>
        `;
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
