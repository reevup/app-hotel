/* =====================================================
   HÔTEL LE GRAND PALAIS — admin.js
   ===================================================== */
'use strict';

function sanitize(s) {
  if (typeof s !== 'string') return String(s);
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

async function hashPassword(pass) {
  const enc = new TextEncoder().encode(pass);
  const buf = await crypto.subtle.digest('SHA-256', enc);
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

const ADMIN_PASS_LEGACY = 'grandpalais2026'; // fallback for demo
const LS_KEY     = 'gp_reservations';

const STATUS_LABELS = {
  pending:   'En attente',
  confirmed: 'Confirmée',
  checkin:   'En cours',
  checkout:  'Départ',
  cancelled: 'Annulée',
};

const STATUS_NEXT = {
  pending:   ['confirmed', 'cancelled'],
  confirmed: ['checkin',   'cancelled'],
  checkin:   ['checkout'],
  checkout:  [],
  cancelled: [],
};

const OPTIONS_LABELS = {
  breakfast:    { icon: '☕', label: 'Petit-déjeuner' },
  pets:         { icon: '🐾', label: 'Animaux' },
  transfer:     { icon: '🚘', label: 'Transfert' },
  latecheckout: { icon: '🕐', label: 'Late check-out' },
  romantic:     { icon: '🌹', label: 'Romantique' },
  breakfastbed: { icon: '🛏', label: 'BF en chambre' },
};

const ROOM_PRICES = { 'Chambre Classique': 450, 'Chambre Deluxe': 650, 'Suite Junior': 950, 'Suite Prestige': 1800, 'Suite Royale': 3500 };
const CONV_LS_KEY = 'gp_conversations';
const TEAM_LS_KEY = 'gp_team';
const INVENTORY_LS_KEY = 'gp_room_inventory';
const ROLE_LABELS = { admin: 'Administrateur', manager: 'Manager', staff: 'Personnel' };
const DEFAULT_INVENTORY = {
  'Chambre Classique': { count: 5, capacity: 2 },
  'Chambre Deluxe':    { count: 4, capacity: 3 },
  'Suite Junior':      { count: 3, capacity: 3 },
  'Suite Prestige':    { count: 2, capacity: 4 },
  'Suite Royale':      { count: 1, capacity: 6 }
};

function getRoomInventory() {
  const stored = localStorage.getItem(INVENTORY_LS_KEY);
  if (stored) return JSON.parse(stored);
  return JSON.parse(JSON.stringify(DEFAULT_INVENTORY));
}
function saveRoomInventory(inv) { localStorage.setItem(INVENTORY_LS_KEY, JSON.stringify(inv)); }

/* ---- State ---- */
let currentFilter = 'all';
let searchQuery   = '';
let currentView   = 'dashboard';
let calYear, calMonth;
let confirmCallback = null;
let loginAttempts = parseInt(sessionStorage.getItem('gp_login_attempts') || '0');
let loginLockUntil = parseInt(sessionStorage.getItem('gp_login_lock') || '0');
let convFilter = 'active';
let selectedConvId = null;
let convPollInterval = null;

/* =====================================================
   AUTH
   ===================================================== */
const loginScreen = document.getElementById('loginScreen');
const adminPanel  = document.getElementById('adminPanel');
const loginForm   = document.getElementById('loginForm');
const loginError  = document.getElementById('loginError');

// Auto-login if stored
if (sessionStorage.getItem('gp_admin_auth') === '1') showAdmin();

loginForm?.addEventListener('submit', async e => {
  e.preventDefault();
  const now = Date.now();
  if (now < loginLockUntil) {
    const secs = Math.ceil((loginLockUntil - now) / 1000);
    loginError.textContent = `Trop de tentatives. Réessayez dans ${secs}s.`;
    return;
  }
  const emailInput = document.getElementById('login-email')?.value.trim().toLowerCase();
  const pass = document.getElementById('login-pass')?.value;
  const hash = await hashPassword(pass);
  // Check against team members first, then legacy
  const team = JSON.parse(localStorage.getItem('gp_team') || '[]');
  const member = emailInput
    ? team.find(m => m.email.toLowerCase() === emailInput && m.passwordHash === hash && m.active)
    : team.find(m => m.passwordHash === hash && m.active);
  if (member) {
    sessionStorage.setItem('gp_admin_auth', '1');
    sessionStorage.setItem('gp_admin_user', JSON.stringify({ id: member.id, name: member.name, role: member.role }));
    loginAttempts = 0;
    sessionStorage.removeItem('gp_login_attempts');
    sessionStorage.removeItem('gp_login_lock');
    showAdmin();
  } else if (pass === ADMIN_PASS_LEGACY) {
    sessionStorage.setItem('gp_admin_auth', '1');
    sessionStorage.setItem('gp_admin_user', JSON.stringify({ id: 'legacy', name: 'Directeur', role: 'admin' }));
    loginAttempts = 0;
    sessionStorage.removeItem('gp_login_attempts');
    sessionStorage.removeItem('gp_login_lock');
    showAdmin();
  } else {
    loginAttempts++;
    sessionStorage.setItem('gp_login_attempts', loginAttempts.toString());
    if (loginAttempts >= 5) {
      loginLockUntil = now + 30000;
      sessionStorage.setItem('gp_login_lock', loginLockUntil.toString());
      loginError.textContent = 'Trop de tentatives. Compte verrouillé 30 secondes.';
    } else {
      loginError.textContent = `Mot de passe incorrect. (${5 - loginAttempts} essai(s) restant(s))`;
    }
    document.getElementById('login-pass').value = '';
    document.getElementById('login-pass').focus();
  }
});

function showAdmin() {
  loginScreen.style.display = 'none';
  adminPanel.hidden = false;
  document.body.style.overflow = '';
  init();
}

function logout() {
  sessionStorage.removeItem('gp_admin_auth');
  location.reload();
}

/* =====================================================
   INIT
   ===================================================== */
function init() {
  setTopbarDate();
  updateTopbarUser();
  seedDefaultTeam();
  renderDashboard();
  renderReservationsTable();
  updatePendingBadge();
  updateChatBadgeAdmin();
  applyRoleRestrictions();

  const now = new Date();
  calYear  = now.getFullYear();
  calMonth = now.getMonth();

  // Poll chat badge every 5s
  setInterval(updateChatBadgeAdmin, 5000);
}

function updateTopbarUser() {
  try {
    const u = JSON.parse(sessionStorage.getItem('gp_admin_user') || '{}');
    if (u.name) {
      const nameEl = document.getElementById('topbarUserName');
      const roleEl = document.getElementById('topbarUserRole');
      const avatarEl = document.getElementById('topbarAvatar');
      if (nameEl) nameEl.textContent = u.name;
      if (roleEl) roleEl.textContent = ROLE_LABELS[u.role] || u.role;
      if (avatarEl) avatarEl.textContent = u.name.split(' ').map(w => w[0]).join('').toUpperCase().substring(0, 2);
    }
  } catch(_) {}
}

function seedDefaultTeam() {
  const team = JSON.parse(localStorage.getItem(TEAM_LS_KEY) || '[]');
  if (team.length === 0) {
    // We'll seed on first addCollaborator; no hash available synchronously
  }
}

function applyRoleRestrictions() {
  try {
    const u = JSON.parse(sessionStorage.getItem('gp_admin_user') || '{}');
    const navItems = document.querySelectorAll('.nav-item[data-view]');
    navItems.forEach(item => {
      const view = item.dataset.view;
      if (u.role === 'staff' && (view === 'reports' || view === 'team' || view === 'inventory' || view === 'roomeditor' || view === 'activity')) item.style.display = 'none';
      if (u.role === 'manager' && view === 'team') item.style.display = 'none';
    });
  } catch(_) {}
}

function setTopbarDate() {
  const el = document.getElementById('topbarDate');
  if (el) el.textContent = new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

/* =====================================================
   DATA
   ===================================================== */
function getReservations() {
  return JSON.parse(localStorage.getItem(LS_KEY) || '[]');
}

function saveReservations(arr) {
  localStorage.setItem(LS_KEY, JSON.stringify(arr));
}

function updateStatus(id, newStatus) {
  const all = getReservations();
  const idx = all.findIndex(r => r.id === id);
  if (idx === -1) return;
  all[idx].status = newStatus;
  saveReservations(all);
  renderDashboard();
  renderReservationsTable();
  updatePendingBadge();
  if (currentView === 'calendar') renderCalendar();
  if (currentView === 'rooms') renderRooms();
  if (currentView === 'reports') renderReports();
  if (typeof logActivity === 'function') logActivity('reservation', `Statut de ${id} → ${STATUS_LABELS[newStatus]}`, id);
}

function deleteReservation(id) {
  if (typeof logActivity === 'function') logActivity('reservation', `Réservation ${id} supprimée`, id);
  const all = getReservations().filter(r => r.id !== id);
  saveReservations(all);
  renderDashboard();
  renderReservationsTable();
  updatePendingBadge();
}

/* =====================================================
   VIEWS
   ===================================================== */
function showView(name, el) {
  if (el?.preventDefault) el.preventDefault();
  currentView = name;

  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  const target = document.getElementById('view-' + name);
  if (target) target.classList.add('active');

  document.querySelectorAll('.nav-item').forEach(a => {
    a.classList.toggle('active', a.dataset.view === name);
  });

  const titles = { dashboard: 'Tableau de bord', reservations: 'Réservations', calendar: 'Calendrier', rooms: 'Chambres', inventory: 'Inventaire Chambres', roomeditor: 'Fiches Chambres', reports: 'Rapports', conversations: 'Conversations', team: 'Équipe', activity: 'Historique' };
  const titleEl = document.getElementById('topbarTitle');
  if (titleEl) titleEl.textContent = titles[name] || '';

  if (name === 'calendar') renderCalendar();
  if (name === 'rooms') renderRooms();
  if (name === 'inventory') renderInventory();
  if (name === 'reports') renderReports();
  if (name === 'conversations') { renderConversations(); startConvPolling(); }
  else { stopConvPolling(); }
  if (name === 'team') renderTeam();
  if (name === 'roomeditor') renderRoomEditor();
  if (name === 'activity') renderActivityLog();

  // Close sidebar on mobile
  document.getElementById('sidebar')?.classList.remove('open');
  return false;
}

function toggleSidebar() {
  document.getElementById('sidebar')?.classList.toggle('open');
}

/* =====================================================
   DASHBOARD
   ===================================================== */
function renderDashboard() {
  const all = getReservations();

  // Stats
  const pending   = all.filter(r => r.status === 'pending').length;
  const confirmed = all.filter(r => r.status === 'confirmed').length;
  const inhouse   = all.filter(r => r.status === 'checkin').length;
  const checkouts = all.filter(r => r.status === 'checkout' && isToday(r.checkout)).length;
  const revenue   = all.filter(r => r.status !== 'cancelled').reduce((s, r) => s + (r.totalPrice || 0), 0);

  setText('s-total',    all.length);
  setText('s-pending',  pending);
  setText('s-confirmed', confirmed);
  setText('s-inhouse',  inhouse);
  setText('s-revenue',  revenue.toLocaleString('fr-FR') + ' €');
  setText('s-checkout', checkouts);

  // Recent list
  const recentEl = document.getElementById('recentList');
  if (recentEl) {
    const recent = [...all].slice(0, 5);
    if (recent.length === 0) {
      recentEl.innerHTML = '<p style="font-size:.8rem;color:var(--text-faint);text-align:center;padding:20px">Aucune réservation</p>';
    } else {
      recentEl.innerHTML = recent.map(r => `
        <div class="recent-item" onclick="openResModal('${sanitize(r.id)}')">
          <div class="recent-avatar">${sanitize(r.firstname[0])}${sanitize(r.lastname[0])}</div>
          <div class="recent-info">
            <div class="recent-name">${sanitize(r.firstname)} ${sanitize(r.lastname)}</div>
            <div class="recent-room">${sanitize(r.room)} · ${sanitize(r.checkin)}</div>
          </div>
          <div class="recent-price">${(r.totalPrice || 0).toLocaleString('fr-FR')} €</div>
          <span class="status-badge status-${r.status}">${STATUS_LABELS[r.status]}</span>
        </div>
      `).join('');
    }
  }

  // Status chart
  const chartEl = document.getElementById('statusChart');
  if (chartEl) {
    const counts = { pending, confirmed, inhouse: all.filter(r=>r.status==='checkin').length, checkout: all.filter(r=>r.status==='checkout').length, cancelled: all.filter(r=>r.status==='cancelled').length };
    const max = Math.max(...Object.values(counts), 1);
    const bars = [
      { label: 'En attente',  count: counts.pending,   color: '#f59e0b' },
      { label: 'Confirmées',  count: counts.confirmed,  color: '#60a5fa' },
      { label: 'En cours',    count: counts.inhouse,    color: '#4ade80' },
      { label: 'Départ',      count: counts.checkout,   color: '#c084fc' },
      { label: 'Annulées',    count: counts.cancelled,  color: '#f87171' },
    ];
    chartEl.innerHTML = bars.map(b => `
      <div class="chart-bar-row">
        <span class="chart-bar-label">${b.label}</span>
        <div class="chart-bar-track"><div class="chart-bar-fill" style="width:${b.count/max*100}%;background:${b.color}"></div></div>
        <span class="chart-bar-count">${b.count}</span>
      </div>
    `).join('');
  }

  // Options chart
  const optsEl = document.getElementById('optionsChart');
  if (optsEl) {
    const optCounts = {};
    all.filter(r => r.status !== 'cancelled').forEach(r => {
      if (r.options) Object.entries(r.options).forEach(([k, v]) => { if (v) optCounts[k] = (optCounts[k] || 0) + 1; });
    });
    const maxOpt = Math.max(...Object.values(optCounts), 1);
    optsEl.innerHTML = Object.entries(OPTIONS_LABELS).map(([k, cfg]) => {
      const c = optCounts[k] || 0;
      return `<div class="opt-row"><span class="opt-label">${cfg.icon} ${cfg.label}</span><div class="opt-bar-wrap"><div class="opt-bar" style="width:${c/maxOpt*100}%"></div></div><span class="opt-count">${c}</span></div>`;
    }).join('');
  }

  // Room revenue
  const revEl = document.getElementById('roomRevenueChart');
  if (revEl) {
    const revByRoom = {};
    all.filter(r => r.status !== 'cancelled').forEach(r => {
      revByRoom[r.room] = (revByRoom[r.room] || 0) + (r.totalPrice || 0);
    });
    const maxRev = Math.max(...Object.values(revByRoom), 1);
    revEl.innerHTML = Object.entries(ROOM_PRICES).map(([name]) => {
      const v = revByRoom[name] || 0;
      return `<div class="rev-row"><span class="rev-label">${name.replace('Chambre ','').replace('Suite ','')}</span><div class="rev-bar-wrap"><div class="rev-bar" style="width:${v/maxRev*100}%"></div></div><span class="rev-amount">${v > 0 ? v.toLocaleString('fr-FR')+'€' : '—'}</span></div>`;
    }).join('');
  }

  // Staff ratings
  renderStaffRatings();

  // Today's movements
  renderTodayMovements();
}

/* =====================================================
   STAFF RATINGS CHART
   ===================================================== */
function renderStaffRatings() {
  const el = document.getElementById('staffRatingsChart');
  if (!el) return;
  const convs = getConversations();
  const rated = convs.filter(c => c.rating !== null && c.rating !== undefined);

  // Aggregate ratings by admin
  const ratingsByAdmin = {};
  rated.forEach(c => {
    const adminId = c.adminId || 'legacy';
    const adminName = c.adminName || 'Directeur';
    if (!ratingsByAdmin[adminId]) ratingsByAdmin[adminId] = { name: adminName, ratings: [], weeklyData: {} };
    ratingsByAdmin[adminId].ratings.push(c.rating);
    // Weekly grouping
    const d = new Date(c.messages[c.messages.length - 1]?.timestamp || c.createdAt);
    const weekKey = getWeekKey(d);
    if (!ratingsByAdmin[adminId].weeklyData[weekKey]) ratingsByAdmin[adminId].weeklyData[weekKey] = [];
    ratingsByAdmin[adminId].weeklyData[weekKey].push(c.rating);
  });

  if (Object.keys(ratingsByAdmin).length === 0) {
    el.innerHTML = '<p style="font-size:.8rem;color:var(--text-faint);text-align:center;padding:20px">Aucune note reçue pour le moment</p>';
    return;
  }

  // Build user cards + mini chart
  el.innerHTML = Object.entries(ratingsByAdmin).map(([id, data]) => {
    const avg = (data.ratings.reduce((a, b) => a + b, 0) / data.ratings.length).toFixed(1);
    const stars = '★'.repeat(Math.round(avg)) + '☆'.repeat(5 - Math.round(avg));
    const initials = data.name.split(' ').map(w => w[0]).join('').toUpperCase().substring(0, 2);

    // Weekly chart (last 8 weeks)
    const weeks = getLast8Weeks();
    const weekAvgs = weeks.map(w => {
      const vals = data.weeklyData[w] || [];
      return vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
    });
    const maxH = 40;
    const bars = weekAvgs.map((v, i) => {
      if (v === null) return `<div class="rating-week-bar" title="${weeks[i]}"><div class="rwb-fill" style="height:0"></div><div class="rwb-label">—</div></div>`;
      const h = (v / 5) * maxH;
      const color = v >= 4 ? '#4ade80' : v >= 3 ? '#f59e0b' : '#f87171';
      return `<div class="rating-week-bar" title="${weeks[i]}"><div class="rwb-fill" style="height:${h}px;background:${color}"></div><div class="rwb-label">${v.toFixed(1)}</div></div>`;
    }).join('');

    return `
      <div class="staff-rating-card">
        <div class="sr-header">
          <div class="team-avatar" style="width:36px;height:36px;font-size:.7rem">${sanitize(initials)}</div>
          <div class="sr-info">
            <div class="sr-name">${sanitize(data.name)}</div>
            <div class="sr-stars" style="color:#c9a84c">${stars} <span style="color:var(--text-faint);font-size:.75rem">${avg}/5 (${data.ratings.length} avis)</span></div>
          </div>
        </div>
        <div class="sr-weekly-chart">${bars}</div>
        <div class="sr-week-labels">${weeks.map(w => `<span>${w.split('-W')[1]}</span>`).join('')}</div>
      </div>`;
  }).join('');
}

function getWeekKey(date) {
  const d = new Date(date);
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
  return d.getUTCFullYear() + '-W' + String(weekNo).padStart(2, '0');
}

function getLast8Weeks() {
  const weeks = [];
  const now = new Date();
  for (let i = 7; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i * 7);
    weeks.push(getWeekKey(d));
  }
  return weeks;
}

/* =====================================================
   RESERVATIONS TABLE
   ===================================================== */
function filterReservations(filter, btn) {
  currentFilter = filter;
  document.querySelectorAll('.filter-tab').forEach(t => t.classList.remove('active'));
  btn.classList.add('active');
  renderReservationsTable();
}

function searchReservations(q) {
  searchQuery = q.toLowerCase();
  renderReservationsTable();
}

function renderReservationsTable() {
  const all = getReservations();
  let filtered = all;

  if (currentFilter !== 'all') filtered = filtered.filter(r => r.status === currentFilter);
  if (searchQuery) {
    filtered = filtered.filter(r =>
      (r.firstname + ' ' + r.lastname).toLowerCase().includes(searchQuery) ||
      r.email?.toLowerCase().includes(searchQuery) ||
      r.id?.toLowerCase().includes(searchQuery) ||
      r.room?.toLowerCase().includes(searchQuery)
    );
  }

  const tbody  = document.getElementById('reservationsBody');
  const empty  = document.getElementById('emptyState');
  if (!tbody) return;

  if (filtered.length === 0) {
    tbody.innerHTML = '';
    if (empty) empty.hidden = false;
    return;
  }
  if (empty) empty.hidden = true;

  tbody.innerHTML = filtered.map(r => {
    const opts = r.options || {};
    const optIcons = Object.entries(OPTIONS_LABELS).map(([k, cfg]) =>
      `<span class="opt-icon ${opts[k] ? '' : 'opt-icon-off'}" title="${cfg.label}">${cfg.icon}</span>`
    ).join('');

    const actions = buildActionButtons(r);

    return `
      <tr onclick="openResModal('${sanitize(r.id)}')">
        <td><span class="res-id">${sanitize(r.id)}</span></td>
        <td>
          <div class="res-guest">
            <span class="res-guest-name">${sanitize(r.firstname)} ${sanitize(r.lastname)}</span>
            <span class="res-guest-email">${sanitize(r.email || '')}</span>
          </div>
        </td>
        <td>${sanitize(r.room || '—')}</td>
        <td>${fmtDate(r.checkin)}</td>
        <td>${fmtDate(r.checkout)}</td>
        <td style="text-align:center">${r.nights || '—'}</td>
        <td style="text-align:center">${r.guests || 1}</td>
        <td><div class="options-icons">${optIcons}</div></td>
        <td><span class="price-cell">${(r.totalPrice || 0).toLocaleString('fr-FR')} €</span></td>
        <td><span class="status-badge status-${r.status}">${STATUS_LABELS[r.status]}</span></td>
        <td onclick="event.stopPropagation()"><div class="action-btns">${actions}</div></td>
      </tr>
    `;
  }).join('');
}

function buildActionButtons(r) {
  const sid = sanitize(r.id);
  let btns = `<button class="action-btn action-btn-view" onclick="openResModal('${sid}')">Voir</button>`;
  if (r.status === 'pending') {
    btns += `<button class="action-btn action-btn-confirm" onclick="quickStatus('${sid}','confirmed')">Confirmer</button>`;
    btns += `<button class="action-btn action-btn-cancel"  onclick="confirmAction('Annuler cette réservation ?', () => quickStatus('${sid}','cancelled'))">Annuler</button>`;
  }
  if (r.status === 'confirmed') {
    btns += `<button class="action-btn action-btn-checkin" onclick="quickStatus('${sid}','checkin')">Check-in</button>`;
    btns += `<button class="action-btn action-btn-cancel"  onclick="confirmAction('Annuler cette réservation ?', () => quickStatus('${sid}','cancelled'))">Annuler</button>`;
  }
  if (r.status === 'checkin') {
    btns += `<button class="action-btn action-btn-checkin" onclick="quickStatus('${sid}','checkout')">Check-out</button>`;
  }
  return btns;
}

function quickStatus(id, status) {
  updateStatus(id, status);
  showAdminToast(`Statut mis à jour → ${STATUS_LABELS[status]}`);
}

function updatePendingBadge() {
  const count = getReservations().filter(r => r.status === 'pending').length;
  const badge = document.getElementById('pendingBadge');
  if (badge) {
    badge.textContent = count;
    badge.classList.toggle('visible', count > 0);
  }
}

/* =====================================================
   RESERVATION DETAIL MODAL
   ===================================================== */
function openResModal(id) {
  const r = getReservations().find(x => x.id === id);
  if (!r) return;

  const opts = r.options || {};
  const canEdit = r.status !== 'cancelled' && r.status !== 'checkout';
  const optChips = Object.entries(OPTIONS_LABELS).map(([k, cfg]) => {
    const active = opts[k];
    if (canEdit) {
      return `<span class="modal-opt-chip ${active ? 'active' : 'inactive'}" style="cursor:pointer" onclick="event.stopPropagation();toggleResOption('${sanitize(r.id)}','${k}')" title="Cliquer pour ${active ? 'retirer' : 'ajouter'}">${cfg.icon} ${cfg.label}</span>`;
    }
    return `<span class="modal-opt-chip ${active ? 'active' : 'inactive'}">${cfg.icon} ${cfg.label}</span>`;
  }).join('');

  const nextStatuses = STATUS_NEXT[r.status] || [];
  const statusOptions = nextStatuses.map(s => `<option value="${s}">${STATUS_LABELS[s]}</option>`).join('');
  const hasActions = nextStatuses.length > 0;

  const sid = sanitize(r.id);
  document.getElementById('resModalContent').innerHTML = `
    <div class="modal-res-header">
      <div>
        <div class="modal-res-id">${sid} · Créé le ${fmtDateFull(r.createdAt)}</div>
        <div class="modal-res-name">${sanitize(r.firstname)} ${sanitize(r.lastname)}</div>
        <div class="modal-res-email">${sanitize(r.email || '')} ${r.phone ? '· ' + sanitize(r.phone) : ''}</div>
      </div>
      <span class="status-badge status-${r.status}">${STATUS_LABELS[r.status]}</span>
    </div>

    <div class="modal-res-grid">
      <div class="modal-info-item">
        <div class="modal-info-label">Chambre</div>
        <div class="modal-info-value">${sanitize(r.room)}</div>
      </div>
      <div class="modal-info-item">
        <div class="modal-info-label">Voyageurs</div>
        <div class="modal-info-value">${r.guests} adulte${r.guests > 1 ? 's' : ''}</div>
      </div>
      <div class="modal-info-item">
        <div class="modal-info-label">Arrivée</div>
        <div class="modal-info-value">${fmtDate(r.checkin)}</div>
      </div>
      <div class="modal-info-item">
        <div class="modal-info-label">Départ</div>
        <div class="modal-info-value">${fmtDate(r.checkout)}</div>
      </div>
      <div class="modal-info-item">
        <div class="modal-info-label">Durée</div>
        <div class="modal-info-value">${r.nights} nuit${r.nights > 1 ? 's' : ''}</div>
      </div>
      <div class="modal-info-item">
        <div class="modal-info-label">Total</div>
        <div class="modal-info-value gold">${(r.totalPrice || 0).toLocaleString('fr-FR')} €</div>
      </div>
      <div class="modal-info-item">
        <div class="modal-info-label">Prix / nuit</div>
        <div class="modal-info-value">${(r.pricePerNight || 0).toLocaleString('fr-FR')} €</div>
      </div>
      <div class="modal-info-item">
        <div class="modal-info-label">Source</div>
        <div class="modal-info-value">${r.source === 'modal' ? 'Réservation rapide' : 'Formulaire complet'}</div>
      </div>
    </div>

    <div class="modal-options-section">
      <h4>Options demandées ${canEdit ? '<span style="font-size:.7rem;color:var(--text-faint);font-weight:400">(cliquer pour modifier)</span>' : ''}</h4>
      <div class="modal-opts-list">${optChips}</div>
    </div>

    ${r.requests ? `
    <div class="modal-requests">
      <div class="modal-requests-label">Demandes spéciales</div>
      <div class="modal-requests-text">"${sanitize(r.requests)}"</div>
    </div>` : ''}

    <div class="modal-notes-section">
      <h4>Notes internes <span style="font-size:.7rem;color:var(--text-faint);font-weight:400">(visibles uniquement par l'équipe)</span></h4>
      <div id="resNotesList-${sid}" class="res-notes-list"></div>
      <div class="note-input-row">
        <input type="text" id="noteInput-${sid}" class="note-input" placeholder="Ajouter une note…" onkeydown="if(event.key==='Enter'){event.preventDefault();addResNote('${sid}')}" />
        <button class="btn-admin-sm" onclick="addResNote('${sid}')">Ajouter</button>
      </div>
    </div>

    <div class="modal-actions">
      <button class="btn-admin-secondary" onclick="generateInvoice('${sid}')" title="Générer une facture">🧾 Facture</button>
      ${hasActions ? `
        <div class="modal-status-select">
          <select id="modalStatusSel">
            <option value="">— Changer le statut —</option>
            ${statusOptions}
          </select>
        </div>
        <button class="btn-admin-save" onclick="applyModalStatus('${sid}')">Appliquer</button>
      ` : ''}
      <button class="btn-admin-danger" onclick="confirmAction('Supprimer définitivement cette réservation ?', () => { deleteReservation('${sid}'); closeResModal(); })">Supprimer</button>
    </div>
  `;

  document.getElementById('resModalTitle')?.remove();
  const modal = document.getElementById('resModal');
  modal.classList.add('open');
  modal.setAttribute('aria-hidden', 'false');
  renderResNotes(r.id);
}

function applyModalStatus(id) {
  const sel = document.getElementById('modalStatusSel');
  if (!sel || !sel.value) return;
  updateStatus(id, sel.value);
  closeResModal();
  showAdminToast(`Statut mis à jour → ${STATUS_LABELS[sel.value]}`);
}

function closeResModal() {
  const modal = document.getElementById('resModal');
  modal.classList.remove('open');
  modal.setAttribute('aria-hidden', 'true');
}

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    closeResModal();
    closeNewResModal();
    closeConfirm();
  }
});

/* =====================================================
   NEW RESERVATION (admin-created)
   ===================================================== */
function openNewResModal() {
  const modal = document.getElementById('newResModal');
  if (!modal) return;

  // Populate room select from room details (includes custom rooms)
  const roomSel = document.getElementById('nres-room');
  if (roomSel) {
    const details = getRoomDetails();
    roomSel.innerHTML = Object.entries(details).map(([name, d]) =>
      `<option value="${name}">${name} — ${(d.price || 0).toLocaleString('fr-FR')} €/nuit</option>`
    ).join('');
  }

  // Populate options checkboxes
  const optGrid = document.getElementById('nresOptionsGrid');
  if (optGrid) {
    optGrid.innerHTML = Object.entries(OPTIONS_LABELS).map(([k, cfg]) =>
      `<label class="nres-opt-item" onclick="this.classList.toggle('active')">
        <input type="checkbox" name="opt-${k}" value="${k}" onchange="updateNewResPrice()" />
        <span class="nres-opt-label">${cfg.icon} ${cfg.label}</span>
      </label>`
    ).join('');
  }

  // Set default dates
  const today = new Date().toISOString().split('T')[0];
  const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0];
  const ciEl = document.getElementById('nres-checkin');
  const coEl = document.getElementById('nres-checkout');
  if (ciEl) ciEl.value = today;
  if (coEl) coEl.value = tomorrow;

  modal.classList.add('open');
  modal.setAttribute('aria-hidden', 'false');
  updateNewResPrice();
}

function closeNewResModal() {
  const modal = document.getElementById('newResModal');
  if (!modal) return;
  modal.classList.remove('open');
  modal.setAttribute('aria-hidden', 'true');
}

function updateNewResPrice() {
  const room = document.getElementById('nres-room')?.value;
  const ci = document.getElementById('nres-checkin')?.value;
  const co = document.getElementById('nres-checkout')?.value;
  const guests = parseInt(document.getElementById('nres-guests')?.value) || 1;
  const display = document.getElementById('nresTotalDisplay');
  if (!room || !ci || !co || !display) return;

  const details = getRoomDetails();
  const pricePerNight = (details[room] && details[room].price) || ROOM_PRICES[room] || 0;
  const nights = Math.max(1, Math.round((new Date(co) - new Date(ci)) / 86400000));

  let optTotal = 0;
  const prices = { breakfast: 35, pets: 25, transfer: 120, latecheckout: 50, romantic: 80, breakfastbed: 25 };
  document.querySelectorAll('#nresOptionsGrid input[type="checkbox"]:checked').forEach(cb => {
    const k = cb.value;
    const p = prices[k] || 0;
    if (k === 'breakfast' || k === 'breakfastbed') optTotal += p * guests * nights;
    else if (k === 'pets') optTotal += p * nights;
    else optTotal += p;
  });

  const total = pricePerNight * nights + optTotal;
  display.textContent = `Total estimé : ${total.toLocaleString('fr-FR')} € (${nights} nuit${nights > 1 ? 's' : ''})`;
}

function createAdminReservation(e) {
  e.preventDefault();
  const firstname = document.getElementById('nres-firstname')?.value.trim();
  const lastname = document.getElementById('nres-lastname')?.value.trim();
  const email = document.getElementById('nres-email')?.value.trim();
  const phone = document.getElementById('nres-phone')?.value.trim();
  const room = document.getElementById('nres-room')?.value;
  const guests = parseInt(document.getElementById('nres-guests')?.value) || 1;
  const checkin = document.getElementById('nres-checkin')?.value;
  const checkout = document.getElementById('nres-checkout')?.value;
  const status = document.getElementById('nres-status')?.value || 'confirmed';
  const requests = document.getElementById('nres-requests')?.value.trim();

  if (!firstname || !lastname || !room || !checkin || !checkout) return;

  const nights = Math.max(1, Math.round((new Date(checkout) - new Date(checkin)) / 86400000));
  const roomDetails = getRoomDetails();
  const pricePerNight = (roomDetails[room] && roomDetails[room].price) || ROOM_PRICES[room] || 0;

  // Collect options
  const options = {};
  let optTotal = 0;
  const prices = { breakfast: 35, pets: 25, transfer: 120, latecheckout: 50, romantic: 80, breakfastbed: 25 };
  document.querySelectorAll('#nresOptionsGrid input[type="checkbox"]:checked').forEach(cb => {
    const k = cb.value;
    options[k] = true;
    const p = prices[k] || 0;
    if (k === 'breakfast' || k === 'breakfastbed') optTotal += p * guests * nights;
    else if (k === 'pets') optTotal += p * nights;
    else optTotal += p;
  });

  const totalPrice = pricePerNight * nights + optTotal;
  const id = 'RES-' + Date.now().toString(36).toUpperCase();

  const reservation = {
    id, firstname, lastname, email, phone, room, guests, checkin, checkout,
    nights, pricePerNight, totalPrice, options, status, requests,
    source: 'admin',
    createdAt: new Date().toISOString()
  };

  const all = getReservations();
  all.push(reservation);
  localStorage.setItem(LS_KEY, JSON.stringify(all));

  closeNewResModal();
  document.getElementById('newResForm')?.reset();
  renderReservationsTable();
  renderDashboard();
  updatePendingBadge();
  logActivity('reservation', `Nouvelle réservation ${id} créée pour ${firstname} ${lastname} (${room})`, id);
  showAdminToast(`Réservation ${id} créée avec succès`);
}

/* =====================================================
   EDIT OPTIONS ON EXISTING RESERVATION
   ===================================================== */
function toggleResOption(resId, optKey) {
  const all = getReservations();
  const idx = all.findIndex(r => r.id === resId);
  if (idx === -1) return;
  const r = all[idx];
  if (!r.options) r.options = {};
  r.options[optKey] = !r.options[optKey];

  // Recalculate total
  const prices = { breakfast: 35, pets: 25, transfer: 120, latecheckout: 50, romantic: 80, breakfastbed: 25 };
  let optTotal = 0;
  Object.entries(r.options).forEach(([k, v]) => {
    if (!v) return;
    const p = prices[k] || 0;
    if (k === 'breakfast' || k === 'breakfastbed') optTotal += p * (r.guests || 1) * (r.nights || 1);
    else if (k === 'pets') optTotal += p * (r.nights || 1);
    else optTotal += p;
  });
  r.totalPrice = (r.pricePerNight || 0) * (r.nights || 1) + optTotal;
  all[idx] = r;
  localStorage.setItem(LS_KEY, JSON.stringify(all));
  openResModal(resId);
  showAdminToast(`Option mise à jour — Total : ${r.totalPrice.toLocaleString('fr-FR')} €`);
}

/* =====================================================
   CALENDAR
   ===================================================== */
function renderCalendar() {
  const titleEl = document.getElementById('calTitle');
  const gridEl  = document.getElementById('calGrid');
  if (!titleEl || !gridEl) return;

  const month = new Date(calYear, calMonth, 1);
  titleEl.textContent = month.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });

  const days = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
  let html = days.map(d => `<div class="cal-day-name">${d}</div>`).join('');

  const firstDay = (month.getDay() + 6) % 7; // Monday first
  const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
  const reservations = getReservations().filter(r => r.status !== 'cancelled');

  for (let i = 0; i < firstDay; i++) html += '<div class="cal-day cal-day-empty"></div>';

  const todayStr = new Date().toISOString().split('T')[0];

  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${calYear}-${String(calMonth+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const isToday = dateStr === todayStr;
    const checkins  = reservations.filter(r => r.checkin  === dateStr);
    const checkouts = reservations.filter(r => r.checkout === dateStr);
    const staying   = reservations.filter(r => r.checkin < dateStr && r.checkout > dateStr);

    const events = [
      ...checkins.map(r  => `<div class="cal-event cal-event-checkin"  title="${sanitize(r.firstname)} ${sanitize(r.lastname)}">→ ${sanitize(r.firstname)}</div>`),
      ...checkouts.map(r => `<div class="cal-event cal-event-checkout" title="${sanitize(r.firstname)} ${sanitize(r.lastname)}">← ${sanitize(r.firstname)}</div>`),
      ...staying.slice(0, 2).map(r => `<div class="cal-event cal-event-stay" title="${sanitize(r.room)}">· ${sanitize(r.room.split(' ')[0])}</div>`),
    ];

    html += `
      <div class="cal-day ${isToday ? 'cal-day-today' : ''}">
        <div class="cal-day-num">${d}</div>
        <div class="cal-events">${events.join('')}</div>
      </div>
    `;
  }

  gridEl.innerHTML = html;
}

function prevMonth() { calMonth--; if (calMonth < 0) { calMonth = 11; calYear--; } renderCalendar(); }
function nextMonth() { calMonth++; if (calMonth > 11) { calMonth = 0; calYear++; } renderCalendar(); }

/* =====================================================
   ROOMS STATUS
   ===================================================== */
function renderRooms() {
  const el = document.getElementById('roomsStatusGrid');
  if (!el) return;

  const all = getReservations().filter(r => r.status !== 'cancelled');
  const todayStr = new Date().toISOString().split('T')[0];
  const inv = getRoomInventory();

  el.innerHTML = Object.entries(ROOM_PRICES).map(([name, price]) => {
    const room = inv[name] || { count: 1, capacity: 2 };
    const roomRes = all.filter(r => r.room === name);
    const currentOccupied = roomRes.filter(r => r.status === 'checkin' || (r.status === 'confirmed' && r.checkin <= todayStr && r.checkout > todayStr));
    const upcoming = roomRes.filter(r => r.checkin > todayStr).sort((a,b) => a.checkin.localeCompare(b.checkin));
    const availableNow = Math.max(0, room.count - currentOccupied.length);
    const totalNights = roomRes.reduce((s, r) => s + (r.nights || 0), 0);
    const occ = Math.min(Math.round(totalNights / (30 * room.count) * 100), 100);

    return `
      <div class="room-status-card">
        <div class="rs-header">
          <div class="rs-name">${name}</div>
          <div class="rs-price">${price.toLocaleString('fr-FR')} €/nuit</div>
        </div>
        <div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap">
          <span class="status-badge" style="background:rgba(34,197,94,.12);color:#4ade80;border:1px solid rgba(34,197,94,.2)">${availableNow}/${room.count} disponible${availableNow !== 1 ? 's' : ''}</span>
          <span class="status-badge" style="background:rgba(255,255,255,.05);color:var(--text-dim);border:1px solid var(--border)">Max ${room.capacity} pers.</span>
        </div>
        ${currentOccupied.length > 0 ? currentOccupied.map(r => `<div style="font-size:.72rem;color:var(--text-dim);margin-bottom:4px">🔑 ${sanitize(r.firstname)} ${sanitize(r.lastname)} (${fmtDate(r.checkin)} → ${fmtDate(r.checkout)})</div>`).join('') : ''}
        <div class="rs-occupancy">
          <div class="rs-occ-label">Taux d'occupation estimé</div>
          <div class="rs-occ-bar"><div class="rs-occ-fill" style="width:${occ}%"></div></div>
          <div class="rs-occ-pct">${occ}%</div>
        </div>
        <div class="rs-next">
          ${upcoming.length > 0 ? `Prochaine arrivée : <strong style="color:var(--text)">${sanitize(upcoming[0].firstname)} ${sanitize(upcoming[0].lastname)}</strong> le ${fmtDate(upcoming[0].checkin)}` : 'Aucune arrivée prévue'}
        </div>
      </div>
    `;
  }).join('');
}

/* =====================================================
   REPORTS
   ===================================================== */
function renderReports() {
  const all = getReservations();
  const active = all.filter(r => r.status !== 'cancelled');

  // Financial
  const totalRev = active.reduce((s, r) => s + (r.totalPrice || 0), 0);
  const avgRev   = active.length ? Math.round(totalRev / active.length) : 0;
  const baseRev  = active.reduce((s, r) => s + ((r.pricePerNight || 0) * (r.nights || 0)), 0);
  const optsRev  = totalRev - baseRev;

  const finEl = document.getElementById('financialSummary');
  if (finEl) {
    finEl.innerHTML = [
      ['Total réservations', all.length],
      ['Réservations actives', active.length],
      ['CA total', totalRev.toLocaleString('fr-FR') + ' €'],
      ['CA hébergement', baseRev.toLocaleString('fr-FR') + ' €'],
      ['CA options', optsRev.toLocaleString('fr-FR') + ' €'],
      ['Panier moyen', avgRev.toLocaleString('fr-FR') + ' €'],
    ].map(([l, v], i) => `
      <div class="financial-row">
        <span class="financial-label">${l}</span>
        <span class="financial-value ${i === 2 ? 'highlight' : ''}">${v}</span>
      </div>
    `).join('');
  }

  // Room performance
  const rpEl = document.getElementById('roomPerformance');
  if (rpEl) {
    const byRoom = {};
    active.forEach(r => {
      if (!byRoom[r.room]) byRoom[r.room] = { count: 0, revenue: 0, nights: 0 };
      byRoom[r.room].count++;
      byRoom[r.room].revenue += r.totalPrice || 0;
      byRoom[r.room].nights  += r.nights || 0;
    });
    rpEl.innerHTML = Object.entries(ROOM_PRICES).map(([name]) => {
      const d = byRoom[name] || { count: 0, revenue: 0, nights: 0 };
      return `
        <div class="financial-row">
          <span class="financial-label">${name.replace('Chambre ','').replace('Suite ','S. ')}</span>
          <span class="financial-value">${d.count} rés. · ${d.revenue.toLocaleString('fr-FR')} €</span>
        </div>
      `;
    }).join('');
  }

  // Options report
  const orEl = document.getElementById('optionsReport');
  if (orEl) {
    const optCounts = {};
    active.forEach(r => {
      if (r.options) Object.entries(r.options).forEach(([k, v]) => { if (v) optCounts[k] = (optCounts[k] || 0) + 1; });
    });
    orEl.innerHTML = Object.entries(OPTIONS_LABELS).map(([k, cfg]) => `
      <div class="financial-row">
        <span class="financial-label">${cfg.icon} ${cfg.label}</span>
        <span class="financial-value">${optCounts[k] || 0} demande${(optCounts[k]||0) > 1 ? 's' : ''}</span>
      </div>
    `).join('');
  }
}

/* =====================================================
   EXPORT
   ===================================================== */
function exportCSV() {
  const all = getReservations();
  const headers = ['ID','Statut','Prénom','Nom','Email','Téléphone','Chambre','Arrivée','Départ','Nuits','Voyageurs','Total','Demandes'];
  const rows = all.map(r => [
    r.id, STATUS_LABELS[r.status], r.firstname, r.lastname, r.email, r.phone || '',
    r.room, r.checkin, r.checkout, r.nights, r.guests, r.totalPrice, (r.requests || '').replace(/,/g,' ')
  ]);
  const csv = [headers, ...rows].map(row => row.join(',')).join('\n');
  download('reservations_grandpalais.csv', 'text/csv', csv);
  showAdminToast('Export CSV téléchargé');
}

function exportJSON() {
  download('reservations_grandpalais.json', 'application/json', JSON.stringify(getReservations(), null, 2));
  showAdminToast('Export JSON téléchargé');
}

function clearAllData() {
  confirmAction('Supprimer TOUTES les données de réservation ? Cette action est irréversible.', () => {
    localStorage.removeItem(LS_KEY);
    localStorage.setItem('gp_seeded', 'cleared');
    renderDashboard();
    renderReservationsTable();
    updatePendingBadge();
    showAdminToast('Données effacées');
  });
}

function download(name, type, content) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([content], { type }));
  a.download = name;
  a.click();
}

/* =====================================================
   CONFIRM DIALOG
   ===================================================== */
function confirmAction(text, cb) {
  confirmCallback = cb;
  document.getElementById('confirmText').textContent = text;
  const modal = document.getElementById('confirmModal');
  modal.classList.add('open');
  modal.setAttribute('aria-hidden', 'false');
  document.getElementById('confirmOk').onclick = () => { cb(); closeConfirm(); };
}

function closeConfirm() {
  const modal = document.getElementById('confirmModal');
  modal.classList.remove('open');
  modal.setAttribute('aria-hidden', 'true');
}

/* =====================================================
   TOAST
   ===================================================== */
let adminToastTimer;
function showAdminToast(msg) {
  const el = document.getElementById('adminToast');
  if (!el) return;
  el.textContent = '✓ ' + msg;
  el.classList.add('show');
  clearTimeout(adminToastTimer);
  adminToastTimer = setTimeout(() => el.classList.remove('show'), 3500);
}

/* =====================================================
   UTILITIES
   ===================================================== */
function fmtDate(s) {
  if (!s) return '—';
  return new Date(s).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function fmtDateFull(s) {
  if (!s) return '—';
  return new Date(s).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function isToday(dateStr) {
  return dateStr === new Date().toISOString().split('T')[0];
}

function setText(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

/* =====================================================
   CONVERSATIONS
   ===================================================== */
function getConversations() { return JSON.parse(localStorage.getItem(CONV_LS_KEY) || '[]'); }
function saveConversations(arr) { localStorage.setItem(CONV_LS_KEY, JSON.stringify(arr)); }

function updateChatBadgeAdmin() {
  const convs = getConversations();
  const total = convs.reduce((s, c) => s + (c.unreadByAdmin || 0), 0);
  const badge = document.getElementById('chatBadgeAdmin');
  if (badge) {
    badge.textContent = total;
    badge.classList.toggle('visible', total > 0);
  }
}

function filterConversations(filter, btn) {
  convFilter = filter;
  document.querySelectorAll('#view-conversations .filter-tab').forEach(t => t.classList.remove('active'));
  if (btn) btn.classList.add('active');
  renderConversations();
}

function renderConversations() {
  const convs = getConversations().filter(c => c.status === convFilter);
  const listEl = document.getElementById('convList');
  if (!listEl) return;

  if (convs.length === 0) {
    listEl.innerHTML = '<div class="conv-empty">Aucune conversation</div>';
    return;
  }

  convs.sort((a, b) => {
    const aLast = a.messages.length ? new Date(a.messages[a.messages.length - 1].timestamp) : new Date(a.createdAt);
    const bLast = b.messages.length ? new Date(b.messages[b.messages.length - 1].timestamp) : new Date(b.createdAt);
    return bLast - aLast;
  });

  listEl.innerHTML = convs.map(c => {
    const lastMsg = c.messages[c.messages.length - 1];
    const preview = lastMsg ? lastMsg.text.substring(0, 50) + (lastMsg.text.length > 50 ? '…' : '') : '';
    const time = lastMsg ? new Date(lastMsg.timestamp).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : '';
    const name = c.guestName || 'Visiteur';
    const initials = name.split(' ').map(w => w[0]).join('').toUpperCase().substring(0, 2);
    const unread = c.unreadByAdmin || 0;
    const isSelected = c.id === selectedConvId;
    const ratingHtml = c.rating ? `<span class="conv-rating">${'★'.repeat(c.rating)}${'☆'.repeat(5 - c.rating)}</span>` : '';

    const handlerTag = c.adminName ? `<span class="conv-handler-tag">${sanitize(c.adminName)}</span>` : '';

    return `
      <div class="conv-item ${isSelected ? 'selected' : ''} ${unread > 0 ? 'unread' : ''}" onclick="selectConversation('${c.id}')">
        <div class="conv-avatar">${sanitize(initials)}</div>
        <div class="conv-info">
          <div class="conv-name">${sanitize(name)} ${ratingHtml}</div>
          <div class="conv-preview">${sanitize(preview)}</div>
          ${handlerTag}
        </div>
        <div class="conv-meta">
          <span class="conv-time">${time}</span>
          ${unread > 0 ? `<span class="conv-unread-badge">${unread}</span>` : ''}
        </div>
      </div>
    `;
  }).join('');
}

function selectConversation(id) {
  selectedConvId = id;
  const convs = getConversations();
  const conv = convs.find(c => c.id === id);
  if (!conv) return;

  // Mark as read
  const idx = convs.findIndex(c => c.id === id);
  if (idx !== -1 && convs[idx].unreadByAdmin > 0) {
    convs[idx].unreadByAdmin = 0;
    saveConversations(convs);
    updateChatBadgeAdmin();
  }

  renderConversations();
  renderConvChat(conv);
}

function renderConvChat(conv) {
  const chatEl = document.getElementById('convChat');
  if (!chatEl) return;

  const name = conv.guestName || 'Visiteur';
  const isArchived = conv.status === 'archived';

  let messagesHtml = conv.messages.map(m => {
    const cls = m.sender === 'guest' ? 'conv-msg-guest' : (m.sender === 'admin' ? 'conv-msg-admin' : 'conv-msg-bot');
    const label = m.sender === 'guest' ? name : (m.sender === 'admin' ? (m.adminName || 'Admin') : 'Bot');
    const time = new Date(m.timestamp).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    return `<div class="conv-msg ${cls}"><div class="conv-msg-header"><span class="conv-msg-sender">${sanitize(label)}</span><span class="conv-msg-time">${time}</span></div><div class="conv-msg-text">${sanitize(m.text)}</div></div>`;
  }).join('');

  const ratingHtml = conv.rating
    ? `<div class="conv-rating-display">Note du visiteur : <span class="conv-stars">${'★'.repeat(conv.rating)}${'☆'.repeat(5 - conv.rating)}</span> (${conv.rating}/5)</div>`
    : '';

  const handledBy = conv.adminName ? `<span class="conv-handled-badge">Prise en charge par <strong>${sanitize(conv.adminName)}</strong></span>` : '<span class="conv-handled-badge conv-unhandled">Non prise en charge</span>';

  chatEl.innerHTML = `
    <div class="conv-chat-header">
      <div>
        <div class="conv-chat-name">${sanitize(name)}</div>
        <div class="conv-chat-meta">Débuté le ${new Date(conv.createdAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })} · ${handledBy}</div>
      </div>
      <div class="conv-chat-actions">
        ${isArchived
          ? `<button class="btn-admin-secondary" onclick="reopenConversation('${conv.id}')">Réouvrir</button>`
          : `<button class="btn-admin-secondary" onclick="archiveConversation('${conv.id}')">Archiver</button>`
        }
      </div>
    </div>
    <div class="conv-chat-messages" id="convMessages">${messagesHtml}</div>
    ${ratingHtml}
    ${!isArchived ? `
    <form class="conv-chat-input" onsubmit="sendAdminMessage(event)">
      <input type="text" id="adminMsgInput" placeholder="Répondre…" autocomplete="off" required />
      <button type="submit" class="conv-send-btn">→</button>
    </form>` : ''}
  `;

  // Scroll to bottom
  const msgsEl = document.getElementById('convMessages');
  if (msgsEl) msgsEl.scrollTop = msgsEl.scrollHeight;
}

function sendAdminMessage(e) {
  e.preventDefault();
  const input = document.getElementById('adminMsgInput');
  const text = input?.value.trim();
  if (!text || !selectedConvId) return;
  input.value = '';

  const convs = getConversations();
  const idx = convs.findIndex(c => c.id === selectedConvId);
  if (idx === -1) return;

  const user = getCurrentUser();
  convs[idx].messages.push({
    id: 'msg-' + Date.now(),
    sender: 'admin',
    adminId: user.id || 'legacy',
    adminName: user.name || 'Directeur',
    text: text,
    timestamp: new Date().toISOString()
  });
  convs[idx].unreadByGuest = (convs[idx].unreadByGuest || 0) + 1;
  // Track which admin handled this conversation
  if (!convs[idx].adminId) {
    convs[idx].adminId = user.id || 'legacy';
    convs[idx].adminName = user.name || 'Directeur';
  }
  saveConversations(convs);
  logActivity('conversation', `Réponse envoyée à ${convs[idx].guestName || 'Visiteur'}`, selectedConvId);

  renderConvChat(convs[idx]);
  renderConversations();
}

function archiveConversation(id) {
  const convs = getConversations();
  const idx = convs.findIndex(c => c.id === id);
  if (idx === -1) return;
  convs[idx].status = 'archived';
  // Add a system message
  convs[idx].messages.push({
    id: 'msg-' + Date.now(),
    sender: 'bot',
    text: 'Cette conversation a été clôturée par notre équipe. Merci de votre visite !',
    timestamp: new Date().toISOString()
  });
  saveConversations(convs);
  selectedConvId = null;
  logActivity('conversation', `Conversation avec ${convs[idx].guestName || 'Visiteur'} archivée`, id);
  renderConversations();
  document.getElementById('convChat').innerHTML = '<div class="conv-chat-empty"><span style="font-size:2.5rem;opacity:.3">💬</span><p>Sélectionnez une conversation</p></div>';
  showAdminToast('Conversation archivée');
}

function reopenConversation(id) {
  const convs = getConversations();
  const idx = convs.findIndex(c => c.id === id);
  if (idx === -1) return;
  convs[idx].status = 'active';
  saveConversations(convs);
  convFilter = 'active';
  document.querySelectorAll('#view-conversations .filter-tab').forEach(t => t.classList.remove('active'));
  document.querySelector('#view-conversations .filter-tab')?.classList.add('active');
  selectedConvId = id;
  renderConversations();
  renderConvChat(convs[idx]);
  showAdminToast('Conversation réouverte');
}

function startConvPolling() {
  stopConvPolling();
  convPollInterval = setInterval(() => {
    updateChatBadgeAdmin();
    if (selectedConvId) {
      const convs = getConversations();
      const conv = convs.find(c => c.id === selectedConvId);
      if (conv) {
        // Only update messages, not the full chat (preserves input focus & text)
        const msgsEl = document.getElementById('convMessages');
        const input = document.getElementById('adminMsgInput');
        if (msgsEl && input) {
          // Save current input state
          const savedVal = input.value;
          const hadFocus = document.activeElement === input;
          // Re-render only the messages area
          const name = conv.guestName || 'Visiteur';
          msgsEl.innerHTML = conv.messages.map(m => {
            const cls = m.sender === 'guest' ? 'conv-msg-guest' : (m.sender === 'admin' ? 'conv-msg-admin' : 'conv-msg-bot');
            const senderLabel = m.sender === 'guest' ? name : (m.sender === 'admin' ? (m.adminName || 'Admin') : 'Bot');
            const time = new Date(m.timestamp).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
            return `<div class="conv-msg ${cls}"><div class="conv-msg-header"><span class="conv-msg-sender">${sanitize(senderLabel)}</span><span class="conv-msg-time">${time}</span></div><div class="conv-msg-text">${sanitize(m.text)}</div></div>`;
          }).join('');
          msgsEl.scrollTop = msgsEl.scrollHeight;
          // Restore input state
          input.value = savedVal;
          if (hadFocus) input.focus();
        } else {
          renderConvChat(conv);
        }
      }
    }
    renderConversations();
  }, 3000);
}

function stopConvPolling() {
  if (convPollInterval) { clearInterval(convPollInterval); convPollInterval = null; }
}

/* =====================================================
   TEAM / COLLABORATORS
   ===================================================== */
function getTeam() { return JSON.parse(localStorage.getItem(TEAM_LS_KEY) || '[]'); }
function saveTeam(arr) { localStorage.setItem(TEAM_LS_KEY, JSON.stringify(arr)); }

function renderTeam() {
  const el = document.getElementById('teamGrid');
  if (!el) return;
  const team = getTeam();
  const currentUser = getCurrentUser();

  if (team.length === 0) {
    el.innerHTML = '<div class="conv-empty">Aucun collaborateur. Le compte par défaut (grandpalais2026) est actif.</div>';
    return;
  }

  el.innerHTML = team.map(m => {
    const initials = m.name.split(' ').map(w => w[0]).join('').toUpperCase().substring(0, 2);
    const isSelf = m.id === currentUser.id;
    const roleClass = m.role === 'admin' ? 'role-admin' : (m.role === 'manager' ? 'role-manager' : 'role-staff');
    return `
      <div class="team-card ${!m.active ? 'team-inactive' : ''}">
        <div class="team-avatar">${sanitize(initials)}</div>
        <div class="team-info">
          <div class="team-name">${sanitize(m.name)} ${isSelf ? '<span class="team-you">(vous)</span>' : ''}</div>
          <div class="team-email">${sanitize(m.email)}</div>
        </div>
        <span class="team-role-badge ${roleClass}">${ROLE_LABELS[m.role]}</span>
        <div class="team-actions">
          ${!isSelf ? `
            <select onchange="updateCollaboratorRole('${m.id}', this.value)" class="team-role-select">
              <option value="admin" ${m.role === 'admin' ? 'selected' : ''}>Admin</option>
              <option value="manager" ${m.role === 'manager' ? 'selected' : ''}>Manager</option>
              <option value="staff" ${m.role === 'staff' ? 'selected' : ''}>Personnel</option>
            </select>
            <button class="btn-admin-danger btn-sm" onclick="confirmAction('Supprimer ${sanitize(m.name)} ?', () => removeCollaborator('${m.id}'))">Supprimer</button>
          ` : ''}
        </div>
      </div>
    `;
  }).join('');
}

function getCurrentUser() {
  try { return JSON.parse(sessionStorage.getItem('gp_admin_user') || '{}'); } catch(_) { return {}; }
}

async function addCollaborator(e) {
  e.preventDefault();
  const name = document.getElementById('collab-name')?.value.trim();
  const email = document.getElementById('collab-email')?.value.trim();
  const role = document.getElementById('collab-role')?.value;
  const pass = document.getElementById('collab-pass')?.value;
  if (!name || !email || !pass) return;

  const passwordHash = await hashPassword(pass);
  const team = getTeam();

  if (team.some(m => m.email === email)) {
    showAdminToast('Un collaborateur avec cet email existe déjà');
    return;
  }

  team.push({
    id: 'user-' + Date.now(),
    name, email, role,
    passwordHash,
    createdAt: new Date().toISOString(),
    active: true
  });
  saveTeam(team);

  document.getElementById('addCollabForm').reset();
  renderTeam();
  logActivity('team', `${name} ajouté à l'équipe (${ROLE_LABELS[role] || role})`);
  showAdminToast(`${name} ajouté à l'équipe`);
}

function updateCollaboratorRole(id, newRole) {
  const team = getTeam();
  const idx = team.findIndex(m => m.id === id);
  if (idx === -1) return;
  team[idx].role = newRole;
  saveTeam(team);
  renderTeam();
  showAdminToast('Rôle mis à jour');
}

function removeCollaborator(id) {
  const team = getTeam().filter(m => m.id !== id);
  saveTeam(team);
  renderTeam();
  showAdminToast('Collaborateur supprimé');
}

/* =====================================================
   ROOM INVENTORY MANAGEMENT
   ===================================================== */
function renderInventory() {
  const el = document.getElementById('inventoryGrid');
  if (!el) return;
  const inv = getRoomInventory();
  const all = getReservations().filter(r => r.status !== 'cancelled');
  const todayStr = new Date().toISOString().split('T')[0];

  el.innerHTML = Object.entries(ROOM_PRICES).map(([name, price]) => {
    const room = inv[name] || { count: 0, capacity: 2 };
    const occupied = all.filter(r => r.room === name && (r.status === 'checkin' || (r.status === 'confirmed' && r.checkin <= todayStr && r.checkout > todayStr))).length;
    const available = Math.max(0, room.count - occupied);
    const occPct = room.count > 0 ? Math.round(occupied / room.count * 100) : 0;

    return `
      <div class="inventory-card">
        <div class="inv-header">
          <div class="inv-name">${sanitize(name)}</div>
          <div class="inv-price">${price.toLocaleString('fr-FR')} €/nuit</div>
        </div>
        <div class="inv-status-row">
          <span class="inv-available">${available} disponible${available !== 1 ? 's' : ''}</span>
          <span class="inv-occupied">${occupied} occupée${occupied !== 1 ? 's' : ''}</span>
        </div>
        <div class="inv-occ-bar"><div class="inv-occ-fill" style="width:${occPct}%"></div></div>
        <div class="inv-fields">
          <div class="inv-field">
            <label>Nombre de chambres</label>
            <div class="inv-stepper">
              <button type="button" onclick="updateInventory('${sanitize(name)}', 'count', -1)">−</button>
              <span id="inv-count-${name.replace(/\s+/g, '-')}">${room.count}</span>
              <button type="button" onclick="updateInventory('${sanitize(name)}', 'count', 1)">+</button>
            </div>
          </div>
          <div class="inv-field">
            <label>Capacité max (pers.)</label>
            <div class="inv-stepper">
              <button type="button" onclick="updateInventory('${sanitize(name)}', 'capacity', -1)">−</button>
              <span id="inv-cap-${name.replace(/\s+/g, '-')}">${room.capacity}</span>
              <button type="button" onclick="updateInventory('${sanitize(name)}', 'capacity', 1)">+</button>
            </div>
          </div>
        </div>
      </div>`;
  }).join('');
}

function updateInventory(roomName, field, delta) {
  const inv = getRoomInventory();
  if (!inv[roomName]) inv[roomName] = { count: 0, capacity: 2 };
  inv[roomName][field] = Math.max(0, (inv[roomName][field] || 0) + delta);
  saveRoomInventory(inv);
  // Update the display
  const suffix = roomName.replace(/\s+/g, '-');
  if (field === 'count') {
    const el = document.getElementById('inv-count-' + suffix);
    if (el) el.textContent = inv[roomName].count;
  } else {
    const el = document.getElementById('inv-cap-' + suffix);
    if (el) el.textContent = inv[roomName].capacity;
  }
  // Re-render to update status
  renderInventory();
  showAdminToast(`${roomName} mis à jour`);
}

/* =====================================================
   ROOM EDITOR (fiches chambres)
   ===================================================== */
const ROOM_DETAILS_LS_KEY = 'gp_room_details';
const ROOM_CLASSES = {
  'Chambre Classique': 'classique',
  'Chambre Deluxe': 'deluxe',
  'Suite Junior': 'junior',
  'Suite Prestige': 'prestige',
  'Suite Royale': 'royale'
};
const DEFAULT_ROOM_DETAILS = {
  'Chambre Classique': {
    name: 'Chambre Classique',
    size: '28 m²',
    badge: 'Populaire',
    badgeClass: '',
    cardClass: '',
    description: 'Élégante chambre alliant confort moderne et décor raffiné, avec vue sur les jardins intérieurs ou la cour parisienne.',
    image: 'https://images.unsplash.com/photo-1631049307264-da0ec9d70304?auto=format&fit=crop&w=800&q=80',
    price: 450,
    features: [
      { icon: '🛏', text: 'Lit King-size' },
      { icon: '🛁', text: 'Salle de bain marbre' },
      { icon: '📡', text: 'WiFi haut débit' },
      { icon: '🍾', text: 'Minibar premium' },
      { icon: '☕', text: 'Machine Nespresso' },
      { icon: '🖥', text: 'TV 4K 55"' }
    ]
  },
  'Chambre Deluxe': {
    name: 'Chambre Deluxe',
    size: '38 m²',
    badge: '★ Best seller',
    badgeClass: 'room-badge-gold',
    cardClass: 'room-card-featured',
    description: 'Espace généreux, baignoire îlot et vue imprenable sur les toits de Paris. Pour les voyageurs les plus exigeants.',
    image: 'https://images.unsplash.com/photo-1582719478250-c89cae4dc85b?auto=format&fit=crop&w=800&q=80',
    price: 650,
    features: [
      { icon: '🛏', text: 'Lit King-size XL' },
      { icon: '🛁', text: 'Baignoire îlot' },
      { icon: '🏙', text: 'Vue sur Paris' },
      { icon: '🍾', text: 'Accueil champagne' },
      { icon: '👔', text: 'Service pressing' },
      { icon: '🌸', text: 'Fleurs fraîches' }
    ]
  },
  'Suite Junior': {
    name: 'Suite Junior',
    size: '55 m²',
    badge: '',
    badgeClass: '',
    cardClass: '',
    description: 'Salon séparé et chambre somptueuse pour une intimité totale. Idéale pour séjours romantiques et voyages d\'affaires.',
    image: 'https://images.unsplash.com/photo-1578683010236-d716f9a3f461?auto=format&fit=crop&w=800&q=80',
    price: 950,
    features: [
      { icon: '🏠', text: 'Chambre + salon séparés' },
      { icon: '🛁', text: 'Douche à l\'italienne' },
      { icon: '🌇', text: 'Vue panoramique' },
      { icon: '🏋', text: 'Accès spa inclus' },
      { icon: '🎁', text: 'Kit Hermès' },
      { icon: '🍾', text: 'Accueil champagne' }
    ]
  },
  'Suite Prestige': {
    name: 'Suite Prestige',
    size: '90 m²',
    badge: '✦ Prestige',
    badgeClass: 'room-badge-prestige',
    cardClass: 'room-card-prestige',
    description: 'Notre suite emblématique avec terrasse privée donnant sur la Tour Eiffel. L\'apogée du luxe parisien avec majordome dédié.',
    image: 'https://images.unsplash.com/photo-1540541338287-41700207dee6?auto=format&fit=crop&w=800&q=80',
    price: 1800,
    features: [
      { icon: '🌹', text: 'Terrasse privée 30 m²' },
      { icon: '🛁', text: 'Bain à remous & sauna' },
      { icon: '🗼', text: 'Vue Tour Eiffel' },
      { icon: '🤵', text: 'Majordome personnel' },
      { icon: '🚗', text: 'Rolls-Royce incluse' },
      { icon: '💐', text: 'Fleurs quotidiennes' }
    ]
  },
  'Suite Royale': {
    name: 'Suite Royale',
    size: '160 m²',
    badge: '♛ Suite Royale',
    badgeClass: 'room-badge-royal',
    cardClass: 'room-card-royal',
    description: 'L\'expression ultime du luxe. Trois pièces, deux salles de bain, salon de réception et terrasse avec piscine chauffée privée.',
    image: 'https://images.unsplash.com/photo-1596394516093-501ba68a0ba6?auto=format&fit=crop&w=800&q=80',
    price: 3500,
    features: [
      { icon: '🏛', text: '3 pièces + piscine privée' },
      { icon: '🛁', text: '2 salles de bain onyx' },
      { icon: '🎹', text: 'Piano Steinway & Sons' },
      { icon: '👨‍🍳', text: 'Chef privé sur demande' },
      { icon: '🛡', text: 'Sécurité 24h/24' },
      { icon: '🌹', text: 'Floristique Valentino' }
    ]
  }
};

function getRoomDetails() {
  try {
    const stored = localStorage.getItem(ROOM_DETAILS_LS_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      // Merge with defaults to handle any new fields
      const merged = JSON.parse(JSON.stringify(DEFAULT_ROOM_DETAILS));
      Object.keys(parsed).forEach(key => {
        if (merged[key]) Object.assign(merged[key], parsed[key]);
        else merged[key] = parsed[key];
      });
      return merged;
    }
  } catch(_) {}
  return JSON.parse(JSON.stringify(DEFAULT_ROOM_DETAILS));
}

function saveRoomDetails(details) {
  localStorage.setItem(ROOM_DETAILS_LS_KEY, JSON.stringify(details));
}

function renderRoomEditor() {
  const el = document.getElementById('roomEditorGrid');
  if (!el) return;
  const details = getRoomDetails();

  el.innerHTML = Object.entries(details).map(([key, room]) => {
    const cls = ROOM_CLASSES[key] || key.toLowerCase().replace(/\s+/g, '-');
    const featuresHtml = (room.features || []).map((f, i) => `
      <div class="re-feat-row" data-room="${sanitize(key)}" data-idx="${i}">
        <input type="text" class="re-feat-icon" value="${sanitize(f.icon)}" maxlength="4" onchange="updateRoomFeature('${sanitize(key)}', ${i}, 'icon', this.value)" />
        <input type="text" class="re-feat-text" value="${sanitize(f.text)}" onchange="updateRoomFeature('${sanitize(key)}', ${i}, 'text', this.value)" />
        <button class="re-feat-del" onclick="removeRoomFeature('${sanitize(key)}', ${i})" title="Supprimer">✕</button>
      </div>
    `).join('');

    const isCustom = !DEFAULT_ROOM_DETAILS[key];
    return `
      <div class="room-editor-card">
        <div class="re-preview" style="background-image:url('${sanitize(room.image)}')">
          <div class="re-preview-overlay">
            <span class="re-room-cls">${sanitize(cls)}</span>
            ${isCustom ? `<button class="re-delete-btn" onclick="confirmAction('Supprimer la chambre ${sanitize(room.name)} ?', () => deleteRoomType('${sanitize(key)}'))" title="Supprimer cette chambre">🗑</button>` : ''}
          </div>
        </div>
        <div class="re-form">
          <div class="re-row">
            <label>Nom de la chambre</label>
            <input type="text" value="${sanitize(room.name)}" onchange="updateRoomField('${sanitize(key)}', 'name', this.value)" />
          </div>
          <div class="re-row">
            <label>Surface</label>
            <input type="text" value="${sanitize(room.size)}" onchange="updateRoomField('${sanitize(key)}', 'size', this.value)" />
          </div>
          <div class="re-row">
            <label>Badge (laisser vide pour aucun)</label>
            <input type="text" value="${sanitize(room.badge || '')}" onchange="updateRoomField('${sanitize(key)}', 'badge', this.value)" />
          </div>
          <div class="re-row">
            <label>Prix par nuit (€)</label>
            <input type="number" value="${room.price}" min="0" onchange="updateRoomField('${sanitize(key)}', 'price', parseInt(this.value) || 0)" />
          </div>
          <div class="re-row">
            <label>URL de l'image</label>
            <input type="url" value="${sanitize(room.image)}" onchange="updateRoomImage('${sanitize(key)}', this.value, this.closest('.room-editor-card'))" />
          </div>
          <div class="re-row re-row-full">
            <label>Description</label>
            <textarea rows="3" onchange="updateRoomField('${sanitize(key)}', 'description', this.value)">${sanitize(room.description)}</textarea>
          </div>
          <div class="re-row re-row-full">
            <label>Équipements / Options</label>
            <div class="re-feat-list">${featuresHtml}</div>
            <button class="btn-admin-sm" onclick="addRoomFeature('${sanitize(key)}')">+ Ajouter un équipement</button>
          </div>
        </div>
      </div>
    `;
  }).join('');

  // Add "Create Room" card at the end
  el.innerHTML += `
    <div class="room-editor-card re-create-card">
      <div class="re-create-content" onclick="createNewRoomType()">
        <span class="re-create-icon">+</span>
        <span class="re-create-text">Créer une nouvelle chambre</span>
      </div>
    </div>
  `;
}

function updateRoomField(roomKey, field, value) {
  const details = getRoomDetails();
  if (!details[roomKey]) return;
  details[roomKey][field] = value;
  // Sync price with ROOM_PRICES for reservation system
  if (field === 'price') {
    ROOM_PRICES[roomKey] = value;
  }
  saveRoomDetails(details);
  showAdminToast('Fiche mise à jour');
}

function updateRoomImage(roomKey, url, cardEl) {
  const details = getRoomDetails();
  if (!details[roomKey]) return;
  details[roomKey].image = url;
  saveRoomDetails(details);
  // Update preview in the editor card
  if (cardEl) {
    const preview = cardEl.querySelector('.re-preview');
    if (preview) preview.style.backgroundImage = `url('${url}')`;
  }
  showAdminToast('Image mise à jour');
}

function updateRoomFeature(roomKey, idx, field, value) {
  const details = getRoomDetails();
  if (!details[roomKey] || !details[roomKey].features[idx]) return;
  details[roomKey].features[idx][field] = value;
  saveRoomDetails(details);
}

function addRoomFeature(roomKey) {
  const details = getRoomDetails();
  if (!details[roomKey]) return;
  if (!details[roomKey].features) details[roomKey].features = [];
  details[roomKey].features.push({ icon: '✨', text: 'Nouvel équipement' });
  saveRoomDetails(details);
  renderRoomEditor();
}

function removeRoomFeature(roomKey, idx) {
  const details = getRoomDetails();
  if (!details[roomKey] || !details[roomKey].features) return;
  details[roomKey].features.splice(idx, 1);
  saveRoomDetails(details);
  renderRoomEditor();
}

function createNewRoomType() {
  const name = prompt('Nom de la nouvelle chambre (ex: Suite Impériale) :');
  if (!name || !name.trim()) return;
  const trimmed = name.trim();

  const details = getRoomDetails();
  if (details[trimmed]) {
    showAdminToast('Une chambre avec ce nom existe déjà');
    return;
  }

  details[trimmed] = {
    name: trimmed,
    size: '30 m²',
    badge: '',
    badgeClass: '',
    cardClass: '',
    description: 'Description de la chambre…',
    image: 'https://images.unsplash.com/photo-1631049307264-da0ec9d70304?auto=format&fit=crop&w=800&q=80',
    price: 500,
    features: [
      { icon: '🛏', text: 'Lit King-size' },
      { icon: '🛁', text: 'Salle de bain privée' },
      { icon: '📡', text: 'WiFi haut débit' }
    ]
  };
  saveRoomDetails(details);

  // Also add to inventory
  const inv = getRoomInventory();
  inv[trimmed] = { count: 1, capacity: 2 };
  saveRoomInventory(inv);

  // Add to ROOM_PRICES for reservation system
  ROOM_PRICES[trimmed] = 500;

  renderRoomEditor();
  logActivity('room', `Chambre "${trimmed}" créée`);
  showAdminToast(`Chambre "${trimmed}" créée — personnalisez-la ci-dessous`);
}

function deleteRoomType(roomKey) {
  const details = getRoomDetails();
  delete details[roomKey];
  saveRoomDetails(details);

  // Remove from inventory too
  const inv = getRoomInventory();
  delete inv[roomKey];
  saveRoomInventory(inv);

  // Remove from ROOM_PRICES
  delete ROOM_PRICES[roomKey];

  renderRoomEditor();
  logActivity('room', `Chambre "${roomKey}" supprimée`);
  showAdminToast(`Chambre "${roomKey}" supprimée`);
}

/* =====================================================
   NOTES INTERNES (per-reservation)
   ===================================================== */
const NOTES_LS_KEY = 'gp_notes';

function getNotes() { return JSON.parse(localStorage.getItem(NOTES_LS_KEY) || '{}'); }
function saveNotes(notes) { localStorage.setItem(NOTES_LS_KEY, JSON.stringify(notes)); }

function addResNote(resId) {
  const input = document.getElementById('noteInput-' + resId);
  if (!input) return;
  const text = input.value.trim();
  if (!text) return;
  input.value = '';

  const notes = getNotes();
  if (!notes[resId]) notes[resId] = [];
  const user = getCurrentUser();
  notes[resId].push({
    id: 'note-' + Date.now(),
    text,
    author: user.name || 'Admin',
    authorId: user.id || 'legacy',
    timestamp: new Date().toISOString()
  });
  saveNotes(notes);
  logActivity('reservation', `Note ajoutée sur ${resId}`, resId);
  renderResNotes(resId);
}

function deleteResNote(resId, noteId) {
  const notes = getNotes();
  if (!notes[resId]) return;
  notes[resId] = notes[resId].filter(n => n.id !== noteId);
  if (notes[resId].length === 0) delete notes[resId];
  saveNotes(notes);
  renderResNotes(resId);
}

function renderResNotes(resId) {
  const el = document.getElementById('resNotesList-' + resId);
  if (!el) return;
  const notes = getNotes();
  const list = notes[resId] || [];
  if (list.length === 0) {
    el.innerHTML = '<p class="notes-empty">Aucune note interne</p>';
    return;
  }
  el.innerHTML = list.map(n => {
    const time = new Date(n.timestamp).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    return `<div class="note-item">
      <div class="note-header"><strong>${sanitize(n.author)}</strong><span class="note-time">${time}</span>
        <button class="note-del" onclick="event.stopPropagation();deleteResNote('${sanitize(resId)}','${n.id}')" title="Supprimer">✕</button>
      </div>
      <div class="note-text">${sanitize(n.text)}</div>
    </div>`;
  }).join('');
}

/* =====================================================
   ACTIVITY LOG
   ===================================================== */
const ACTIVITY_LS_KEY = 'gp_activity_log';
let activityFilter = 'all';

function getActivityLog() { return JSON.parse(localStorage.getItem(ACTIVITY_LS_KEY) || '[]'); }
function saveActivityLog(log) { localStorage.setItem(ACTIVITY_LS_KEY, JSON.stringify(log)); }

function logActivity(category, message, refId) {
  const log = getActivityLog();
  const user = getCurrentUser();
  log.unshift({
    id: 'act-' + Date.now(),
    category,
    message,
    refId: refId || null,
    user: user.name || 'Système',
    timestamp: new Date().toISOString()
  });
  // Keep last 200 entries
  if (log.length > 200) log.length = 200;
  saveActivityLog(log);
}

function filterActivity(filter, btn) {
  activityFilter = filter;
  document.querySelectorAll('#view-activity .filter-tab').forEach(t => t.classList.remove('active'));
  if (btn) btn.classList.add('active');
  renderActivityLog();
}

function renderActivityLog() {
  const el = document.getElementById('activityList');
  if (!el) return;
  let log = getActivityLog();
  if (activityFilter !== 'all') log = log.filter(a => a.category === activityFilter);

  if (log.length === 0) {
    el.innerHTML = '<div class="activity-empty">Aucune activité enregistrée</div>';
    return;
  }

  const CATEGORY_ICONS = { reservation: '📋', conversation: '💬', room: '🛏', team: '👥', system: '⚙️' };

  el.innerHTML = log.map(a => {
    const time = new Date(a.timestamp).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    const icon = CATEGORY_ICONS[a.category] || '📝';
    return `<div class="activity-item">
      <div class="activity-icon">${icon}</div>
      <div class="activity-body">
        <div class="activity-msg">${sanitize(a.message)}</div>
        <div class="activity-meta">${sanitize(a.user)} · ${time}</div>
      </div>
    </div>`;
  }).join('');
}

function clearActivityLog() {
  confirmAction("Vider tout l'historique d'activité ?", () => {
    localStorage.removeItem(ACTIVITY_LS_KEY);
    renderActivityLog();
    showAdminToast('Historique vidé');
  });
}

/* =====================================================
   INVOICE GENERATION
   ===================================================== */
function generateInvoice(resId) {
  const r = getReservations().find(x => x.id === resId);
  if (!r) return;

  const opts = r.options || {};
  const prices = { breakfast: 35, pets: 25, transfer: 120, latecheckout: 50, romantic: 80, breakfastbed: 25 };
  const optLines = Object.entries(OPTIONS_LABELS).filter(([k]) => opts[k]).map(([k, cfg]) => {
    const p = prices[k] || 0;
    let qty = 1, total = p;
    if (k === 'breakfast' || k === 'breakfastbed') { qty = (r.guests||1) * (r.nights||1); total = p * qty; }
    else if (k === 'pets') { qty = r.nights||1; total = p * qty; }
    return { label: cfg.icon + ' ' + cfg.label, unit: p, qty, total };
  });

  const baseTotal = (r.pricePerNight || 0) * (r.nights || 1);
  const optTotal = optLines.reduce((s, o) => s + o.total, 0);
  const invoiceNum = 'FAC-' + resId.replace('RES-', '');
  const today = new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });

  const html = `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><title>Facture ${invoiceNum}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}body{font-family:'Segoe UI',sans-serif;color:#1a1a2e;padding:40px;max-width:800px;margin:0 auto;background:#fff}
.inv-header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:40px;padding-bottom:20px;border-bottom:3px solid #c9a84c}
.inv-hotel{font-size:24px;font-weight:700;color:#1a1a2e;letter-spacing:2px}.inv-hotel-sub{font-size:12px;color:#666;letter-spacing:1px}
.inv-info{text-align:right;font-size:13px;color:#444}.inv-info strong{font-size:18px;color:#c9a84c;display:block;margin-bottom:4px}
.inv-section{margin-bottom:24px}.inv-section h3{font-size:14px;color:#c9a84c;text-transform:uppercase;letter-spacing:1px;margin-bottom:10px;border-bottom:1px solid #eee;padding-bottom:6px}
.inv-guest{font-size:14px;line-height:1.8;color:#333}
table{width:100%;border-collapse:collapse;margin-bottom:20px}th{text-align:left;font-size:12px;text-transform:uppercase;color:#888;border-bottom:2px solid #eee;padding:8px 4px}
td{padding:10px 4px;border-bottom:1px solid #f0f0f0;font-size:13px}.td-right{text-align:right}
.inv-total-row{display:flex;justify-content:space-between;padding:8px 0;font-size:14px;color:#333}
.inv-grand-total{display:flex;justify-content:space-between;padding:12px 0;font-size:20px;font-weight:700;color:#1a1a2e;border-top:2px solid #c9a84c;margin-top:8px}
.inv-footer{margin-top:40px;text-align:center;font-size:11px;color:#999;border-top:1px solid #eee;padding-top:16px}
@media print{body{padding:20px}}
</style></head><body>
<div class="inv-header">
  <div><div class="inv-hotel">LE GRAND PALAIS</div><div class="inv-hotel-sub">HÔTEL DE LUXE — PARIS</div></div>
  <div class="inv-info"><strong>${invoiceNum}</strong>Date : ${today}<br>Réf. : ${sanitize(r.id)}</div>
</div>
<div class="inv-section"><h3>Client</h3>
  <div class="inv-guest">${sanitize(r.firstname)} ${sanitize(r.lastname)}<br>${r.email ? sanitize(r.email) + '<br>' : ''}${r.phone ? sanitize(r.phone) : ''}</div>
</div>
<div class="inv-section"><h3>Détails du séjour</h3>
<table><thead><tr><th>Description</th><th>Prix unit.</th><th>Qté</th><th class="td-right">Total</th></tr></thead><tbody>
<tr><td>${sanitize(r.room)}</td><td>${(r.pricePerNight||0).toLocaleString('fr-FR')} €/nuit</td><td>${r.nights||1}</td><td class="td-right">${baseTotal.toLocaleString('fr-FR')} €</td></tr>
${optLines.map(o => `<tr><td>${sanitize(o.label)}</td><td>${o.unit.toLocaleString('fr-FR')} €</td><td>${o.qty}</td><td class="td-right">${o.total.toLocaleString('fr-FR')} €</td></tr>`).join('')}
</tbody></table>
</div>
<div class="inv-section">
  <div class="inv-total-row"><span>Hébergement</span><span>${baseTotal.toLocaleString('fr-FR')} €</span></div>
  ${optTotal > 0 ? `<div class="inv-total-row"><span>Options & Services</span><span>${optTotal.toLocaleString('fr-FR')} €</span></div>` : ''}
  <div class="inv-grand-total"><span>TOTAL TTC</span><span>${(r.totalPrice||0).toLocaleString('fr-FR')} €</span></div>
</div>
<div class="inv-footer">Hôtel Le Grand Palais — 12 Avenue des Champs-Élysées, 75008 Paris — +33 1 42 68 00 00<br>SIRET : 123 456 789 00012 — TVA : FR12345678901</div>
</body></html>`;

  const w = window.open('', '_blank');
  w.document.write(html);
  w.document.close();
  w.focus();
  w.print();
  logActivity('reservation', `Facture générée pour ${resId}`, resId);
}

/* =====================================================
   DASHBOARD: TODAY'S ARRIVALS & DEPARTURES
   ===================================================== */
function renderTodayMovements() {
  const todayStr = new Date().toISOString().split('T')[0];
  const all = getReservations().filter(r => r.status !== 'cancelled');

  const arrivals = all.filter(r => r.checkin === todayStr && r.status !== 'checkout');
  const departures = all.filter(r => r.checkout === todayStr || (r.status === 'checkout' && r.checkout === todayStr));

  const ciEl = document.getElementById('todayCheckins');
  const coEl = document.getElementById('todayCheckouts');

  if (ciEl) {
    if (arrivals.length === 0) {
      ciEl.innerHTML = '<p class="today-empty">Aucune arrivée prévue</p>';
    } else {
      ciEl.innerHTML = arrivals.map(r => {
        const checked = r.status === 'checkin';
        return `<div class="today-item ${checked ? 'today-done' : ''}">
          <div class="today-guest"><strong>${sanitize(r.firstname)} ${sanitize(r.lastname)}</strong><span class="today-room">${sanitize(r.room)}</span></div>
          <div class="today-actions">
            ${checked ? '<span class="today-badge-done">Arrivé</span>' : `<button class="btn-admin-sm btn-today" onclick="quickStatus('${sanitize(r.id)}','checkin');renderTodayMovements()">Check-in</button>`}
          </div>
        </div>`;
      }).join('');
    }
  }

  if (coEl) {
    if (departures.length === 0) {
      coEl.innerHTML = '<p class="today-empty">Aucun départ prévu</p>';
    } else {
      coEl.innerHTML = departures.map(r => {
        const checked = r.status === 'checkout';
        return `<div class="today-item ${checked ? 'today-done' : ''}">
          <div class="today-guest"><strong>${sanitize(r.firstname)} ${sanitize(r.lastname)}</strong><span class="today-room">${sanitize(r.room)}</span></div>
          <div class="today-actions">
            ${checked ? '<span class="today-badge-done">Parti</span>' : `<button class="btn-admin-sm btn-today" onclick="quickStatus('${sanitize(r.id)}','checkout');renderTodayMovements()">Check-out</button>`}
          </div>
        </div>`;
      }).join('');
    }
  }
}

/* =====================================================
   GLOBAL SEARCH
   ===================================================== */
let globalSearchTimeout = null;

function globalSearchHandler(query) {
  clearTimeout(globalSearchTimeout);
  const resultsEl = document.getElementById('globalSearchResults');
  if (!resultsEl) return;

  if (!query || query.trim().length < 2) {
    resultsEl.innerHTML = '';
    resultsEl.classList.remove('open');
    return;
  }

  globalSearchTimeout = setTimeout(() => {
    const q = query.trim().toLowerCase();
    const results = [];

    // Search reservations
    getReservations().forEach(r => {
      const fullName = (r.firstname + ' ' + r.lastname).toLowerCase();
      const match = fullName.includes(q) || (r.email||'').toLowerCase().includes(q) || (r.id||'').toLowerCase().includes(q) || (r.room||'').toLowerCase().includes(q);
      if (match) {
        results.push({ type: 'reservation', icon: '📋', label: `${r.firstname} ${r.lastname}`, sub: `${r.room} · ${STATUS_LABELS[r.status]}`, action: `openResModal('${sanitize(r.id)}')` });
      }
    });

    // Search conversations
    getConversations().forEach(c => {
      const name = (c.guestName || '').toLowerCase();
      if (name.includes(q)) {
        results.push({ type: 'conversation', icon: '💬', label: c.guestName, sub: `${c.messages.length} messages`, action: `showView('conversations');setTimeout(()=>selectConversation('${c.id}'),100)` });
      }
    });

    // Search team
    (JSON.parse(localStorage.getItem(TEAM_LS_KEY) || '[]')).forEach(m => {
      if (m.name.toLowerCase().includes(q) || (m.email||'').toLowerCase().includes(q)) {
        results.push({ type: 'team', icon: '👤', label: m.name, sub: ROLE_LABELS[m.role] || m.role, action: `showView('team')` });
      }
    });

    if (results.length === 0) {
      resultsEl.innerHTML = '<div class="gsr-empty">Aucun résultat</div>';
    } else {
      resultsEl.innerHTML = results.slice(0, 8).map(r =>
        `<div class="gsr-item" onclick="${r.action};document.getElementById('globalSearch').value='';document.getElementById('globalSearchResults').classList.remove('open')">
          <span class="gsr-icon">${r.icon}</span>
          <div class="gsr-info"><div class="gsr-label">${sanitize(r.label)}</div><div class="gsr-sub">${sanitize(r.sub)}</div></div>
        </div>`
      ).join('');
    }
    resultsEl.classList.add('open');
  }, 200);
}

// Close search results on click outside
document.addEventListener('click', e => {
  const wrap = document.querySelector('.topbar-search-wrap');
  if (wrap && !wrap.contains(e.target)) {
    const el = document.getElementById('globalSearchResults');
    if (el) el.classList.remove('open');
  }
});

console.log('%c✦ Admin Le Grand Palais %c— Panel de gestion v3', 'color:#c9a84c;font-weight:700;font-size:14px', 'color:#7a7268;font-size:12px');
