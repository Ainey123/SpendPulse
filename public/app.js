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

// Initialize App
document.addEventListener("DOMContentLoaded", () => {
    initAuthView();
    initPinPad();
    initMultiImageDropzones();
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
// 2. AUTHENTICATION & PIN KEYPAD CONTROLLER
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

    if (currentPin.length < 4 && !password) {
        errBox.textContent = "Please enter your 4-digit security PIN or password.";
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
// 3. ADMIN DASHBOARD & EMPLOYEE MANAGEMENT CONTROLLER
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
            
            // Populate Employee Table
            const tbody = document.getElementById("employeeTableBody");
            const select = document.getElementById("adminAssignSelect");
            const modalSelect = document.getElementById("modalEmpSelect");

            select.innerHTML = `<option value="">Unassigned (General Queue)</option>`;
            modalSelect.innerHTML = `<option value="">Unassigned</option>`;

            if (users.length === 0) {
                tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: #94a3b8;">No registered employees found.</td></tr>`;
                return;
            }

            let html = "";
            users.forEach(u => {
                // Populate dropdown options
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
            tbody.innerHTML = html;
        }
    } catch (e) {
        console.warn("Users fetch failed:", e);
    }
}

function initAdminFormEvents() {
    const toggleBtn = document.getElementById("toggleCreateEmpBtn");
    const form = document.getElementById("createEmpForm");
    
    toggleBtn.onclick = () => form.classList.toggle("hidden");

    document.getElementById("autoGenCredentialsBtn").onclick = () => {
        const randPin = Math.floor(1000 + Math.random() * 9000).toString();
        const randPass = "Emp#" + Math.floor(1000 + Math.random() * 9000);
        document.getElementById("newEmpPin").value = randPin;
        document.getElementById("newEmpPassword").value = randPass;
    };

    form.onsubmit = async (e) => {
        e.preventDefault();
        const name = document.getElementById("newEmpName").value.trim();
        const username = document.getElementById("newEmpUsername").value.trim();
        const pin_code = document.getElementById("newEmpPin").value.trim();
        const password = document.getElementById("newEmpPassword").value.trim();
        const msg = document.getElementById("createEmpMsg");

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

    document.getElementById("refreshAdminTableBtn").onclick = () => fetchAdminTransactions();
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
// 4. EMPLOYEE DASHBOARD CONTROLLER
// -------------------------------------------------------------
async function loadEmployeeDashboard() {
    fetchEmployeeTransactions();
    document.getElementById("refreshEmpTableBtn").onclick = () => fetchEmployeeTransactions();
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

            // Compute Employee Summary Cards
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
// 5. MULTI-IMAGE DROPZONES & PREVIEWS
// -------------------------------------------------------------
function initMultiImageDropzones() {
    // Admin Dropzone
    const adminDropzone = document.getElementById("adminDropzone");
    const adminFileInput = document.getElementById("adminFileInput");
    const adminUploadBtn = document.getElementById("adminUploadBtn");

    adminDropzone.onclick = () => adminFileInput.click();
    adminFileInput.onchange = (e) => handleImageFiles(e.target.files, "admin");

    adminDropzone.ondragover = (e) => { e.preventDefault(); adminDropzone.style.borderColor = "#6366f1"; };
    adminDropzone.ondragleave = () => adminDropzone.style.borderColor = "rgba(99, 102, 241, 0.4)";
    adminDropzone.ondrop = (e) => {
        e.preventDefault();
        adminDropzone.style.borderColor = "rgba(99, 102, 241, 0.4)";
        if (e.dataTransfer.files.length) handleImageFiles(e.dataTransfer.files, "admin");
    };

    adminUploadBtn.onclick = () => submitImageBatch("admin");

    // Employee Dropzone
    const empDropzone = document.getElementById("empDropzone");
    const empFileInput = document.getElementById("empFileInput");
    const empUploadBtn = document.getElementById("empUploadBtn");

    empDropzone.onclick = () => empFileInput.click();
    empFileInput.onchange = (e) => handleImageFiles(e.target.files, "employee");

    empDropzone.ondragover = (e) => { e.preventDefault(); empDropzone.style.borderColor = "#34d399"; };
    empDropzone.ondragleave = () => empDropzone.style.borderColor = "rgba(16, 185, 129, 0.4)";
    empDropzone.ondrop = (e) => {
        e.preventDefault();
        empDropzone.style.borderColor = "rgba(16, 185, 129, 0.4)";
        if (e.dataTransfer.files.length) handleImageFiles(e.dataTransfer.files, "employee");
    };

    empUploadBtn.onclick = () => submitImageBatch("employee");
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
// 6. UPDATE STATUS MODAL CONTROLLER (ADMIN)
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

document.getElementById("closeStatusModalBtn").onclick = () => {
    document.getElementById("updateStatusModal").classList.add("hidden");
};

document.getElementById("saveStatusBtn").onclick = async () => {
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
