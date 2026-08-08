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
      } else if (tabId === 'hostels-tab') {
        loadHostelsFromServer();
      } else if (tabId === 'settings-tab') {
        loadSettingsData();
      }
    });
  });

  const hostelSearch = document.getElementById('hostelSearchInput');
  if (hostelSearch) {
    hostelSearch.addEventListener('input', () => {
      applyHostelFilters();
    });
  }
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
      .neq('expiry_days', -1)
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

    // Wait for all refresh operations to complete
    await Promise.all([
      loadPendingApprovals(),
      loadAllStudentsFromServer(),
      loadStatistics()
    ]);

    showToast("Student Approved Successfully", "success");
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

    // Wait for all refresh operations to complete
    await Promise.all([
      loadPendingApprovals(),
      loadAllStudentsFromServer(),
      loadStatistics()
    ]);

    showToast("Registration Rejected", "warning");
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
      .neq('expiry_days', -1)
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

    // Wait for all refresh operations to complete
    await Promise.all([
      loadExpiredApprovals(),
      loadAllStudentsFromServer(),
      loadStatistics()
    ]);

    showToast("Student Re-approved Successfully", "success");
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

    await Promise.all([
      loadAllStudentsFromServer(),
      loadStatistics()
    ]);

    toggleLoader(false);
    if (targetRow) targetRow.remove();
    showToast("Student Record Deleted Successfully", "danger");
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

// =========================================================================
// HOSTEL MANAGEMENT & AREA SETTINGS EXTENSIONS (V3 CRUD)
// =========================================================================

// State variables for hostels and settings
let allHostelsList = [];
let filteredHostelsList = [];
let selectedHostelId = null;
let optimizedImageFile = null;

let globalSettings = null;
let areasList = [];
let editAreaIndex = -1;

// Modal instances
let hostelModalInstance = null;
let deleteHostelModalInstance = null;
let editAreaModalInstance = null;

// A. --- SETTINGS & AREAS CORE LOGIC ---

// Fetch expiry days and dynamic area list from settings
export async function loadSettingsData() {
  toggleLoader(true, "Loading settings configuration...");
  try {
    // 1. Get global settings record (excluding areas row)
    const { data: globalRow, error: gError } = await supabaseClient
      .from('settings')
      .select('*')
      .neq('expiry_days', -1)
      .limit(1)
      .maybeSingle();

    if (gError) throw gError;
    if (globalRow) {
      globalSettings = globalRow;
      const expInput = document.getElementById('settingsExpiryDays');
      if (expInput) expInput.value = globalRow.expiry_days;
    }

    // 2. Fetch whitelist area rows
    areasList = await loadSettingsAreas();
    renderAreasTable();
    populateHostelAreaDropdown();
    toggleLoader(false);
  } catch (err) {
    toggleLoader(false);
    logError("loadSettingsData", err);
    showToast("Failed to fetch settings parameters.", "danger");
  }
}

// Read areas list from separate settings records where expiry_days = -1
export async function loadSettingsAreas() {
  try {
    const { data: records, error } = await supabaseClient
      .from('settings')
      .select('website_name')
      .eq('expiry_days', -1);

    if (error) throw error;

    if (!records || records.length === 0) {
      // Default areas fallback
      const defaultAreas = ["Kasaba Bawada", "Tarabai Park", "Ruikar Colony", "Nagala Park", "Line Bazar"];
      for (const area of defaultAreas) {
        await supabaseClient.from('settings').insert({
          expiry_days: -1,
          website_name: area,
          maintenance_mode: false
        });
      }
      return defaultAreas;
    }

    return records.map(r => r.website_name.trim()).filter(Boolean);
  } catch (err) {
    logError("loadSettingsAreas", err);
    return ["Kasaba Bawada", "Tarabai Park", "Ruikar Colony", "Nagala Park", "Line Bazar"];
  }
}

// Add New Area record
export async function handleAddArea() {
  const input = document.getElementById('newAreaName');
  if (!input) return;

  const name = input.value.trim();
  if (!name) {
    showToast("Area name cannot be empty.", "warning");
    return;
  }
  if (areasList.includes(name)) {
    showToast("This location name already exists.", "warning");
    return;
  }

  toggleLoader(true, "Adding location area...");
  try {
    const { error } = await supabaseClient
      .from('settings')
      .insert({
        expiry_days: -1,
        website_name: name,
        maintenance_mode: false
      });

    if (error) throw error;

    areasList.push(name);
    input.value = '';
    renderAreasTable();
    populateHostelAreaDropdown();
    showToast("Location added successfully.", "success");
    toggleLoader(false);
  } catch (err) {
    toggleLoader(false);
    logError("handleAddArea", err);
    showToast("Failed to add location: " + err.message, "danger");
  }
}

// Open Area Edit dialog
export function openEditAreaModal(index) {
  editAreaIndex = index;
  const name = areasList[index];

  const idxInput = document.getElementById('editAreaOldIndex');
  const nameInput = document.getElementById('editAreaNameInput');
  if (idxInput) idxInput.value = index;
  if (nameInput) nameInput.value = name;

  if (!editAreaModalInstance) {
    editAreaModalInstance = new bootstrap.Modal(document.getElementById('editAreaModal'));
  }
  editAreaModalInstance.show();
}

// Submit edited area name
export async function submitEditArea() {
  const nameInput = document.getElementById('editAreaNameInput');
  if (!nameInput || editAreaIndex === -1) return;

  const newName = nameInput.value.trim();
  if (!newName) {
    showToast("Location name cannot be empty.", "warning");
    return;
  }

  const oldName = areasList[editAreaIndex];
  if (oldName === newName) {
    if (editAreaModalInstance) editAreaModalInstance.hide();
    return;
  }

  if (areasList.includes(newName)) {
    showToast("This location name already exists.", "warning");
    return;
  }

  if (editAreaModalInstance) editAreaModalInstance.hide();
  toggleLoader(true, "Renaming location...");

  try {
    const { error } = await supabaseClient
      .from('settings')
      .update({ website_name: newName })
      .eq('expiry_days', -1)
      .eq('website_name', oldName);

    if (error) throw error;

    areasList[editAreaIndex] = newName;
    renderAreasTable();
    populateHostelAreaDropdown();
    showToast("Location updated successfully.", "success");
    toggleLoader(false);
  } catch (err) {
    toggleLoader(false);
    logError("submitEditArea", err);
    showToast("Failed to rename location: " + err.message, "danger");
  }
}

// Delete Area name
export async function handleDeleteArea(index) {
  const name = areasList[index];
  if (!confirm(`Are you sure you want to delete the location "${name}"?`)) {
    return;
  }

  toggleLoader(true, "Deleting location...");
  try {
    const { error } = await supabaseClient
      .from('settings')
      .delete()
      .eq('expiry_days', -1)
      .eq('website_name', name);

    if (error) throw error;

    areasList.splice(index, 1);
    renderAreasTable();
    populateHostelAreaDropdown();
    showToast("Location deleted successfully.", "success");
    toggleLoader(false);
  } catch (err) {
    toggleLoader(false);
    logError("handleDeleteArea", err);
    showToast("Failed to delete location: " + err.message, "danger");
  }
}

// Save Expiry Days change
export async function saveExpiryDays() {
  const expInput = document.getElementById('settingsExpiryDays');
  if (!expInput) return;

  const value = parseInt(expInput.value, 10);
  if (isNaN(value) || value < 1 || value > 365) {
    showToast("Please enter a valid expiry offset between 1 and 365 days.", "warning");
    return;
  }

  toggleLoader(true, "Updating expiry settings...");
  try {
    const idToUpdate = globalSettings ? globalSettings.id : undefined;
    const { error } = await supabaseClient
      .from('settings')
      .upsert({
        id: idToUpdate,
        expiry_days: value,
        website_name: globalSettings ? globalSettings.website_name : 'Hostels Near DYPCET',
        maintenance_mode: globalSettings ? globalSettings.maintenance_mode : false
      });

    if (error) throw error;
    showToast("Expiry days updated successfully.", "success");
    toggleLoader(false);
  } catch (err) {
    toggleLoader(false);
    logError("saveExpiryDays", err);
    showToast("Failed to update settings: " + err.message, "danger");
  }
}

// Render dynamic areas list table
function renderAreasTable() {
  const tbody = document.getElementById('areasTableBody');
  if (!tbody) return;
  tbody.innerHTML = '';

  if (areasList.length === 0) {
    tbody.innerHTML = `<tr><td colspan="2" class="text-center text-muted py-2 small">No locations configured.</td></tr>`;
    return;
  }

  areasList.forEach((area, index) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${area}</td>
      <td class="text-end">
        <button class="btn btn-sm btn-outline-primary py-0 px-2 small me-1" onclick="openEditAreaModal(${index})">Edit</button>
        <button class="btn btn-sm btn-outline-danger py-0 px-2 small" onclick="handleDeleteArea(${index})">Delete</button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

// Populate Add/Edit hostel location dropdown
function populateHostelAreaDropdown() {
  const dropdown = document.getElementById('hostelAreaInput');
  if (!dropdown) return;
  
  dropdown.innerHTML = '';
  areasList.forEach(area => {
    const opt = document.createElement('option');
    opt.value = area;
    opt.textContent = area;
    dropdown.appendChild(opt);
  });
}

// B. --- HOSTEL CRUD LOGIC ---

// Fetch hostels from database
export async function loadHostelsFromServer() {
  const tbody = document.getElementById('hostelsTableBody');
  if (!tbody) return;
  tbody.innerHTML = `<tr><td colspan="7" class="text-center py-4"><div class="spinner-border text-primary spinner-border-sm" role="status"></div> Loading hostels...</td></tr>`;

  try {
    const { data: hostels, error } = await supabaseClient
      .from('hostels')
      .select('*')
      .order('hostel_name', { ascending: true });

    if (error) throw error;

    allHostelsList = hostels;
    applyHostelFilters();
  } catch (err) {
    logError("loadHostelsFromServer", err);
    tbody.innerHTML = `<tr><td colspan="7" class="text-center text-danger py-4">Failed to load hostels list.</td></tr>`;
  }
}

// Local Search Filters (under 10ms execution)
export function applyHostelFilters() {
  const query = document.getElementById('hostelSearchInput').value.trim().toLowerCase();
  
  filteredHostelsList = allHostelsList.filter(hostel => {
    return !query || 
      hostel.hostel_name.toLowerCase().includes(query) ||
      hostel.owner_name.toLowerCase().includes(query) ||
      hostel.area.toLowerCase().includes(query);
  });

  renderHostelsTable();
}

// Render dynamic hostels table list
function renderHostelsTable() {
  const tbody = document.getElementById('hostelsTableBody');
  if (!tbody) return;
  tbody.innerHTML = '';

  if (filteredHostelsList.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="text-center text-muted py-4">No matching hostels found.</td></tr>`;
    return;
  }

  filteredHostelsList.forEach(hostel => {
    // Show placeholder if photo is null or empty
    const imgUrl = hostel.photo || 'images/placeholder.jpg';
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><strong>${hostel.hostel_name}</strong></td>
      <td>
        <img src="${imgUrl}" alt="${hostel.hostel_name}" style="width: 48px; height: 48px; object-fit: cover; border-radius: 8px; border: 1px solid #e2e8f0;" onerror="this.onerror=null; this.src='images/placeholder.jpg';">
      </td>
      <td>${hostel.owner_name}</td>
      <td>${hostel.gender}</td>
      <td>${hostel.area}</td>
      <td>${hostel.phone}</td>
      <td class="text-center">
        <button class="btn btn-outline-primary btn-action-sm me-1" onclick="openEditHostelModal('${hostel.id}')">Edit</button>
        <button class="btn btn-outline-danger btn-action-sm" onclick="openDeleteHostelModal('${hostel.id}', '${hostel.hostel_name}')">Delete</button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

// Open Add Hostel popup modal
export function openAddHostelModal() {
  selectedHostelId = null;
  optimizedImageFile = null;

  document.getElementById('hostelModalLabel').textContent = 'Add Hostel';
  const form = document.getElementById('hostelForm');
  if (form) form.reset();

  document.getElementById('hostelId').value = '';
  document.getElementById('imagePreviewContainer').classList.add('d-none');
  document.getElementById('hostelImagePreview').src = '';

  // Synchronize dynamic Area dropdown list
  populateHostelAreaDropdown();

  if (!hostelModalInstance) {
    hostelModalInstance = new bootstrap.Modal(document.getElementById('hostelModal'));
  }
  hostelModalInstance.show();
}

// Open Edit Hostel popup modal
export function openEditHostelModal(hostelId) {
  const hostel = allHostelsList.find(h => h.id === hostelId);
  if (!hostel) return;

  selectedHostelId = hostelId;
  optimizedImageFile = null;

  document.getElementById('hostelModalLabel').textContent = 'Edit Hostel';
  document.getElementById('hostelId').value = hostelId;
  document.getElementById('hostelNameInput').value = hostel.hostel_name;
  document.getElementById('hostelOwnerInput').value = hostel.owner_name;
  document.getElementById('hostelGenderInput').value = hostel.gender;
  document.getElementById('hostelPhoneInput').value = hostel.phone;
  document.getElementById('hostelMapsInput').value = hostel.maps;
  document.getElementById('hostelDescriptionInput').value = hostel.description || '';
  
  // Set up Area list options and select match
  populateHostelAreaDropdown();
  document.getElementById('hostelAreaInput').value = hostel.area;

  const preview = document.getElementById('hostelImagePreview');
  const container = document.getElementById('imagePreviewContainer');
  if (hostel.photo) {
    preview.src = hostel.photo;
    container.classList.remove('d-none');
  } else {
    preview.src = '';
    container.classList.add('d-none');
  }

  const fileInput = document.getElementById('hostelPhotoInput');
  if (fileInput) fileInput.value = '';

  if (!hostelModalInstance) {
    hostelModalInstance = new bootstrap.Modal(document.getElementById('hostelModal'));
  }
  hostelModalInstance.show();
}

// Preview and validate uploaded files
export async function previewHostelImage(event) {
  const file = event.target.files[0];
  const container = document.getElementById('imagePreviewContainer');
  const preview = document.getElementById('hostelImagePreview');
  
  if (!file) {
    optimizedImageFile = null;
    preview.src = '';
    container.classList.add('d-none');
    return;
  }

  // 1. Validation checks
  const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
  if (!allowedTypes.includes(file.type)) {
    showToast("Only JPG, JPEG, PNG and WEBP images are allowed.", "danger");
    event.target.value = '';
    optimizedImageFile = null;
    preview.src = '';
    container.classList.add('d-none');
    return;
  }

  const maxSize = 5 * 1024 * 1024; // 5 MB
  if (file.size > maxSize) {
    showToast("Image size must be less than 5 MB.", "danger");
    event.target.value = '';
    optimizedImageFile = null;
    preview.src = '';
    container.classList.add('d-none');
    return;
  }

  // Show a local temporary preview immediately before canvas optimization
  preview.src = URL.createObjectURL(file);
  container.classList.remove('d-none');

  // 2. Local Preview and scale image asynchronously via Canvas
  try {
    toggleLoader(true, "Optimizing image file...");
    const resized = await resizeImage(file);
    optimizedImageFile = resized;
    
    // Revoke old blob and assign optimized preview
    URL.revokeObjectURL(preview.src);
    preview.src = URL.createObjectURL(resized);
    toggleLoader(false);
  } catch (err) {
    toggleLoader(false);
    logError("previewHostelImage", err);
    showToast("Failed to optimize image: " + err.message, "danger");
  }
}

// Resize image with custom Canvas scale constraints (under 1600px width, 85% JPEG)
async function resizeImage(file, maxWidth = 1600) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.src = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(img.src);
      let width = img.width;
      let height = img.height;

      if (width > maxWidth) {
        height = Math.round((height * maxWidth) / width);
        width = maxWidth;
      }

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;

      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, width, height);

      canvas.toBlob((blob) => {
        if (blob) {
          const nameWithoutExt = file.name.substring(0, file.name.lastIndexOf('.')) || file.name;
          const resizedFile = new File([blob], `${nameWithoutExt}.jpg`, {
            type: 'image/jpeg',
            lastModified: Date.now()
          });
          resolve(resizedFile);
        } else {
          reject(new Error("Canvas blob conversion failed."));
        }
      }, 'image/jpeg', 0.85); // Compress quality to 85% JPEG
    };
    img.onerror = (err) => reject(err);
  });
}

// Upload file to storage with upload progress feedback
async function uploadStorageFile(file) {
  const fileExt = 'jpg'; // We always compress to jpeg inside resizeImage
  const fileName = `hostel_${Date.now()}_${Math.random().toString(36).substring(2, 8)}.${fileExt}`;
  const filePath = fileName;

  const { error } = await supabaseClient.storage
    .from('hostel-photos')
    .upload(filePath, file, {
      cacheControl: '3600',
      upsert: false,
      onUploadProgress: (progress) => {
        const percent = Math.round((progress.loaded / progress.total) * 100);
        toggleLoader(true, `Uploading image (${percent}%)...`);
      }
    });

  if (error) throw error;

  const { data: { publicUrl } } = supabaseClient.storage
    .from('hostel-photos')
    .getPublicUrl(filePath);

  return publicUrl;
}

// Submit Add/Edit Hostel form
export async function handleHostelSubmit(e) {
  e.preventDefault();
  
  const name = document.getElementById('hostelNameInput').value.trim();
  const owner = document.getElementById('hostelOwnerInput').value.trim();
  const gender = document.getElementById('hostelGenderInput').value;
  const area = document.getElementById('hostelAreaInput').value;
  const phone = document.getElementById('hostelPhoneInput').value.trim();
  const maps = document.getElementById('hostelMapsInput').value.trim();
  const description = document.getElementById('hostelDescriptionInput').value.trim();

  // 1. Phone number validation (10 digits, stripped of separators)
  const cleanPhone = phone.replace(/^\+91/, '').replace(/^0/, '').replace(/\s+/g, '').replace(/[\-\(\)]/g, '');
  if (!/^\d{10}$/.test(cleanPhone)) {
    showToast("Phone number must be a valid 10-digit number.", "danger");
    return;
  }

  // 2. Google Maps URL validation
  let validMap = false;
  try {
    const parsed = new URL(maps);
    const host = parsed.hostname.toLowerCase();
    validMap = (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
               (host.includes('maps.google.') || 
                (host.includes('google.com') && parsed.pathname.includes('/maps')) ||
                host === 'maps.app.goo.gl' || 
                host === 'goo.gl');
  } catch (e) {
    validMap = false;
  }
  if (!validMap) {
    showToast("Please enter a valid Google Maps link (e.g. maps.app.goo.gl).", "danger");
    return;
  }

  const hostelId = document.getElementById('hostelId').value.trim() || null;

  // 3. Duplicate hostel check (Phone number must be unique across other records)
  const isDuplicatePhone = allHostelsList.some(h => 
    h.id !== hostelId && 
    h.phone.trim() === phone
  );
  if (isDuplicatePhone) {
    showToast("A hostel with this phone number already exists.", "danger");
    return;
  }

  if (hostelModalInstance) hostelModalInstance.hide();
  toggleLoader(true, "Saving hostel details...");

  try {
    let photoUrl = null;
    const currentHostel = hostelId ? allHostelsList.find(h => h.id === hostelId) : null;
    
    // Use existing photo URL if no new file is uploaded
    if (currentHostel) {
      photoUrl = currentHostel.photo;
    }

    // Upload new image if present
    if (optimizedImageFile) {
      // If updating, delete the old file from Storage first
      if (currentHostel && currentHostel.photo) {
        const oldFileName = currentHostel.photo.split('/').pop();
        if (oldFileName && !oldFileName.includes('placeholder')) {
          await supabaseClient.storage.from('hostel-photos').remove([oldFileName]).catch(e => {
            console.warn("Failed to delete older file during overwrite cleanup:", e);
          });
        }
      }
      photoUrl = await uploadStorageFile(optimizedImageFile);
    }

    const payload = {
      hostel_name: name,
      owner_name: owner,
      gender: gender,
      area: area,
      phone: phone,
      maps: maps,
      photo: photoUrl,
      description: description
    };

    if (hostelId) {
      // Update
      const { error } = await supabaseClient
        .from('hostels')
        .update(payload)
        .eq('id', hostelId);

      if (error) throw error;
      showToast("Hostel updated successfully.", "success");
    } else {
      // Insert
      const { error } = await supabaseClient
        .from('hostels')
        .insert([payload]);

      if (error) throw error;
      showToast("Hostel added successfully.", "success");
    }

    // Refresh hostels grid and statistics counts
    await loadHostelsFromServer();
    setTimeout(loadStatistics, 50);
    toggleLoader(false);
  } catch (err) {
    toggleLoader(false);
    logError("handleHostelSubmit", err);
    showToast("Failed to save hostel details: " + err.message, "danger");
  }
}

// Open Delete Hostel Modal
export function openDeleteHostelModal(hostelId, name) {
  selectedHostelId = hostelId;
  const span = document.getElementById('deleteHostelNameSpan');
  if (span) span.textContent = name;

  const chk = document.getElementById('confirmPermanentDeleteCheck');
  const btn = document.getElementById('confirmDeleteHostelBtn');
  if (chk) chk.checked = false;
  if (btn) btn.disabled = true;

  if (!deleteHostelModalInstance) {
    deleteHostelModalInstance = new bootstrap.Modal(document.getElementById('deleteHostelConfirmModal'));
  }
  deleteHostelModalInstance.show();
}

// Confirm Delete Hostel
export async function submitHostelDeletion() {
  if (!selectedHostelId) return;
  const hostelId = selectedHostelId;

  if (deleteHostelModalInstance) deleteHostelModalInstance.hide();
  toggleLoader(true, "Deleting hostel record...");

  try {
    const currentHostel = allHostelsList.find(h => h.id === hostelId);

    // 1. Delete record from hostels database table
    const { error: dbError } = await supabaseClient
      .from('hostels')
      .delete()
      .eq('id', hostelId);

    if (dbError) throw dbError;

    // 2. Clean up file inside storage bucket if present
    if (currentHostel && currentHostel.photo) {
      const fileName = currentHostel.photo.split('/').pop();
      if (fileName && !fileName.includes('placeholder')) {
        const { error: stError } = await supabaseClient.storage
          .from('hostel-photos')
          .remove([fileName]);

        if (stError) {
          console.warn("Storage cleanup failed during record deletion:", stError);
        }
      }
    }

    showToast("Hostel deleted successfully.", "danger");
    await loadHostelsFromServer();
    setTimeout(loadStatistics, 50);
    toggleLoader(false);
  } catch (err) {
    toggleLoader(false);
    logError("submitHostelDeletion", err);
    showToast("Failed to delete hostel: " + err.message, "danger");
  }
}

// Toggle Hostel Delete button status based on permanent checkbox check state
export function toggleHostelDeleteButton() {
  const chk = document.getElementById('confirmPermanentDeleteCheck');
  const btn = document.getElementById('confirmDeleteHostelBtn');
  if (chk && btn) {
    btn.disabled = !chk.checked;
  }
}

// Bind V3 methods to window context for inline onclick triggers
window.openAddHostelModal = openAddHostelModal;
window.openEditHostelModal = openEditHostelModal;
window.previewHostelImage = previewHostelImage;
window.handleHostelSubmit = handleHostelSubmit;
window.openDeleteHostelModal = openDeleteHostelModal;
window.submitHostelDeletion = submitHostelDeletion;
window.toggleHostelDeleteButton = toggleHostelDeleteButton;

window.loadSettingsData = loadSettingsData;
window.saveExpiryDays = saveExpiryDays;
window.handleAddArea = handleAddArea;
window.openEditAreaModal = openEditAreaModal;
window.submitEditArea = submitEditArea;
window.handleDeleteArea = handleDeleteArea;

