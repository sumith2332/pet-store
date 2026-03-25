'use strict';

const CATEGORY_IMAGE_FALLBACK = {
  'Dog Food': 'https://placehold.co/600x600/3b82f6/ffffff?text=Dog+Food',
  'Cat Food': 'https://placehold.co/600x600/8b5cf6/ffffff?text=Cat+Food',
  'Medicine': 'https://placehold.co/600x600/ef4444/ffffff?text=Medicine',
  'Accessories': 'https://placehold.co/600x600/10b981/ffffff?text=Accessories',
  'Grooming': 'https://placehold.co/600x600/f59e0b/ffffff?text=Grooming',
  'Birds & Small': 'https://placehold.co/600x600/06b6d4/ffffff?text=Birds+and+Small',
};
const DEFAULT_IMAGE = 'https://placehold.co/600x600/0f172a/e2e8f0?text=PetStore+Product';

let allProducts = [];
let activeFilter = '';
let cart = JSON.parse(localStorage.getItem('cart') || '[]');

document.addEventListener('DOMContentLoaded', () => {
  fetchProducts();
  updateCartBadge();
  syncUserNav();
});

function getFallbackImage(category) {
  return CATEGORY_IMAGE_FALLBACK[category] || DEFAULT_IMAGE;
}

function getProductImage(product) {
  const image = String(product.image || '').trim();
  if (/^https?:\/\//i.test(image)) {
    return image;
  }
  return getFallbackImage(product.category);
}

// ============================================================
//  syncUserNav()
//  Shows the user's name chip and logout button in the navbar.
//  Calls GET /api/session → { is_user, user: { username } }
// ============================================================
async function syncUserNav() {
  const chip       = document.getElementById('user-chip');
  const avatar     = document.getElementById('user-avatar');
  const nameEl     = document.getElementById('user-name');
  const logoutBtn  = document.getElementById('logout-btn');

  if (!chip) return;

  try {
    const response = await fetch('/api/session');
    if (!response.ok) throw new Error('session check failed');

    const data = await response.json();
    if (data.is_user && data.user) {
      const uname = data.user.username || 'User';
      if (chip)    chip.style.display    = 'flex';
      if (avatar)  avatar.textContent    = uname[0].toUpperCase();
      if (nameEl)  nameEl.textContent    = uname;
      if (logoutBtn) logoutBtn.style.display = 'inline-flex';
    }
  } catch (error) {
    // silently fail – user is still browsing
  }
}

// ============================================================
//  logoutUser()
//  Calls POST /api/user/logout → clears user session
//  Redirects to /login
// ============================================================
async function logoutUser() {
  try {
    await fetch('/api/user/logout', { method: 'POST' });
  } catch (error) {
    console.warn('[store.js] logout failed:', error);
  }
  window.location.href = '/login';
}
window.logoutUser = logoutUser;

// Legacy alias used by cart.html
async function logoutFromStore() {
  return logoutUser();
}
window.logoutFromStore = logoutFromStore;

async function fetchProducts() {
  const grid = document.getElementById('products');
  grid.innerHTML = '<div class="empty">Loading products...</div>';

  try {
    const response = await fetch('/api/products');
    if (!response.ok) {
      if (response.status === 403) {
        window.location.href = '/login';
        return;
      }
      throw new Error(`Server returned ${response.status} ${response.statusText}`);
    }

    allProducts = await response.json();
    if (!Array.isArray(allProducts)) {
      throw new Error('Expected array from /api/products');
    }

    applyFilters();
  } catch (err) {
    console.error('[store.js] fetchProducts error:', err.message);
    grid.innerHTML = `
      <div class="empty">
        Could not load products.<br>
        <small style="color:#475569;">${err.message}</small><br>
        <small style="color:#475569;">Make sure Flask server is running on port 5000.</small>
      </div>`;
  }
}

function setFilter(cat) {
  activeFilter = cat;
  document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
  const catToButtonId = {
    'Dog Food': 'f-dog',
    'Cat Food': 'f-cat',
    'Medicine': 'f-med',
    'Accessories': 'f-acc',
    'Grooming': 'f-grm',
    'Birds & Small': 'f-bird',
  };
  const activeBtn = document.getElementById(cat ? catToButtonId[cat] : 'f-all');
  if (activeBtn) activeBtn.classList.add('active');
  applyFilters();
}

function applyFilters() {
  const searchEl = document.getElementById('search');
  const query = searchEl ? searchEl.value.toLowerCase().trim() : '';

  let list = activeFilter
    ? allProducts.filter(p => p.category === activeFilter)
    : [...allProducts];

  if (query) {
    list = list.filter(p =>
      p.name.toLowerCase().includes(query) ||
      (p.brand || '').toLowerCase().includes(query)
    );
  }

  renderGrid(list);
}

function renderGrid(list) {
  const grid = document.getElementById('products');

  if (!list.length) {
    grid.innerHTML = '<div class="empty">No products found.</div>';
    return;
  }

  grid.innerHTML = list.map(p => {
    const oos = p.stock === 0;
    const image = getProductImage(p);
    const fallback = getFallbackImage(p.category);

    return `
      <div class="product">
        <img src="${image}" alt="${xh(p.name)}" loading="lazy" onerror="this.onerror=null;this.src='${fallback}'">
        <span class="cat-tag">${xh(p.category)}</span>
        <h3>${xh(p.name)}</h3>
        <div class="brand">${xh(p.brand || '')}</div>
        <div class="price">Rs ${p.price.toLocaleString('en-IN')}</div>
        <div class="stock">${oos ? 'Out of stock' : 'In stock: ' + p.stock}</div>
        <button
          onclick="addToCart(${p.id}, '${xa(p.name)}', ${p.price})"
          ${oos ? 'disabled' : ''}>
          ${oos ? 'Out of Stock' : 'Add to Cart'}
        </button>
      </div>`;
  }).join('');
}

function addToCart(id, name, price) {
  const existingIndex = cart.findIndex(item => item.id === id);
  if (existingIndex > -1) {
    cart[existingIndex].qty += 1;
  } else {
    cart.push({ id, name, price, qty: 1 });
  }
  localStorage.setItem('cart', JSON.stringify(cart));
  updateCartBadge();
  showToast(`Added: ${name}`);
}

function updateCartBadge() {
  const totalQty = cart.reduce((sum, item) => sum + item.qty, 0);
  const badge = document.getElementById('cart-count');
  if (badge) badge.textContent = totalQty > 0 ? totalQty : '';
}

function showToast(msg) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.style.opacity = '1';
  clearTimeout(window._toastTimer);
  window._toastTimer = setTimeout(() => {
    t.style.opacity = '0';
  }, 2400);
}

function xh(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function xa(s) {
  return String(s || '').replace(/'/g, "\\'").replace(/"/g, '&quot;');
}