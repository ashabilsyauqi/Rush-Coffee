// Rush Coffee — HPP Counter Server
// Zero-dependency Node.js server (Node 18+). Run: node server.js
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');

const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');
const DATA_DIR = path.join(ROOT, 'data');
const DATA_FILE = path.join(DATA_DIR, 'data.json');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const CONFIG_FILE = path.join(ROOT, 'config.json');

// ---------- config ----------
const defaultConfig = { port: 8080, host: '0.0.0.0', password: 'rushcoffee', sessionHours: 72 };
if (!fs.existsSync(CONFIG_FILE)) fs.writeFileSync(CONFIG_FILE, JSON.stringify(defaultConfig, null, 2));
const config = Object.assign({}, defaultConfig, JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8').replace(/^\uFEFF/, '')));
if (process.env.PORT) config.port = Number(process.env.PORT);

// secret for signing session tokens (persisted so sessions survive restarts)
fs.mkdirSync(BACKUP_DIR, { recursive: true });
const SECRET_FILE = path.join(DATA_DIR, '.secret');
if (!fs.existsSync(SECRET_FILE)) fs.writeFileSync(SECRET_FILE, crypto.randomBytes(32).toString('hex'));
const SECRET = fs.readFileSync(SECRET_FILE, 'utf8').trim();

// ---------- data ----------
function seed() {
  return JSON.parse(fs.readFileSync(path.join(ROOT, 'seed.json'), 'utf8'));
}
function loadData() {
  if (!fs.existsSync(DATA_FILE)) {
    const s = seed();
    s.rev = 1;
    s.updatedAt = new Date().toISOString();
    writeAtomic(DATA_FILE, JSON.stringify(s, null, 2));
    return s;
  }
  return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8').replace(/^\uFEFF/, ''));
}
function writeAtomic(file, content) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, content);
  fs.renameSync(tmp, file);
}
function backup() {
  // one backup file per day (overwritten during the day), keep last 30
  const day = new Date().toISOString().slice(0, 10);
  if (fs.existsSync(DATA_FILE)) fs.copyFileSync(DATA_FILE, path.join(BACKUP_DIR, `data-${day}.json`));
  const files = fs.readdirSync(BACKUP_DIR).filter(f => f.startsWith('data-')).sort();
  while (files.length > 30) fs.unlinkSync(path.join(BACKUP_DIR, files.shift()));
}
let data = loadData();

// ---------- auth ----------
function sign(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  return body + '.' + sig;
}
function verify(token) {
  if (!token || !token.includes('.')) return null;
  const [body, sig] = token.split('.');
  const exp = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  if (sig.length !== exp.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(exp))) return null;
  const p = JSON.parse(Buffer.from(body, 'base64url').toString());
  return p.exp > Date.now() ? p : null;
}
function getCookie(req, name) {
  const m = (req.headers.cookie || '').match(new RegExp('(?:^|; )' + name + '=([^;]+)'));
  return m ? decodeURIComponent(m[1]) : null;
}
const loginAttempts = new Map(); // ip -> {n, until}

// ---------- helpers ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json' };
function send(res, code, obj, headers = {}) {
  res.writeHead(code, Object.assign({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, headers));
  res.end(JSON.stringify(obj));
}
function readBody(req, limit = 5 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > limit) { reject(new Error('too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {}); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}
function validState(s) {
  return s && Array.isArray(s.ingredients) && Array.isArray(s.menus) && Array.isArray(s.overheads) && typeof s.settings === 'object';
}

// ---------- server ----------
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  const ip = req.socket.remoteAddress;

  try {
    if (p === '/api/health') return send(res, 200, { ok: true, rev: data.rev });

    if (p === '/api/login' && req.method === 'POST') {
      const a = loginAttempts.get(ip) || { n: 0, until: 0 };
      if (a.until > Date.now()) return send(res, 429, { error: 'Terlalu banyak percobaan. Coba lagi 5 menit lagi.' });
      const body = await readBody(req);
      const ok = typeof body.password === 'string' && body.password.length === config.password.length &&
        crypto.timingSafeEqual(Buffer.from(body.password), Buffer.from(config.password));
      if (!ok) {
        a.n++; if (a.n >= 5) { a.until = Date.now() + 5 * 60e3; a.n = 0; }
        loginAttempts.set(ip, a);
        return send(res, 401, { error: 'Password salah' });
      }
      loginAttempts.delete(ip);
      const token = sign({ exp: Date.now() + config.sessionHours * 3600e3, name: String(body.name || 'staff').slice(0, 40) });
      return send(res, 200, { ok: true }, { 'Set-Cookie': `hpp_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${config.sessionHours * 3600}` });
    }
    if (p === '/api/logout') return send(res, 200, { ok: true }, { 'Set-Cookie': 'hpp_session=; Path=/; Max-Age=0' });

    if (p.startsWith('/api/')) {
      const session = verify(getCookie(req, 'hpp_session'));
      if (!session) return send(res, 401, { error: 'Belum login' });

      if (p === '/api/data' && req.method === 'GET') return send(res, 200, data);

      if (p === '/api/data' && req.method === 'PUT') {
        const body = await readBody(req);
        if (!validState(body.state)) return send(res, 400, { error: 'Format data tidak valid' });
        if (body.baseRev !== data.rev && !body.force) return send(res, 409, { error: 'Data sudah diubah dari perangkat lain', current: data });
        backup();
        const next = Object.assign({}, body.state, { rev: data.rev + 1, updatedAt: new Date().toISOString(), updatedBy: session.name });
        writeAtomic(DATA_FILE, JSON.stringify(next, null, 2));
        data = next;
        return send(res, 200, { ok: true, rev: data.rev, updatedAt: data.updatedAt });
      }

      if (p === '/api/backups' && req.method === 'GET') {
        return send(res, 200, fs.readdirSync(BACKUP_DIR).filter(f => f.endsWith('.json')).sort().reverse());
      }
      return send(res, 404, { error: 'Not found' });
    }

    // static files
    let file = path.normalize(path.join(PUBLIC, p === '/' ? 'index.html' : p));
    if (!file.startsWith(PUBLIC)) return send(res, 403, { error: 'Forbidden' });
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      if (path.extname(p)) { res.writeHead(404); return res.end('Not found'); }
      file = path.join(PUBLIC, 'index.html');
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    fs.createReadStream(file).pipe(res);
  } catch (e) {
    console.error(e);
    send(res, 500, { error: 'Server error: ' + e.message });
  }
});

server.listen(config.port, config.host, () => {
  console.log('\n  RUSH COFFEE — HPP Counter berjalan');
  console.log('  -----------------------------------');
  console.log(`  Lokal   : http://localhost:${config.port}`);
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    for (const a of addrs || []) if (a.family === 'IPv4' && !a.internal) console.log(`  ${name.padEnd(8).slice(0, 8)}: http://${a.address}:${config.port}`);
  }
  if (config.password === 'rushcoffee') console.log('\n  ⚠  Password masih default. Ganti di config.json lalu restart.');
  console.log('');
});
