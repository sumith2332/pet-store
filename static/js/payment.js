/**
 * ============================================================
 *  payment.js  –  Cart Page + Razorpay Payment Flow
 *  Loaded by: templates/cart.html
 * ============================================================
 *
 *  FULL PAYMENT FLOW (3 steps)
 *  ─────────────────────────────────────────────────────────
 *
 *  STEP 1 – CREATE ORDER (backend)
 *    POST /api/payment/create-order
 *    Request:  { amount, items[], name, phone, email }
 *    Response: { order_id, amount, currency, key, db_order_id }
 *    Flask handler: app.py → create_order()
 *    What it does:  Creates Razorpay order via Razorpay API,
 *                   saves Order row to SQLite DB, returns order_id
 *
 *  STEP 2 – RAZORPAY CHECKOUT (frontend)
 *    Opens Razorpay modal with the order_id from Step 1.
 *    User enters card/UPI/netbanking details.
 *    On success → Razorpay calls handler() with:
 *      { razorpay_order_id, razorpay_payment_id, razorpay_signature }
 *
 *  STEP 3 – VERIFY PAYMENT (backend)
 *    POST /api/payment/verify
 *    Request:  { razorpay_order_id, razorpay_payment_id,
 *                razorpay_signature, db_order_id }
 *    Response: { success: true, slip_url: "/slip/<id>" }
 *              OR { success: false, error: "..." }
 *    Flask handler: app.py → verify_payment()
 *    What it does:  Verifies HMAC-SHA256 signature using
 *                   RAZORPAY_KEY_SECRET. Updates Order.status
 *                   to "paid" or "failed" in SQLite.
 *
 *  LOCALSTORAGE KEYS
 *  ─────────────────────────────────────────────────────────
 *  cart  → Array of { id, name, price, qty }
 *          Written by store.js, read here for checkout.
 *          Cleared after successful payment.
 *
 *  RAZORPAY KEY
 *  ─────────────────────────────────────────────────────────
 *  const RAZORPAY_KEY = "{{ razorpay_key }}"  (Jinja2 injected in cart.html)
 *  Set in app.py → RAZORPAY_KEY_ID environment variable
 *
 *  FUNCTIONS CALLED FROM HTML
 *  ─────────────────────────────────────────────────────────
 *  payNow()           → Pay button onclick in cart.html
 *  changeQty(idx,d)   → +/- qty buttons on cart items
 *  removeItem(idx)    → Remove (✕) button on cart items
 * ============================================================
 */

'use strict';

// ── Cart state (loaded from localStorage) ────────────────────
let cart = JSON.parse(localStorage.getItem('cart') || '[]');


// ── Boot: render cart on page load ───────────────────────────
document.addEventListener('DOMContentLoaded', renderCart);


// ============================================================
//  renderCart()
//  Reads cart from localStorage and builds the cart UI.
//  Shows cart items, qty controls, customer form, pay button.
// ============================================================
function renderCart() {
  const itemsDiv  = document.getElementById('cart-items');
  const emptyDiv  = document.getElementById('cart-empty');
  const divider   = document.getElementById('divider');
  const totalRow  = document.getElementById('total-row');
  const formSec   = document.getElementById('form-section');
  const payBtn    = document.getElementById('pay-btn');

  // Show empty message if no items
  if (!cart.length) {
    emptyDiv.style.display = 'block';
    itemsDiv.innerHTML     = '';
    divider.style.display  = 'none';
    totalRow.style.display = 'none';
    if (formSec) formSec.style.display = 'none';
    if (payBtn)  payBtn.style.display  = 'none';
    return;
  }

  emptyDiv.style.display = 'none';

  // Calculate total and build item rows
  let total = 0;
  itemsDiv.innerHTML = cart.map((item, idx) => {
    const sub = item.price * item.qty;
    total += sub;
    return `
      <div class="cart-item">
        <div class="item-info">
          <div class="item-name">${xh(item.name)}</div>
          <div class="item-price">₹${item.price.toLocaleString('en-IN')} each</div>
        </div>
        <div class="item-qty">
          <button class="qty-btn" onclick="changeQty(${idx}, -1)">−</button>
          <div class="qty-num">${item.qty}</div>
          <button class="qty-btn" onclick="changeQty(${idx}, +1)">+</button>
        </div>
        <div class="item-sub">₹${sub.toLocaleString('en-IN')}</div>
        <button class="remove-btn" onclick="removeItem(${idx})" title="Remove item">✕</button>
      </div>`;
  }).join('');

  // Show total
  document.getElementById('total-amount').textContent = total.toLocaleString('en-IN');

  // Show remaining UI sections
  divider.style.display           = 'block';
  totalRow.style.display          = 'flex';
  if (formSec) formSec.style.display = 'block';
  if (payBtn)  payBtn.style.display  = 'block';
}


// ============================================================
//  changeQty(idx, delta)
//  Increment (+1) or decrement (-1) qty for cart[idx].
//  Removes item if qty drops to 0.
// ============================================================
function changeQty(idx, delta) {
  if (!cart[idx]) return;

  cart[idx].qty += delta;

  if (cart[idx].qty <= 0) {
    cart.splice(idx, 1);   // remove item
  }

  saveCart();
  renderCart();
}


// ============================================================
//  removeItem(idx)
//  Remove a cart item entirely
// ============================================================
function removeItem(idx) {
  cart.splice(idx, 1);
  saveCart();
  renderCart();
}


// ============================================================
//  saveCart()
//  Persist cart to localStorage
// ============================================================
function saveCart() {
  localStorage.setItem('cart', JSON.stringify(cart));
}


// ============================================================
//  payNow()
//  Full 3-step payment flow:
//    Step 1: POST /api/payment/create-order  → get Razorpay order_id
//    Step 2: Open Razorpay checkout modal
//    Step 3: POST /api/payment/verify        → verify signature, get slip URL
// ============================================================
async function payNow() {

  // ── Read customer details from form ───────────────────────
  const name  = (document.getElementById('c-name')  || {}).value?.trim();
  const phone = (document.getElementById('c-phone') || {}).value?.trim();
  const email = (document.getElementById('c-email') || {}).value?.trim() || '';

  if (!name || !phone) {
    alert('Please enter your name and phone number before paying.');
    return;
  }

  // ── Calculate total ───────────────────────────────────────
  const total = cart.reduce((sum, item) => sum + item.price * item.qty, 0);
  if (total <= 0) {
    alert('Your cart is empty!');
    return;
  }
  if (!RAZORPAY_KEY || RAZORPAY_KEY === 'rzp_test_YOUR_KEY') {
    alert('Razorpay is not configured. Please set a valid RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET.');
    return;
  }

  // ── Disable pay button during network calls ───────────────
  const btn = document.getElementById('pay-btn');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Creating order...'; }

  try {

    // ────────────────────────────────────────────────────────
    //  STEP 1: Create Razorpay Order via Flask backend
    //  POST /api/payment/create-order
    //  Flask: app.py → create_order()
    //    • Calls Razorpay API: rzp_client.order.create(...)
    //    • Saves Order row to SQLite with status="created"
    //    • Returns: { order_id, amount (paise), currency, key, db_order_id }
    // ────────────────────────────────────────────────────────
    const orderResponse = await fetch('/api/payment/create-order', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        amount: total,         // in INR (backend converts to paise)
        items:  cart,          // array of cart items (saved to DB)
        name,
        phone,
        email,
      }),
    });

    if (!orderResponse.ok) {
      let msg = `Order creation failed: HTTP ${orderResponse.status}`;
      try {
        const errJson = await orderResponse.json();
        if (errJson && errJson.error) msg = errJson.error;
      } catch (e) {}
      throw new Error(msg);
    }

    const orderData = await orderResponse.json();

    if (!orderData.order_id) {
      throw new Error('No order_id in response. Check Razorpay keys in app.py.');
    }

    if (btn) btn.textContent = '⏳ Opening payment...';

    // ────────────────────────────────────────────────────────
    //  STEP 2: Open Razorpay Checkout Modal
    //  Uses Razorpay JS SDK loaded in cart.html:
    //    <script src="https://checkout.razorpay.com/v1/checkout.js">
    //
    //  key:      RAZORPAY_KEY_ID  (Jinja2 var from app.py)
    //  amount:   in paise (e.g. ₹499 → 49900)
    //  order_id: from Razorpay (required for payment capture)
    //  handler:  called by Razorpay after user completes payment
    // ────────────────────────────────────────────────────────
    const rzpOptions = {
      key:         RAZORPAY_KEY,         // from <script> block in cart.html
      amount:      orderData.amount,     // paise
      currency:    orderData.currency,   // "INR"
      name:        'PetStore Pro',
      description: 'Premium pet care products',
      order_id:    orderData.order_id,   // Razorpay order ID

      prefill: {
        name:    name,
        contact: phone,
        email:   email,
      },

      notes: {
        db_order_id: String(orderData.db_order_id),
      },

      theme: { color: '#3b82f6' },

      // ──────────────────────────────────────────────────────
      //  STEP 3 (inside handler): Verify payment on backend
      //  This is called automatically by Razorpay after the
      //  user successfully completes payment in the modal.
      //
      //  resp contains:
      //    razorpay_order_id   – Razorpay order ref
      //    razorpay_payment_id – unique payment ID
      //    razorpay_signature  – HMAC-SHA256 to verify
      // ──────────────────────────────────────────────────────
      handler: async function(resp) {
        if (btn) { btn.disabled = true; btn.textContent = '⏳ Verifying payment...'; }

        try {

          // POST /api/payment/verify
          // Flask: app.py → verify_payment()
          //   • Computes HMAC-SHA256(order_id + "|" + payment_id, SECRET_KEY)
          //   • Compares with razorpay_signature
          //   • If match: updates Order.status = "paid" in SQLite
          //   • Returns: { success: true, slip_url: "/slip/<id>" }
          const verifyResponse = await fetch('/api/payment/verify', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({
              razorpay_order_id:   resp.razorpay_order_id,
              razorpay_payment_id: resp.razorpay_payment_id,
              razorpay_signature:  resp.razorpay_signature || '',
              db_order_id:         orderData.db_order_id,  // our SQLite Order.id
            }),
          });

          const verifyData = await verifyResponse.json();

          if (verifyData.success) {
            // ✅ Payment verified – clear cart and go to slip
            localStorage.removeItem('cart');
            window.location.href = verifyData.slip_url;   // e.g. /slip/42

          } else {
            alert('❌ Payment verification failed!\n' + (verifyData.error || 'Contact support.'));
            if (btn) { btn.disabled = false; btn.textContent = '🔒 Pay Securely with Razorpay'; }
          }

        } catch (verifyErr) {
          console.error('[payment.js] verify error:', verifyErr);
          alert('Verification network error. Contact support with your payment ID:\n' + resp.razorpay_payment_id);
          if (btn) { btn.disabled = false; btn.textContent = '🔒 Pay Securely with Razorpay'; }
        }
      },
    };

    // Attach payment failure handler
    const rzp = new Razorpay(rzpOptions);

    rzp.on('payment.failed', function(response) {
      console.error('[payment.js] Payment failed:', response.error);
      alert('❌ Payment failed!\nReason: ' + response.error.description);
      if (btn) { btn.disabled = false; btn.textContent = '🔒 Pay Securely with Razorpay'; }
    });

    // Open the Razorpay checkout modal
    rzp.open();
    if (btn) { btn.disabled = false; btn.textContent = '🔒 Pay Securely with Razorpay'; }

  } catch (err) {
    console.error('[payment.js] payNow error:', err.message);
    alert('Payment initiation failed: ' + err.message);
    if (btn) { btn.disabled = false; btn.textContent = '🔒 Pay Securely with Razorpay'; }
  }
}


// ── Escape helper (prevent XSS) ───────────────────────────────
function xh(s) {
  return String(s || '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
