/* =====================================================
   HÔTEL LE GRAND PALAIS — script.js
   ===================================================== */
'use strict';

function sanitize(s) {
  if (typeof s !== 'string') return s;
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

/* ---- Constants ---- */
const ROOMS = {
  'Chambre Classique': { code: 'classique', price: 450 },
  'Chambre Deluxe':    { code: 'deluxe',    price: 650 },
  'Suite Junior':      { code: 'junior',    price: 950 },
  'Suite Prestige':    { code: 'prestige',  price: 1800 },
  'Suite Royale':      { code: 'royale',    price: 3500 },
};

const OPTIONS_PRICES = {
  breakfast:     { label: 'Petit-déjeuner',         type: 'perPersonNight', price: 35 },
  pets:          { label: 'Animaux de compagnie',   type: 'perNight',       price: 25 },
  transfer:      { label: 'Transfert aéroport',     type: 'fixed',          price: 120 },
  latecheckout:  { label: 'Late Check-out (16h)',   type: 'fixed',          price: 50 },
  romantic:      { label: 'Décoration romantique',  type: 'fixed',          price: 80 },
  breakfastbed:  { label: 'Petit-déjeuner en chambre', type: 'perPersonNight', price: 25 },
};

const MODAL_OPTIONS = {
  breakfast:    { id: 'mo-breakfast', type: 'perPersonNight', price: 35 },
  pets:         { id: 'mo-pets',      type: 'perNight',       price: 25 },
  transfer:     { id: 'mo-transfer',  type: 'fixed',          price: 120 },
  latecheckout: { id: 'mo-late',      type: 'fixed',          price: 50 },
  romantic:     { id: 'mo-romantic',  type: 'fixed',          price: 80 },
  breakfastbed: { id: 'mo-bfbed',     type: 'perPersonNight', price: 25 },
};

const ROOM_CAPACITY_DEFAULT = {
  'Chambre Classique': 2,
  'Chambre Deluxe': 3,
  'Suite Junior': 3,
  'Suite Prestige': 4,
  'Suite Royale': 6,
};
const ROOM_INVENTORY_DEFAULT = {
  'Chambre Classique': 5,
  'Chambre Deluxe': 4,
  'Suite Junior': 3,
  'Suite Prestige': 2,
  'Suite Royale': 1,
};

function getInventoryFromAdmin() {
  try {
    const stored = JSON.parse(localStorage.getItem('gp_room_inventory') || 'null');
    if (!stored) return { inventory: ROOM_INVENTORY_DEFAULT, capacity: ROOM_CAPACITY_DEFAULT };
    const inv = {}, cap = {};
    Object.entries(stored).forEach(([name, data]) => {
      inv[name] = data.count;
      cap[name] = data.capacity;
    });
    return { inventory: inv, capacity: cap };
  } catch(_) { return { inventory: ROOM_INVENTORY_DEFAULT, capacity: ROOM_CAPACITY_DEFAULT }; }
}

const ROOM_CAPACITY = new Proxy({}, { get(_, prop) { return getInventoryFromAdmin().capacity[prop]; } });
const ROOM_INVENTORY = new Proxy({}, { get(_, prop) { return getInventoryFromAdmin().inventory[prop]; } });

function isRoomAvailable(roomName, checkin, checkout) {
  const { inventory } = getInventoryFromAdmin();
  const total = inventory[roomName] || 0;
  const existing = JSON.parse(localStorage.getItem('gp_reservations') || '[]');
  const conflicts = existing.filter(r =>
    r.status !== 'cancelled' &&
    r.room === roomName &&
    r.checkin < checkout &&
    r.checkout > checkin
  );
  const remaining = total - conflicts.length;
  return { available: remaining > 0, remaining: Math.max(0, remaining), total };
}

function checkCapacityAndSuggest(roomName, guests, targetContainerId) {
  const container = document.getElementById(targetContainerId);
  if (container) { container.innerHTML = ''; container.hidden = true; }
  const { capacity } = getInventoryFromAdmin();
  const maxCap = capacity[roomName];
  if (!maxCap || guests <= maxCap) return true;

  // Find cheapest room that fits
  const sorted = Object.entries(capacity)
    .filter(([, cap]) => cap >= guests)
    .sort((a, b) => (ROOMS[a[0]]?.price || Infinity) - (ROOMS[b[0]]?.price || Infinity));

  if (sorted.length && container) {
    const [suggestedRoom] = sorted[0];
    const suggestedPrice = ROOMS[suggestedRoom]?.price || 0;
    container.hidden = false;
    container.innerHTML = `
      <div style="background:rgba(201,168,76,.12);border:1px solid rgba(201,168,76,.3);border-radius:8px;padding:10px 14px;margin-top:8px;font-size:.82rem;color:#c9a84c">
        ⚠ La ${sanitize(roomName)} accueille ${maxCap} voyageurs max.
        Pour ${guests} voyageurs, nous suggérons la <strong>${sanitize(suggestedRoom)}</strong> (${suggestedPrice.toLocaleString('fr-FR')} €/nuit).
        <button type="button" class="btn btn-gold" style="margin-top:6px;padding:4px 14px;font-size:.78rem"
          onclick="switchRoom('${suggestedRoom.replace(/'/g, "\\'")}', '${targetContainerId}')">
          Choisir ${sanitize(suggestedRoom)}
        </button>
      </div>`;
  }
  return false;
}

function switchRoom(roomName, containerId) {
  const entry = Object.entries(ROOMS).find(([n]) => n === roomName);
  if (!entry) return;
  if (containerId === 'upgrade-suggestion-modal') {
    modalRoom = roomName;
    modalPrice = entry[1].price;
    const el = document.getElementById('modalRoomName');
    if (el) el.textContent = roomName + ' · ' + entry[1].price.toLocaleString('fr-FR') + ' €/nuit';
    updateModalSummary();
  } else {
    const sel = document.getElementById('res-room');
    if (sel) { sel.value = entry[1].code; updateFormSummary(); }
  }
  const container = document.getElementById(containerId);
  if (container) { container.innerHTML = ''; container.hidden = true; }
}

let modalRoom  = null;
let modalPrice = 0;

/* =====================================================
   DATES
   ===================================================== */
function today()    { return new Date().toISOString().split('T')[0]; }
function tomorrow() { const d = new Date(); d.setDate(d.getDate() + 1); return d.toISOString().split('T')[0]; }

function setDates() {
  [['qb-checkin', today()], ['qb-checkout', tomorrow()],
   ['res-checkin', today()], ['res-checkout', tomorrow()],
   ['m-checkin',  today()], ['m-checkout',  tomorrow()]].forEach(([id, val]) => {
    const el = document.getElementById(id);
    if (el) { el.min = today(); el.value = val; }
  });
}
setDates();

/* =====================================================
   NAVBAR
   ===================================================== */
const navbar    = document.getElementById('navbar');
const navToggle = document.getElementById('navToggle');
const navLinks  = document.getElementById('navLinks');

window.addEventListener('scroll', () => {
  navbar.classList.toggle('scrolled', window.scrollY > 60);
}, { passive: true });

navToggle?.addEventListener('click', () => {
  const open = navLinks.classList.toggle('open');
  navToggle.setAttribute('aria-expanded', String(open));
  document.body.style.overflow = open ? 'hidden' : '';
});

navLinks?.querySelectorAll('a').forEach(a => {
  a.addEventListener('click', () => {
    navLinks.classList.remove('open');
    navToggle.setAttribute('aria-expanded', 'false');
    document.body.style.overflow = '';
  });
});

document.addEventListener('click', e => {
  if (!navbar?.contains(e.target) && navLinks?.classList.contains('open')) {
    navLinks.classList.remove('open');
    navToggle.setAttribute('aria-expanded', 'false');
    document.body.style.overflow = '';
  }
});

/* Active nav highlight */
const sections = document.querySelectorAll('section[id]');
const navAnchors = document.querySelectorAll('.nav-links a[href^="#"]');
new IntersectionObserver(entries => {
  entries.forEach(e => {
    if (e.isIntersecting) {
      navAnchors.forEach(a => a.classList.remove('active'));
      document.querySelector(`.nav-links a[href="#${e.target.id}"]`)?.classList.add('active');
    }
  });
}, { threshold: 0.35 }).observe && sections.forEach(s => {
  new IntersectionObserver(entries => {
    entries.forEach(e => {
      if (e.isIntersecting) {
        navAnchors.forEach(a => a.classList.remove('active'));
        document.querySelector(`.nav-links a[href="#${e.target.id}"]`)?.classList.add('active');
      }
    });
  }, { threshold: 0.35 }).observe(s);
});

/* Smooth scroll with navbar offset */
document.querySelectorAll('a[href^="#"]').forEach(a => {
  a.addEventListener('click', e => {
    const id = a.getAttribute('href').slice(1);
    if (!id) return;
    const target = document.getElementById(id);
    if (!target) return;
    e.preventDefault();
    const top = target.getBoundingClientRect().top + window.scrollY - (navbar?.offsetHeight || 80) - 16;
    window.scrollTo({ top, behavior: 'smooth' });
  });
});

/* =====================================================
   QUICK BOOKING
   ===================================================== */
const qbIn  = document.getElementById('qb-checkin');
const qbOut = document.getElementById('qb-checkout');

qbIn?.addEventListener('change', () => {
  const next = new Date(qbIn.value);
  next.setDate(next.getDate() + 1);
  const str = next.toISOString().split('T')[0];
  qbOut.min = str;
  if (qbOut.value <= qbIn.value) qbOut.value = str;
});

function scrollToBooking() {
  const room = document.getElementById('qb-room')?.value;
  const s = document.getElementById('reservation');
  if (s) {
    const top = s.getBoundingClientRect().top + window.scrollY - (navbar?.offsetHeight || 80) - 16;
    window.scrollTo({ top, behavior: 'smooth' });
    if (room) {
      const sel = document.getElementById('res-room');
      if (sel) { sel.value = room; updateFormSummary(); }
    }
    setTimeout(() => {
      const rIn  = document.getElementById('res-checkin');
      const rOut = document.getElementById('res-checkout');
      if (rIn && qbIn?.value)  rIn.value  = qbIn.value;
      if (rOut && qbOut?.value) rOut.value = qbOut.value;
      updateFormSummary();
    }, 100);
  }
}

/* =====================================================
   OPTIONS CALCULATION
   ===================================================== */
function calcOptionsExtra(optionsMap, nights, guests) {
  let extra = 0;
  const lines = [];
  Object.entries(optionsMap).forEach(([key, cfg]) => {
    if (!cfg.checked) return;
    let cost = 0;
    if (cfg.type === 'fixed')          cost = cfg.price;
    if (cfg.type === 'perNight')       cost = cfg.price * nights;
    if (cfg.type === 'perPersonNight') cost = cfg.price * guests * nights;
    extra += cost;
    lines.push({ label: cfg.label, cost });
  });
  return { extra, lines };
}

function getFormOptions() {
  const ids = { breakfast: 'opt-breakfast', pets: 'opt-pets', transfer: 'opt-transfer', latecheckout: 'opt-latecheckout', romantic: 'opt-romantic', breakfastbed: 'opt-breakfast-bed' };
  const map = {};
  Object.entries(ids).forEach(([key, id]) => {
    const el = document.getElementById(id);
    if (el) map[key] = { ...OPTIONS_PRICES[key], checked: el.checked };
  });
  return map;
}

function getModalOptions() {
  const map = {};
  Object.entries(MODAL_OPTIONS).forEach(([key, cfg]) => {
    const el = document.getElementById(cfg.id);
    if (el) map[key] = { ...OPTIONS_PRICES[key], price: cfg.price, type: cfg.type, checked: el.checked };
  });
  return map;
}

/* =====================================================
   MAIN RESERVATION FORM
   ===================================================== */
const resForm     = document.getElementById('reservationForm');
const formSummary = document.getElementById('formSummary');

function calcNights(a, b) {
  if (!a || !b) return 0;
  return Math.max(0, Math.round((new Date(b) - new Date(a)) / 86400000));
}

function fmtDate(s) {
  return new Date(s).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' });
}

function fmtPrice(n) {
  return n.toLocaleString('fr-FR') + ' €';
}

function updateFormSummary() {
  const checkin  = document.getElementById('res-checkin')?.value;
  const checkout = document.getElementById('res-checkout')?.value;
  const roomCode = document.getElementById('res-room')?.value;
  const guests   = parseInt(document.getElementById('res-guests')?.value || '2');

  if (!checkin || !checkout || !roomCode) { hideSummary(formSummary); return; }
  const nights = calcNights(checkin, checkout);
  if (nights <= 0) { hideSummary(formSummary); return; }

  const entry = Object.entries(ROOMS).find(([, v]) => v.code === roomCode);
  if (!entry) { hideSummary(formSummary); return; }
  const [name, { price }] = entry;

  const opts = getFormOptions();
  const { extra, lines } = calcOptionsExtra(opts, nights, guests);
  const base  = price * nights;
  const total = base + extra;

  let html = `
    <div class="summary-label">Récapitulatif de votre demande</div>
    <div><strong style="color:rgba(255,255,255,.85)">${name}</strong></div>
    <div>Du ${fmtDate(checkin)} au ${fmtDate(checkout)} · ${nights} nuit${nights > 1 ? 's' : ''} · ${guests} voyageur${guests > 1 ? 's' : ''}</div>
    <div>${nights} × ${fmtPrice(price)} = ${fmtPrice(base)}</div>
  `;
  if (lines.length) {
    lines.forEach(l => { html += `<div style="color:rgba(255,255,255,.5);font-size:.78rem">+ ${l.label} : ${fmtPrice(l.cost)}</div>`; });
  }
  html += `<span class="summary-total">${fmtPrice(total)}</span>`;
  html += `<div style="font-size:.72rem;color:rgba(255,255,255,.3);margin-top:4px">✓ Annulation gratuite jusqu'à 48h · ✓ Aucun débit avant confirmation</div>`;

  formSummary.innerHTML = html;
  formSummary.classList.add('visible');
}

function hideSummary(el) {
  if (el) { el.classList.remove('visible'); el.innerHTML = ''; }
}

['res-checkin', 'res-checkout', 'res-room', 'res-guests'].forEach(id => {
  document.getElementById(id)?.addEventListener('change', updateFormSummary);
});

document.querySelectorAll('.options-grid input[type="checkbox"]').forEach(cb => {
  cb.addEventListener('change', updateFormSummary);
});

/* Capacity check on guest/room change (main form) */
['res-guests', 'res-room'].forEach(id => {
  document.getElementById(id)?.addEventListener('change', () => {
    const roomCode = document.getElementById('res-room')?.value;
    const guests = parseInt(document.getElementById('res-guests')?.value || '2');
    const entry = Object.entries(ROOMS).find(([, v]) => v.code === roomCode);
    if (entry) checkCapacityAndSuggest(entry[0], guests, 'upgrade-suggestion-form');
  });
});

document.getElementById('res-checkin')?.addEventListener('change', () => {
  const rIn  = document.getElementById('res-checkin');
  const rOut = document.getElementById('res-checkout');
  if (!rIn || !rOut) return;
  const next = new Date(rIn.value); next.setDate(next.getDate() + 1);
  const str  = next.toISOString().split('T')[0];
  rOut.min = str;
  if (rOut.value <= rIn.value) rOut.value = str;
  updateFormSummary();
});

/* Form submit */
resForm?.addEventListener('submit', e => {
  e.preventDefault();
  if (!validateForm(resForm)) return;

  const roomCode = document.getElementById('res-room')?.value;
  const entry = Object.entries(ROOMS).find(([, v]) => v.code === roomCode);
  const roomName = entry ? entry[0] : '';
  const checkin  = document.getElementById('res-checkin')?.value;
  const checkout = document.getElementById('res-checkout')?.value;
  const guests   = parseInt(document.getElementById('res-guests')?.value || '2');

  /* Availability check */
  const avail = isRoomAvailable(roomName, checkin, checkout);
  if (!avail.available) {
    showPopup({ type:'error', title:'Chambre indisponible', text:`Désolé, la ${roomName} est complète sur cette période. Veuillez choisir d'autres dates ou une autre chambre.` });
    return;
  }

  /* Capacity check */
  const maxCap = ROOM_CAPACITY[roomName] || 99;
  if (guests > maxCap) {
    showPopup({
      type:'confirm',
      title:'Capacité dépassée',
      text:`La ${roomName} accueille ${maxCap} voyageurs maximum. Souhaitez-vous choisir une chambre plus grande ?`,
      buttons:[{ label:'Changer de chambre', class:'btn btn-gold' }, { label:'Annuler', class:'btn btn-outline' }]
    });
    return;
  }

  submitForm(resForm, () => {
    const res = buildReservation('form');
    saveReservation(res);
    showPopup({ type:'success', title:'Demande envoyée !', text:'Notre équipe vous contactera sous 2 heures pour confirmer votre réservation.', autoClose:4500 });
    resForm.reset();
    hideSummary(formSummary);
    setDates();
    document.querySelectorAll('.options-grid input').forEach(cb => cb.checked = false);
  });
});

/* =====================================================
   BOOKING MODAL
   ===================================================== */
const modal             = document.getElementById('bookingModal');
const modalRoomNameEl   = document.getElementById('modalRoomName');
const modalPriceSummary = document.getElementById('modalPriceSummary');
const modalForm         = document.getElementById('modalForm');

function openBookingModal(roomName, price) {
  modalRoom  = roomName;
  modalPrice = price;
  if (modalRoomNameEl) modalRoomNameEl.textContent = `${roomName} · ${price.toLocaleString('fr-FR')} €/nuit`;

  // Sync dates & room select on main form
  const rIn  = document.getElementById('res-checkin');
  const rOut = document.getElementById('res-checkout');
  const mIn  = document.getElementById('m-checkin');
  const mOut = document.getElementById('m-checkout');
  if (mIn)  mIn.value  = (rIn?.value  || qbIn?.value)  || today();
  if (mOut) mOut.value = (rOut?.value || qbOut?.value) || tomorrow();

  const roomSel = document.getElementById('res-room');
  const entry = Object.entries(ROOMS).find(([n]) => n === roomName);
  if (entry && roomSel) { roomSel.value = entry[1].code; updateFormSummary(); }

  updateModalSummary();
  modal.classList.add('open');
  modal.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
  setTimeout(() => modal.querySelector('input, select')?.focus(), 120);
}

function closeBookingModal() {
  modal.classList.remove('open');
  modal.setAttribute('aria-hidden', 'true');
  document.body.style.overflow = '';
}

function updateModalSummary() {
  const mIn  = document.getElementById('m-checkin');
  const mOut = document.getElementById('m-checkout');
  const guests = parseInt(document.getElementById('m-guests')?.value || '2');
  if (!mIn?.value || !mOut?.value) { hideSummary(modalPriceSummary); return; }
  const nights = calcNights(mIn.value, mOut.value);
  if (nights <= 0 || !modalRoom) { hideSummary(modalPriceSummary); return; }

  const opts  = getModalOptions();
  const { extra, lines } = calcOptionsExtra(opts, nights, guests);
  const base  = modalPrice * nights;
  const total = base + extra;

  let html = `
    <div><strong style="color:rgba(255,255,255,.85)">${modalRoom}</strong></div>
    <div>${nights} nuit${nights > 1 ? 's' : ''} × ${fmtPrice(modalPrice)} = ${fmtPrice(base)}</div>
  `;
  lines.forEach(l => { html += `<div style="color:rgba(255,255,255,.5);font-size:.78rem">+ ${l.label} : ${fmtPrice(l.cost)}</div>`; });
  html += `<span class="summary-total">${fmtPrice(total)}</span>`;

  modalPriceSummary.innerHTML = html;
  modalPriceSummary.classList.add('visible');
}

['m-checkin', 'm-checkout', 'm-guests'].forEach(id => {
  document.getElementById(id)?.addEventListener('change', updateModalSummary);
});
document.querySelectorAll('.modal-options-grid input').forEach(cb => {
  cb.addEventListener('change', updateModalSummary);
});

/* Capacity check on guest change (modal) */
document.getElementById('m-guests')?.addEventListener('change', () => {
  const guests = parseInt(document.getElementById('m-guests')?.value || '2');
  if (modalRoom) checkCapacityAndSuggest(modalRoom, guests, 'upgrade-suggestion-modal');
});

document.getElementById('m-checkin')?.addEventListener('change', () => {
  const mIn  = document.getElementById('m-checkin');
  const mOut = document.getElementById('m-checkout');
  const next = new Date(mIn.value); next.setDate(next.getDate() + 1);
  const str  = next.toISOString().split('T')[0];
  mOut.min = str;
  if (mOut.value <= mIn.value) mOut.value = str;
  updateModalSummary();
});

modalForm?.addEventListener('submit', e => {
  e.preventDefault();
  if (!validateForm(modalForm)) return;

  const checkin  = document.getElementById('m-checkin')?.value;
  const checkout = document.getElementById('m-checkout')?.value;
  const guests   = parseInt(document.getElementById('m-guests')?.value || '2');

  /* Availability check */
  const avail = isRoomAvailable(modalRoom, checkin, checkout);
  if (!avail.available) {
    showPopup({ type:'error', title:'Chambre indisponible', text:`Désolé, la ${modalRoom} est complète sur cette période. Veuillez choisir d'autres dates ou une autre chambre.` });
    return;
  }

  /* Capacity check */
  const maxCap = ROOM_CAPACITY[modalRoom] || 99;
  if (guests > maxCap) {
    showPopup({
      type:'confirm',
      title:'Capacité dépassée',
      text:`La ${modalRoom} accueille ${maxCap} voyageurs maximum. Souhaitez-vous choisir une chambre plus grande ?`,
      buttons:[{ label:'Changer de chambre', class:'btn btn-gold' }, { label:'Annuler', class:'btn btn-outline' }]
    });
    return;
  }

  submitForm(modalForm, () => {
    const res = buildReservation('modal');
    saveReservation(res);
    closeBookingModal();
    showPopup({ type:'success', title:'Demande envoyée !', text:'Notre équipe vous contactera sous 2 heures pour confirmer votre réservation.', autoClose:4500 });
    modalForm.reset();
    hideSummary(modalPriceSummary);
    document.querySelectorAll('.modal-options-grid input').forEach(cb => cb.checked = false);
  });
});

document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && modal?.classList.contains('open')) closeBookingModal();
});

/* =====================================================
   RESERVATION DATA
   ===================================================== */
function buildReservation(source) {
  const isModal = source === 'modal';
  const checkin  = document.getElementById(isModal ? 'm-checkin'  : 'res-checkin')?.value;
  const checkout = document.getElementById(isModal ? 'm-checkout' : 'res-checkout')?.value;
  const guests   = parseInt(document.getElementById(isModal ? 'm-guests' : 'res-guests')?.value || '2');
  const nights   = calcNights(checkin, checkout);

  const room   = isModal ? modalRoom : (Object.entries(ROOMS).find(([, v]) => v.code === document.getElementById('res-room')?.value)?.[0] || '');
  const price  = isModal ? modalPrice : (ROOMS[room]?.price || 0);

  const opts = isModal ? getModalOptions() : (() => {
    const map = {};
    const ids = { breakfast: 'opt-breakfast', pets: 'opt-pets', transfer: 'opt-transfer', latecheckout: 'opt-latecheckout', romantic: 'opt-romantic', breakfastbed: 'opt-breakfast-bed' };
    Object.entries(ids).forEach(([k, id]) => {
      const el = document.getElementById(id);
      if (el) map[k] = { ...OPTIONS_PRICES[k], checked: el.checked };
    });
    return map;
  })();

  const { extra } = calcOptionsExtra(opts, nights, guests);

  const optionsList = {};
  Object.entries(opts).forEach(([k, v]) => { optionsList[k] = v.checked || false; });

  return {
    id:        'RES-' + Date.now(),
    status:    'pending',
    createdAt: new Date().toISOString(),
    firstname: document.getElementById(isModal ? 'm-firstname' : 'res-firstname')?.value || '',
    lastname:  document.getElementById(isModal ? 'm-lastname'  : 'res-lastname')?.value  || '',
    email:     document.getElementById(isModal ? 'm-email'     : 'res-email')?.value     || '',
    phone:     document.getElementById('res-phone')?.value || '',
    checkin, checkout, room, guests, nights,
    pricePerNight: price,
    options:   optionsList,
    totalPrice: price * nights + extra,
    requests:  document.getElementById('res-requests')?.value || '',
    source,
  };
}

function saveReservation(res) {
  const all = JSON.parse(localStorage.getItem('gp_reservations') || '[]');
  all.unshift(res);
  localStorage.setItem('gp_reservations', JSON.stringify(all));
}

/* =====================================================
   FORM VALIDATION
   ===================================================== */
function validateForm(form) {
  let ok = true;
  form.querySelectorAll('[required]').forEach(f => {
    f.classList.remove('error');
    if (!f.value.trim()) { f.classList.add('error'); ok = false; }
  });
  form.querySelectorAll('[type="email"]').forEach(f => {
    if (f.value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.value)) { f.classList.add('error'); ok = false; }
  });
  if (!ok) {
    const first = form.querySelector('.error');
    first?.focus();
    first?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  return ok;
}

document.querySelectorAll('input, select, textarea').forEach(el => {
  el.addEventListener('input', () => el.classList.remove('error'));
});

function submitForm(form, cb) {
  const btn = form.querySelector('[type="submit"]');
  if (!btn) return;
  const orig = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<span style="opacity:.7">Envoi en cours…</span>';
  setTimeout(() => { btn.disabled = false; btn.innerHTML = orig; cb(); }, 1400);
}

/* =====================================================
   TOAST
   ===================================================== */
const toast = document.getElementById('successToast');
let toastTimer;

function showToast() {
  toast?.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast?.classList.remove('show'), 5500);
}

function hideToast() {
  toast?.classList.remove('show');
}

/* =====================================================
   POPUP SYSTEM
   ===================================================== */
function showPopup({ type = 'success', title = '', text = '', buttons = [], autoClose = 0 }) {
  return new Promise(resolve => {
    const overlay = document.getElementById('popupOverlay');
    const box = document.getElementById('popupBox');
    const icons = { success:'\u2713', error:'\u2717', confirm:'?', info:'\u2139' };
    const colors = { success:'#22c55e', error:'#ef4444', confirm:'#c9a84c', info:'#3b82f6' };

    document.getElementById('popupIcon').innerHTML = `<span style="background:${colors[type]};width:64px;height:64px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:1.8rem;color:#fff;margin:0 auto 16px;animation:popupIconBounce 0.5s ease 0.15s both">${icons[type]}</span>`;
    document.getElementById('popupTitle').textContent = title;
    document.getElementById('popupText').textContent = text;

    const actionsEl = document.getElementById('popupActions');
    if (buttons.length === 0) buttons = [{ label: 'OK', class: 'btn btn-gold' }];
    actionsEl.innerHTML = buttons.map((b, i) =>
      `<button class="${b.class || 'btn btn-gold'}" data-idx="${i}">${sanitize(b.label)}</button>`
    ).join('');

    actionsEl.querySelectorAll('button').forEach(btn => {
      btn.onclick = () => { closePopup(); resolve(parseInt(btn.dataset.idx)); };
    });

    overlay.hidden = false;
    overlay.classList.add('popup-active');
    document.body.style.overflow = 'hidden';

    if (autoClose > 0) setTimeout(() => { closePopup(); resolve(-1); }, autoClose);
  });
}

function closePopup() {
  const overlay = document.getElementById('popupOverlay');
  overlay.classList.remove('popup-active');
  setTimeout(() => { overlay.hidden = true; document.body.style.overflow = ''; }, 350);
}

/* =====================================================
   SCROLL REVEAL
   ===================================================== */
function initReveal() {
  const targets = document.querySelectorAll('.room-card, .service-card, .testi-card, .exp-stat, .contact-item, .gal-item, .award-item');
  targets.forEach((el, i) => {
    el.classList.add('reveal');
    el.style.transitionDelay = `${(i % 5) * 0.08}s`;
  });
  new IntersectionObserver((entries) => {
    entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add('visible'); } });
  }, { threshold: 0.1, rootMargin: '0px 0px -40px 0px' })
    .observe && targets.forEach(el => {
      new IntersectionObserver(([e]) => { if (e.isIntersecting) e.target.classList.add('visible'); }, { threshold: 0.1 }).observe(el);
    });
}
initReveal();

/* =====================================================
   SAMPLE DATA (pour démo admin)
   ===================================================== */
function seedSampleData() {
  if (localStorage.getItem('gp_seeded')) return;
  const samples = [
    { id:'RES-1001', status:'confirmed', createdAt:'2026-03-01T10:30:00Z', firstname:'Sophie', lastname:'Lambert', email:'sophie.lambert@email.fr', phone:'+33 6 12 34 56 78', checkin:'2026-03-15', checkout:'2026-03-18', room:'Suite Prestige', guests:2, nights:3, pricePerNight:1800, options:{ breakfast:true, pets:false, transfer:true, latecheckout:false, romantic:true, breakfastbed:false }, totalPrice:6130, requests:'Anniversaire de mariage, fleurs souhaitées', source:'form' },
    { id:'RES-1002', status:'pending',   createdAt:'2026-03-05T14:15:00Z', firstname:'James',  lastname:'Wilson',  email:'j.wilson@corporate.com',   phone:'+44 20 7123 4567',  checkin:'2026-03-20', checkout:'2026-03-22', room:'Chambre Deluxe', guests:1, nights:2, pricePerNight:650, options:{ breakfast:true, pets:false, transfer:true, latecheckout:true, romantic:false, breakfastbed:false }, totalPrice:1490, requests:'Early check-in souhaité 10h si possible', source:'modal' },
    { id:'RES-1003', status:'checkin',   createdAt:'2026-03-08T09:00:00Z', firstname:'Marie',  lastname:'Dubois',  email:'marie.dubois@gmail.com',    phone:'+33 1 42 00 11 22',  checkin:'2026-03-10', checkout:'2026-03-14', room:'Suite Junior', guests:2, nights:4, pricePerNight:950, options:{ breakfast:true, pets:true, transfer:false, latecheckout:false, romantic:false, breakfastbed:false }, totalPrice:4180, requests:'Allergie aux noix', source:'form' },
    { id:'RES-1004', status:'pending',   createdAt:'2026-03-09T16:45:00Z', firstname:'Ahmed',  lastname:'Al-Rashid', email:'a.rashid@investment.ae', phone:'+971 50 123 4567', checkin:'2026-04-01', checkout:'2026-04-08', room:'Suite Royale', guests:4, nights:7, pricePerNight:3500, options:{ breakfast:true, pets:false, transfer:true, latecheckout:true, romantic:false, breakfastbed:true }, totalPrice:27180, requests:'Besoin de 2 suites communicantes si possible. Chef privé pour 3 repas.', source:'modal' },
    { id:'RES-1005', status:'cancelled', createdAt:'2026-02-20T11:00:00Z', firstname:'Claire', lastname:'Martin',  email:'cmartin@outlook.fr',        phone:'+33 6 98 76 54 32',  checkin:'2026-03-05', checkout:'2026-03-07', room:'Chambre Classique', guests:2, nights:2, pricePerNight:450, options:{ breakfast:false, pets:false, transfer:false, latecheckout:false, romantic:false, breakfastbed:false }, totalPrice:900, requests:'', source:'form' },
    { id:'RES-1006', status:'checkout',  createdAt:'2026-03-01T08:30:00Z', firstname:'Hans',   lastname:'Mueller', email:'hans.mueller@business.de',  phone:'+49 89 123 456 78',  checkin:'2026-03-08', checkout:'2026-03-10', room:'Chambre Deluxe', guests:2, nights:2, pricePerNight:650, options:{ breakfast:true, pets:false, transfer:true, latecheckout:false, romantic:false, breakfastbed:false }, totalPrice:1580, requests:'', source:'modal' },
    { id:'RES-1007', status:'confirmed', createdAt:'2026-03-10T13:20:00Z', firstname:'Isabelle', lastname:'Petit', email:'isabelle.petit@luxe.fr',    phone:'+33 6 45 67 89 01',  checkin:'2026-03-25', checkout:'2026-03-28', room:'Suite Prestige', guests:2, nights:3, pricePerNight:1800, options:{ breakfast:true, pets:false, transfer:false, latecheckout:true, romantic:true, breakfastbed:false }, totalPrice:5680, requests:'Décoration avec orchidées blanches', source:'form' },
    { id:'RES-1008', status:'pending',   createdAt:'2026-03-11T18:00:00Z', firstname:'Liu',    lastname:'Wei',     email:'liu.wei@shanghai.cn',       phone:'+86 138 0000 1234',  checkin:'2026-04-15', checkout:'2026-04-20', room:'Suite Royale', guests:2, nights:5, pricePerNight:3500, options:{ breakfast:true, pets:false, transfer:true, latecheckout:true, romantic:true, breakfastbed:false }, totalPrice:18980, requests:'Interprète mandarin souhaité', source:'form' },
  ];
  localStorage.setItem('gp_reservations', JSON.stringify(samples));
  localStorage.setItem('gp_seeded', '1');
}
seedSampleData();

/* =====================================================
   AVAILABILITY CHECKER
   ===================================================== */
function checkAvailability() {
  const checkin  = document.getElementById('qb-checkin')?.value;
  const checkout = document.getElementById('qb-checkout')?.value;
  const roomFilter = document.getElementById('qb-room')?.value;

  if (!checkin || !checkout) {
    showToast(); // reuse toast to alert
    return;
  }

  const nights = calcNights(checkin, checkout);
  if (nights <= 0) return;

  const existing = JSON.parse(localStorage.getItem('gp_reservations') || '[]')
    .filter(r => r.status !== 'cancelled');

  const panel = document.getElementById('availabilityResults');
  const grid  = document.getElementById('availGrid');
  const dates = document.getElementById('availDates');

  dates.textContent = `Du ${fmtDate(checkin)} au ${fmtDate(checkout)} · ${nights} nuit${nights > 1 ? 's' : ''}`;

  const allRooms = [
    { name: 'Chambre Classique', code: 'classique', price: 450 },
    { name: 'Chambre Deluxe',    code: 'deluxe',    price: 650 },
    { name: 'Suite Junior',      code: 'junior',    price: 950 },
    { name: 'Suite Prestige',    code: 'prestige',  price: 1800 },
    { name: 'Suite Royale',      code: 'royale',    price: 3500 },
  ];

  const rooms = roomFilter ? allRooms.filter(r => r.code === roomFilter) : allRooms;

  grid.innerHTML = rooms.map(room => {
    const conflicts = existing.filter(r =>
      r.room === room.name && r.checkin < checkout && r.checkout > checkin
    );
    const inventory = ROOM_INVENTORY[room.name] || 1;
    const remaining = Math.max(0, inventory - conflicts.length);
    const available = remaining > 0;
    const total = room.price * nights;

    return `
      <div class="avail-card ${available ? 'available' : 'unavailable'}"
           ${available ? `onclick="openBookingModal('${room.name}', ${room.price})"` : ''}>
        <div class="avail-card-name">${room.name}</div>
        <div class="avail-card-price">${room.price.toLocaleString('fr-FR')} € / nuit</div>
        <div class="avail-card-status ${available ? 'open' : 'taken'}">
          ${available ? `✓ ${remaining} chambre${remaining>1?'s':''} disponible${remaining>1?'s':''}` : '✗ Complet'}
        </div>
        ${available ? `
          <div style="font-size:.78rem;color:rgba(255,255,255,.45);margin-top:6px">${nights} nuit${nights>1?'s':''} · <strong style="color:#c9a84c">${total.toLocaleString('fr-FR')} €</strong></div>
          <button class="avail-card-btn">Réserver →</button>
        ` : `<div style="font-size:.72rem;color:rgba(255,255,255,.25);margin-top:8px">Complet sur cette période</div>`}
      </div>
    `;
  }).join('');

  panel.hidden = false;
  panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function closeAvailability() {
  document.getElementById('availabilityResults').hidden = true;
}

/* =====================================================
   PROMO CODES
   ===================================================== */
const PROMO_CODES = {
  'BIENVENUE10':  { discount: 10, type: 'percent', label: '10% de réduction', minNights: 1 },
  'LUXURY20':     { discount: 20, type: 'percent', label: '20% de réduction', minNights: 3 },
  'PALACE50':     { discount: 50, type: 'fixed',   label: '50 € de réduction', minNights: 1 },
  'WEEKEND15':    { discount: 15, type: 'percent', label: '15% le week-end', minNights: 2 },
  'PRESTIGE100':  { discount: 100, type: 'fixed',  label: '100 € de réduction', minNights: 2 },
};

let activePromo = null;

function applyPromoCode() {
  const input  = document.getElementById('res-promo');
  const result = document.getElementById('promoResult');
  const code   = input?.value.trim().toUpperCase();

  if (!code) {
    result.className = 'promo-result error';
    result.textContent = 'Veuillez entrer un code promotionnel.';
    return;
  }

  const promo = PROMO_CODES[code];
  if (!promo) {
    result.className = 'promo-result error';
    result.textContent = `❌ Code "${code}" invalide ou expiré.`;
    activePromo = null;
    updateFormSummary();
    return;
  }

  activePromo = { ...promo, code };
  result.className = 'promo-result success';
  result.textContent = `✓ Code "${code}" appliqué ! ${promo.label}${promo.minNights > 1 ? ` (min. ${promo.minNights} nuits)` : ''}`;
  updateFormSummary();
}

/* Patch the summary to show promo discount */
const _origUpdateFormSummary = updateFormSummary;
updateFormSummary = function() {
  const checkin  = document.getElementById('res-checkin')?.value;
  const checkout = document.getElementById('res-checkout')?.value;
  const roomCode = document.getElementById('res-room')?.value;
  const guests   = parseInt(document.getElementById('res-guests')?.value || '2');

  if (!checkin || !checkout || !roomCode) { hideSummary(formSummary); return; }
  const nights = calcNights(checkin, checkout);
  if (nights <= 0) { hideSummary(formSummary); return; }

  const entry = Object.entries(ROOMS).find(([, v]) => v.code === roomCode);
  if (!entry) { hideSummary(formSummary); return; }
  const [name, { price }] = entry;

  const opts = getFormOptions();
  const { extra, lines } = calcOptionsExtra(opts, nights, guests);
  const base  = price * nights;
  let total = base + extra;

  let html = `
    <div class="summary-label">Récapitulatif de votre demande</div>
    <div><strong style="color:rgba(255,255,255,.85)">${name}</strong></div>
    <div>Du ${fmtDate(checkin)} au ${fmtDate(checkout)} · ${nights} nuit${nights > 1 ? 's' : ''} · ${guests} voyageur${guests > 1 ? 's' : ''}</div>
    <div>${nights} × ${fmtPrice(price)} = ${fmtPrice(base)}</div>
  `;
  if (lines.length) {
    lines.forEach(l => { html += `<div style="color:rgba(255,255,255,.5);font-size:.78rem">+ ${l.label} : ${fmtPrice(l.cost)}</div>`; });
  }

  // Promo
  if (activePromo && nights >= activePromo.minNights) {
    let discount = 0;
    if (activePromo.type === 'percent') discount = Math.round(total * activePromo.discount / 100);
    else discount = activePromo.discount;
    discount = Math.min(discount, total);
    html += `<div style="color:#4ade80;font-size:.82rem;margin-top:4px">🏷 Code ${activePromo.code} : -${fmtPrice(discount)}</div>`;
    total -= discount;
  }

  html += `<span class="summary-total">${fmtPrice(total)}</span>`;
  html += `<div style="font-size:.72rem;color:rgba(255,255,255,.3);margin-top:4px">✓ Annulation gratuite jusqu'à 48h · ✓ Aucun débit avant confirmation</div>`;

  formSummary.innerHTML = html;
  formSummary.classList.add('visible');
};

/* =====================================================
   FAQ ACCORDION
   ===================================================== */
function toggleFaq(btn) {
  const item = btn.closest('.faq-item');
  const wasOpen = item.classList.contains('open');

  // Close all in same column
  item.closest('.faq-col')?.querySelectorAll('.faq-item').forEach(f => {
    f.classList.remove('open');
    f.querySelector('.faq-q')?.setAttribute('aria-expanded', 'false');
  });

  if (!wasOpen) {
    item.classList.add('open');
    btn.setAttribute('aria-expanded', 'true');
  }
}

/* =====================================================
   NEWSLETTER
   ===================================================== */
function subscribeNewsletter(e) {
  e.preventDefault();
  const email = document.getElementById('nl-email')?.value;
  if (!email) return;

  const btn = e.target.querySelector('button');
  const orig = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Inscription…';

  setTimeout(() => {
    btn.disabled = false;
    btn.textContent = orig;
    document.getElementById('nl-email').value = '';

    // Save to localStorage
    const list = JSON.parse(localStorage.getItem('gp_newsletter') || '[]');
    if (!list.includes(email)) { list.push(email); localStorage.setItem('gp_newsletter', JSON.stringify(list)); }

    showToastCustom('✓ Inscription confirmée !', `Un email de confirmation a été envoyé à ${email}`);
  }, 1200);
}

function showToastCustom(title, text) {
  const t = document.getElementById('successToast');
  if (!t) return;
  t.querySelector('strong').textContent = title;
  t.querySelector('p').textContent = text;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 5500);
}

/* =====================================================
   LIGHTBOX GALLERY
   ===================================================== */
const GALLERY_IMAGES = [
  'https://images.unsplash.com/photo-1564501049412-61c2a3083791?auto=format&fit=crop&w=1600&q=90',
  'https://images.unsplash.com/photo-1566073771259-6a8506099945?auto=format&fit=crop&w=1600&q=90',
  'https://images.unsplash.com/photo-1414235077428-338989a2e8c0?auto=format&fit=crop&w=1600&q=90',
  'https://images.unsplash.com/photo-1582719478250-c89cae4dc85b?auto=format&fit=crop&w=1600&q=90',
  'https://images.unsplash.com/photo-1544161515-4ab6ce6db874?auto=format&fit=crop&w=1600&q=90',
  'https://images.unsplash.com/photo-1525268771113-32d9e9021a97?auto=format&fit=crop&w=1600&q=90',
];

let lbIndex = 0;

function openLightbox(idx) {
  lbIndex = idx;
  const lb = document.getElementById('lightbox');
  lb.hidden = false;
  document.body.style.overflow = 'hidden';
  updateLightbox();
}

function closeLightbox() {
  document.getElementById('lightbox').hidden = true;
  document.body.style.overflow = '';
}

function lbNav(dir) {
  lbIndex = (lbIndex + dir + GALLERY_IMAGES.length) % GALLERY_IMAGES.length;
  updateLightbox();
}

function updateLightbox() {
  document.getElementById('lbImg').src = GALLERY_IMAGES[lbIndex];
  document.getElementById('lbCounter').textContent = `${lbIndex + 1} / ${GALLERY_IMAGES.length}`;
}

document.addEventListener('keydown', e => {
  if (document.getElementById('lightbox')?.hidden === false) {
    if (e.key === 'Escape') closeLightbox();
    if (e.key === 'ArrowLeft')  lbNav(-1);
    if (e.key === 'ArrowRight') lbNav(1);
  }
});

/* =====================================================
   ROOM COMPARISON
   ===================================================== */
const ROOM_DATA = {
  classique: { name:'Chambre Classique', price:450, size:28, bed:'King-size', view:'Jardin/Cour', bath:'Marbre', spa:'Payant (60€)', butler:'Non', terrace:'Non', features:['WiFi','Minibar','Nespresso','TV 4K'] },
  deluxe:    { name:'Chambre Deluxe',    price:650, size:38, bed:'King-size XL', view:'Vue Paris', bath:'Baignoire îlot', spa:'Payant (60€)', butler:'Non', terrace:'Non', features:['WiFi','Minibar','Champagne','Pressing','TV 4K'] },
  junior:    { name:'Suite Junior',      price:950, size:55, bed:'King-size XL', view:'Panoramique', bath:'Douche italienne', spa:'Inclus', butler:'Non', terrace:'Non', features:['WiFi','Minibar','Champagne','Hermès','TV 4K','Salon'] },
  prestige:  { name:'Suite Prestige',    price:1800, size:90, bed:'King-size XXL', view:'Tour Eiffel', bath:'Remous + Sauna', spa:'Inclus + VIP', butler:'Oui', terrace:'30 m²', features:['WiFi','Minibar','Rolls-Royce','Fleurs','TV 4K','Salon','Dressing'] },
  royale:    { name:'Suite Royale',      price:3500, size:160, bed:'Super King', view:'360° Paris', bath:'Onyx double', spa:'Privé', butler:'24h/24', terrace:'Piscine privée', features:['WiFi','Minibar','Chef privé','Steinway','TV 4K','3 pièces','Sécurité'] },
};

function openCompare() {
  document.getElementById('compareModal').hidden = false;
  document.body.style.overflow = 'hidden';
}

function closeCompare() {
  document.getElementById('compareModal').hidden = true;
  document.body.style.overflow = '';
}

function updateComparison() {
  const v1 = document.getElementById('cmp-room-1')?.value;
  const v2 = document.getElementById('cmp-room-2')?.value;
  const out = document.getElementById('compareResult');

  if (!v1 || !v2) { out.innerHTML = '<p style="text-align:center;color:rgba(255,255,255,.25);padding:20px;font-size:.85rem">Sélectionnez deux chambres pour les comparer</p>'; return; }

  const r1 = ROOM_DATA[v1], r2 = ROOM_DATA[v2];
  if (!r1 || !r2) return;

  const rows = [
    ['Prix / nuit', fmtPrice(r1.price), fmtPrice(r2.price), r1.price <= r2.price, r2.price <= r1.price],
    ['Surface', r1.size+' m²', r2.size+' m²', r1.size >= r2.size, r2.size >= r1.size],
    ['Lit', r1.bed, r2.bed],
    ['Vue', r1.view, r2.view],
    ['Salle de bain', r1.bath, r2.bath],
    ['Spa', r1.spa, r2.spa],
    ['Majordome', r1.butler, r2.butler],
    ['Terrasse', r1.terrace, r2.terrace],
  ];

  out.innerHTML = `
    <table>
      <thead><tr><th>Critère</th><th>${r1.name}</th><th>${r2.name}</th></tr></thead>
      <tbody>
        ${rows.map(([label, a, b, betterA, betterB]) =>
          `<tr><td>${label}</td><td class="${betterA ? 'cmp-better' : ''}">${a}</td><td class="${betterB ? 'cmp-better' : ''}">${b}</td></tr>`
        ).join('')}
        <tr><td>Équipements</td><td>${r1.features.length} inclus</td><td>${r2.features.length} inclus</td></tr>
      </tbody>
    </table>
  `;
}

// Show floating compare button when in rooms section
const roomsSection = document.getElementById('chambres');
if (roomsSection) {
  new IntersectionObserver(([e]) => {
    const btn = document.getElementById('compareBtn');
    if (btn) btn.hidden = !e.isIntersecting;
  }, { threshold: 0.1 }).observe(roomsSection);
}

/* =====================================================
   COOKIE CONSENT
   ===================================================== */
function initCookieBanner() {
  if (localStorage.getItem('gp_cookies')) return;
  setTimeout(() => {
    const banner = document.getElementById('cookieBanner');
    if (banner) banner.hidden = false;
  }, 2000);
}

function acceptCookies(choice) {
  localStorage.setItem('gp_cookies', choice);
  const banner = document.getElementById('cookieBanner');
  if (banner) banner.hidden = true;
}

initCookieBanner();

/* =====================================================
   BACK TO TOP
   ===================================================== */
const bttBtn = document.getElementById('backToTop');
window.addEventListener('scroll', () => {
  bttBtn?.classList.toggle('visible', window.scrollY > 600);
}, { passive: true });

function scrollToTop() {
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* =====================================================
   CHAT WIDGET — CONCIERGE
   ===================================================== */
let chatOpen = false;
let chatInitialized = false;

const CONV_LS_KEY = 'gp_conversations';
const CHAT_POLL_MS = 2000;
let chatPollInterval = null;
let currentConvId = null;
let lastRenderedMsgCount = 0;
let pendingAutoReplyTimer = null;

const CHAT_RESPONSES = {
  default: "Merci pour votre message. Notre concierge vous répondra dans les plus brefs délais. En attendant, n'hésitez pas à explorer nos suggestions ci-dessus ou à appeler le +33 1 42 00 00 00.",

  'prix': "Voici nos tarifs :\n\n• Chambre Classique : 450 €/nuit (28 m²)\n• Chambre Deluxe : 650 €/nuit (38 m²)\n• Suite Junior : 950 €/nuit (55 m²)\n• Suite Prestige : 1 800 €/nuit (90 m²)\n• Suite Royale : 3 500 €/nuit (160 m²)\n\nTous les tarifs incluent WiFi, minibar et accès fitness. Essayez le code promo BIENVENUE10 pour 10% de réduction !",

  'spa': "Notre Spa s'étend sur 1 200 m² et comprend :\n\n• Piscine intérieure chauffée (28°C)\n• Hammam & Sauna\n• 8 cabines de soins La Mer\n• Espace relaxation\n\nL'accès est inclus pour les Suites Junior et supérieures. Pour les Classique et Deluxe, pass journalier à 60 €. Réservation soins : +33 1 42 00 00 01.",

  'réserv': "Pour réserver, plusieurs options :\n\n1. Remplissez le formulaire de réservation en bas de page\n2. Cliquez sur 'Réserver' sur la chambre de votre choix\n3. Appelez le +33 1 42 00 00 00\n4. Email : reservation@legrandpalais.fr\n\nAucun prépaiement requis. Annulation gratuite jusqu'à 48h avant l'arrivée.",

  'service': "Nos services incluent :\n\n🍽 Restaurant 2★ Michelin (Chef Rivière)\n💆 Spa 1200m² avec soins La Mer\n🍸 Bar & Lounge Art Déco\n🚘 Transferts en Rolls-Royce\n🎩 Conciergerie privée 24h/24\n🎭 Salons pour événements\n🏋 Fitness center\n👶 Baby-sitting sur demande\n\nNotre conciergerie peut organiser absolument tout !",

  'annul': "Notre politique d'annulation est flexible :\n\n• Chambres Classique & Deluxe : annulation gratuite 48h avant\n• Suites Junior : annulation gratuite 72h avant\n• Suites Prestige & Royale : annulation gratuite 7 jours avant\n\nAu-delà du délai, la première nuit sera facturée. Aucun prépaiement au moment de la réservation.",

  'venir': "Comment nous rejoindre :\n\n📍 12, Avenue de la Paix, 75008 Paris\n\n🚗 Transfert privé disponible :\n• Depuis CDG : 120 € (Rolls-Royce)\n• Depuis Orly : 90 €\n\n🚇 Métro : Ligne 1, station Concorde (5 min à pied)\n\n🚗 Voiturier 24h/24 — Parking souterrain privé (45 €/nuit)\n\nCochez l'option 'Transfert aéroport' lors de la réservation !",

  'bonjour': "Bienvenue au Grand Palais ! 🌟 Je suis votre concierge virtuel. Comment puis-je vous aider aujourd'hui ? N'hésitez pas à me poser des questions sur nos chambres, services, tarifs ou tout autre sujet.",

  'merci': "Avec plaisir ! N'hésitez pas si vous avez d'autres questions. Nous serions ravis de vous accueillir au Grand Palais. Belle journée ! 🌟",

  'petit': "Le petit-déjeuner est proposé à 35 €/personne/nuit :\n\n• Buffet continental premium (6h30-10h30)\n• Viennoiseries artisanales\n• Fruits frais de saison\n• Œufs à la carte\n• Sélection de fromages et charcuteries\n• Jus pressés minute\n\nService en chambre disponible (+25 €/pers). Ajoutez l'option lors de votre réservation !",

  'parking': "Voiturier et parking :\n\n🚗 Service voiturier 24h/24 devant l'hôtel\n🅿️ Parking souterrain privé et sécurisé : 45 €/nuit\n🚿 Service de lavage automobile sur demande\n⚡ 2 bornes de recharge électrique disponibles",
};

/* ---- localStorage helpers ---- */
function getGuestId() {
  let id = localStorage.getItem('gp_guest_id');
  if (!id) {
    id = 'guest-' + Date.now() + '-' + Math.random().toString(36).substring(2, 8);
    localStorage.setItem('gp_guest_id', id);
  }
  return id;
}
function getConversations() { return JSON.parse(localStorage.getItem(CONV_LS_KEY) || '[]'); }
function saveConversations(arr) { localStorage.setItem(CONV_LS_KEY, JSON.stringify(arr)); }

function getOrCreateConversation() {
  const guestId = getGuestId();
  let convs = getConversations();
  let conv = convs.find(c => c.guestId === guestId && c.status === 'active');
  if (!conv) {
    conv = {
      id: 'conv-' + Date.now(),
      guestId,
      guestName: null,
      status: 'active',
      rating: null,
      createdAt: new Date().toISOString(),
      messages: [{
        id: 'msg-0',
        sender: 'bot',
        text: 'Bienvenue au Grand Palais ! 🌟 Je suis votre concierge virtuel. Comment puis-je vous aider ?',
        timestamp: new Date().toISOString()
      }],
      unreadByGuest: 0,
      unreadByAdmin: 0
    };
    convs.push(conv);
    saveConversations(convs);
  }
  currentConvId = conv.id;
  return conv;
}

/* ---- Chat status indicator ---- */
function updateChatStatus() {
  const dot = document.querySelector('.chat-dot');
  const statusEl = document.querySelector('.chat-status');
  if (!dot || !statusEl) return;

  if (!currentConvId) { statusEl.innerHTML = '<span class="chat-dot"></span> En ligne'; return; }

  const convs = getConversations();
  const conv = convs.find(c => c.id === currentConvId);
  if (!conv) return;

  const now = Date.now();
  const fiveMin = 5 * 60 * 1000;
  const hasRecentAdmin = conv.messages.some(m =>
    m.sender === 'admin' && (now - new Date(m.timestamp).getTime()) < fiveMin
  );
  statusEl.innerHTML = hasRecentAdmin
    ? '<span class="chat-dot"></span> En ligne'
    : '<span class="chat-dot chat-dot-offline"></span> Hors ligne';
}

/* ---- Render messages ---- */
function renderChatMessages(conv) {
  const container = document.getElementById('chatMessages');
  const ratingEl = document.getElementById('chatRating');
  container.innerHTML = '';

  conv.messages.forEach(msg => {
    const el = document.createElement('div');
    if (msg.sender === 'guest') {
      el.className = 'chat-msg chat-msg-user';
    } else {
      el.className = 'chat-msg chat-msg-bot';
    }
    el.textContent = msg.text;
    container.appendChild(el);
  });

  // Handle archived conversation rating UI
  if (conv.status === 'archived' && conv.rating === null) {
    if (ratingEl) ratingEl.hidden = false;
  } else if (conv.status === 'archived' && conv.rating !== null) {
    if (ratingEl) ratingEl.hidden = true;
    const ty = document.createElement('div');
    ty.className = 'chat-msg chat-msg-bot';
    ty.textContent = 'Merci pour votre évaluation (' + conv.rating + '/5) ! Nous espérons vous revoir bientôt. ✨';
    container.appendChild(ty);
  } else {
    if (ratingEl) ratingEl.hidden = true;
  }

  lastRenderedMsgCount = conv.messages.length;
  container.scrollTop = container.scrollHeight;
}

/* ---- Append a single message to DOM (avoids full re-render) ---- */
function appendMessageToDOM(msg) {
  const container = document.getElementById('chatMessages');
  const el = document.createElement('div');
  if (msg.sender === 'guest') {
    el.className = 'chat-msg chat-msg-user';
  } else {
    el.className = 'chat-msg chat-msg-bot';
  }
  el.textContent = msg.text;
  container.appendChild(el);
  container.scrollTop = container.scrollHeight;
}

/* ---- Polling ---- */
function pollChatMessages() {
  if (!currentConvId) return;
  const convs = getConversations();
  const conv = convs.find(c => c.id === currentConvId);
  if (!conv) return;

  // Render new messages only
  if (conv.messages.length > lastRenderedMsgCount) {
    const newMsgs = conv.messages.slice(lastRenderedMsgCount);
    newMsgs.forEach(msg => appendMessageToDOM(msg));
    lastRenderedMsgCount = conv.messages.length;
  }

  // If conversation was archived by admin
  if (conv.status === 'archived') {
    const ratingEl = document.getElementById('chatRating');
    if (conv.rating === null) {
      if (ratingEl) ratingEl.hidden = false;
    } else {
      if (ratingEl) ratingEl.hidden = true;
    }
  }

  // Mark messages as read since chat is open
  if (conv.unreadByGuest > 0) {
    const idx = convs.findIndex(c => c.id === currentConvId);
    if (idx !== -1) {
      convs[idx].unreadByGuest = 0;
      saveConversations(convs);
    }
    const badge = document.getElementById('chatBadge');
    if (badge) badge.hidden = true;
  }

  updateChatStatus();
}

/* ---- Update badge when chat is closed ---- */
function updateChatBadge() {
  if (chatOpen) return;
  const guestId = getGuestId();
  const convs = getConversations();
  const conv = convs.find(c => c.guestId === guestId && c.status === 'active');
  if (conv && conv.unreadByGuest > 0) {
    const badge = document.getElementById('chatBadge');
    if (badge) {
      badge.textContent = conv.unreadByGuest;
      badge.hidden = false;
    }
  }
}

/* ---- Toggle ---- */
function toggleChat() {
  chatOpen = !chatOpen;
  const win = document.getElementById('chatWindow');
  const icon = document.getElementById('chatToggleIcon');
  const badge = document.getElementById('chatBadge');

  if (chatOpen) {
    win.hidden = false;
    icon.textContent = '✕';
    badge.hidden = true;

    const conv = getOrCreateConversation();
    renderChatMessages(conv);

    // Mark as read
    if (conv.unreadByGuest > 0) {
      const convs = getConversations();
      const idx = convs.findIndex(c => c.id === currentConvId);
      if (idx !== -1) {
        convs[idx].unreadByGuest = 0;
        saveConversations(convs);
      }
    }

    // Show or hide suggestions based on message count
    const sugg = document.getElementById('chatSuggestions');
    if (sugg) {
      sugg.style.display = conv.messages.length <= 1 ? '' : 'none';
    }

    updateChatStatus();
    chatInitialized = true;

    // Start polling
    if (chatPollInterval) clearInterval(chatPollInterval);
    chatPollInterval = setInterval(pollChatMessages, CHAT_POLL_MS);

    document.getElementById('chatInput')?.focus();
  } else {
    win.hidden = true;
    icon.textContent = '💬';

    // Stop polling
    if (chatPollInterval) { clearInterval(chatPollInterval); chatPollInterval = null; }
  }
}

/* ---- Typing indicator (kept for auto-reply UX) ---- */
function addTypingIndicator() {
  const messages = document.getElementById('chatMessages');
  const typing = document.createElement('div');
  typing.className = 'chat-msg chat-msg-bot chat-msg-typing';
  typing.id = 'chatTyping';
  typing.innerHTML = '<span></span><span></span><span></span>';
  messages.appendChild(typing);
  messages.scrollTop = messages.scrollHeight;
}
function removeTypingIndicator() {
  document.getElementById('chatTyping')?.remove();
}

/* ---- Keyword fallback (kept) ---- */
function findResponse(text) {
  const lower = text.toLowerCase();
  for (const [keyword, response] of Object.entries(CHAT_RESPONSES)) {
    if (keyword !== 'default' && lower.includes(keyword)) return response;
  }
  return CHAT_RESPONSES.default;
}

/* ---- Send message ---- */
function chatSend(text) {
  if (!text || !text.trim()) return;
  text = text.trim();

  // Get conversation
  const conv = getOrCreateConversation();
  const convs = getConversations();
  const idx = convs.findIndex(c => c.id === currentConvId);
  if (idx === -1) return;

  // Save guest message
  const guestMsg = {
    id: 'msg-' + Date.now(),
    sender: 'guest',
    text: text,
    timestamp: new Date().toISOString()
  };
  convs[idx].messages.push(guestMsg);
  convs[idx].unreadByAdmin += 1;
  saveConversations(convs);

  // Render immediately
  appendMessageToDOM(guestMsg);
  lastRenderedMsgCount = convs[idx].messages.length;

  // Hide suggestions after first interaction
  const sugg = document.getElementById('chatSuggestions');
  if (sugg) sugg.style.display = 'none';

  // If first guest message (welcome + this = 2 messages), add acknowledgement after 1s
  if (convs[idx].messages.length === 2) {
    setTimeout(() => {
      const freshConvs = getConversations();
      const freshIdx = freshConvs.findIndex(c => c.id === currentConvId);
      if (freshIdx === -1) return;
      const ackMsg = {
        id: 'msg-' + Date.now(),
        sender: 'bot',
        text: 'Merci pour votre message ! Un membre de notre équipe va vous répondre très prochainement. ⏳',
        timestamp: new Date().toISOString()
      };
      freshConvs[freshIdx].messages.push(ackMsg);
      saveConversations(freshConvs);
      if (chatOpen) {
        appendMessageToDOM(ackMsg);
        lastRenderedMsgCount = freshConvs[freshIdx].messages.length;
      }
    }, 1000);
  }

  // Clear any previous auto-reply timer
  if (pendingAutoReplyTimer) { clearTimeout(pendingAutoReplyTimer); pendingAutoReplyTimer = null; }

  // Schedule keyword fallback auto-reply after 30s if no admin reply arrives
  const msgCountAtSend = convs[idx].messages.length;
  pendingAutoReplyTimer = setTimeout(() => {
    const latestConvs = getConversations();
    const latestIdx = latestConvs.findIndex(c => c.id === currentConvId);
    if (latestIdx === -1) return;
    const latestConv = latestConvs[latestIdx];
    // Check if admin replied since we sent the message
    const hasAdminReply = latestConv.messages.slice(msgCountAtSend).some(m => m.sender === 'admin');
    if (hasAdminReply) return;

    // No admin reply — use keyword fallback
    const autoReply = {
      id: 'msg-' + Date.now(),
      sender: 'bot',
      text: findResponse(text),
      timestamp: new Date().toISOString()
    };
    latestConvs[latestIdx].messages.push(autoReply);
    saveConversations(latestConvs);
    if (chatOpen) {
      appendMessageToDOM(autoReply);
      lastRenderedMsgCount = latestConvs[latestIdx].messages.length;
    }
    pendingAutoReplyTimer = null;
  }, 30000);
}

function chatSubmit(e) {
  e.preventDefault();
  const input = document.getElementById('chatInput');
  const text = input?.value.trim();
  if (!text) return;
  input.value = '';
  chatSend(text);
}

/* ---- Rating ---- */
function rateChatService(stars) {
  let convs = getConversations();
  const idx = convs.findIndex(c => c.id === currentConvId);
  if (idx === -1) return;
  convs[idx].rating = stars;
  saveConversations(convs);

  const container = document.getElementById('chatMessages');
  const ratingEl = document.getElementById('chatRating');
  if (ratingEl) ratingEl.hidden = true;
  const ty = document.createElement('div');
  ty.className = 'chat-msg chat-msg-bot';
  ty.textContent = 'Merci pour votre évaluation (' + stars + '/5) ! Nous espérons vous revoir bientôt. ✨';
  container.appendChild(ty);
  container.scrollTop = container.scrollHeight;
}

// Show chat badge after delay (or if unread messages exist)
setTimeout(() => {
  if (!chatOpen) {
    const guestId = getGuestId();
    const convs = getConversations();
    const conv = convs.find(c => c.guestId === guestId && c.status === 'active');
    const badge = document.getElementById('chatBadge');
    if (badge) {
      if (conv && conv.unreadByGuest > 0) {
        badge.textContent = conv.unreadByGuest;
        badge.hidden = false;
      } else {
        badge.hidden = false;
      }
    }
  }
}, 5000);

/* =====================================================
   DYNAMIC ROOM CARDS (from admin gp_room_details)
   ===================================================== */
const ROOM_DETAILS_LS_KEY = 'gp_room_details';
const ROOM_CLASSES_MAP = {
  'Chambre Classique': 'classique',
  'Chambre Deluxe': 'deluxe',
  'Suite Junior': 'junior',
  'Suite Prestige': 'prestige',
  'Suite Royale': 'royale'
};
const DEFAULT_ROOM_DETAILS = {
  'Chambre Classique': {
    name: 'Chambre Classique', size: '28 m²', badge: 'Populaire', badgeClass: '', cardClass: '',
    description: 'Élégante chambre alliant confort moderne et décor raffiné, avec vue sur les jardins intérieurs ou la cour parisienne.',
    image: 'https://images.unsplash.com/photo-1631049307264-da0ec9d70304?auto=format&fit=crop&w=800&q=80',
    price: 450,
    features: [
      { icon: '🛏', text: 'Lit King-size' }, { icon: '🛁', text: 'Salle de bain marbre' },
      { icon: '📡', text: 'WiFi haut débit' }, { icon: '🍾', text: 'Minibar premium' },
      { icon: '☕', text: 'Machine Nespresso' }, { icon: '🖥', text: 'TV 4K 55"' }
    ]
  },
  'Chambre Deluxe': {
    name: 'Chambre Deluxe', size: '38 m²', badge: '★ Best seller', badgeClass: 'room-badge-gold', cardClass: 'room-card-featured',
    description: 'Espace généreux, baignoire îlot et vue imprenable sur les toits de Paris. Pour les voyageurs les plus exigeants.',
    image: 'https://images.unsplash.com/photo-1582719478250-c89cae4dc85b?auto=format&fit=crop&w=800&q=80',
    price: 650,
    features: [
      { icon: '🛏', text: 'Lit King-size XL' }, { icon: '🛁', text: 'Baignoire îlot' },
      { icon: '🏙', text: 'Vue sur Paris' }, { icon: '🍾', text: 'Accueil champagne' },
      { icon: '👔', text: 'Service pressing' }, { icon: '🌸', text: 'Fleurs fraîches' }
    ]
  },
  'Suite Junior': {
    name: 'Suite Junior', size: '55 m²', badge: '', badgeClass: '', cardClass: '',
    description: 'Salon séparé et chambre somptueuse pour une intimité totale. Idéale pour séjours romantiques et voyages d\'affaires.',
    image: 'https://images.unsplash.com/photo-1578683010236-d716f9a3f461?auto=format&fit=crop&w=800&q=80',
    price: 950,
    features: [
      { icon: '🏠', text: 'Chambre + salon séparés' }, { icon: '🛁', text: 'Douche à l\'italienne' },
      { icon: '🌇', text: 'Vue panoramique' }, { icon: '🏋', text: 'Accès spa inclus' },
      { icon: '🎁', text: 'Kit Hermès' }, { icon: '🍾', text: 'Accueil champagne' }
    ]
  },
  'Suite Prestige': {
    name: 'Suite Prestige', size: '90 m²', badge: '✦ Prestige', badgeClass: 'room-badge-prestige', cardClass: 'room-card-prestige',
    description: 'Notre suite emblématique avec terrasse privée donnant sur la Tour Eiffel. L\'apogée du luxe parisien avec majordome dédié.',
    image: 'https://images.unsplash.com/photo-1540541338287-41700207dee6?auto=format&fit=crop&w=800&q=80',
    price: 1800,
    features: [
      { icon: '🌹', text: 'Terrasse privée 30 m²' }, { icon: '🛁', text: 'Bain à remous & sauna' },
      { icon: '🗼', text: 'Vue Tour Eiffel' }, { icon: '🤵', text: 'Majordome personnel' },
      { icon: '🚗', text: 'Rolls-Royce incluse' }, { icon: '💐', text: 'Fleurs quotidiennes' }
    ]
  },
  'Suite Royale': {
    name: 'Suite Royale', size: '160 m²', badge: '♛ Suite Royale', badgeClass: 'room-badge-royal', cardClass: 'room-card-royal',
    description: 'L\'expression ultime du luxe. Trois pièces, deux salles de bain, salon de réception et terrasse avec piscine chauffée privée.',
    image: 'https://images.unsplash.com/photo-1596394516093-501ba68a0ba6?auto=format&fit=crop&w=800&q=80',
    price: 3500,
    features: [
      { icon: '🏛', text: '3 pièces + piscine privée' }, { icon: '🛁', text: '2 salles de bain onyx' },
      { icon: '🎹', text: 'Piano Steinway & Sons' }, { icon: '👨‍🍳', text: 'Chef privé sur demande' },
      { icon: '🛡', text: 'Sécurité 24h/24' }, { icon: '🌹', text: 'Floristique Valentino' }
    ]
  }
};

function getSiteRoomDetails() {
  try {
    const stored = localStorage.getItem(ROOM_DETAILS_LS_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
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

function renderRoomCards() {
  const grid = document.getElementById('roomsGridDynamic');
  if (!grid) return;
  const details = getSiteRoomDetails();

  grid.innerHTML = Object.entries(details).map(([key, room]) => {
    const cls = ROOM_CLASSES_MAP[key] || key.toLowerCase().replace(/\s+/g, '-');
    const badgeHtml = room.badge ? `<span class="room-badge ${room.badgeClass || ''}">${room.badge}</span>` : '';
    const priceFormatted = room.price.toLocaleString('fr-FR');
    const featuresHtml = (room.features || []).map(f =>
      `<li><span class="feat-icon">${f.icon}</span> ${f.text}</li>`
    ).join('');

    return `
      <article class="room-card ${room.cardClass || ''}" itemscope itemtype="https://schema.org/HotelRoom">
        <div class="room-img" style="background-image:url('${room.image}');background-size:cover;background-position:center">
          ${badgeHtml}
          <div class="room-img-overlay">
            <button class="room-gallery-btn" onclick="openBookingModal('${key}', ${room.price})" aria-label="Réserver ${room.name}">Réserver</button>
          </div>
        </div>
        <div class="room-body">
          <div class="room-meta">
            <h3 itemprop="name">${room.name}</h3>
            <span class="room-size">${room.size}</span>
          </div>
          <p itemprop="description">${room.description}</p>
          <ul class="room-features">${featuresHtml}</ul>
          <div class="room-footer">
            <div class="room-price-block">
              <span class="price-label">À partir de</span>
              <span class="price-amount"><strong>${priceFormatted} €</strong><span class="price-night"> / nuit</span></span>
            </div>
            <button class="btn btn-gold" onclick="openBookingModal('${key}', ${room.price})">Réserver</button>
          </div>
        </div>
      </article>
    `;
  }).join('');
}

// Render room cards on page load
renderRoomCards();

// Auto-refresh room cards when admin changes data in another tab
window.addEventListener('storage', function(e) {
  if (e.key === ROOM_DETAILS_LS_KEY || e.key === 'gp_room_inventory') {
    renderRoomCards();
  }
});

console.log('%c✦ Hôtel Le Grand Palais %c— Prestige Edition v2', 'color:#c9a84c;font-weight:700;font-size:14px', 'color:#7a7268;font-size:12px');
