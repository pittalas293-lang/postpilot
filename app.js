const state = {
  token: localStorage.getItem('postpilot_token') || '',
  user: null,
  page: 'dashboard',
  posts: [],
  connections: {},
  analytics: null,
  platform: 'LinkedIn',
  tone: 'Professional',
  length: 'Medium',
  generated: '',
  provider: '',
  ollama: { available: false, configuredModel: '', models: [] },
  libraryQuery: '',
  libraryFilter: 'All',
  video: null
};

const mediaObjectUrls = new Map();

const app = document.getElementById('app');
const PLATFORMS = ['LinkedIn', 'Instagram', 'Facebook', 'X'];
const TONES = ['Professional', 'Friendly', 'Bold', 'Educational', 'Persuasive'];
const LENGTHS = ['Short', 'Medium', 'Long'];
const esc = (value = '') => String(value).replace(/[&<>'"]/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[c]));

function setToken(token) {
  state.token = token || '';
  if (token) localStorage.setItem('postpilot_token', token);
  else localStorage.removeItem('postpilot_token');
}

async function api(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (state.token) headers.Authorization = `Bearer ${state.token}`;
  const response = await fetch(path, { ...options, headers });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
  return data;
}


async function uploadVideo(file) {
  if (!file) throw new Error('Choose a video first');
  const allowed = new Set(['video/mp4', 'video/quicktime', 'video/webm']);
  if (!allowed.has(file.type)) throw new Error('Use MP4, MOV, or WebM video.');
  const maxBytes = 100 * 1024 * 1024;
  if (file.size > maxBytes) throw new Error('Video is too large. Maximum size is 100 MB.');
  const form = new FormData();
  form.append('video', file, file.name);
  const headers = {};
  if (state.token) headers.Authorization = `Bearer ${state.token}`;
  const response = await fetch('/api/media', { method: 'POST', headers, body: form });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Upload failed (${response.status})`);
  state.video = { ...data.media, previewUrl: URL.createObjectURL(file) };
  return state.video;
}

async function hydrateVideos() {
  for (const video of document.querySelectorAll('video[data-media-id]')) {
    const mediaId = video.dataset.mediaId;
    try {
      if (!mediaObjectUrls.has(mediaId)) {
        const response = await fetch(`/api/media/${encodeURIComponent(mediaId)}`, {
          headers: state.token ? { Authorization: `Bearer ${state.token}` } : {}
        });
        if (!response.ok) continue;
        const blob = await response.blob();
        mediaObjectUrls.set(mediaId, URL.createObjectURL(blob));
      }
      video.src = mediaObjectUrls.get(mediaId);
    } catch { /* ignore unavailable media */ }
  }
}

function videoPicker() {
  const current = state.video;
  return `<div class="media-box">
    <div class="media-head"><div><strong>Attach a video</strong><span>MP4, MOV or WebM · max 100 MB</span></div>${current ? `<button class="btn" id="removeVideo" type="button">Remove</button>` : ''}</div>
    ${current ? `<div class="video-preview-wrap"><video class="video-preview" controls preload="metadata" src="${esc(current.previewUrl || '')}"></video><div class="media-file"><strong>${esc(current.originalName || current.name || 'Video')}</strong><span>${Math.round((current.size || 0) / 1024 / 1024 * 10) / 10} MB</span></div></div>` : `<label class="upload-drop"><input id="videoFile" type="file" accept="video/mp4,video/quicktime,video/webm,.mp4,.mov,.webm" hidden><span class="upload-icon">＋</span><strong>Select a video</strong><span>Attach it to this post before saving or scheduling.</span></label><div id="uploadState" class="muted small"></div>`}
  </div>`;
}
function clearComposerMedia() {
  if (state.video?.previewUrl) URL.revokeObjectURL(state.video.previewUrl);
  state.video = null;
}

function toast(message) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = message;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2600);
}

function authView(mode = 'login', message = '') {
  const signup = mode === 'signup';
  app.innerHTML = `<div class="auth-page">
    <div class="auth-visual">
      <div class="auth-brand"><div class="brand-mark">P</div><div><div class="brand-name">PostPilot</div><div class="brand-sub">AI social publishing</div></div></div>
      <div class="auth-copy"><span class="badge">LOCAL-FIRST</span><h1>Turn one idea into a publishing workflow.</h1><p>Create platform-ready content, manage drafts, schedule posts and track your publishing workspace from one place.</p><div class="auth-points"><div><strong>AI generation</strong><span>Use Ollama locally with no per-token cloud bill.</span></div><div><strong>Content control</strong><span>Edit, save, duplicate and schedule every post.</span></div><div><strong>Production path</strong><span>OAuth-ready connections for real social publishing.</span></div></div></div>
    </div>
    <div class="auth-panel"><div class="auth-card">
      <div class="mobile-auth-brand"><div class="brand-mark">P</div><div><div class="brand-name">PostPilot</div><div class="brand-sub">AI social publishing</div></div></div>
      <h2>${signup ? 'Create your workspace' : 'Welcome back'}</h2><p class="muted">${signup ? 'Start your local-first publishing workspace.' : 'Sign in to continue to PostPilot.'}</p>
      ${message ? `<div class="notice danger-note">${esc(message)}</div>` : ''}
      <form id="authForm" class="auth-form">
        ${signup ? `<div class="field"><label>Name</label><input class="input" name="name" required maxlength="80" placeholder="Your name"></div>` : ''}
        <div class="field"><label>Email</label><input class="input" type="email" name="email" required placeholder="you@example.com"></div>
        <div class="field"><label>Password</label><input class="input" type="password" name="password" required minlength="8" placeholder="At least 8 characters"></div>
        <button class="btn primary full" type="submit">${signup ? 'Create account' : 'Sign in'}</button>
      </form>
      <div class="switch">${signup ? 'Already have an account?' : 'New to PostPilot?'} <button class="link" id="authSwitch">${signup ? 'Sign in' : 'Create account'}</button></div>
    </div></div>
  </div>`;
  document.getElementById('authSwitch').onclick = () => authView(signup ? 'login' : 'signup');
  document.getElementById('authForm').onsubmit = async event => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const payload = Object.fromEntries(form.entries());
    try {
      const data = await api(signup ? '/api/auth/signup' : '/api/auth/login', { method: 'POST', body: JSON.stringify(payload) });
      setToken(data.token);
      state.user = data.user;
      await loadData();
      render();
    } catch (error) {
      authView(mode, error.message);
    }
  };
}

async function refreshOllama() {
  try { state.ollama = await api('/api/ollama/status'); } catch { state.ollama = { available: false, configuredModel: '', models: [] }; }
}

async function loadData() {
  if (!state.token) { state.user = null; return; }
  try {
    const [me, posts, analytics, connections] = await Promise.all([
      api('/api/me'), api('/api/posts'), api('/api/analytics'), api('/api/connections')
    ]);
    state.user = me.user;
    state.posts = posts.posts;
    state.analytics = analytics;
    state.connections = connections.connections || {};
    await refreshOllama();
  } catch {
    setToken('');
    state.user = null;
  }
}

function navItems() {
  return [
    ['dashboard', 'Overview'], ['create', 'Create Post'], ['library', 'Content Library'],
    ['calendar', 'Calendar'], ['analytics', 'Analytics'], ['connections', 'Connections'], ['settings', 'Settings']
  ];
}

function layout(content) {
  app.innerHTML = `<div class="app-shell">
    <aside class="sidebar">
      <div class="sidebar-brand"><div class="brand-mark">P</div><div><div class="brand-name">PostPilot</div><div class="brand-sub">AI social publishing</div></div></div>
      <button class="create-big" id="sidebarCreate">+ Create post</button>
      <nav class="nav">${navItems().map(([id, label]) => `<button class="nav-item ${state.page === id ? 'active' : ''}" data-page="${id}"><span>${iconFor(id)}</span>${label}</button>`).join('')}</nav>
      <div class="sidebar-bottom"><div class="ai-status ${state.ollama.available ? 'ok' : 'off'}"><span class="status-dot"></span><div><strong>${state.ollama.available ? 'Local AI ready' : 'Ollama offline'}</strong><span>${esc(state.ollama.available ? (state.ollama.configuredModel || 'Connected') : 'Use fallback generation')}</span></div></div><div class="account"><div class="avatar">${esc((state.user?.name || 'U').slice(0,1).toUpperCase())}</div><div><strong>${esc(state.user?.name || 'User')}</strong><span>${esc(state.user?.email || '')}</span></div><button class="icon-btn" id="logout" title="Log out">↪</button></div></div>
    </aside>
    <main class="main-content"><div class="mobile-top"><div class="sidebar-brand"><div class="brand-mark">P</div><div><div class="brand-name">PostPilot</div><div class="brand-sub">AI social publishing</div></div></div><button class="btn primary" id="mobileCreate">+ Post</button></div>${content}</main>
  </div>`;
  document.querySelectorAll('[data-page]').forEach(button => button.onclick = () => { state.page = button.dataset.page; render(); });
  document.getElementById('sidebarCreate')?.addEventListener('click', () => { state.page = 'create'; render(); });
  document.getElementById('mobileCreate')?.addEventListener('click', () => { state.page = 'create'; render(); });
  document.getElementById('logout')?.addEventListener('click', async () => {
    try { await api('/api/auth/logout', { method: 'POST' }); } catch {}
    setToken(''); state.user = null; state.posts = []; clearComposerMedia(); authView('login');
  });
}

function iconFor(id) {
  return { dashboard: '⌂', create: '✦', library: '▤', calendar: '□', analytics: '◩', connections: '◎', settings: '⚙' }[id] || '•';
}

function pageHeader(title, subtitle, action = '') {
  return `<div class="page-head"><div><div class="eyebrow">WORKSPACE</div><h1>${title}</h1><p>${subtitle}</p></div><div class="head-actions">${action}</div></div>`;
}

function platformPills() {
  return `<div class="platform-pills">${PLATFORMS.map(platform => `<button class="platform-pill ${state.platform === platform ? 'selected' : ''}" data-platform="${platform}"><span class="platform-dot ${platform.toLowerCase()}-dot"></span>${platform}</button>`).join('')}</div>`;
}

function aiStatusCard() {
  const ready = state.ollama.available;
  return `<div class="ai-banner ${ready ? 'ready' : ''}"><div class="ai-icon">✦</div><div><strong>${ready ? 'Ollama is connected' : 'Connect Ollama for local AI'}</strong><p>${ready ? `Model: ${esc(state.ollama.configuredModel || 'configured')}` : 'The app will use a safe local fallback until Ollama is running.'}</p></div><button class="btn ${ready ? '' : 'primary'}" id="refreshAi">${ready ? 'Refresh' : 'Check again'}</button></div>`;
}

function dashboard() {
  const totals = state.analytics?.totals || { created: 0, Draft: 0, Scheduled: 0, Published: 0, last30: 0 };
  const recent = state.posts.slice(0, 6);
  return pageHeader('Dashboard', `Welcome back, ${esc(state.user?.name || 'there')}. Here is your publishing workspace.`, '<button class="btn primary" id="newPost">+ Create post</button>') + aiStatusCard() +
    `<section class="stats-grid">
      ${[['Posts', totals.created || 0, 'All content'], ['Drafts', totals.Draft || 0, 'Needs review'], ['Scheduled', totals.Scheduled || 0, 'Queued'], ['Published', totals.Published || 0, 'Completed']].map(([label, value, note]) => `<div class="stat-card"><div class="stat-label">${label}</div><div class="stat-value">${value}</div><div class="stat-note">${note}</div></div>`).join('')}
    </section>
    <div class="content-grid"><section class="panel compose-panel"><div class="panel-title"><div><h2>Quick create</h2><p>Turn a topic into platform-ready content.</p></div><span class="ai-chip">AI</span></div>${platformPills()}<div class="field"><label>Topic or instruction</label><textarea id="dashTopic" class="textarea" placeholder="Example: Explain how AI automation can save small businesses time."></textarea></div><div class="compose-controls"><select id="dashTone" class="select">${TONES.map(t => `<option ${t===state.tone?'selected':''}>${t}</option>`).join('')}</select><select id="dashLength" class="select">${LENGTHS.map(l => `<option ${l===state.length?'selected':''}>${l}</option>`).join('')} </select><button class="btn accent" id="dashGenerate">Generate</button></div><div class="field"><label>Generated content</label><textarea id="dashOutput" class="textarea output" placeholder="Your generated content appears here."></textarea></div><div class="compose-footer"><span id="dashProvider" class="muted small"></span><div class="row"><button class="btn" id="dashCopy">Copy</button><button class="btn primary" id="dashSave">Save draft</button></div></div></section>
    <section class="panel"><div class="panel-title"><div><h2>Recent posts</h2><p>Your latest content activity.</p></div><button class="btn" id="viewLibrary">View all</button></div>${recent.length ? `<div class="post-list">${recent.map(p => postCard(p, true)).join('')}</div>` : `<div class="empty">No posts yet.<br><button class="link" id="startCreate">Create your first post</button></div>`}</section></div>`;
}

function postCard(post, compact = false) {
  const date = post.scheduledAt ? new Date(post.scheduledAt).toLocaleString() : new Date(post.createdAt).toLocaleDateString();
  const media = post.media ? `<div class="post-media"><video data-media-id="${esc(post.media.id)}" controls preload="metadata"></video><div class="media-file"><strong>${esc(post.media.originalName)}</strong><span>${Math.round((post.media.size || 0) / 1024 / 1024 * 10) / 10} MB</span></div></div>` : '';
  return `<article class="post-card"><div class="post-meta-row"><div class="post-tags"><span class="platform-label">${esc(post.platform)}</span><span class="status ${esc(post.status)}">${esc(post.status)}</span>${post.media ? '<span class="status Scheduled">Video</span>' : ''}</div><time>${esc(date)}</time></div><div class="post-content">${esc(post.content)}</div>${media}${!compact ? `<div class="post-actions"><button class="btn" data-edit="${post.id}">Edit</button>${post.status !== 'Published' ? `<button class="btn" data-duplicate="${post.id}">Duplicate</button>` : ''}${post.status === 'Draft' ? `<button class="btn" data-schedule="${post.id}">Schedule</button>` : ''}${post.status === 'Scheduled' ? `<button class="btn primary" data-publish="${post.id}">Publish now</button>` : ''}<button class="btn danger" data-delete="${post.id}">Delete</button></div>` : ''}</article>`;
}

function createPage() {
  return pageHeader('Create Post', 'Draft, refine and schedule content without leaving PostPilot.', '') + aiStatusCard() +
    `<div class="create-grid"><section class="panel"><div class="step"><span>01</span><div><h2>Choose your channel</h2><p>PostPilot will tailor the writing for the selected platform.</p></div></div>${platformPills()}<div class="two-field"><div class="field"><label>Tone</label><select id="tone" class="select">${TONES.map(t => `<option ${t===state.tone?'selected':''}>${t}</option>`).join('')}</select></div><div class="field"><label>Length</label><select id="length" class="select">${LENGTHS.map(l => `<option ${l===state.length?'selected':''}>${l}</option>`).join('')}</select></div></div><div class="step step-gap"><span>02</span><div><h2>Describe the post</h2><p>Give PostPilot the topic, audience, hook, or call to action.</p></div></div><div class="field"><textarea id="topic" class="textarea large" placeholder="What should PostPilot write about?"></textarea></div>${videoPicker()}<div class="row end"><span id="provider" class="muted small"></span><button class="btn accent" id="generate">Generate with AI</button></div></section>
    <section class="panel sticky-panel"><div class="step"><span>03</span><div><h2>Edit & publish</h2><p>Review the copy before saving or scheduling it.</p></div></div><div class="field"><label>Generated content</label><textarea id="generated" class="textarea editor">${esc(state.generated)}</textarea></div><div class="editor-meta"><span id="counter">0 characters</span><span>${esc(state.platform)}</span></div>${state.video ? `<div class="notice">Video attached: ${esc(state.video.originalName || 'video')}</div>` : ''}<div class="editor-actions"><button class="btn" id="copyGenerated">Copy</button><button class="btn" id="saveDraft">Save draft</button><button class="btn primary" id="scheduleBtn">Schedule</button></div><div id="scheduleBox" class="schedule-box hidden"><div class="field"><label>Schedule date & time</label><input id="scheduleAt" class="input" type="datetime-local"></div><button class="btn accent" id="confirmSchedule">Save scheduled post</button></div></section></div>`;
}

function library() {
  const filtered = state.posts.filter(post => {
    const query = state.libraryQuery.toLowerCase();
    const matchesQuery = !query || post.content.toLowerCase().includes(query) || post.platform.toLowerCase().includes(query);
    const matchesFilter = state.libraryFilter === 'All' || post.status === state.libraryFilter;
    return matchesQuery && matchesFilter;
  });
  return pageHeader('Content Library', 'Everything you have drafted, scheduled and published.', '<button class="btn primary" id="newLibraryPost">+ Create post</button>') +
    `<section class="panel"><div class="library-toolbar"><div class="search-wrap"><span>⌕</span><input id="librarySearch" class="input" placeholder="Search posts..." value="${esc(state.libraryQuery)}"></div><select id="libraryFilter" class="select compact-select">${['All','Draft','Scheduled','Published'].map(v => `<option ${v===state.libraryFilter?'selected':''}>${v}</option>`).join('')}</select></div>${filtered.length ? `<div class="post-list">${filtered.map(postCard).join('')}</div>` : `<div class="empty">No content matches your search.</div>`}</section>`;
}

function calendar() {
  const selected = new Date();
  const year = selected.getFullYear();
  const month = selected.getMonth();
  const first = new Date(year, month, 1);
  const days = new Date(year, month + 1, 0).getDate();
  const start = first.getDay();
  const cells = [];
  for (let i = 0; i < start; i++) cells.push('<div class="calendar-cell muted-cell"></div>');
  for (let day = 1; day <= days; day++) {
    const events = state.posts.filter(post => {
      if (!post.scheduledAt) return false;
      const d = new Date(post.scheduledAt);
      return d.getFullYear() === year && d.getMonth() === month && d.getDate() === day;
    });
    cells.push(`<div class="calendar-cell"><div class="day-number">${day}</div>${events.map(event => `<div class="calendar-event"><strong>${esc(event.platform)}</strong><span>${esc(event.status)}</span></div>`).join('')}</div>`);
  }
  while (cells.length % 7) cells.push('<div class="calendar-cell muted-cell"></div>');
  return pageHeader('Calendar', 'See scheduled content at a glance.', '') + `<section class="panel"><div class="calendar-head"><div><h2>${esc(selected.toLocaleString(undefined,{month:'long',year:'numeric'}))}</h2><p>Scheduled publishing queue</p></div></div><div class="calendar-grid">${['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(day => `<div class="calendar-weekday">${day}</div>`).join('')}${cells.join('')}</div></section>`;
}

function analytics() {
  const a = state.analytics || { totals: {}, byPlatform: {} };
  const max = Math.max(1, ...Object.values(a.byPlatform || {}));
  return pageHeader('Analytics', 'A simple view of content volume and publishing status.', '') + `<div class="stats-grid">${[['Total posts',a.totals.created||0],['Published',a.totals.Published||0],['Scheduled',a.totals.Scheduled||0],['Last 30 days',a.totals.last30||0]].map(([label,value]) => `<div class="stat-card"><div class="stat-label">${label}</div><div class="stat-value">${value}</div></div>`).join('')}</div><section class="panel analytics-panel"><div class="panel-title"><div><h2>Content by platform</h2><p>Distribution across your connected channels.</p></div></div><div class="bar-list">${PLATFORMS.map(platform => { const value = a.byPlatform?.[platform] || 0; return `<div class="bar-row"><div class="bar-head"><span>${platform}</span><strong>${value}</strong></div><div class="bar-track"><div class="bar-fill" style="width:${Math.round(value/max*100)}%"></div></div></div>`; }).join('')}</div></section>`;
}

function connections() {
  return pageHeader('Connections', 'Prepare social channels for real OAuth/API publishing.', '') + `<div class="connection-grid">${PLATFORMS.map(platform => { const c = state.connections[platform]; return `<section class="panel connection-card"><div class="platform-logo">${platform[0]}</div><div><h2>${platform}</h2><p>${c ? 'Configuration record exists.' : 'Not configured.'}</p></div>${c ? `<span class="status Scheduled">OAuth required</span><button class="btn danger" data-disconnect="${platform}">Remove record</button>` : `<button class="btn" data-connect="${platform}">Prepare connection</button>`}</section>`; }).join('')}</div><div class="notice">PostPilot deliberately does not fake social publishing. Real LinkedIn, Meta and X publishing requires developer apps, OAuth scopes, access tokens and platform-approved API access.</div>`;
}

function settings() {
  const modelOptions = (state.ollama.models || []).length ? state.ollama.models.map(model => `<option ${model===state.ollama.configuredModel?'selected':''}>${esc(model)}</option>`).join('') : `<option>${esc(state.ollama.configuredModel || 'No local model detected')}</option>`;
  return pageHeader('Settings', 'Manage your profile and local AI setup.', '') + `<div class="settings-grid"><section class="panel"><div class="panel-title"><div><h2>Profile</h2><p>Your PostPilot account.</p></div></div><form id="settingsForm" class="form-stack"><div class="field"><label>Name</label><input class="input" name="name" value="${esc(state.user?.name || '')}" maxlength="80"></div><div class="field"><label>Email</label><input class="input" value="${esc(state.user?.email || '')}" disabled></div><button class="btn primary" type="submit">Save changes</button></form></section><section class="panel"><div class="panel-title"><div><h2>Local AI</h2><p>PostPilot uses Ollama for local generation.</p></div><span class="status ${state.ollama.available ? 'Published' : 'Draft'}">${state.ollama.available ? 'Connected' : 'Offline'}</span></div><div class="form-stack"><div class="field"><label>Ollama URL</label><input class="input" value="${esc(state.ollama.url || 'http://127.0.0.1:11434')}" disabled></div><div class="field"><label>Detected models</label><select class="select" disabled>${modelOptions}</select></div><div class="notice">Start Ollama locally and make sure at least one chat model is installed. The app will detect available models automatically.</div><button class="btn" id="refreshModels">Refresh Ollama status</button></div></section></div>`;
}

function editModal(post) {
  const wrap = document.createElement('div');
  wrap.className = 'modal-backdrop';
  wrap.innerHTML = `<div class="modal"><div class="modal-head"><div><h2>Edit post</h2><p>Update your content before saving.</p></div><button class="icon-btn" id="closeModal">×</button></div><div class="form-stack"><div class="field"><label>Platform</label><select id="editPlatform" class="select">${PLATFORMS.map(p => `<option ${p===post.platform?'selected':''}>${p}</option>`).join('')}</select></div><div class="field"><label>Content</label><textarea id="editContent" class="textarea large">${esc(post.content)}</textarea></div><div class="row end"><button class="btn" id="cancelModal">Cancel</button><button class="btn primary" id="saveEdit">Save changes</button></div></div></div>`;
  document.body.appendChild(wrap);
  const close = () => wrap.remove();
  document.getElementById('closeModal').onclick = close;
  document.getElementById('cancelModal').onclick = close;
  document.getElementById('saveEdit').onclick = async () => {
    try {
      await api(`/api/posts/${post.id}`, { method: 'PUT', body: JSON.stringify({ platform: document.getElementById('editPlatform').value, content: document.getElementById('editContent').value }) });
      close(); await loadData(); render(); toast('Post updated');
    } catch (error) { toast(error.message); }
  };
}

function bindCommon() {
  document.getElementById('newPost')?.addEventListener('click', () => { state.page = 'create'; render(); });
  document.getElementById('viewLibrary')?.addEventListener('click', () => { state.page = 'library'; render(); });
  document.getElementById('startCreate')?.addEventListener('click', () => { state.page = 'create'; render(); });
  document.getElementById('newLibraryPost')?.addEventListener('click', () => { state.page = 'create'; render(); });
  document.getElementById('refreshAi')?.addEventListener('click', async () => { await refreshOllama(); render(); toast(state.ollama.available ? 'Ollama is connected' : 'Ollama is still offline'); });
  document.querySelectorAll('[data-platform]').forEach(button => button.onclick = () => { state.platform = button.dataset.platform; render(); });
  document.querySelectorAll('[data-edit]').forEach(button => button.onclick = () => editModal(state.posts.find(post => post.id === button.dataset.edit)));
  document.querySelectorAll('[data-delete]').forEach(button => button.onclick = async () => {
    if (!confirm('Delete this post?')) return;
    try { await api(`/api/posts/${button.dataset.delete}`, { method: 'DELETE' }); await loadData(); render(); toast('Post deleted'); } catch (error) { toast(error.message); }
  });
  document.querySelectorAll('[data-duplicate]').forEach(button => button.onclick = async () => {
    try { await api(`/api/posts/${button.dataset.duplicate}/duplicate`, { method: 'POST' }); await loadData(); render(); toast('Draft duplicated'); } catch (error) { toast(error.message); }
  });
  document.querySelectorAll('[data-publish]').forEach(button => button.onclick = async () => {
    try { const d = await api(`/api/posts/${button.dataset.publish}`, { method: 'POST' }); await loadData(); render(); toast(d.mode === 'local-publish-simulation' ? 'Marked published (local simulation)' : 'Published'); } catch (error) { toast(error.message); }
  });
  document.querySelectorAll('[data-schedule]').forEach(button => button.onclick = async () => {
    const value = prompt('Enter a future date/time, for example 2026-09-25T18:00');
    if (!value) return;
    try { await api(`/api/posts/${button.dataset.schedule}`, { method: 'PUT', body: JSON.stringify({ status: 'Scheduled', scheduledAt: new Date(value).toISOString() }) }); await loadData(); render(); toast('Post scheduled'); } catch (error) { toast(error.message); }
  });
  document.querySelectorAll('[data-connect]').forEach(button => button.onclick = async () => {
    try { await api(`/api/connections/${button.dataset.connect}`, { method: 'POST' }); await loadData(); render(); toast(`${button.dataset.connect} connection record prepared`); } catch (error) { toast(error.message); }
  });
  document.querySelectorAll('[data-disconnect]').forEach(button => button.onclick = async () => {
    try { await api(`/api/connections/${button.dataset.disconnect}`, { method: 'DELETE' }); await loadData(); render(); toast(`${button.dataset.disconnect} removed`); } catch (error) { toast(error.message); }
  });
}

function bindGenerator({ topicId, outputId, providerId, buttonId }) {
  const topic = document.getElementById(topicId);
  const output = document.getElementById(outputId);
  const provider = document.getElementById(providerId);
  const button = document.getElementById(buttonId);
  if (!topic || !output || !button) return;
  const toneEl = document.getElementById('tone') || document.getElementById('dashTone');
  const lengthEl = document.getElementById('length') || document.getElementById('dashLength');
  button.onclick = async () => {
    const value = topic.value.trim();
    if (!value) return toast('Enter a topic first');
    state.tone = toneEl?.value || state.tone;
    state.length = lengthEl?.value || state.length;
    button.disabled = true; button.innerHTML = '<span class="spinner"></span> Generating';
    try {
      const d = await api('/api/generate', { method: 'POST', body: JSON.stringify({ topic: value, platform: state.platform, tone: state.tone, length: state.length }) });
      output.value = d.text;
      state.generated = d.text;
      state.provider = d.provider;
      provider.textContent = `${d.provider}${d.model ? ` · ${d.model}` : ''}`;
      toast(d.warning ? 'Fallback used — connect Ollama for local AI' : 'AI content generated');
      updateCounter(output);
    } catch (error) { toast(error.message); }
    finally { button.disabled = false; button.textContent = 'Generate'; }
  };
}

function updateCounter(textarea) {
  const counter = document.getElementById('counter');
  if (counter && textarea) counter.textContent = `${textarea.value.length} characters · ${textarea.value.trim() ? textarea.value.trim().split(/\s+/).length : 0} words`;
}

function bindPage() {
  bindCommon();
  bindGenerator({ topicId:'dashTopic', outputId:'dashOutput', providerId:'dashProvider', buttonId:'dashGenerate' });
  bindGenerator({ topicId:'topic', outputId:'generated', providerId:'provider', buttonId:'generate' });
  const dashTone = document.getElementById('dashTone'); if (dashTone) dashTone.onchange = () => { state.tone = dashTone.value; };
  const dashLength = document.getElementById('dashLength'); if (dashLength) dashLength.onchange = () => { state.length = dashLength.value; };
  const tone = document.getElementById('tone'); if (tone) tone.onchange = () => { state.tone = tone.value; };
  const length = document.getElementById('length'); if (length) length.onchange = () => { state.length = length.value; };
  const generated = document.getElementById('generated'); if (generated) generated.addEventListener('input', () => { state.generated = generated.value; updateCounter(generated); });
  const dashOutput = document.getElementById('dashOutput'); if (dashOutput) dashOutput.addEventListener('input', () => { state.generated = dashOutput.value; });

  document.getElementById('dashSave')?.addEventListener('click', async () => {
    const output = document.getElementById('dashOutput');
    const content = output?.value.trim();
    if (!content) return toast('Generate or write content first');
    try { await api('/api/posts', { method:'POST', body:JSON.stringify({ platform:state.platform, content, status:'Draft', mediaId: state.video?.id || null }) }); clearComposerMedia(); await loadData(); render(); toast('Draft saved'); } catch (error) { toast(error.message); }
  });
  document.getElementById('dashCopy')?.addEventListener('click', async () => { const text = document.getElementById('dashOutput')?.value || ''; if (!text) return; await navigator.clipboard.writeText(text); toast('Copied to clipboard'); });
  const videoFile = document.getElementById('videoFile');
  if (videoFile) videoFile.addEventListener('change', async () => {
    const file = videoFile.files?.[0];
    if (!file) return;
    const stateEl = document.getElementById('uploadState');
    if (stateEl) stateEl.textContent = `Uploading ${file.name}…`;
    try { await uploadVideo(file); render(); toast('Video uploaded and attached'); }
    catch (error) { if (stateEl) stateEl.textContent = error.message; toast(error.message); }
  });
  document.getElementById('removeVideo')?.addEventListener('click', () => {
    if (state.video?.previewUrl) URL.revokeObjectURL(state.video.previewUrl);
    state.video = null; render(); toast('Video removed from this draft');
  });
  document.getElementById('copyGenerated')?.addEventListener('click', async () => { const text = document.getElementById('generated')?.value || ''; if (!text) return; await navigator.clipboard.writeText(text); toast('Copied to clipboard'); });
  document.getElementById('saveDraft')?.addEventListener('click', async () => {
    const content = document.getElementById('generated')?.value.trim(); if (!content) return toast('Generate or write content first');
    try { await api('/api/posts', { method:'POST', body:JSON.stringify({ platform:state.platform, content, status:'Draft', mediaId: state.video?.id || null }) }); clearComposerMedia(); await loadData(); state.page='library'; render(); toast('Draft saved'); } catch (error) { toast(error.message); }
  });
  document.getElementById('scheduleBtn')?.addEventListener('click', () => document.getElementById('scheduleBox')?.classList.toggle('hidden'));
  document.getElementById('confirmSchedule')?.addEventListener('click', async () => {
    const content = document.getElementById('generated')?.value.trim(); const at = document.getElementById('scheduleAt')?.value;
    if (!content || !at) return toast('Content and schedule time are required');
    try { await api('/api/posts', { method:'POST', body:JSON.stringify({ platform:state.platform, content, status:'Scheduled', scheduledAt:new Date(at).toISOString(), mediaId: state.video?.id || null }) }); clearComposerMedia(); await loadData(); state.page='calendar'; render(); toast('Post scheduled'); } catch (error) { toast(error.message); }
  });

  const search = document.getElementById('librarySearch'); if (search) search.oninput = () => { state.libraryQuery = search.value; render(); const input = document.getElementById('librarySearch'); input?.focus(); input?.setSelectionRange(input.value.length, input.value.length); };
  const filter = document.getElementById('libraryFilter'); if (filter) filter.onchange = () => { state.libraryFilter = filter.value; render(); };
  document.getElementById('settingsForm')?.addEventListener('submit', async event => { event.preventDefault(); try { const name = new FormData(event.currentTarget).get('name'); const d = await api('/api/settings', { method:'PUT', body:JSON.stringify({ name }) }); state.user = d.user; render(); toast('Settings saved'); } catch (error) { toast(error.message); } });
  document.getElementById('refreshModels')?.addEventListener('click', async () => { await refreshOllama(); render(); toast(state.ollama.available ? 'Ollama status refreshed' : 'Ollama is offline'); });
}

async function render() {
  if (!state.user) return authView();
  let body = '';
  if (state.page === 'dashboard') body = dashboard();
  if (state.page === 'create') body = createPage();
  if (state.page === 'library') body = library();
  if (state.page === 'calendar') body = calendar();
  if (state.page === 'analytics') body = analytics();
  if (state.page === 'connections') body = connections();
  if (state.page === 'settings') body = settings();
  layout(body); bindPage(); await hydrateVideos();
}

(async () => {
  if (state.token) await loadData();
  render();
})();
