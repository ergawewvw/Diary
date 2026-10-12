'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = __dirname;
const DATA = path.join(ROOT, 'data');
const AUTH_FILE = path.join(DATA, 'auth.json');
const ENTRIES_FILE = path.join(DATA, 'entries.json');
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const IS_PROD = process.env.NODE_ENV === 'production';
const SESSION_MS = 8 * 60 * 60 * 1000;
const LIMIT_WINDOW = 15 * 60 * 1000;
const sessions = new Map();
const failures = new Map();
const moods = new Set(['happy', 'calm', 'thoughtful']);

class HttpError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

const toJson = (res, status, data, extra = {}) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extra });
  res.end(JSON.stringify(data));
};
const errJson = (res, status, error) => toJson(res, status, { error });

function loadAuth() {
  try { return JSON.parse(fs.readFileSync(AUTH_FILE, 'utf8')); }
  catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}
function verify(candidate, record) {
  if (!record || typeof record.salt !== 'string' || typeof record.hash !== 'string') return false;
  const computed = crypto.scryptSync(candidate, Buffer.from(record.salt, 'hex'), 64);
  const stored = Buffer.from(record.hash, 'hex');
  return stored.length === computed.length && crypto.timingSafeEqual(stored, computed);
}
const normAnswer = (answer) => answer.normalize('NFKC').trim().toLocaleLowerCase();

function cookie(req) {
  const match = /(?:^|;\s*)diary_session=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie || '');
  return match?.[1] || '';
}
function session(req) {
  const key = crypto.createHash('sha256').update(cookie(req)).digest('hex');
  const item = sessions.get(key);
  if (!item) return null;
  if (item.expires < Date.now()) { sessions.delete(key); return null; }
  return item;
}
function requireSession(req) {
  const item = session(req);
  if (!item) throw new HttpError(401, 'Kirish talab qilinadi.');
  return item;
}
function checkCsrf(req, sess) {
  const candidate = req.headers['x-csrf-token'];
  if (typeof candidate !== 'string' || candidate.length !== sess.csrf.length) {
    throw new HttpError(403, 'Himoya belgisi noto‘g‘ri.');
  }
  if (!crypto.timingSafeEqual(Buffer.from(candidate), Buffer.from(sess.csrf))) {
    throw new HttpError(403, 'Himoya belgisi noto‘g‘ri.');
  }
}
function setCookie(res, token, maxAge) {
  res.setHeader('Set-Cookie', `diary_session=${token}; HttpOnly; Path=/; SameSite=Strict; Max-Age=${maxAge}${IS_PROD ? '; Secure' : ''}`);
}
function createSession(res) {
  const token = crypto.randomBytes(32).toString('hex');
  const csrf = crypto.randomBytes(32).toString('hex');
  sessions.set(crypto.createHash('sha256').update(token).digest('hex'), { csrf, expires: Date.now() + SESSION_MS });
  setCookie(res, token, SESSION_MS / 1000);
  return csrf;
}
function rejectCrossSite(req) {
  const origin = req.headers.origin;
  if (!origin) return;
  try {
    if (new URL(origin).host === req.headers.host && (!IS_PROD || new URL(origin).protocol === 'https:')) return;
  } catch {}
  throw new HttpError(403, 'So‘rov manbasi ruxsat etilmagan.');
}
async function jsonBody(req) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > 64 * 1024) throw new HttpError(413, 'So‘rov juda katta.');
    chunks.push(chunk);
  }
  try {
    const result = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error('not object');
    return result;
  } catch { throw new HttpError(400, 'JSON ma’lumoti noto‘g‘ri.'); }
}

function readEntries() {
  try {
    const result = JSON.parse(fs.readFileSync(ENTRIES_FILE, 'utf8'));
    if (!Array.isArray(result)) throw new Error('Yozuvlar formati noto‘g‘ri.');
    return result;
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
}
function writeEntries(entries) {
  fs.mkdirSync(DATA, { recursive: true, mode: 0o700 });
  const temp = ENTRIES_FILE + '.' + crypto.randomBytes(6).toString('hex') + '.tmp';
  try {
    fs.writeFileSync(temp, JSON.stringify(entries, null, 2), { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(temp, ENTRIES_FILE);
  } finally {
    if (fs.existsSync(temp)) fs.unlinkSync(temp);
  }
}
function validateEntry(body) {
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  const content = typeof body.content === 'string' ? body.content.trim() : '';
  const date = body.date;
  if (title.length > 120 || content.length > 20000 || (!title && !content)) {
    throw new HttpError(400, 'Sarlavha yoki matnni kiriting (sarlavha 120, matn 20000 belgigacha).');
  }
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date) {
    throw new HttpError(400, 'Sana noto‘g‘ri.');
  }
  if (!moods.has(body.mood)) throw new HttpError(400, 'Kayfiyat noto‘g‘ri.');
  return { title, content, date, mood: body.mood, pinned: body.pinned === true };
}
function attemptAllowed(key) {
  const now = Date.now();
  const item = failures.get(key);
  if (!item || item.reset < now) { failures.delete(key); return true; }
  return item.count < 5;
}
function failedAttempt(key) {
  const now = Date.now();
  const item = failures.get(key);
  failures.set(key, (!item || item.reset < now)
    ? { count: 1, reset: now + LIMIT_WINDOW }
    : { count: item.count + 1, reset: item.reset });
  if (failures.size > 5000) {
    for (const [ip, value] of failures) if (value.reset < now) failures.delete(ip);
  }
}
function securityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
  if (IS_PROD) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
}
function staticFile(req, res, pathname) {
  const names = {
    '/': ['index.html', 'text/html; charset=utf-8'],
    '/index.html': ['index.html', 'text/html; charset=utf-8'],
    '/styles.css': ['styles.css', 'text/css; charset=utf-8'],
    '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
    '/favicon.svg': ['favicon.svg', 'image/svg+xml']
  };
  if (!(pathname in names)) throw new HttpError(404, 'Sahifa topilmadi.');
  const [name, type] = names[pathname];
  res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(fs.readFileSync(path.join(ROOT, 'public', name)));
}

async function handler(req, res) {
  securityHeaders(res);
  const pathname = new URL(req.url, 'http://localhost').pathname;
  const method = req.method;
  if (!['GET', 'POST', 'PUT', 'DELETE'].includes(method)) throw new HttpError(405, 'Usul ruxsat etilmagan.');
  if (method !== 'GET') rejectCrossSite(req);

  if (pathname === '/api/config' && method === 'GET') {
    const auth = loadAuth();
    return toJson(res, 200, { configured: !!auth, questions: auth?.questions || [] });
  }
  if (pathname === '/api/session' && method === 'GET') {
    const active = session(req);
    return toJson(res, 200, active ? { authenticated: true, csrf: active.csrf } : { authenticated: false });
  }
  if (pathname === '/api/login' && method === 'POST') {
    const auth = loadAuth();
    if (!auth) throw new HttpError(503, 'Administrator dastlab hisobni sozlashi kerak.');
    const address = req.socket.remoteAddress || 'unknown';
    if (!attemptAllowed(address)) throw new HttpError(429, 'Juda ko‘p urinish. 15 daqiqadan keyin qayta urinib ko‘ring.');
    const body = await jsonBody(req);
    if (typeof body.username !== 'string' || typeof body.password !== 'string' ||
        !Array.isArray(body.answers) || body.answers.length !== 3 ||
        body.answers.some(value => typeof value !== 'string' || value.length > 200) ||
        body.password.length > 200) throw new HttpError(400, 'Kirish ma’lumotlarini to‘liq kiriting.');

    const passOk = verify(body.password, auth.password);
    const answersOk = body.answers.map((a, i) => verify(normAnswer(a), auth.answers[i])).every(Boolean);
    if (!(body.username === auth.username && passOk && answersOk)) {
      failedAttempt(address);
      throw new HttpError(401, 'Login, parol yoki savollar javoblari noto‘g‘ri.');
    }
    failures.delete(address);
    const csrf = createSession(res);
    return toJson(res, 200, { authenticated: true, csrf });
  }
  if (pathname === '/api/logout' && method === 'POST') {
    const active = requireSession(req);
    checkCsrf(req, active);
    sessions.delete(crypto.createHash('sha256').update(cookie(req)).digest('hex'));
    setCookie(res, '', 0);
    return toJson(res, 200, { ok: true });
  }
  if (pathname === '/api/entries' && method === 'GET') {
    requireSession(req);
    return toJson(res, 200, { entries: readEntries().sort((a, b) => b.date.localeCompare(a.date) || b.updatedAt.localeCompare(a.updatedAt)) });
  }
  if (pathname === '/api/entries' && method === 'POST') {
    checkCsrf(req, requireSession(req));
    const data = validateEntry(await jsonBody(req));
    const entries = readEntries();
    if (entries.length >= 10000) throw new HttpError(400, 'Yozuvlar soni chegarasiga yetildi.');
    const time = new Date().toISOString();
    const entry = { id: crypto.randomUUID(), ...data, createdAt: time, updatedAt: time };
    entries.push(entry);
    writeEntries(entries);
    return toJson(res, 201, { entry });
  }
  const match = /^\/api\/entries\/([0-9a-f-]{36})$/.exec(pathname);
  if (match && (method === 'PUT' || method === 'DELETE')) {
    checkCsrf(req, requireSession(req));
    const entries = readEntries();
    const index = entries.findIndex(item => item.id === match[1]);
    if (index === -1) throw new HttpError(404, 'Yozuv topilmadi.');
    if (method === 'DELETE') {
      entries.splice(index, 1);
      writeEntries(entries);
      return toJson(res, 200, { ok: true });
    }
    entries[index] = { ...entries[index], ...validateEntry(await jsonBody(req)), updatedAt: new Date().toISOString() };
    writeEntries(entries);
    return toJson(res, 200, { entry: entries[index] });
  }

  if (pathname.startsWith('/api/')) throw new HttpError(404, 'API topilmadi.');
  if (method !== 'GET') throw new HttpError(405, 'Usul ruxsat etilmagan.');
  return staticFile(req, res, pathname);
}

const server = http.createServer((req, res) => {
  handler(req, res).catch((error) => {
    console.error(error.code || 500, error.code ? error.message : error);
    if (!res.headersSent) errJson(res, error.code || 500, error.code ? error.message : 'Ichki server xatosi.');
    else res.end();
  });
});
server.listen(PORT, HOST, () => {
  console.log(`Kundalik: http://localhost:${PORT}`);
  if (!loadAuth()) console.log('Hisob hali sozlanmagan: npm run setup');
});
