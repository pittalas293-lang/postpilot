const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { URL } = require('url');

const PORT = Number(process.env.PORT || 3000);
const OLLAMA_URL = String(process.env.OLLAMA_URL || 'http://127.0.0.1:11434').replace(/\/$/, '');
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'qwen2.5:7b';
const SESSION_DAYS = Math.max(1, Number(process.env.SESSION_DAYS || 7));
const REQUEST_TIMEOUT_MS = Math.max(10_000, Number(process.env.REQUEST_TIMEOUT_MS || 45_000));
const ROOT = __dirname;
const DB_FILE = path.join(ROOT, 'data', 'db.json');
const PUBLIC_DIR = path.join(ROOT, 'public');
const MEDIA_DIR = path.join(ROOT, 'data', 'media');
const MAX_VIDEO_BYTES = 100 * 1024 * 1024;
const ALLOWED_VIDEO_MIME = new Set(['video/mp4', 'video/quicktime', 'video/webm']);
const ALLOWED_PLATFORMS = ['LinkedIn', 'Instagram', 'Facebook', 'X'];
const ALLOWED_TONES = ['Professional', 'Friendly', 'Bold', 'Educational', 'Persuasive'];
const ALLOWED_LENGTHS = ['Short', 'Medium', 'Long'];

function ensureDb() {
  fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
  fs.mkdirSync(MEDIA_DIR, { recursive: true });
  if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify({ users: [], posts: [], media: [], connections: {}, sessions: {} }, null, 2));
  }
}
ensureDb();

function readDb() {
  try {
    const parsed = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    return {
      users: Array.isArray(parsed.users) ? parsed.users : [],
      posts: Array.isArray(parsed.posts) ? parsed.posts : [],
      media: Array.isArray(parsed.media) ? parsed.media : [],
      connections: parsed.connections && typeof parsed.connections === 'object' ? parsed.connections : {},
      sessions: parsed.sessions && typeof parsed.sessions === 'object' ? parsed.sessions : {}
    };
  } catch {
    return { users: [], posts: [], media: [], connections: {}, sessions: {} };
  }
}

function writeDb(next) {
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2));
  fs.renameSync(tmp, DB_FILE);
}

let db = readDb();

const rateState = new Map();
function rateLimit(key, limit, windowMs) {
  const now = Date.now();
  const previous = rateState.get(key) || { count: 0, reset: now + windowMs };
  if (now > previous.reset) {
    previous.count = 0;
    previous.reset = now + windowMs;
  }
  previous.count += 1;
  rateState.set(key, previous);
  return { allowed: previous.count <= limit, remaining: Math.max(0, limit - previous.count), reset: previous.reset };
}

function json(res, status, body, extraHeaders = {}) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'same-origin',
    ...extraHeaders
  });
  res.end(payload);
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => {
      data += chunk;
      if (data.length > 1_000_000) {
        reject(new Error('Request too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!data) return resolve({});
      try { resolve(JSON.parse(data)); } catch { reject(new Error('Invalid JSON')); }
    });
    req.on('error', reject);
  });
}

function sendFile(res, file) {
  const ext = path.extname(file).toLowerCase();
  const type = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.ico': 'image/x-icon'
  }[ext] || 'application/octet-stream';
  try {
    const stat = fs.statSync(file);
    if (!stat.isFile()) return json(res, 404, { error: 'Not found' });
    res.writeHead(200, {
      'Content-Type': type,
      'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=300',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'same-origin'
    });
    fs.createReadStream(file).pipe(res);
  } catch {
    json(res, 404, { error: 'Not found' });
  }
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { salt, hash };
}
function verifyPassword(password, user) {
  const hash = crypto.scryptSync(password, user.salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(user.passwordHash, 'hex'));
}
function token() { return crypto.randomBytes(32).toString('hex'); }
function id(prefix = 'id') { return `${prefix}_${crypto.randomBytes(8).toString('hex')}`; }
function nowIso() { return new Date().toISOString(); }
function normalizeEmail(value) { return String(value || '').trim().toLowerCase(); }
function clientIp(req) { return String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || 'unknown'; }

function userFromReq(req) {
  const auth = req.headers.authorization || '';
  const sessionToken = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!sessionToken) return null;
  const session = db.sessions[sessionToken];
  if (!session || session.expiresAt < Date.now()) {
    if (session) delete db.sessions[sessionToken];
    return null;
  }
  return db.users.find(user => user.id === session.userId) || null;
}

function requireUser(req, res) {
  const user = userFromReq(req);
  if (!user) {
    json(res, 401, { error: 'Authentication required' });
    return null;
  }
  return user;
}

function publicUser(user) {
  return { id: user.id, name: user.name, email: user.email, createdAt: user.createdAt };
}
function publicPost(post) {
  const { userId, ...rest } = post;
  if (post.mediaId) {
    const media = db.media.find(item => item.id === post.mediaId && item.userId === post.userId);
    rest.media = media ? { id: media.id, originalName: media.originalName, mimeType: media.mimeType, size: media.size } : null;
  } else {
    rest.media = null;
  }
  return rest;
}

function userMedia(userId, mediaId) {
  return db.media.find(item => item.id === mediaId && item.userId === userId) || null;
}

function looksLikeVideo(buffer, mimeType) {
  if (mimeType === 'video/webm') return buffer.length >= 4 && buffer.slice(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
  if (mimeType === 'video/mp4' || mimeType === 'video/quicktime') return buffer.length >= 12 && buffer.slice(4, 8).toString('ascii') === 'ftyp';
  return false;
}

function parseMultipartFile(req, maxBytes = MAX_VIDEO_BYTES) {
  return new Promise((resolve, reject) => {
    const contentType = String(req.headers['content-type'] || '');
    const boundaryMatch = contentType.match(/boundary=(?:\"([^\"]+)\"|([^;]+))/i);
    if (!boundaryMatch) return reject(new Error('Invalid multipart form data'));
    const boundary = Buffer.from(`--${boundaryMatch[1] || boundaryMatch[2]}`);
    const chunks = [];
    let total = 0;
    let settled = false;
    const fail = (error) => { if (!settled) { settled = true; reject(error); } req.removeAllListeners('data'); req.removeAllListeners('end'); };
    req.on('data', chunk => {
      total += chunk.length;
      if (total > maxBytes + 2 * 1024 * 1024) return fail(new Error('Video is too large. Maximum size is 100 MB.'));
      chunks.push(Buffer.from(chunk));
    });
    req.on('error', fail);
    req.on('end', () => {
      if (settled) return;
      const body = Buffer.concat(chunks);
      const start = body.indexOf(boundary);
      if (start < 0) return fail(new Error('Multipart boundary not found'));
      const headerStart = start + boundary.length + 2;
      const headerEnd = body.indexOf(Buffer.from('\r\n\r\n'), headerStart);
      if (headerEnd < 0) return fail(new Error('Multipart headers not found'));
      const headerText = body.slice(headerStart, headerEnd).toString('utf8');
      const disposition = headerText.match(/content-disposition:[^\r\n]*name=\"([^\"]+)\"[^\r\n]*filename=\"([^\"]*)\"/i);
      const mimeMatch = headerText.match(/content-type:\s*([^\r\n]+)/i);
      if (!disposition) return fail(new Error('Video file field is required'));
      const partStart = headerEnd + 4;
      const nextBoundary = body.indexOf(boundary, partStart);
      if (nextBoundary < 0) return fail(new Error('Multipart end boundary not found'));
      let fileEnd = nextBoundary - 2;
      if (fileEnd < partStart) fileEnd = partStart;
      const buffer = body.slice(partStart, fileEnd);
      if (buffer.length > maxBytes) return fail(new Error('Video is too large. Maximum size is 100 MB.'));
      settled = true;
      resolve({ fieldName: disposition[1], originalName: disposition[2], mimeType: (mimeMatch?.[1] || 'application/octet-stream').trim().toLowerCase(), buffer });
    });
  });
}
function postsForUser(userId) {
  return db.posts
    .filter(post => post.userId === userId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function fallbackGenerate({ topic, platform, tone, length }) {
  const max = length === 'Short' ? 360 : length === 'Long' ? 900 : 600;
  const openings = {
    Professional: `A practical perspective on ${topic}:`,
    Friendly: `Here’s a simple way to think about ${topic}:`,
    Bold: `The biggest opportunity around ${topic} is being missed by teams that wait too long.`,
    Educational: `Let’s break down ${topic} into a few useful ideas:`,
    Persuasive: `If ${topic} matters to your audience, here is where to start:`
  };
  const tags = {
    LinkedIn: '#AI #Automation #Business',
    Instagram: '#AI #Tech #Creator #Innovation',
    Facebook: '#AI #Business #Innovation',
    X: '#AI #Tech #BuildInPublic'
  };
  const body = `${openings[tone] || openings.Professional}\n\nPostPilot AI helps turn one idea into platform-ready social content, giving teams a faster path from concept to publishing.\n\nWhat would you change, test, or add?`;
  return `${body}\n\n${tags[platform] || tags.LinkedIn}`.slice(0, max);
}

async function ollamaRequest(endpoint, payload) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${OLLAMA_URL}${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    const text = await response.text();
    let data = {};
    try { data = JSON.parse(text); } catch { /* ignore */ }
    if (!response.ok) throw new Error(data?.error || `Ollama returned ${response.status}`);
    return data;
  } finally {
    clearTimeout(timeout);
  }
}

async function ollamaGenerate({ topic, platform, tone, length, model }) {
  const chosenModel = String(model || OLLAMA_MODEL).trim();
  const system = [
    'You are PostPilot AI, a senior social media copywriter.',
    `Target platform: ${platform}.`,
    `Tone: ${tone}.`,
    `Length: ${length}.`,
    'Write original, useful, platform-native content.',
    'Do not invent facts about people, companies, products, or statistics.',
    'Return only the final post text. No preamble, no quotation marks, no analysis.'
  ].join(' ');
  const prompt = `Create a social media post about: ${topic}`;
  const data = await ollamaRequest('/api/chat', {
    model: chosenModel,
    stream: false,
    messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }]
  });
  const text = data?.message?.content?.trim();
  if (!text) throw new Error('Ollama returned an empty response');
  return { text, provider: 'Ollama', model: chosenModel };
}

async function ollamaStatus() {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2500);
    try {
      const r = await fetch(`${OLLAMA_URL}/api/tags`, { signal: controller.signal });
      if (!r.ok) throw new Error(`Ollama returned ${r.status}`);
      const data = await r.json();
      const models = Array.isArray(data?.models) ? data.models.map(m => m.name).filter(Boolean) : [];
      return { available: true, url: OLLAMA_URL, configuredModel: OLLAMA_MODEL, models };
    } finally {
      clearTimeout(timeout);
    }
  } catch {
    return { available: false, url: OLLAMA_URL, configuredModel: OLLAMA_MODEL, models: [] };
  }
}

function makeConnectionRecord(platform) {
  return {
    platform,
    mode: 'oauth-required',
    configured: false,
    updatedAt: nowIso()
  };
}

async function route(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname;
  const method = req.method || 'GET';

  if (pathname === '/api/health' && method === 'GET') {
    const ollama = await ollamaStatus();
    return json(res, 200, { ok: true, service: 'PostPilot AI', provider: 'local-first', ollama, timestamp: nowIso() });
  }

  if (pathname === '/api/ollama/status' && method === 'GET') {
    return json(res, 200, await ollamaStatus());
  }

  if (pathname === '/api/auth/signup' && method === 'POST') {
    const limit = rateLimit(`signup:${clientIp(req)}`, 8, 60 * 60 * 1000);
    if (!limit.allowed) return json(res, 429, { error: 'Too many signup attempts. Try again later.' });
    const body = await parseBody(req);
    const email = normalizeEmail(body.email);
    const password = String(body.password || '');
    const name = String(body.name || 'PostPilot User').trim().slice(0, 80);
    if (!/^\S+@\S+\.\S+$/.test(email)) return json(res, 400, { error: 'Enter a valid email address' });
    if (password.length < 8) return json(res, 400, { error: 'Password must be at least 8 characters' });
    if (db.users.some(user => user.email === email)) return json(res, 409, { error: 'Email already registered' });
    const { salt, hash } = hashPassword(password);
    const user = { id: id('usr'), name: name || 'PostPilot User', email, salt, passwordHash: hash, createdAt: nowIso() };
    db.users.push(user);
    db.connections[user.id] = {};
    const sessionToken = token();
    db.sessions[sessionToken] = { userId: user.id, expiresAt: Date.now() + SESSION_DAYS * 86_400_000 };
    writeDb(db);
    return json(res, 201, { token: sessionToken, user: publicUser(user) });
  }

  if (pathname === '/api/auth/login' && method === 'POST') {
    const limit = rateLimit(`login:${clientIp(req)}`, 15, 15 * 60 * 1000);
    if (!limit.allowed) return json(res, 429, { error: 'Too many login attempts. Try again later.' });
    const body = await parseBody(req);
    const email = normalizeEmail(body.email);
    const password = String(body.password || '');
    const user = db.users.find(candidate => candidate.email === email);
    if (!user || !verifyPassword(password, user)) return json(res, 401, { error: 'Invalid email or password' });
    const sessionToken = token();
    db.sessions[sessionToken] = { userId: user.id, expiresAt: Date.now() + SESSION_DAYS * 86_400_000 };
    writeDb(db);
    return json(res, 200, { token: sessionToken, user: publicUser(user) });
  }

  if (pathname === '/api/auth/logout' && method === 'POST') {
    const auth = req.headers.authorization || '';
    const sessionToken = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    if (sessionToken) delete db.sessions[sessionToken];
    writeDb(db);
    return json(res, 200, { ok: true });
  }

  if (pathname === '/api/me' && method === 'GET') {
    const user = userFromReq(req);
    return user ? json(res, 200, { user: publicUser(user) }) : json(res, 401, { error: 'Authentication required' });
  }

  const user = requireUser(req, res);
  if (!user) return;

  if (pathname === '/api/posts' && method === 'GET') {
    const posts = postsForUser(user.id);
    return json(res, 200, { posts: posts.map(publicPost) });
  }

  if (pathname === '/api/posts' && method === 'POST') {
    const body = await parseBody(req);
    const content = String(body.content || '').trim();
    const platform = String(body.platform || 'LinkedIn');
    const status = String(body.status || 'Draft');
    const scheduledAt = body.scheduledAt ? new Date(body.scheduledAt) : null;
    if (!content) return json(res, 400, { error: 'Content is required' });
    if (!ALLOWED_PLATFORMS.includes(platform)) return json(res, 400, { error: 'Unsupported platform' });
    if (!['Draft', 'Scheduled'].includes(status)) return json(res, 400, { error: 'Unsupported post status' });
    if (status === 'Scheduled' && (!scheduledAt || Number.isNaN(scheduledAt.getTime()) || scheduledAt.getTime() <= Date.now())) {
      return json(res, 400, { error: 'Choose a future schedule time' });
    }
    let mediaId = body.mediaId ? String(body.mediaId) : null;
    if (mediaId && !userMedia(user.id, mediaId)) return json(res, 400, { error: 'Invalid video attachment' });
    const post = {
      id: id('post'),
      userId: user.id,
      platform,
      content,
      mediaId,
      status,
      scheduledAt: status === 'Scheduled' ? scheduledAt.toISOString() : null,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      publishedAt: null,
      publishMode: null
    };
    db.posts.push(post);
    writeDb(db);
    return json(res, 201, { post: publicPost(post) });
  }

  const postMatch = pathname.match(/^\/api\/posts\/([^/]+)$/);
  if (postMatch) {
    const post = db.posts.find(item => item.id === postMatch[1] && item.userId === user.id);
    if (!post) return json(res, 404, { error: 'Post not found' });

    if (method === 'GET') return json(res, 200, { post: publicPost(post) });

    if (method === 'PUT') {
      const body = await parseBody(req);
      if (body.content !== undefined) post.content = String(body.content).trim();
      if (body.mediaId !== undefined) {
        const requestedMediaId = body.mediaId ? String(body.mediaId) : null;
        if (requestedMediaId && !userMedia(user.id, requestedMediaId)) return json(res, 400, { error: 'Invalid video attachment' });
        post.mediaId = requestedMediaId;
      }
      if (body.platform !== undefined) {
        if (!ALLOWED_PLATFORMS.includes(String(body.platform))) return json(res, 400, { error: 'Unsupported platform' });
        post.platform = String(body.platform);
      }
      if (body.status !== undefined) {
        if (!['Draft', 'Scheduled', 'Published'].includes(String(body.status))) return json(res, 400, { error: 'Unsupported status' });
        post.status = String(body.status);
      }
      if (body.scheduledAt !== undefined) {
        if (!body.scheduledAt) {
          post.scheduledAt = null;
        } else {
          const d = new Date(body.scheduledAt);
          if (Number.isNaN(d.getTime())) return json(res, 400, { error: 'Invalid schedule time' });
          post.scheduledAt = d.toISOString();
        }
      }
      if (post.status === 'Scheduled' && (!post.scheduledAt || new Date(post.scheduledAt).getTime() <= Date.now())) {
        return json(res, 400, { error: 'Scheduled posts must use a future time' });
      }
      if (post.status === 'Published' && !post.publishedAt) {
        post.publishedAt = nowIso();
        post.publishMode = 'local-publish-simulation';
      }
      post.updatedAt = nowIso();
      writeDb(db);
      return json(res, 200, { post: publicPost(post) });
    }

    if (method === 'DELETE') {
      db.posts = db.posts.filter(item => item !== post);
      writeDb(db);
      return json(res, 200, { ok: true });
    }

    if (method === 'POST') {
      if (post.status !== 'Scheduled' && post.status !== 'Draft') return json(res, 400, { error: 'Only drafts or scheduled posts can be published' });
      post.status = 'Published';
      post.publishedAt = nowIso();
      post.updatedAt = nowIso();
      post.publishMode = 'local-publish-simulation';
      writeDb(db);
      return json(res, 200, { post: publicPost(post), mode: 'local-publish-simulation' });
    }
  }

  const duplicateMatch = pathname.match(/^\/api\/posts\/([^/]+)\/duplicate$/);
  if (duplicateMatch && method === 'POST') {
    const source = db.posts.find(item => item.id === duplicateMatch[1] && item.userId === user.id);
    if (!source) return json(res, 404, { error: 'Post not found' });
    const copy = {
      ...source,
      id: id('post'),
      status: 'Draft',
      scheduledAt: null,
      publishedAt: null,
      publishMode: null,
      mediaId: source.mediaId || null,
      createdAt: nowIso(),
      updatedAt: nowIso()
    };
    db.posts.push(copy);
    writeDb(db);
    return json(res, 201, { post: publicPost(copy) });
  }

  if (pathname === '/api/media' && method === 'POST') {
    const limit = rateLimit(`upload:${user.id}`, 30, 60 * 60 * 1000);
    if (!limit.allowed) return json(res, 429, { error: 'Upload rate limit reached. Try again later.' });
    try {
      const file = await parseMultipartFile(req);
      if (file.fieldName !== 'video') return json(res, 400, { error: 'Use the video upload field.' });
      if (!ALLOWED_VIDEO_MIME.has(file.mimeType)) return json(res, 415, { error: 'Unsupported video type. Use MP4, MOV, or WebM.' });
      if (!looksLikeVideo(file.buffer, file.mimeType)) return json(res, 415, { error: 'The uploaded file does not look like a valid MP4, MOV, or WebM video.' });
      const extMap = { 'video/mp4': '.mp4', 'video/quicktime': '.mov', 'video/webm': '.webm' };
      const mediaId = id('media');
      const safeName = path.basename(file.originalName || 'video').replace(/[^a-zA-Z0-9._-]+/g, '_').slice(-120) || 'video';
      const fileName = `${mediaId}${extMap[file.mimeType] || ''}`;
      const diskPath = path.join(MEDIA_DIR, fileName);
      fs.writeFileSync(diskPath, file.buffer, { flag: 'wx' });
      const media = { id: mediaId, userId: user.id, originalName: safeName, mimeType: file.mimeType, size: file.buffer.length, diskPath, createdAt: nowIso() };
      db.media.push(media);
      writeDb(db);
      return json(res, 201, { media: { id: media.id, originalName: media.originalName, mimeType: media.mimeType, size: media.size } });
    } catch (error) {
      return json(res, 400, { error: error.message || 'Video upload failed' });
    }
  }

  const mediaMatch = pathname.match(/^\/api\/media\/([^/]+)$/);
  if (mediaMatch && method === 'GET') {
    const media = userMedia(user.id, mediaMatch[1]);
    if (!media || !fs.existsSync(media.diskPath)) return json(res, 404, { error: 'Media not found' });
    res.writeHead(200, { 'Content-Type': media.mimeType, 'Content-Length': media.size, 'Cache-Control': 'private, max-age=300', 'X-Content-Type-Options': 'nosniff', 'Accept-Ranges': 'bytes' });
    return fs.createReadStream(media.diskPath).pipe(res);
  }

  if (pathname === '/api/media' && method === 'GET') {
    const media = db.media.filter(item => item.userId === user.id).map(item => ({ id: item.id, originalName: item.originalName, mimeType: item.mimeType, size: item.size, createdAt: item.createdAt }));
    return json(res, 200, { media });
  }

  if (pathname === '/api/generate' && method === 'POST') {
    const limit = rateLimit(`generate:${user.id}`, 80, 60 * 60 * 1000);
    if (!limit.allowed) return json(res, 429, { error: 'Generation rate limit reached. Try again later.' });
    const body = await parseBody(req);
    const topic = String(body.topic || '').trim();
    const platform = String(body.platform || 'LinkedIn');
    const tone = String(body.tone || 'Professional');
    const length = String(body.length || 'Medium');
    const model = String(body.model || '').trim();
    if (!topic) return json(res, 400, { error: 'Topic is required' });
    if (!ALLOWED_PLATFORMS.includes(platform)) return json(res, 400, { error: 'Unsupported platform' });
    if (!ALLOWED_TONES.includes(tone)) return json(res, 400, { error: 'Unsupported tone' });
    if (!ALLOWED_LENGTHS.includes(length)) return json(res, 400, { error: 'Unsupported length' });

    try {
      return json(res, 200, await ollamaGenerate({ topic, platform, tone, length, model: model || OLLAMA_MODEL }));
    } catch (error) {
      return json(res, 200, {
        text: fallbackGenerate({ topic, platform, tone, length }),
        provider: 'Local fallback',
        model: null,
        warning: 'Ollama is not reachable with the configured model. Start Ollama and pull the configured model for real local generation.'
      });
    }
  }

  if (pathname === '/api/analytics' && method === 'GET') {
    const posts = db.posts.filter(item => item.userId === user.id);
    const byPlatform = Object.fromEntries(ALLOWED_PLATFORMS.map(platform => [platform, posts.filter(post => post.platform === platform).length]));
    const byStatus = {
      Draft: posts.filter(post => post.status === 'Draft').length,
      Scheduled: posts.filter(post => post.status === 'Scheduled').length,
      Published: posts.filter(post => post.status === 'Published').length
    };
    const now = new Date();
    const last30 = posts.filter(post => new Date(post.createdAt).getTime() >= now.getTime() - 30 * 86_400_000).length;
    return json(res, 200, {
      totals: { created: posts.length, ...byStatus, last30 },
      byPlatform,
      generatedAt: nowIso()
    });
  }

  if (pathname === '/api/connections' && method === 'GET') {
    const connections = db.connections[user.id] || {};
    return json(res, 200, { connections });
  }

  const connMatch = pathname.match(/^\/api\/connections\/([^/]+)$/);
  if (connMatch) {
    const platform = connMatch[1];
    if (!ALLOWED_PLATFORMS.includes(platform)) return json(res, 400, { error: 'Unsupported platform' });
    db.connections[user.id] = db.connections[user.id] || {};
    if (method === 'POST') {
      db.connections[user.id][platform] = makeConnectionRecord(platform);
      writeDb(db);
      return json(res, 200, { connection: db.connections[user.id][platform] });
    }
    if (method === 'DELETE') {
      delete db.connections[user.id][platform];
      writeDb(db);
      return json(res, 200, { ok: true });
    }
  }

  if (pathname === '/api/settings' && method === 'PUT') {
    const body = await parseBody(req);
    const name = String(body.name || '').trim().slice(0, 80);
    if (name) user.name = name;
    writeDb(db);
    return json(res, 200, { user: publicUser(user) });
  }

  return json(res, 404, { error: 'Not found' });
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS'
      });
      return res.end();
    }

    if (req.url.startsWith('/api/')) return await route(req, res);

    const pathname = new URL(req.url, `http://${req.headers.host || 'localhost'}`).pathname;
    const safe = pathname === '/' ? '/index.html' : pathname;
    const file = path.normalize(path.join(PUBLIC_DIR, safe));
    if (!file.startsWith(PUBLIC_DIR)) return json(res, 403, { error: 'Forbidden' });
    return sendFile(res, file);
  } catch (error) {
    console.error(error);
    return json(res, 500, { error: error.message || 'Server error' });
  }
});

setInterval(() => {
  let changed = false;
  const now = Date.now();
  for (const post of db.posts) {
    if (post.status === 'Scheduled' && post.scheduledAt) {
      const scheduled = new Date(post.scheduledAt).getTime();
      if (Number.isFinite(scheduled) && scheduled <= now) {
        post.status = 'Published';
        post.publishedAt = nowIso();
        post.updatedAt = nowIso();
        post.publishMode = 'local-scheduler-simulation';
        changed = true;
      }
    }
  }
  for (const [sessionToken, session] of Object.entries(db.sessions)) {
    if (!session?.expiresAt || session.expiresAt < now) {
      delete db.sessions[sessionToken];
      changed = true;
    }
  }
  if (changed) writeDb(db);
}, 15_000).unref();

server.listen(PORT, () => console.log(`PostPilot running at http://localhost:${PORT}`));
