/**
 * ============================================================
 *  auth.js  –  Admin Authentication
 *  Loaded by: templates/admin-login.html
 *             templates/admin.html  (for logout only)
 * ============================================================
 *
 *  FLASK API CONNECTIONS
 *  ─────────────────────────────────────────────────────────
 *  POST /api/login
 *    Request body:  { username: String, password: String }
 *    Success:       { success: true }
 *    Failure:       { success: false, error: "Invalid credentials" }
 *    Flask handler: app.py → login()
 *    On success:    Flask sets session["admin"] = True (server-side)
 *
 *  POST /api/logout
 *    Request body:  (empty)
 *    Success:       { success: true }
 *    Flask handler: app.py → logout()
 *    On success:    Flask clears session["admin"]
 *
 *  SECURITY NOTE:
 *  ─────────────────────────────────────────────────────────
 *  Credentials are NEVER stored client-side.
 *  The server uses a Flask session cookie (signed with SECRET_KEY).
 *  Admin routes in app.py check is_admin() = session.get("admin") == True
 *
 *  FUNCTIONS CALLED FROM HTML
 *  ─────────────────────────────────────────────────────────
 *  login()   → Login button onclick in admin-login.html
 *  logout()  → Sidebar logout link onclick in admin.html
 * ============================================================
 */

'use strict';


// ============================================================
//  login()
//  Reads #user and #pass inputs, posts to /api/login.
//  On success → redirects to / (index page)
//  On failure → shows error in #msg element
// ============================================================
async function login() {
  const usernameEl = document.getElementById('user');
  const passwordEl = document.getElementById('pass');
  const msgEl      = document.getElementById('msg');

  const username = usernameEl.value.trim();
  const password = passwordEl.value;

  // ── Client-side validation ───────────────────────────────
  if (!username || !password) {
    msgEl.textContent = 'Please enter username and password.';
    return;
  }

  msgEl.textContent = 'Authenticating…';

  try {
    // ── POST /api/login ──────────────────────────────────
    //    Flask handler: app.py → login()
    //    Checks: username == ADMIN_USERNAME and password == ADMIN_PASSWORD
    //    Sets:   session["admin"] = True  (server-side session cookie)
    const response = await fetch('/api/login', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ username, password }),
    });

    const data = await response.json();

    if (data.success) {
      // Session cookie is set by Flask.
      // Redirect to index page after login.
      window.location.href = '/';

    } else {
      // Show error from server
      msgEl.textContent = data.error || 'Login failed. Try again.';
      passwordEl.value  = '';   // clear password field on failure
      passwordEl.focus();
    }

  } catch (err) {
    console.error('[auth.js] Login error:', err);
    msgEl.textContent = 'Network error. Is the Flask server running?';
  }
}


// ============================================================
//  logout()
//  Calls POST /api/logout to clear the server session,
//  then redirects to /admin-login
// ============================================================
async function logout() {
  try {
    // ── POST /api/logout ─────────────────────────────────
    //    Flask handler: app.py → logout()
    //    Removes: session["admin"]
    await fetch('/api/logout', { method: 'POST' });

  } catch (err) {
    // Logout locally anyway even if network fails
    console.warn('[auth.js] Logout API call failed:', err);
  }

  window.location.href = '/admin-login';
}
