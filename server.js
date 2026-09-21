// VIP Channels — zero-dependency Node server (Railway ready)
// Auth (register/login), user tiers, admin API, image uploads, JSON file storage.
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const PUBLIC = path.join(__dirname, 'public');
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data'));
const UPLOADS = path.join(DATA_DIR, 'uploads');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const MAX_BODY = 12 * 1024 * 1024; // 12 MB (images arrive as base64)
const SESSION_DAYS = 30;

fs.mkdirSync(UPLOADS, { recursive: true });

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.json': 'application/json'
};

/* ---------------- Default content ---------------- */
function makeButtons(n, prefix) {
  return Array.from({ length: n }, (_, i) => ({ name: `${prefix} ${i + 1}`, url: '' }));
}
function defaultSettings() {
  return {
    siteTitle: 'VIP Channels',
    siteSub: 'Pick a package, scan to pay, then send your receipt.',
    contactLabel: 'Contact us',
    contactUrl: '',
    sendUrl: '',
    qrUrl: '/qr.png',
    qrHint: 'Scan with any InstaPay-enabled bank or e-wallet app.',
    lockTitle: 'This is locked',
    lockText: 'Upgrade your account to unlock every channel in this package.',
    carouselTitle: 'Our Coffee Beans',
    footer: 'Payments via InstaPay. Transfer fees may apply.',
    bUnlocksA: true,
    packages: {
      free: { name: 'Free Plan', countLabel: 'Free Channels', price: '₱0', priceNote: 'free forever', desc: '', buttons: makeButtons(5, 'Free Channel') },
      a: { name: 'Package A', countLabel: 'VIP Channels', price: '₱250', priceNote: 'one-time only', desc: '', buttons: makeButtons(20, 'VIP Channel') },
      b: { name: 'Package B', countLabel: 'VIP Channels', price: '₱500', priceNote: 'one-time only', desc: '', buttons: makeButtons(50, 'VIP Channel') }
    }
  };
}

/* ---------------- Storage ---------------- */
let db;
function loadDb() {
  try { db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); }
  catch { db = {}; }
  db.users = db.users || [];
  db.sessions = db.sessions || {};
  db.carousel = db.carousel || [];
  const def = defaultSettings();
  db.settings = Object.assign(def, db.settings || {});
  db.settings.packages = Object.assign(def.packages, (db.settings && db.settings.packages) || {});
  const now = Date.now();
  for (const [t, s] of Object.entries(db.sessions)) if (s.exp < now) delete db.sessions[t];
}
let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const tmp = DB_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
    fs.renameSync(tmp, DB_FILE);
  }, 50);
}
function saveNow() { clearTimeout(saveTimer); const tmp = DB_FILE + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(db, null, 2)); fs.renameSync(tmp, DB_FILE); }

/* ---------------- Passwords & sessions ---------------- */
function hashPw(pw, salt = crypto.randomBytes(16).toString('hex')) {
  return { salt, hash: crypto.scryptSync(pw, salt, 64).toString('hex') };
}
function checkPw(pw, user) {
  const h = crypto.scryptSync(pw, user.salt, 64);
  const s = Buffer.from(user.hash, 'hex');
  return h.length === s.length && crypto.timingSafeEqual(h, s);
}
function newId() { return crypto.randomBytes(8).toString('hex'); }

function seedAdmin() {
  if (db.users.some(u => u.role === 'admin')) return;
  const username = process.env.ADMIN_USERNAME || 'admin';
  const password = process.env.ADMIN_PASSWORD || 'changeme123';
  if (!process.env.ADMIN_PASSWORD) console.warn('⚠  No ADMIN_PASSWORD set — created admin with default password "changeme123". Change it in Admin → Account.');
  const { salt, hash } = hashPw(password);
  db.users.push({ id: newId(), username, salt, hash, role: 'admin', tier: 'b', createdAt: Date.now() });
  saveNow();
}

/* ---------------- Helpers ---------------- */
function send(res, code, obj, headers = {}) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(body);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > MAX_BODY) { reject(Object.assign(new Error('Too large'), { code: 413 })); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch { reject(Object.assign(new Error('Bad JSON'), { code: 400 })); } });
    req.on('error', reject);
  });
}
function cookies(req) {
  const out = {};
  (req.headers.cookie || '').split(';').forEach(p => { const i = p.indexOf('='); if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim()); });
  return out;
}
function isHttps(req) { return req.headers['x-forwarded-proto'] === 'https'; }
function sessionCookie(req, token, maxAge) {
  return `sid=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${isHttps(req) ? '; Secure' : ''}`;
}
function currentUser(req) {
  const t = cookies(req).sid;
  const s = t && db.sessions[t];
  if (!s || s.exp < Date.now()) return null;
  return db.users.find(u => u.id === s.userId) || null;
}
function startSession(req, res, user) {
  const token = crypto.randomBytes(32).toString('hex');
  db.sessions[token] = { userId: user.id, exp: Date.now() + SESSION_DAYS * 864e5 };
  save();
  return sessionCookie(req, token, SESSION_DAYS * 86400);
}
const str = (v, max = 500) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
function safeUrl(v) {
  const s = str(v, 2000);
  if (!s) return '';
  if (/^(https?:|mailto:|tg:|tel:|viber:|fb-messenger:)/i.test(s) || s.startsWith('/')) return s;
  if (/^[\w.-]+\.[a-z]{2,}(\/|$)/i.test(s)) return 'https://' + s; // bare domain → https
  return '';
}
function publicUser(u) { return { id: u.id, username: u.username, role: u.role, tier: u.tier, createdAt: u.createdAt }; }
function hasAccess(user, key) {
  if (key === 'free') return true;
  if (user.role === 'admin') return true;
  if (key === 'a') return user.tier === 'a' || (user.tier === 'b' && db.settings.bUnlocksA);
  if (key === 'b') return user.tier === 'b';
  return false;
}

// Simple in-memory rate limit for auth endpoints
const hits = new Map();
function limited(req, key, max = 10, windowMs = 10 * 60 * 1000) {
  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  const k = key + ':' + ip; const now = Date.now();
  const arr = (hits.get(k) || []).filter(t => now - t < windowMs);
  arr.push(now); hits.set(k, arr);
  return arr.length > max;
}

function saveDataUrl(dataUrl) {
  const m = /^data:image\/(png|jpe?g|webp|gif);base64,(.+)$/i.exec(dataUrl || '');
  if (!m) throw Object.assign(new Error('Unsupported image'), { code: 400 });
  const ext = m[1].toLowerCase() === 'jpeg' ? 'jpg' : m[1].toLowerCase();
  const name = `${Date.now()}-${newId()}.${ext}`;
  fs.writeFileSync(path.join(UPLOADS, name), Buffer.from(m[2], 'base64'));
  return '/uploads/' + name;
}
function removeUpload(url) {
  if (typeof url !== 'string' || !url.startsWith('/uploads/')) return;
  const f = path.join(UPLOADS, path.basename(url));
  fs.unlink(f, () => {});
}

/* ---------------- API ---------------- */
async function api(req, res, pathname) {
  const method = req.method;
  const user = currentUser(req);

  if (pathname === '/api/register' && method === 'POST') {
    if (limited(req, 'reg', 8)) return send(res, 429, { error: 'Too many attempts. Try again later.' });
    const b = await readBody(req);
    const username = str(b.username, 32);
    const password = typeof b.password === 'string' ? b.password : '';
    if (!/^[a-zA-Z0-9_.@-]{3,32}$/.test(username)) return send(res, 400, { error: 'Username must be 3–32 characters (letters, numbers, _ . @ -).', field: 'username' });
    if (password.length < 6) return send(res, 400, { error: 'Password must be at least 6 characters.', field: 'password' });
    if (db.users.some(u => u.username.toLowerCase() === username.toLowerCase())) return send(res, 409, { error: 'That username is already taken.', field: 'username' });
    const { salt, hash } = hashPw(password);
    const u = { id: newId(), username, salt, hash, role: 'user', tier: 'free', createdAt: Date.now() };
    db.users.push(u); save();
    return send(res, 200, { user: publicUser(u) }, { 'Set-Cookie': startSession(req, res, u) });
  }

  if (pathname === '/api/login' && method === 'POST') {
    if (limited(req, 'login', 15)) return send(res, 429, { error: 'Too many attempts. Try again in a few minutes.' });
    const b = await readBody(req);
    const u = db.users.find(x => x.username.toLowerCase() === str(b.username, 64).toLowerCase());
    if (!u || typeof b.password !== 'string' || !checkPw(b.password, u)) return send(res, 401, { error: 'Wrong username or password.' });
    return send(res, 200, { user: publicUser(u) }, { 'Set-Cookie': startSession(req, res, u) });
  }

  if (pathname === '/api/logout' && method === 'POST') {
    const t = cookies(req).sid; if (t) { delete db.sessions[t]; save(); }
    return send(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie(req, '', 0) });
  }

  // Public bits for login page (title, contact)
  if (pathname === '/api/public' && method === 'GET') {
    const s = db.settings;
    return send(res, 200, { siteTitle: s.siteTitle, siteSub: s.siteSub, contactLabel: s.contactLabel, contactUrl: s.contactUrl });
  }

  if (!user) return send(res, 401, { error: 'Please log in.' });

  if (pathname === '/api/me' && method === 'GET') {
    const s = db.settings;
    const packages = {};
    for (const key of ['free', 'a', 'b']) {
      const p = s.packages[key]; const open = hasAccess(user, key);
      packages[key] = {
        name: p.name, countLabel: p.countLabel, price: p.price, priceNote: p.priceNote, desc: p.desc, locked: !open,
        // Links for locked packages never leave the server
        buttons: p.buttons.map(bt => ({ name: bt.name, url: open ? bt.url : '' }))
      };
    }
    return send(res, 200, {
      user: publicUser(user),
      settings: { siteTitle: s.siteTitle, siteSub: s.siteSub, contactLabel: s.contactLabel, contactUrl: s.contactUrl, sendUrl: s.sendUrl,
        qrUrl: s.qrUrl, qrHint: s.qrHint, lockTitle: s.lockTitle, lockText: s.lockText, carouselTitle: s.carouselTitle, footer: s.footer },
      packages, carousel: db.carousel
    });
  }

  if (pathname === '/api/me/password' && method === 'POST') {
    const b = await readBody(req);
    if (typeof b.current !== 'string' || !checkPw(b.current, user)) return send(res, 400, { error: 'Current password is wrong.', field: 'current' });
    if (typeof b.password !== 'string' || b.password.length < 6) return send(res, 400, { error: 'New password must be at least 6 characters.', field: 'password' });
    Object.assign(user, hashPw(b.password)); save();
    return send(res, 200, { ok: true });
  }

  /* ---------- Admin ---------- */
  if (!pathname.startsWith('/api/admin/')) return send(res, 404, { error: 'Not found' });
  if (user.role !== 'admin') return send(res, 403, { error: 'Admins only.' });

  if (pathname === '/api/admin/data' && method === 'GET') {
    return send(res, 200, { settings: db.settings, carousel: db.carousel, users: db.users.map(publicUser), me: publicUser(user) });
  }

  if (pathname === '/api/admin/settings' && method === 'PUT') {
    const b = await readBody(req); const s = db.settings;
    for (const k of ['siteTitle', 'siteSub', 'contactLabel', 'qrHint', 'lockTitle', 'lockText', 'carouselTitle', 'footer'])
      if (k in b) s[k] = str(b[k], 600);
    if ('contactUrl' in b) s.contactUrl = safeUrl(b.contactUrl);
    if ('sendUrl' in b) s.sendUrl = safeUrl(b.sendUrl);
    if ('bUnlocksA' in b) s.bUnlocksA = !!b.bUnlocksA;
    if (b.packages && typeof b.packages === 'object') {
      for (const key of ['free', 'a', 'b']) {
        const src = b.packages[key]; if (!src) continue; const dst = s.packages[key];
        for (const k of ['name', 'countLabel', 'price', 'priceNote']) if (k in src) dst[k] = str(src[k], 120);
        if ('desc' in src) dst.desc = str(src.desc, 1500);
        if (Array.isArray(src.buttons)) dst.buttons = src.buttons.slice(0, 200).map(bt => ({ name: str(bt && bt.name, 80) || 'Untitled', url: safeUrl(bt && bt.url) }));
      }
    }
    save();
    return send(res, 200, { settings: s });
  }

  if (pathname === '/api/admin/qr' && method === 'POST') {
    const b = await readBody(req);
    if (b.reset) { removeUpload(db.settings.qrUrl); db.settings.qrUrl = '/qr.png'; }
    else { const url = saveDataUrl(b.dataUrl); removeUpload(db.settings.qrUrl); db.settings.qrUrl = url; }
    save(); return send(res, 200, { qrUrl: db.settings.qrUrl });
  }

  if (pathname === '/api/admin/carousel' && method === 'POST') {
    const b = await readBody(req);
    const item = { id: newId(), url: saveDataUrl(b.dataUrl), caption: str(b.caption, 140) };
    db.carousel.push(item); save();
    return send(res, 200, { carousel: db.carousel });
  }
  if (pathname === '/api/admin/carousel' && method === 'PUT') {
    // Reorder + captions: body.items = [{id, caption}]
    const b = await readBody(req);
    if (!Array.isArray(b.items)) return send(res, 400, { error: 'items required' });
    const byId = new Map(db.carousel.map(i => [i.id, i]));
    const next = [];
    for (const it of b.items) { const cur = byId.get(it && it.id); if (cur) { cur.caption = str(it.caption, 140); next.push(cur); byId.delete(cur.id); } }
    db.carousel = next.concat([...byId.values()]); save();
    return send(res, 200, { carousel: db.carousel });
  }
  let m;
  if ((m = /^\/api\/admin\/carousel\/([a-f0-9]+)$/.exec(pathname)) && method === 'DELETE') {
    const it = db.carousel.find(i => i.id === m[1]);
    if (it) { removeUpload(it.url); db.carousel = db.carousel.filter(i => i.id !== m[1]); save(); }
    return send(res, 200, { carousel: db.carousel });
  }

  if ((m = /^\/api\/admin\/users\/([a-f0-9]+)$/.exec(pathname))) {
    const target = db.users.find(u => u.id === m[1]);
    if (!target) return send(res, 404, { error: 'User not found' });
    if (method === 'PUT') {
      const b = await readBody(req);
      if ('tier' in b) { if (!['free', 'a', 'b'].includes(b.tier)) return send(res, 400, { error: 'Bad tier' }); target.tier = b.tier; }
      if ('role' in b) {
        if (!['user', 'admin'].includes(b.role)) return send(res, 400, { error: 'Bad role' });
        if (target.id === user.id && b.role !== 'admin') return send(res, 400, { error: "You can't remove your own admin role." });
        target.role = b.role;
      }
      save(); return send(res, 200, { user: publicUser(target) });
    }
    if (method === 'DELETE') {
      if (target.id === user.id) return send(res, 400, { error: "You can't delete your own account." });
      db.users = db.users.filter(u => u.id !== target.id);
      for (const [t, s] of Object.entries(db.sessions)) if (s.userId === target.id) delete db.sessions[t];
      save(); return send(res, 200, { ok: true });
    }
  }
  if ((m = /^\/api\/admin\/users\/([a-f0-9]+)\/password$/.exec(pathname)) && method === 'POST') {
    const target = db.users.find(u => u.id === m[1]);
    if (!target) return send(res, 404, { error: 'User not found' });
    const b = await readBody(req);
    if (typeof b.password !== 'string' || b.password.length < 6) return send(res, 400, { error: 'Password must be at least 6 characters.' });
    Object.assign(target, hashPw(b.password));
    for (const [t, s] of Object.entries(db.sessions)) if (s.userId === target.id && target.id !== user.id) delete db.sessions[t];
    save(); return send(res, 200, { ok: true });
  }

  return send(res, 404, { error: 'Not found' });
}

/* ---------------- Static ---------------- */
function serveFile(res, file, cache) {
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': cache });
    res.end(data);
  });
}
const PAGES = { '/': 'index.html', '/login': 'login.html', '/register': 'login.html', '/admin': 'admin.html' };

loadDb();
seedAdmin();

http.createServer(async (req, res) => {
  const pathname = decodeURIComponent(req.url.split('?')[0]);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  try {
    if (pathname.startsWith('/api/')) return await api(req, res, pathname);
    if (pathname.startsWith('/uploads/')) return serveFile(res, path.join(UPLOADS, path.basename(pathname)), 'public, max-age=31536000, immutable');
    if (PAGES[pathname]) return serveFile(res, path.join(PUBLIC, PAGES[pathname]), 'no-cache');
    const file = path.normalize(path.join(PUBLIC, pathname));
    if (!file.startsWith(PUBLIC)) { res.writeHead(403); return res.end(); }
    return serveFile(res, file, 'public, max-age=3600');
  } catch (e) {
    console.error(e);
    if (!res.headersSent) send(res, e.code && e.code >= 400 && e.code < 600 ? e.code : 500, { error: e.code === 413 ? 'Image too large.' : (e.code === 400 ? e.message : 'Server error') });
  }
}).listen(PORT, '0.0.0.0', () => console.log(`VIP Channels running on port ${PORT} — data in ${DATA_DIR}`));

process.on('SIGTERM', () => { try { saveNow(); } catch {} process.exit(0); });
