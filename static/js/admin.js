/**
 * ============================================================
 *  admin.js  –  Admin Dashboard Logic
 *  Loaded by: templates/admin.html
 * ============================================================
 */

'use strict';

let editId   = null;
let allProds = [];
const CATEGORY_IMAGE_FALLBACK = {
  'Dog Food': 'https://placehold.co/600x600/3b82f6/ffffff?text=Dog+Food',
  'Cat Food': 'https://placehold.co/600x600/8b5cf6/ffffff?text=Cat+Food',
  'Medicine': 'https://placehold.co/600x600/ef4444/ffffff?text=Medicine',
  'Accessories': 'https://placehold.co/600x600/10b981/ffffff?text=Accessories',
  'Grooming': 'https://placehold.co/600x600/f59e0b/ffffff?text=Grooming',
  'Birds & Small': 'https://placehold.co/600x600/06b6d4/ffffff?text=Birds+and+Small',
};
const DEFAULT_IMAGE = 'https://placehold.co/600x600/0f172a/e2e8f0?text=PetStore+Product';

document.addEventListener('DOMContentLoaded', () => {
  loadStats();
  loadProducts();
});

function getFallbackImage(category) {
  return CATEGORY_IMAGE_FALLBACK[category] || DEFAULT_IMAGE;
}

function getProductImage(product) {
  const image = String(product.image || '').trim();
  if (/^https?:\/\//i.test(image)) return image;
  return getFallbackImage(product.category);
}

// ============================================================
//  showSection(sec)
// ============================================================
function showSection(sec) {
  const ordersEl = document.getElementById('section-orders');
  const usersEl  = document.getElementById('section-users');

  // Hide all dynamic sections first
  ordersEl.style.display = 'none';
  usersEl.style.display  = 'none';

  if (sec === 'orders') {
    ordersEl.style.display = 'block';
    ordersEl.scrollIntoView({ behavior: 'smooth' });
    loadOrders();

  } else if (sec === 'users') {
    usersEl.style.display = 'block';
    usersEl.scrollIntoView({ behavior: 'smooth' });
    loadUsers();

  } else if (sec === 'products') {
    document.getElementById('section-form').scrollIntoView({ behavior: 'smooth' });
  }
}


// ============================================================
//  loadStats() – GET /api/stats
//  Now includes `users` count
// ============================================================
async function loadStats() {
  try {
    const res  = await fetch('/api/stats');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    document.getElementById('s-products').textContent = data.products;
    document.getElementById('s-orders').textContent   = data.orders;
    document.getElementById('s-revenue').textContent  = '₹' + data.revenue.toLocaleString('en-IN');
    document.getElementById('s-low').textContent      = data.low_stock;
    document.getElementById('s-users').textContent    = data.users ?? '–';

    if (data.low_stock > 0) {
      document.getElementById('stat-low').classList.add('warn');
    } else {
      document.getElementById('stat-low').classList.remove('warn');
    }
  } catch (err) {
    console.error('[admin.js] loadStats error:', err.message);
  }
}


// ============================================================
//  loadProducts() – GET /api/products
// ============================================================
async function loadProducts() {
  try {
    const res = await fetch('/api/products');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    allProds = await res.json();
    renderProducts(allProds);
  } catch (err) {
    console.error('[admin.js] loadProducts error:', err.message);
    document.getElementById('list').innerHTML =
      '<p style="color:#f87171;">⚠ Failed to load products: ' + err.message + '</p>';
  }
}


// ============================================================
//  filterProducts()
// ============================================================
function filterProducts() {
  const q = (document.getElementById('prod-search').value || '').toLowerCase();
  const filtered = q
    ? allProds.filter(p =>
        p.name.toLowerCase().includes(q) ||
        (p.brand || '').toLowerCase().includes(q) ||
        p.category.toLowerCase().includes(q)
      )
    : allProds;
  renderProducts(filtered);
}


// ============================================================
//  renderProducts(list)
// ============================================================
function renderProducts(list) {
  const container = document.getElementById('list');
  if (!list.length) {
    container.innerHTML = '<p style="color:#475569;padding:20px;">No products found.</p>';
    return;
  }
  container.innerHTML = list.map(p => {
    const isLow = p.stock < 5;
    const image = getProductImage(p);
    const fallback = getFallbackImage(p.category);
    return `
      <div class="product">
        <img src="${image}" alt="${xh(p.name)}" loading="lazy" onerror="this.onerror=null;this.src='${fallback}'">
        <span class="cat-tag">${xh(p.category)}</span>
        <h3>${xh(p.name)}</h3>
        <div class="brand">${xh(p.brand || '')}</div>
        <div class="price">₹${p.price.toLocaleString('en-IN')}</div>
        <div class="stock-info ${isLow ? 'low-stock' : ''}">
          ${isLow ? '⚠ Low' : '✅'} Stock: ${p.stock}
        </div>
        <div class="prod-actions">
          <button class="btn-edit"
            onclick="editProduct(${p.id},'${xa(p.name)}',${p.price},${p.stock},'${xa(p.image)}','${xa(p.category)}','${xa(p.brand || '')}')">
            ✏ Edit
          </button>
          <button class="btn-del" onclick="deleteProduct(${p.id})">
            🗑 Delete
          </button>
        </div>
      </div>`;
  }).join('');
}


// ============================================================
//  saveProduct()
// ============================================================
async function saveProduct() {
  const name     = document.getElementById('p-name').value.trim();
  const price    = document.getElementById('p-price').value;
  const stock    = document.getElementById('p-stock').value;
  const image    = document.getElementById('p-image').value.trim();
  const category = document.getElementById('p-category').value;
  const brand    = document.getElementById('p-brand').value.trim();

  if (!name)  { alert('Product name is required.'); return; }
  if (!price) { alert('Price is required.'); return; }
  if (isNaN(parseFloat(price)) || parseFloat(price) < 0) {
    alert('Enter a valid price.'); return;
  }

  const payload = {
    name, price: parseFloat(price),
    stock: parseInt(stock) || 0,
    image: image || getFallbackImage(category),
    category: category || 'General',
    brand,
  };

  const url    = editId ? `/api/products/${editId}` : '/api/products';
  const method = editId ? 'PUT' : 'POST';

  try {
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload),
    });
    if (!res.ok) {
      const err = await res.json();
      alert('Error: ' + (err.error || 'Unknown error'));
      return;
    }
    cancelEdit();
    loadStats();
    loadProducts();
  } catch (err) {
    console.error('[admin.js] saveProduct error:', err.message);
    alert('Network error: ' + err.message);
  }
}


// ============================================================
//  editProduct(...)
// ============================================================
function editProduct(id, name, price, stock, image, category, brand) {
  editId = id;
  document.getElementById('p-name').value     = name;
  document.getElementById('p-price').value    = price;
  document.getElementById('p-stock').value    = stock;
  document.getElementById('p-image').value    = image;
  document.getElementById('p-category').value = category;
  document.getElementById('p-brand').value    = brand;
  document.getElementById('form-title').textContent    = '✏ Edit Product';
  document.getElementById('save-btn').textContent      = 'Update Product';
  document.getElementById('cancel-btn').style.display = 'inline-block';
  document.getElementById('section-form').scrollIntoView({ behavior: 'smooth' });
}


// ============================================================
//  cancelEdit()
// ============================================================
function cancelEdit() {
  editId = null;
  ['p-name', 'p-price', 'p-stock', 'p-image', 'p-brand'].forEach(id => {
    document.getElementById(id).value = '';
  });
  document.getElementById('p-category').value = 'Dog Food';
  document.getElementById('form-title').textContent    = '➕ Add New Product';
  document.getElementById('save-btn').textContent      = 'Save Product';
  document.getElementById('cancel-btn').style.display = 'none';
}


// ============================================================
//  deleteProduct(id)
// ============================================================
async function deleteProduct(id) {
  if (!confirm('Are you sure you want to delete this product?\nThis cannot be undone.')) return;
  try {
    const res = await fetch(`/api/products/${id}`, { method: 'DELETE' });
    if (!res.ok) {
      const err = await res.json();
      alert('Delete failed: ' + (err.error || 'Unknown error'));
      return;
    }
    loadStats();
    loadProducts();
  } catch (err) {
    console.error('[admin.js] deleteProduct error:', err.message);
    alert('Network error: ' + err.message);
  }
}


// ============================================================
//  loadOrders() – GET /api/orders
// ============================================================
async function loadOrders() {
  const el = document.getElementById('orders-content');
  el.innerHTML = '<p style="color:#64748b;">Loading orders...</p>';
  try {
    const res    = await fetch('/api/orders');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const orders = await res.json();

    if (!orders.length) {
      el.innerHTML = '<p style="color:#64748b;padding:20px;">No orders yet.</p>';
      return;
    }

    el.innerHTML = `
      <table class="orders">
        <thead>
          <tr>
            <th>#</th>
            <th>Razorpay Order ID</th>
            <th>Customer</th>
            <th>Phone</th>
            <th>Amount</th>
            <th>Status</th>
            <th>Date</th>
            <th>Receipt</th>
          </tr>
        </thead>
        <tbody>
          ${orders.map((o, i) => `
            <tr>
              <td>${i + 1}</td>
              <td style="font-size:11px;color:#64748b;max-width:160px;overflow:hidden;text-overflow:ellipsis;">${o.order || '—'}</td>
              <td>${xh(o.customer_name) || '—'}</td>
              <td style="font-size:12px;">${xh(o.customer_phone) || '—'}</td>
              <td style="font-weight:700;">₹${(o.amount || 0).toLocaleString('en-IN')}</td>
              <td>
                <span class="status-pill status-${o.status}">${o.status}</span>
              </td>
              <td style="font-size:12px;color:#64748b;">
                ${new Date(o.created).toLocaleDateString('en-IN', {day:'2-digit',month:'short',year:'numeric'})}
              </td>
              <td>
                ${o.status === 'paid'
                  ? `<a href="/slip/${o.id}" target="_blank" style="color:#3b82f6;font-size:12px;font-weight:600;text-decoration:none;">🧾 View</a>`
                  : '<span style="color:#475569;font-size:12px;">—</span>'
                }
              </td>
            </tr>`
          ).join('')}
        </tbody>
      </table>`;
  } catch (err) {
    console.error('[admin.js] loadOrders error:', err.message);
    el.innerHTML = '<p style="color:#f87171;">⚠ Failed to load orders: ' + err.message + '</p>';
  }
}


// ============================================================
//  loadUsers() – GET /api/admin/users
//  Displays registered user accounts
// ============================================================
async function loadUsers() {
  const el = document.getElementById('users-content');
  el.innerHTML = '<p style="color:#64748b;">Loading users...</p>';
  try {
    const res   = await fetch('/api/admin/users');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const users = await res.json();

    if (!users.length) {
      el.innerHTML = '<p style="color:#64748b;padding:20px;">No registered users yet.</p>';
      return;
    }

    el.innerHTML = `
      <table class="orders">
        <thead>
          <tr>
            <th>#</th>
            <th>ID</th>
            <th>Username</th>
            <th>Email</th>
            <th>Joined</th>
          </tr>
        </thead>
        <tbody>
          ${users.map((u, i) => `
            <tr>
              <td>${i + 1}</td>
              <td style="color:#64748b;">#${u.id}</td>
              <td><strong>${xh(u.username)}</strong></td>
              <td style="color:#94a3b8;">${xh(u.email)}</td>
              <td style="font-size:12px;color:#64748b;">
                ${new Date(u.created).toLocaleDateString('en-IN', {day:'2-digit',month:'short',year:'numeric'})}
              </td>
            </tr>`
          ).join('')}
        </tbody>
      </table>`;
  } catch (err) {
    console.error('[admin.js] loadUsers error:', err.message);
    el.innerHTML = '<p style="color:#f87171;">⚠ Failed to load users: ' + err.message + '</p>';
  }
}


// ── Escape helpers ────────────────────────────────────────────
function xh(s) {
  return String(s || '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function xa(s) {
  return String(s || '').replace(/'/g, "\\'").replace(/"/g, '&quot;');
}