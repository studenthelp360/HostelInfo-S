/**
 * Hostels Information Listings Display Controller
 * Fetches listings securely via student session lookups
 * HostelInfo-S (V2)
 */

import { CONFIG_APP } from './config.js';
import { callRPC, showToast, toggleLoader, logError } from './utils.js';
import { getStudentSession } from './auth.js';

// Global state variables
let hostelsData = [];
let deferredPrompt = null;

// DOM Selectors
let searchInput, genderFilter, areaFilter, hostelsContainer;
let resultsCountBadge, errorContainer, installBanner, installBtn, closeInstallBtn;

// Initialize Student listings
document.addEventListener('DOMContentLoaded', () => {
  console.log("[Listings] Initializing Hostels listings modules...");

  searchInput = document.getElementById('searchInput');
  genderFilter = document.getElementById('genderFilter');
  areaFilter = document.getElementById('areaFilter');
  hostelsContainer = document.getElementById('hostelsContainer');
  resultsCountBadge = document.getElementById('resultsCount');
  errorContainer = document.getElementById('errorContainer');
  installBanner = document.getElementById('installBanner');
  installBtn = document.getElementById('installBtn');
  closeInstallBtn = document.getElementById('closeInstallBtn');

  setupEventListeners();
  setupPwaInstallPrompt();
  registerServiceWorker();

  // If student session is active, pre-load listings automatically
  const session = getStudentSession();
  if (session) {
    loadData(false);
  }
});

// Configure event bindings
function setupEventListeners() {
  if (searchInput) {
    searchInput.addEventListener('input', filterAndRender);
  }
  if (genderFilter) {
    genderFilter.addEventListener('change', filterAndRender);
  }
  if (areaFilter) {
    areaFilter.addEventListener('change', filterAndRender);
  }

  const clearBtn = document.getElementById('clearFiltersBtn') || document.getElementById('clearBtn');
  if (clearBtn) {
    clearBtn.addEventListener('click', clearFilters);
  }

  const retryBtn = document.getElementById('retryBtn');
  if (retryBtn) {
    retryBtn.addEventListener('click', retryLoading);
  }
}

// Fetch Hostels (Target: under 300ms)
export async function loadData(force = false) {
  const session = getStudentSession();
  if (!session) {
    showAuthScreen();
    return;
  }

  hideErrorState();
  showLoadingState();

  const startTime = Date.now();
  console.log("Supabase request: get_hostels RPC");

  try {
    // Call secure PostgreSQL RPC to retrieve hostels whitelisted for this active student session
    const response = await callRPC('get_hostels', {
      p_student_id: session.studentId,
      p_mobile: session.mobileNumber
    });

    const duration = Date.now() - startTime;
    console.log(`[Performance] Hostel loading completed in ${duration}ms`);

    hostelsData = response || [];
    populateFilters(hostelsData);
    filterAndRender();
  } catch (err) {
    logError("loadData", err);
    showErrorState();
    showToast("Failed to load hostels list: " + err.message, "danger");
  }
}

// Populate dropdown filters dynamically based on database elements
function populateFilters(data) {
  if (!genderFilter || !areaFilter) return;

  const currentGender = genderFilter.value;
  const currentArea = areaFilter.value;

  // Distinct genders
  const genders = [...new Set(data.map(item => item.gender).filter(Boolean))];
  genders.sort((a, b) => a.localeCompare(b));

  genderFilter.innerHTML = '<option value="All">All</option>';
  genders.forEach(gender => {
    const option = document.createElement('option');
    option.value = gender;
    option.textContent = gender;
    genderFilter.appendChild(option);
  });

  // Distinct areas
  const areas = [...new Set(data.map(item => item.area).filter(Boolean))];
  areas.sort((a, b) => a.localeCompare(b));

  areaFilter.innerHTML = '<option value="All Areas">All Areas</option>';
  areas.forEach(area => {
    const option = document.createElement('option');
    option.value = area;
    option.textContent = area;
    areaFilter.appendChild(option);
  });

  // Restore selection states
  if ([...genderFilter.options].some(opt => opt.value === currentGender)) {
    genderFilter.value = currentGender;
  }
  if ([...areaFilter.options].some(opt => opt.value === currentArea)) {
    areaFilter.value = currentArea;
  }
}

// Local Search Filters (under 10ms execution)
function filterAndRender() {
  if (!hostelsContainer) return;

  const query = searchInput.value.toLowerCase().trim();
  const selectedGender = genderFilter.value;
  const selectedArea = areaFilter.value;

  const filtered = hostelsData.filter(hostel => {
    const matchesSearch = hostel.hostel_name.toLowerCase().includes(query);
    const matchesGender = selectedGender === "All" || hostel.gender === selectedGender;
    const matchesArea = selectedArea === "All Areas" || hostel.area === selectedArea;
    return matchesSearch && matchesGender && matchesArea;
  });

  renderCards(filtered);
}

// Generate listing cards
function renderCards(hostels) {
  hostelsContainer.innerHTML = '';
  if (resultsCountBadge) resultsCountBadge.textContent = hostels.length;

  if (hostels.length === 0) {
    hostelsContainer.innerHTML = `
      <div class="col-12">
        <div class="empty-state">
          <div class="empty-state-icon">🔍</div>
          <h2 class="h5 fw-bold mb-2">No hostels found matching your search.</h2>
          <p class="text-muted mb-0">Try clearing filters or search for another name.</p>
        </div>
      </div>
    `;
    return;
  }

  hostels.forEach(hostel => {
    const imagePath = getImagePath(hostel.photo);
    const genderIcon = hostel.gender === 'Boys' ? '🙋‍♂️' : '🙋‍♀️';
    
    const cardCol = document.createElement('div');
    cardCol.className = 'col-12';
    
    cardCol.innerHTML = `
      <div class="hostel-card">
        <div class="hostel-img-wrapper">
          <img 
            src="${imagePath}" 
            alt="${hostel.hostel_name}" 
            loading="lazy" 
            class="img-lazy"
            onerror="this.onerror=null; this.src='images/placeholder.jpg';"
            onload="this.classList.add('img-loaded');"
          >
        </div>
        <div class="hostel-card-body">
          <div>
            <h2 class="hostel-title">
              <span class="gender-icon">${genderIcon}</span>
              ${hostel.hostel_name}
            </h2>
            <div class="hostel-owner">👤 Owner: ${hostel.owner_name || 'N/A'}</div>
            <div class="hostel-area">📍 Area: ${hostel.area || 'N/A'}</div>
            ${hostel.description ? `<p class="hostel-desc text-muted mt-2 small">${hostel.description}</p>` : ''}
          </div>
          <div class="card-buttons-container mt-2">
            <a href="tel:${hostel.phone}" class="btn-action btn-call" aria-label="Call ${hostel.hostel_name}">
              📞 Call
            </a>
            <a href="${hostel.maps}" target="_blank" rel="noopener noreferrer" class="btn-action btn-map" aria-label="Open ${hostel.hostel_name} in Google Maps">
              🗺️ Map
            </a>
          </div>
        </div>
      </div>
    `;
    hostelsContainer.appendChild(cardCol);
  });
}

// Construct image url using Supabase Storage public path
function getImagePath(photo) {
  if (!photo) return 'images/placeholder.jpg';
  if (photo.startsWith('http://') || photo.startsWith('https://')) {
    return photo;
  }
  const bucketName = 'hostel-photos';
  return `${CONFIG_APP.SUPABASE_URL}/storage/v1/object/public/${bucketName}/${photo}`;
}

// Clear Search input parameters
function clearFilters() {
  if (searchInput) searchInput.value = '';
  if (genderFilter) genderFilter.value = 'All';
  if (areaFilter) areaFilter.value = 'All Areas';
  filterAndRender();
}

// Loading Skeletons layout rendering
function showLoadingState() {
  if (!hostelsContainer) return;
  hostelsContainer.innerHTML = '';
  for (let i = 0; i < 4; i++) {
    const skeleton = document.createElement('div');
    skeleton.className = 'col-12';
    skeleton.innerHTML = `<div class="skeleton-card" style="height: 140px; background: linear-gradient(90deg, #f0f0f0 25%, #e0e0e0 50%, #f0f0f0 75%); background-size: 200% 100%; animation: loading 1.5s infinite; border-radius: 16px; margin-bottom: 16px;"></div>`;
    hostelsContainer.appendChild(skeleton);
  }
}

function showErrorState() {
  if (errorContainer) errorContainer.style.display = 'block';
}

function hideErrorState() {
  if (errorContainer) errorContainer.style.display = 'none';
}

function retryLoading() {
  loadData(true);
}

// PWA banner callbacks
function setupPwaInstallPrompt() {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    if (installBanner && !sessionStorage.getItem('pwa-banner-dismissed')) {
      installBanner.classList.remove('d-none');
    }
  });

  if (installBtn) {
    installBtn.addEventListener('click', async () => {
      if (!deferredPrompt) return;
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      console.log(`User choice outcome: ${outcome}`);
      deferredPrompt = null;
      if (installBanner) installBanner.classList.add('d-none');
    });
  }

  if (closeInstallBtn) {
    closeInstallBtn.addEventListener('click', () => {
      if (installBanner) installBanner.classList.add('d-none');
      sessionStorage.setItem('pwa-banner-dismissed', 'true');
    });
  }

  window.addEventListener('appinstalled', () => {
    console.log('App installed successfully.');
    if (installBanner) installBanner.classList.add('d-none');
    deferredPrompt = null;
  });
}

// Register service worker manifest
function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./service-worker.js')
        .then(reg => console.log('Service Worker registered. Scope:', reg.scope))
        .catch(err => console.warn('Service Worker registration failed:', err));
    });
  }
}

// Bind to window context
window.loadData = loadData;
window.clearFilters = clearFilters;
window.retryLoading = retryLoading;
