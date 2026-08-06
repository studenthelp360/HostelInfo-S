/**
 * Reusable Utilities & Supabase Service Layer
 * HostelInfo-S (V2)
 */

import { CONFIG_APP } from './config.js';

// 1. Initialize Supabase Client (Relies on window.supabase loaded from CDN)
export let supabaseClient = null;

try {
  if (typeof supabase !== 'undefined' && supabase.createClient) {
    supabaseClient = supabase.createClient(CONFIG_APP.SUPABASE_URL, CONFIG_APP.SUPABASE_ANON_KEY);
    console.log("[Supabase] Service Layer initialized successfully.");
  } else {
    console.warn("[Supabase] library CDN not found in DOM yet. Client will be initialized dynamically.");
  }
} catch (err) {
  console.error("[Supabase] Failed to initialize Supabase client:", err);
}

// Fallback dynamic initializer if imported before CDN is ready
export function getSupabase() {
  if (!supabaseClient) {
    if (typeof supabase !== 'undefined' && supabase.createClient) {
      supabaseClient = supabase.createClient(CONFIG_APP.SUPABASE_URL, CONFIG_APP.SUPABASE_ANON_KEY);
    } else {
      throw new Error("Supabase library not loaded. Please verify CDN is active in HTML.");
    }
  }
  return supabaseClient;
}

// 2. Database Service Call Wrapper (with built-in request timeouts to prevent infinite spinners)
export async function callRPC(funcName, params = {}, timeoutMs = 8000) {
  const client = getSupabase();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const { data, error } = await client.rpc(funcName, params, { abortSignal: controller.signal });
    clearTimeout(timeoutId);

    if (error) {
      console.error(`[DB Error] RPC '${funcName}' failed:`, error);
      throw new Error(error.message || "Database action failed.");
    }
    return data;
  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      console.error(`[DB Timeout] RPC '${funcName}' request aborted after ${timeoutMs}ms.`);
      throw new Error("Network Timeout: The server took too long to respond. Please check your connection.");
    }
    console.error(`[DB Exception] RPC '${funcName}':`, err);
    throw err;
  }
}

// 3. UI Toast Notification helper
export function showToast(message, type = 'success') {
  let container = document.getElementById('toastContainer');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toastContainer';
    container.className = 'toast-container position-fixed bottom-0 end-0 p-3';
    container.style.zIndex = '1100';
    document.body.appendChild(container);
  }

  const toastId = 'toast_' + Date.now();
  const bgClass = `bg-${type}`;
  const textClass = type === 'warning' ? 'text-dark' : 'text-white';

  const html = `
    <div id="${toastId}" class="toast align-items-center ${bgClass} ${textClass} border-0 shadow-lg" role="alert" aria-live="assertive" aria-atomic="true" data-bs-delay="4000">
      <div class="d-flex">
        <div class="toast-body fw-medium">
          ${message}
        </div>
        <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast" aria-label="Close"></button>
      </div>
    </div>
  `;

  container.insertAdjacentHTML('beforeend', html);
  
  const toastElement = document.getElementById(toastId);
  if (window.bootstrap && window.bootstrap.Toast) {
    const toast = new window.bootstrap.Toast(toastElement);
    toast.show();
    toastElement.addEventListener('hidden.bs.toast', () => {
      toastElement.remove();
    });
  } else {
    // Console fallback if bootstrap is offline
    console.log(`[Toast Fallback] ${message}`);
  }
}

// 4. Fullscreen Loading Overlay blocker
export function toggleLoader(show, msg = "Processing...") {
  let loader = document.getElementById('appLoaderOverlay');
  
  if (show) {
    if (!loader) {
      loader = document.createElement('div');
      loader.id = 'appLoaderOverlay';
      loader.className = 'position-fixed top-0 start-0 w-100 h-100 d-flex flex-column align-items-center justify-content-center bg-white bg-opacity-75';
      loader.style.zIndex = '2000';
      loader.innerHTML = `
        <div class="spinner-border text-primary" style="width: 3rem; height: 3rem;" role="status">
          <span class="visually-hidden">Loading...</span>
        </div>
        <div class="mt-3 fw-bold text-primary text-center px-3" id="loaderMessage">${msg}</div>
      `;
      document.body.appendChild(loader);
    } else {
      document.getElementById('loaderMessage').textContent = msg;
      loader.classList.remove('d-none');
    }
  } else {
    if (loader) {
      loader.classList.add('d-none');
    }
  }
}

// 5. Shared Error Logger utility
export function logError(context, err) {
  const errMsg = err.message || err.toString();
  console.error(`[Error Log] Context: ${context} | Message: ${errMsg}`, err);
}
