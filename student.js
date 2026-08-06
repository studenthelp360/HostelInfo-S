/**
 * Student Authentication (Registration & Login) Operations
 * Routing through secure Supabase RPC Database APIs
 * HostelInfo-S (V2)
 */

import { callRPC, showToast, toggleLoader, logError } from './utils.js';
import { saveStudentSession, getStudentSession, clearStudentSession } from './auth.js';

// Show Auth Screen Overlay and hide Main App UI
export function showAuthScreen() {
  const authContainer = document.getElementById('authContainer');
  const appMainContainer = document.getElementById('appMainContainer');
  const refreshBtn = document.getElementById('refreshBtn');

  if (authContainer) authContainer.classList.remove('d-none');
  if (appMainContainer) appMainContainer.classList.add('d-none');
  if (refreshBtn) refreshBtn.classList.add('d-none');
}

// Hide Auth Screen Overlay and show Main App UI
export function hideAuthScreen() {
  const authContainer = document.getElementById('authContainer');
  const appMainContainer = document.getElementById('appMainContainer');
  const refreshBtn = document.getElementById('refreshBtn');

  if (authContainer) authContainer.classList.add('d-none');
  if (appMainContainer) appMainContainer.classList.remove('d-none');
  if (refreshBtn) refreshBtn.classList.remove('d-none');

  // Update Welcome Banner
  const session = getStudentSession();
  if (session) {
    const banner = document.getElementById('studentWelcomeBanner');
    if (banner) {
      banner.textContent = `👤 ${session.name} (${session.studentId})`;
    }
  }
}

// Register Student Form Submission (Under 1s execution target)
export async function handleStudentRegistration(e) {
  e.preventDefault();
  
  const nameInput = document.getElementById('regName').value.trim();
  const mobileInput = document.getElementById('regMobile').value.trim();
  const feedbackEl = document.getElementById('regFeedback');
  
  if (feedbackEl) feedbackEl.className = "d-none"; // Reset feedback panel

  // 1. Client-side Input Validations
  if (nameInput.length < 2 || nameInput.length > 50) {
    showToast("Name must be between 2 and 50 characters.", "warning");
    return;
  }

  if (!/^\d{10}$/.test(mobileInput)) {
    showToast("Mobile Number must be exactly 10 digits (numbers only).", "warning");
    return;
  }

  toggleLoader(true, "Submitting Registration...");
  const startTime = Date.now();

  try {
    // Call secure PostgreSQL RPC registration API
    const response = await callRPC('register_student', {
      p_name: nameInput,
      p_mobile: mobileInput
    });

    const duration = Date.now() - startTime;
    console.log(`[Performance] Student registration RPC executed in ${duration}ms`);
    toggleLoader(false);

    if (feedbackEl) {
      if (response.success) {
        feedbackEl.className = "alert alert-success mt-3 shadow-sm";
        feedbackEl.innerHTML = `
          <h4 class="alert-heading h6 fw-bold">🎉 Registration Successful</h4>
          <p class="small mb-0">${response.message}</p>
        `;
        document.getElementById('regForm').reset();
      } else {
        let alertClass = "alert-warning";
        if (response.status === 'Rejected') alertClass = "alert-danger";
        if (response.status === 'Approved') alertClass = "alert-info";

        feedbackEl.className = `alert ${alertClass} mt-3 shadow-sm`;
        feedbackEl.innerHTML = `
          <h4 class="alert-heading h6 fw-bold">⚠️ Notice</h4>
          <p class="small mb-0">${response.message}</p>
        `;
      }
    }
  } catch (err) {
    toggleLoader(false);
    logError("handleStudentRegistration", err);
    showToast("Failed to register. Please try again.", "danger");
  }
}

// Student Login Form Submission (Under 500ms execution target)
export async function handleStudentLogin(e) {
  e.preventDefault();

  const nameInput = document.getElementById('loginName').value.trim();
  const mobileInput = document.getElementById('loginMobile').value.trim();

  // Client-side Input Validations
  if (nameInput.length < 2 || nameInput.length > 50) {
    showToast("Please enter a valid Name.", "warning");
    return;
  }

  if (!/^\d{10}$/.test(mobileInput)) {
    showToast("Please enter a valid 10-digit Mobile Number.", "warning");
    return;
  }

  toggleLoader(true, "Logging in...");
  const startTime = Date.now();

  try {
    // Call secure PostgreSQL RPC login API
    const response = await callRPC('login_student', {
      p_name: nameInput,
      p_mobile: mobileInput
    });

    const duration = Date.now() - startTime;
    console.log(`[Performance] Student login RPC executed in ${duration}ms`);
    toggleLoader(false);

    if (response.success) {
      showToast("Login Successful! Welcome.", "success");
      
      // Save session inside browser cache
      saveStudentSession({
        studentId: response.studentId,
        name: response.name,
        mobileNumber: response.mobileNumber
      });
      
      hideAuthScreen();
      
      // Load hostels data asynchronously
      if (typeof window.loadData === 'function') {
        window.loadData(false);
      }
    } else {
      showToast(response.message, "danger");
    }
  } catch (err) {
    toggleLoader(false);
    logError("handleStudentLogin", err);
    showToast("Unable to login: Connection issue or database is busy.", "danger");
  }
}

// Handle Student Logout
export function handleStudentLogout() {
  clearStudentSession();
  showToast("Logged out successfully.", "info");
}

// Bind to window object for compatibility
window.showAuthScreen = showAuthScreen;
window.hideAuthScreen = hideAuthScreen;
window.handleStudentLogout = handleStudentLogout;

// Initial authentication listeners setup on load
document.addEventListener('DOMContentLoaded', () => {
  const session = getStudentSession();
  
  const regForm = document.getElementById('regForm');
  const loginForm = document.getElementById('loginForm');
  const logoutBtn = document.getElementById('studentLogoutBtn');

  if (regForm) regForm.addEventListener('submit', handleStudentRegistration);
  if (loginForm) loginForm.addEventListener('submit', handleStudentLogin);
  if (logoutBtn) logoutBtn.addEventListener('click', handleStudentLogout);

  if (!session) {
    showAuthScreen();
  } else {
    hideAuthScreen();
  }
});
