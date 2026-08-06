/**
 * Authentication and Session Management
 * Student Inactivity & Admin OAuth Whitelist Protection
 * HostelInfo-S (V2)
 */

import { supabaseClient, showToast, logError } from './utils.js';

const STUDENT_SESSION_KEY = 'hostel_student_session';
const TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
const ACTIVITY_EVENTS = ['click', 'keypress', 'scroll', 'touchstart', 'mousemove'];

// Determine path context
const isSettingAdmin = window.location.pathname.includes('admin.html') || window.location.pathname.includes('/admin');

if (!isSettingAdmin) {
  // Start inactivity watchdog on load for student views
  document.addEventListener('DOMContentLoaded', () => {
    if (getStudentSession()) {
      setupActivityListeners();
      setInterval(checkTimeout, 10000); // Check every 10 seconds
    }
  });
}

// Save Student Session parameters
export function saveStudentSession(studentData) {
  const sessionObj = {
    studentId: studentData.studentId,
    name: studentData.name,
    mobileNumber: studentData.mobileNumber,
    loginTime: Date.now()
  };
  sessionStorage.setItem(STUDENT_SESSION_KEY, JSON.stringify(sessionObj));
  setupActivityListeners();
  console.log("[AuthManager] Student session saved:", studentData.studentId);
}

// Retrieve Student Session details
export function getStudentSession() {
  const sessionStr = sessionStorage.getItem(STUDENT_SESSION_KEY);
  if (!sessionStr) return null;
  try {
    return JSON.parse(sessionStr);
  } catch (e) {
    return null;
  }
}

// Clear Student Session and reload
export function clearStudentSession() {
  sessionStorage.removeItem(STUDENT_SESSION_KEY);
  removeActivityListeners();
  console.log("[AuthManager] Student session cleared.");
  
  if (typeof window.showAuthScreen === 'function') {
    window.showAuthScreen();
  } else {
    window.location.reload();
  }
}

function refreshSessionTime() {
  const session = getStudentSession();
  if (session) {
    session.loginTime = Date.now();
    sessionStorage.setItem(STUDENT_SESSION_KEY, JSON.stringify(session));
  }
}

function checkTimeout() {
  const session = getStudentSession();
  if (!session) return;

  const idleTime = Date.now() - session.loginTime;
  if (idleTime > TIMEOUT_MS) {
    console.log("[AuthManager] Student inactivity limit reached. Logging out...");
    clearStudentSession();
    setTimeout(() => {
      showToast("Session expired due to inactivity. Please login again.", "warning");
    }, 500);
  }
}

function setupActivityListeners() {
  ACTIVITY_EVENTS.forEach(ev => {
    document.addEventListener(ev, refreshSessionTime, { passive: true });
  });
}

function removeActivityListeners() {
  ACTIVITY_EVENTS.forEach(ev => {
    document.removeEventListener(ev, refreshSessionTime);
  });
}

// Bind to window object to preserve V1 HTML inline script calls compatibility
window.saveStudentSession = saveStudentSession;
window.getStudentSession = getStudentSession;
window.clearStudentSession = clearStudentSession;

// =========================================================================
// ADMIN AUTHENTICATION UTILITIES (Supabase OAuth)
// =========================================================================

// Trigger Admin Google OAuth redirect
export async function triggerAdminGoogleLogin() {
  try {
    const currentLoc = window.location.href;
    // Replace current page with admin.html to handle post-login redirection
    let redirectUrl = window.location.origin + window.location.pathname;
    if (redirectUrl.endsWith('index.html')) {
      redirectUrl = redirectUrl.replace('index.html', 'admin.html');
    } else if (!redirectUrl.endsWith('admin.html')) {
      redirectUrl = redirectUrl.endsWith('/') ? redirectUrl + 'admin.html' : redirectUrl + '/admin.html';
    }
    
    console.log("[AuthManager] Redirecting for Google Sign-In to URL:", redirectUrl);

    const { error } = await supabaseClient.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: redirectUrl
      }
    });

    if (error) throw error;
  } catch (err) {
    logError("triggerAdminGoogleLogin", err);
    showToast("Google Authentication failed to start: " + err.message, "danger");
  }
}

// Admin logout
export async function triggerAdminLogout() {
  try {
    const { error } = await supabaseClient.auth.signOut();
    if (error) throw error;
    sessionStorage.removeItem('admin_verified_email');
    window.location.reload();
  } catch (err) {
    logError("triggerAdminLogout", err);
    window.location.reload();
  }
}

// Verify Admin Session whitelist permission status
export async function verifyAdminSession() {
  try {
    // 1. Check active authenticated session in Supabase Auth
    const { data: { session }, error } = await supabaseClient.auth.getSession();
    if (error) throw error;

    if (!session || !session.user) {
      console.log("[AuthManager] No active Google session.");
      return null;
    }

    const email = session.user.email;
    
    // Check local session cache for faster refreshes
    const cachedEmail = sessionStorage.getItem('admin_verified_email');
    if (cachedEmail && cachedEmail.toLowerCase() === email.toLowerCase()) {
      return { email, verified: true };
    }

    // 2. Perform Whitelist verify lookup in database
    const { data, error: dbError } = await supabaseClient
      .from('admins')
      .select('email')
      .eq('email', email.toLowerCase().trim())
      .maybeSingle();

    if (dbError) throw dbError;

    if (!data) {
      console.warn(`[AuthManager] Whitelist Block: '${email}' is not whitelisted.`);
      // Terminate auth session instantly
      await supabaseClient.auth.signOut();
      sessionStorage.removeItem('admin_verified_email');
      return { email, verified: false, error: "Access Denied: You are not an authorized administrator." };
    }

    // Cache verified state locally
    sessionStorage.setItem('admin_verified_email', email);
    return { email, verified: true };
  } catch (err) {
    logError("verifyAdminSession", err);
    return { email: null, verified: false, error: "Authentication validation failed: " + err.message };
  }
}
