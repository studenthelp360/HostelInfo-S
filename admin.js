/**
 * Admin Panel Controller
 * Managing Students Database, Status updates, and Audits
 * HostelInfo-S (V2)
 */

import { verifyAdminSession, triggerAdminLogout, triggerAdminGoogleLogin } from './auth.js';
import { supabaseClient, showToast, toggleLoader, logError } from './utils.js';

// Global state variables
let activeAdminEmail = null;
let studentToReject = null;
let studentToDelete = null;

let allStudentsList = [];        // Caches all students fetched from database
let filteredStudentsList = [];   // Stores locally filtered students for search
let currentPage = 1;             // Pagination tracking
const pageSize = 25;             // Page size limit

// Modal instances
let rejectModalInstance = null;
let detailsModalInstance = null;
let deleteModalInstance = null;

// Initialize Admin Dashboard on load
document.addEventListener('DOMContentLoaded', async () => {
  console.log("[AdminPanel] Initializing Supabase V2 dashboard controller...");

  // Hook login triggers
  const googleLoginBtn = document.getElementById('adminGoogleLoginBtn');
  if (googleLoginBtn) {
    googleLoginBtn.addEventListener('click', triggerAdminGoogleLogin);
  }

  // 1. Verify administrative credentials
  const adminInfo = await verifyAdminSession();
  
  if (!adminInfo || !adminInfo.verified) {
    // Redirect to login overlay if not whitelisted
    const overlay = document.getElementById('adminAuthOverlay');
    const dashboard = document.getElementById('adminDashboardContainer');
    if (overlay) overlay.classList.remove('d-none');
    if (dashboard) dashboard.classList.add('d-none');

    if (adminInfo && adminInfo.error) {
      showToast(adminInfo.error, "danger");
      const feedback = document.getElementById('adminAuthFeedback');
      if (feedback) {
        feedback.textContent = adminInfo.error;
        feedback.classList.remove('d-none');
      }
    }
  } else {
    // Whitelisted admin: display email and show panel
    activeAdminEmail = adminInfo.email;
    const badge = document.getElementById('adminEmailBadge');
    const overlay = document.getElementById('adminAuthOverlay');
    const dashboard = document.getElementById('adminDashboardContainer');
    
    if (badge) badge.textContent = activeAdminEmail;
    if (overlay) overlay.classList.add('d-none');
    if (dashboard) dashboard.classList.remove('d-none');

    setupAdminEventListeners();
    loadAllDashboardData();
  }
});

// Configure dashboard UI events
function setupAdminEventListeners() {
  const logoutBtn = document.getElementById('adminLogoutBtn');
  if (logoutBtn) logoutBtn.addEventListener('click', triggerAdminLogout);

  // Search input typing filters locally (no DB roundtrip)
  const searchInput = document.getElementById('adminSearchInput');
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      currentPage = 1;
      applyLocalFilters();
    });
  }

  const searchStatus = document.getElementById('adminSearchStatus');
  if (searchStatus) {
    searchStatus.addEventListener('change', () => {
      currentPage = 1;
      applyLocalFilters();
    });
  }

  // Hard reload database grid
  const searchBtn = document.getElementById('adminSearchBtn');
  if (searchBtn) {
    searchBtn.addEventListener('click', async () => {
      toggleLoader(true, "Synchronizing database...");
      await loadAllStudentsFromServer();
      toggleLoader(false);
    });
  }

  // Bind modal confirmation handlers
  const confirmRejectBtn = document.getElementById('confirmRejectBtn');
  if (confirmRejectBtn) confirmRejectBtn.addEventListener('click', submitStudentRejection);

  const confirmDeleteBtn = document.getElementById('confirmDeleteBtn');
  if (confirmDeleteBtn) confirmDeleteBtn.addEventListener('click', submitStudentDeletion);

  const exportBtn = document.getElementById('adminExportBtn') || document.getElementById('exportCsvBtn');
  if (exportBtn) exportBtn.addEventListener('click', exportToCSV);

  // Tab dynamic lazy loading
  const tabs = document.querySelectorAll('button[data-bs-toggle="tab"]');
  tabs.forEach(tab => {
    tab.addEventListener('shown.bs.tab', (event) => {
      const tabId = event.target.id;
      if (tabId === 'pending-tab') {
        loadPendingApprovals();
      } else if (tabId === 'expired-tab') {
        loadExpiredApprovals();
      } else if (tabId === 'all-tab') {
        if (allStudentsList.length === 0) {
          loadAllStudentsFromServer();
        } else {
          applyLocalFilters();
        }
      }
    });
  });
}

// Concurrently retrieve statistics and pending registrations
async function loadAllDashboardData() {
  const startTime = Date.now();
  console.log("[Performance] Starting concurrent admin load...");
  toggleLoader(true, "Loading Dashboard...");

  try {
    await Promise.all([
      loadStatistics(),
      loadPendingApprovals()
    ]);
    
    // Background lazy load approved students list
    setTimeout(() => {
      loadAllStudentsFromServer();
    }, 100);

    toggleLoader(false);
    console.log(`[Performance] Dashboard loaded in ${Date.now() - startTime}ms`);
  } catch (err) {
    toggleLoader(false);
    logError("loadAllDashboardData", err);
    showToast("Failed to load dashboard data.", "danger");
  }
}

// Fetch stats card counts in parallel
async function loadStatistics() {
  try {
    const [total, pending, approved, expired, rejected, hostels] = await Promise.all([
      supabaseClient.from('students').select('*', { count: 'exact', head: true }),
      supabaseClient.from('students').select('*', { count: 'exact', head: true }).eq('status', 'Pending'),
      supabaseClient.from('students').select('*', { count: 'exact', head: true }).eq('status', 'Approved'),
      supabaseClient.from('students').select('*', { count: 'exact', head: true }).eq('status', 'Expired'),
      supabaseClient.from('students').select('*', { count: 'exact', head: true }).eq('status', 'Rejected'),
      supabaseClient.from('hostels').select('*', { count: 'exact', head: true })
    ]);

    document.getElementById('statTotalStudents').textContent = total.count || 0;
    document.getElementById('statPendingStudents').textContent = pending.count || 0;
    document.getElementById('statApprovedStudents').textContent = approved.count || 0;
    document.getElementById('statExpiredStudents').textContent = expired.count || 0;
    document.getElementById('statRejectedStudents').textContent = rejected.count || 0;
    document.getElementById('statTotalHostels').textContent = hostels.count || 0;
  } catch (err) {
    logError("loadStatistics", err);
  }
}

// Tab 1: Load Pending Registrations
async function loadPendingApprovals() {
  const tbody = document.getElementById('pendingStudentsTableBody');
  if (!tbody) return;
  
  tbody.innerHTML = `<tr><td colspan="5" class="text-center py-4"><div class="spinner-border text-primary spinner-border-sm" role="status"></div> Loading...</td></tr>`;

  try {
    const { data: students, error } = await supabaseClient
      .from('students')
      .select('*')
      .eq('status', 'Pending')
      .order('created_at', { ascending: false });

    if (error) throw error;

    tbody.innerHTML = '';
    if (students.length === 0) {
      tbody.innerHTML = `<tr><td colspan="5" class="text-center text-muted py-4">No pending registrations found.</td></tr>`;
      return;
    }

    students.forEach(student => {
      const regDate = student.registration_date || '';
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><strong>${student.student_id}</strong></td>
        <td>${student.name}</td>
        <td>${student.mobile}</td>
        <td>${regDate}</td>
        <td class="text-center">
          <button class="btn btn-success btn-action-sm me-2" onclick="approveStudent('${student.student_id}')">✓ Approve</button>
          <button class="btn btn-danger btn-action-sm" onclick="openRejectModal('${student.student_id}')">✕ Reject</button>
        </td>
      `;
      tbody.appendChild(tr);
    });
  } catch (err) {
    logError("loadPendingApprovals", err);
    tbody.innerHTML = `<tr><td colspan="5" class="text-center text-danger py-4">Database offline or error loading.</td></tr>`;
  }
}

// Approve Student logic (Optimistic UI)
export async function approveStudent(studentId) {
  console.log("Approve student action initiated:", studentId);
  
  // 1. Locate row in DOM for optimistic fade
  const pendingTbody = document.getElementById('pendingStudentsTableBody');
  const rows = pendingTbody ? pendingTbody.getElementsByTagName('tr') : [];
  let targetRow = null;
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].innerHTML.includes(`approveStudent('${studentId}')`)) {
      targetRow = rows[i];
      break;
    }
  }

  // Backup original row markup
  const originalHtml = targetRow ? targetRow.innerHTML : null;

  // Optimistic UI updates
  if (targetRow) {
    targetRow.style.opacity = '0.5';
    targetRow.style.pointerEvents = 'none';
  }

  const pendingCard = document.getElementById('statPendingStudents');
  const approvedCard = document.getElementById('statApprovedStudents');
  const origPending = parseInt(pendingCard.textContent, 10) || 0;
  const origApproved = parseInt(approvedCard.textContent, 10) || 0;
  if (origPending > 0) pendingCard.textContent = origPending - 1;
  approvedCard.textContent = origApproved + 1;

  try {
    // Query expiry days from settings
    const { data: settings, error: settingsError } = await supabaseClient
      .from('settings')
      .select('expiry_days')
      .limit(1)
      .maybeSingle();

    if (settingsError) throw settingsError;
    const expiryDays = settings ? settings.expiry_days : 5;

    const today = new Date();
    const expiryDate = new Date();
    expiryDate.setDate(today.getDate() + expiryDays);

    const todayStr = today.toISOString().split('T')[0];
    const expiryStr = expiryDate.toISOString().split('T')[0];

    // Update row
    const { error: updateError } = await supabaseClient
      .from('students')
      .update({
        status: 'Approved',
        approval_date: todayStr,
        expiry_date: expiryStr,
        remarks: 'Approved by administrator'
      })
      .eq('student_id', studentId);

    if (updateError) throw updateError;

    // Successful update: Remove row
    if (targetRow) {
      targetRow.remove();
      if (pendingTbody.children.length === 0) {
        pendingTbody.innerHTML = `<tr><td colspan="5" class="text-center text-muted py-4">No pending registrations found.</td></tr>`;
      }
    }
    showToast("Student Approved Successfully", "success");

    // Asynchronously refresh stats card
    setTimeout(loadStatistics, 50);

    // Update in cached students array if present
    const cachedStudent = allStudentsList.find(s => s.student_id === studentId);
    if (cachedStudent) {
      cachedStudent.status = 'Approved';
      cachedStudent.approval_date = todayStr;
      cachedStudent.expiry_date = expiryStr;
      applyLocalFilters();
    }
  } catch (err) {
    logError("approveStudent", err);
    // Rollback UI
    if (targetRow && originalHtml) {
      targetRow.innerHTML = originalHtml;
      targetRow.style.opacity = '1.0';
      targetRow.style.pointerEvents = 'auto';
    }
    pendingCard.textContent = origPending;
    approvedCard.textContent = origApproved;
    showToast("Failed to approve student: " + err.message, "danger");
  }
}

// Reject student modal trigger
export function openRejectModal(studentId) {
  studentToReject = studentId;
  const remarksInput = document.getElementById('rejectRemarks');
  if (remarksInput) remarksInput.value = '';
  
  if (!rejectModalInstance) {
    rejectModalInstance = new bootstrap.Modal(document.getElementById('rejectRemarksModal'));
  }
  rejectModalInstance.show();
}

async function submitStudentRejection() {
  if (!studentToReject) return;
  const remarks = document.getElementById('rejectRemarks').value.trim();
  const studentId = studentToReject;

  if (rejectModalInstance) rejectModalInstance.hide();

  const pendingTbody = document.getElementById('pendingStudentsTableBody');
  const rows = pendingTbody ? pendingTbody.getElementsByTagName('tr') : [];
  let targetRow = null;
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].innerHTML.includes(`openRejectModal('${studentId}')`)) {
      targetRow = rows[i];
      break;
    }
  }

  const originalHtml = targetRow ? targetRow.innerHTML : null;

  // Optimistic UI updates
  if (targetRow) {
    targetRow.style.opacity = '0.5';
    targetRow.style.pointerEvents = 'none';
  }

  const pendingCard = document.getElementById('statPendingStudents');
  const rejectedCard = document.getElementById('statRejectedStudents');
  const origPending = parseInt(pendingCard.textContent, 10) || 0;
  const origRejected = parseInt(rejectedCard.textContent, 10) || 0;
  if (origPending > 0) pendingCard.textContent = origPending - 1;
  rejectedCard.textContent = origRejected + 1;

  try {
    const { error } = await supabaseClient
      .from('students')
      .update({
        status: 'Rejected',
        remarks: remarks || 'Rejected by administrator'
      })
      .eq('student_id', studentId);

    if (error) throw error;

    if (targetRow) {
      targetRow.remove();
      if (pendingTbody.children.length === 0) {
        pendingTbody.innerHTML = `<tr><td colspan="5" class="text-center text-muted py-4">No pending registrations found.</td></tr>`;
      }
    }
    showToast("Registration Rejected", "warning");

    // Asynchronously refresh stats
    setTimeout(loadStatistics, 50);

    const cachedStudent = allStudentsList.find(s => s.student_id === studentId);
    if (cachedStudent) {
      cachedStudent.status = 'Rejected';
      cachedStudent.remarks = remarks || 'Rejected by administrator';
      applyLocalFilters();
    }
  } catch (err) {
    logError("submitStudentRejection", err);
    if (targetRow && originalHtml) {
      targetRow.innerHTML = originalHtml;
      targetRow.style.opacity = '1.0';
      targetRow.style.pointerEvents = 'auto';
    }
    pendingCard.textContent = origPending;
    rejectedCard.textContent = origRejected;
    showToast("Rejection failed: " + err.message, "danger");
  }
}

// Tab 2: Load Expired registrations
async function loadExpiredApprovals() {
  const tbody = document.getElementById('expiredStudentsTableBody');
  if (!tbody) return;
  tbody.innerHTML = `<tr><td colspan="5" class="text-center py-4"><div class="spinner-border text-primary spinner-border-sm" role="status"></div> Loading...</td></tr>`;

  try {
    const { data: students, error } = await supabaseClient
      .from('students')
      .select('*')
      .eq('status', 'Expired')
      .order('expiry_date', { ascending: false });

    if (error) throw error;

    tbody.innerHTML = '';
    if (students.length === 0) {
      tbody.innerHTML = `<tr><td colspan="5" class="text-center text-muted py-4">No expired accounts found.</td></tr>`;
      return;
    }

    students.forEach(student => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><strong>${student.student_id}</strong></td>
        <td>${student.name}</td>
        <td>${student.mobile}</td>
        <td><span class="text-danger">${student.expiry_date || 'N/A'}</span></td>
        <td class="text-center">
          <button class="btn btn-success btn-action-sm" onclick="reapproveStudent('${student.student_id}')">🔄 Re-Approve</button>
        </td>
      `;
      tbody.appendChild(tr);
    });
  } catch (err) {
    logError("loadExpiredApprovals", err);
    tbody.innerHTML = `<tr><td colspan="5" class="text-center text-danger py-4">Database offline or error loading.</td></tr>`;
  }
}

// Re-Approve Student (Optimistic UI)
export async function reapproveStudent(studentId) {
  const expiredTbody = document.getElementById('expiredStudentsTableBody');
  const rows = expiredTbody ? expiredTbody.getElementsByTagName('tr') : [];
  let targetRow = null;
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].innerHTML.includes(`reapproveStudent('${studentId}')`)) {
      targetRow = rows[i];
      break;
    }
  }

  const originalHtml = targetRow ? targetRow.innerHTML : null;

  if (targetRow) {
    targetRow.style.opacity = '0.5';
    targetRow.style.pointerEvents = 'none';
  }

  const expiredCard = document.getElementById('statExpiredStudents');
  const approvedCard = document.getElementById('statApprovedStudents');
  const origExpired = parseInt(expiredCard.textContent, 10) || 0;
  const origApproved = parseInt(approvedCard.textContent, 10) || 0;
  if (origExpired > 0) expiredCard.textContent = origExpired - 1;
  approvedCard.textContent = origApproved + 1;

  try {
    const { data: settings, error: settingsError } = await supabaseClient
      .from('settings')
      .select('expiry_days')
      .limit(1)
      .maybeSingle();

    if (settingsError) throw settingsError;
    const expiryDays = settings ? settings.expiry_days : 5;

    const today = new Date();
    const expiryDate = new Date();
    expiryDate.setDate(today.getDate() + expiryDays);

    const todayStr = today.toISOString().split('T')[0];
    const expiryStr = expiryDate.toISOString().split('T')[0];

    const { error } = await supabaseClient
      .from('students')
      .update({
        status: 'Approved',
        approval_date: todayStr,
        expiry_date: expiryStr,
        remarks: 'Re-approved by administrator'
      })
      .eq('student_id', studentId);

    if (error) throw error;

    if (targetRow) {
      targetRow.remove();
      if (expiredTbody.children.length === 0) {
        expiredTbody.innerHTML = `<tr><td colspan="5" class="text-center text-muted py-4">No expired accounts found.</td></tr>`;
      }
    }
    showToast("Student Re-approved Successfully", "success");

    setTimeout(loadStatistics, 50);

    const cachedStudent = allStudentsList.find(s => s.student_id === studentId);
    if (cachedStudent) {
      cachedStudent.status = 'Approved';
      cachedStudent.approval_date = todayStr;
      cachedStudent.expiry_date = expiryStr;
      applyLocalFilters();
    }
  } catch (err) {
    logError("reapproveStudent", err);
    if (targetRow && originalHtml) {
      targetRow.innerHTML = originalHtml;
      targetRow.style.opacity = '1.0';
      targetRow.style.pointerEvents = 'auto';
    }
    expiredCard.textContent = origExpired;
    approvedCard.textContent = origApproved;
    showToast("Re-approval failed: " + err.message, "danger");
  }
}

// Tab 3: Load All Students Database
async function loadAllStudentsFromServer() {
  try {
    const { data: students, error } = await supabaseClient
      .from('students')
      .select('*')
      .order('name', { ascending: true });

    if (error) throw error;

    allStudentsList = students;
    applyLocalFilters();
  } catch (err) {
    logError("loadAllStudentsFromServer", err);
    showToast("Failed to fetch student list.", "danger");
  }
}

// Apply searches and status switches locally
function applyLocalFilters() {
  const queryVal = document.getElementById('adminSearchInput').value.trim().toLowerCase();
  const statusVal = document.getElementById('adminSearchStatus').value;

  filteredStudentsList = allStudentsList.filter(student => {
    const matchesStatus = statusVal === 'All' || student.status === statusVal;
    const matchesQuery = !queryVal || 
      student.student_id.toLowerCase().includes(queryVal) ||
      student.name.toLowerCase().includes(queryVal) ||
      student.mobile.includes(queryVal);
    return matchesStatus && matchesQuery;
  });

  renderAllStudentsPage(1);
}

// Slice into 25 rows block
function renderAllStudentsPage(page) {
  currentPage = page;
  const tbody = document.getElementById('allStudentsTableBody');
  const pagDiv = document.getElementById('allStudentsPagination');
  
  if (!tbody || !pagDiv) return;

  if (filteredStudentsList.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="text-center text-muted py-4">No matching student records found.</td></tr>`;
    pagDiv.innerHTML = '';
    return;
  }

  const totalRecords = filteredStudentsList.length;
  const totalPages = Math.ceil(totalRecords / pageSize);
  if (currentPage > totalPages) currentPage = totalPages;
  if (currentPage < 1) currentPage = 1;

  const startIdx = (currentPage - 1) * pageSize;
  const endIdx = Math.min(startIdx + pageSize, totalRecords);
  const pageData = filteredStudentsList.slice(startIdx, endIdx);

  tbody.innerHTML = '';
  pageData.forEach(student => {
    let statusBadge = `<span class="badge bg-secondary">${student.status}</span>`;
    if (student.status === 'Approved') statusBadge = `<span class="badge bg-success">Approved</span>`;
    else if (student.status === 'Pending') statusBadge = `<span class="badge bg-warning text-dark">Pending</span>`;
    else if (student.status === 'Rejected') statusBadge = `<span class="badge bg-danger">Rejected</span>`;
    else if (student.status === 'Expired') statusBadge = `<span class="badge bg-dark">Expired</span>`;

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><strong>${student.student_id}</strong></td>
      <td>${student.name}</td>
      <td>${student.mobile}</td>
      <td>${statusBadge}</td>
      <td>${student.expiry_date || 'N/A'}</td>
      <td class="text-center">
        <button class="btn btn-outline-primary btn-action-sm me-2" onclick="viewStudentDetails('${student.student_id}')">👁 View</button>
        <button class="btn btn-outline-danger btn-action-sm" onclick="openDeleteModal('${student.student_id}', '${student.name}')">🗑 Delete</button>
      </td>
    `;
    tbody.appendChild(tr);
  });

  const prevDisabled = currentPage === 1 ? 'disabled' : '';
  const nextDisabled = currentPage === totalPages ? 'disabled' : '';

  pagDiv.innerHTML = `
    <div class="text-muted small">Showing <strong>${startIdx + 1}</strong> to <strong>${endIdx}</strong> of <strong>${totalRecords}</strong> entries</div>
    <div class="d-flex gap-2">
      <button class="btn btn-sm btn-outline-primary px-3" ${prevDisabled} onclick="changeAllStudentsPage(${currentPage - 1})">Previous</button>
      <span class="align-self-center small fw-semibold text-primary">Page ${currentPage} of ${totalPages}</span>
      <button class="btn btn-sm btn-outline-primary px-3" ${nextDisabled} onclick="changeAllStudentsPage(${currentPage + 1})">Next</button>
    </div>
  `;
}

export function changeAllStudentsPage(page) {
  renderAllStudentsPage(page);
}

// Display Student Details modal
export function viewStudentDetails(studentId) {
  const student = allStudentsList.find(s => s.student_id === studentId);
  if (!student) return;

  const content = document.getElementById('detailsContent');
  if (!content) return;

  content.innerHTML = `
    <ul class="list-group list-group-flush small">
      <li class="list-group-item d-flex justify-content-between"><strong>Student ID:</strong> <span>${student.student_id}</span></li>
      <li class="list-group-item d-flex justify-content-between"><strong>Name:</strong> <span>${student.name}</span></li>
      <li class="list-group-item d-flex justify-content-between"><strong>Mobile Number:</strong> <span>${student.mobile}</span></li>
      <li class="list-group-item d-flex justify-content-between"><strong>Status:</strong> <span class="badge bg-${student.status === 'Approved' ? 'success' : 'secondary'}">${student.status}</span></li>
      <li class="list-group-item d-flex justify-content-between"><strong>Registration Date:</strong> <span>${student.registration_date || 'N/A'}</span></li>
      <li class="list-group-item d-flex justify-content-between"><strong>Approval Date:</strong> <span>${student.approval_date || 'N/A'}</span></li>
      <li class="list-group-item d-flex justify-content-between"><strong>Expiry Date:</strong> <span>${student.expiry_date || 'N/A'}</span></li>
      <li class="list-group-item d-flex justify-content-between"><strong>Last Login:</strong> <span>${student.last_login ? new Date(student.last_login).toLocaleString() : 'N/A'}</span></li>
      <li class="list-group-item text-start">
        <strong>Remarks / Status Description:</strong>
        <div class="p-2 border rounded mt-1 bg-light text-muted" style="min-height: 40px;">${student.remarks || 'None'}</div>
      </li>
    </ul>
  `;

  if (!detailsModalInstance) {
    detailsModalInstance = new bootstrap.Modal(document.getElementById('detailsModal'));
  }
  detailsModalInstance.show();
}

// Open Delete student verification Modal
export function openDeleteModal(studentId, studentName) {
  studentToDelete = studentId;
  const nameSpan = document.getElementById('deleteStudentName');
  if (nameSpan) nameSpan.textContent = studentName;
  
  if (!deleteModalInstance) {
    deleteModalInstance = new bootstrap.Modal(document.getElementById('deleteConfirmModal'));
  }
  deleteModalInstance.show();
}

// Confirm Delete student record (Optimistic UI)
async function submitStudentDeletion() {
  if (!studentToDelete) return;
  const studentId = studentToDelete;

  if (deleteModalInstance) deleteModalInstance.hide();
  toggleLoader(true, "Deleting Student Record...");

  const allTbody = document.getElementById('allStudentsTableBody');
  const rows = allTbody ? allTbody.getElementsByTagName('tr') : [];
  let targetRow = null;
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].innerHTML.includes(`viewStudentDetails('${studentId}')`)) {
      targetRow = rows[i];
      break;
    }
  }

  const originalHtml = targetRow ? targetRow.innerHTML : null;

  if (targetRow) {
    targetRow.style.opacity = '0.5';
    targetRow.style.pointerEvents = 'none';
  }

  const totalCard = document.getElementById('statTotalStudents');
  const origTotal = parseInt(totalCard.textContent, 10) || 0;
  if (origTotal > 0) totalCard.textContent = origTotal - 1;

  const targetStudent = allStudentsList.find(s => s.student_id === studentId);
  let backupData = targetStudent ? { ...targetStudent } : null;
  let statusCard = null;
  let origStatusCount = 0;

  if (targetStudent) {
    const cardIdMap = {
      'Approved': 'statApprovedStudents',
      'Pending': 'statPendingStudents',
      'Rejected': 'statRejectedStudents',
      'Expired': 'statExpiredStudents'
    };
    const cardId = cardIdMap[targetStudent.status];
    if (cardId) {
      statusCard = document.getElementById(cardId);
      if (statusCard) {
        origStatusCount = parseInt(statusCard.textContent, 10) || 0;
        if (origStatusCount > 0) statusCard.textContent = origStatusCount - 1;
      }
    }

    // Local list deletion
    allStudentsList = allStudentsList.filter(s => s.student_id !== studentId);
    applyLocalFilters();
  }

  try {
    const { error } = await supabaseClient
      .from('students')
      .delete()
      .eq('student_id', studentId);

    if (error) throw error;
    toggleLoader(false);

    if (targetRow) targetRow.remove();
    showToast("Student Record Deleted Successfully", "danger");

    setTimeout(loadStatistics, 50);
  } catch (err) {
    toggleLoader(false);
    logError("submitStudentDeletion", err);
    
    // Rollback
    if (targetRow && originalHtml) {
      targetRow.innerHTML = originalHtml;
      targetRow.style.opacity = '1.0';
      targetRow.style.pointerEvents = 'auto';
    }
    totalCard.textContent = origTotal;
    if (statusCard) statusCard.textContent = origStatusCount;
    if (backupData) {
      allStudentsList.push(backupData);
      applyLocalFilters();
    }
    showToast("Deletion failed: " + err.message, "danger");
  }
}

// Generate and trigger dynamic CSV download
function exportToCSV() {
  if (filteredStudentsList.length === 0) {
    showToast("No data available to export.", "warning");
    return;
  }

  const headers = ['Student ID', 'Name', 'Mobile Number', 'Status', 'Registration Date', 'Approval Date', 'Expiry Date', 'Remarks'];
  const csvRows = [headers.join(',')];

  filteredStudentsList.forEach(s => {
    const row = [
      `"${s.student_id || ''}"`,
      `"${s.name || ''}"`,
      `"${s.mobile || ''}"`,
      `"${s.status || ''}"`,
      `"${s.registration_date || ''}"`,
      `"${s.approval_date || ''}"`,
      `"${s.expiry_date || ''}"`,
      `"${(s.remarks || '').replace(/"/g, '""')}"`
    ];
    csvRows.push(row.join(','));
  });

  const csvBlob = new Blob([csvRows.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const blobUrl = URL.createObjectURL(csvBlob);
  const link = document.createElement('a');
  link.setAttribute('href', blobUrl);
  link.setAttribute('download', `Student_Records_Export_${new Date().toISOString().split('T')[0]}.csv`);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  showToast("CSV Export Started", "success");
}

// Bind methods to window context for inline onclick bindings in admin.html
window.approveStudent = approveStudent;
window.openRejectModal = openRejectModal;
window.reapproveStudent = reapproveStudent;
window.viewStudentDetails = viewStudentDetails;
window.openDeleteModal = openDeleteModal;
window.changeAllStudentsPage = changeAllStudentsPage;
