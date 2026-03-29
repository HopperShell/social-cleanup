const $ = (sel) => document.querySelector(sel);

const elements = {
  statusBar: $('#status-bar'),
  statusIcon: $('#status-icon'),
  statusText: $('#status-text'),
  navPosts: $('#nav-posts'),
  navComments: $('#nav-comments'),
  navReactions: $('#nav-reactions'),
  currentPage: $('#current-page'),
  btnStart: $('#btn-start'),
  btnPause: $('#btn-pause'),
  btnResume: $('#btn-resume'),
  btnStop: $('#btn-stop'),
  stats: $('#stats'),
  statPosts: $('#stat-posts'),
  statComments: $('#stat-comments'),
  statReactions: $('#stat-reactions'),
  logContainer: $('#log-container'),
  log: $('#log'),
  deleteBefore: $('#delete-before'),
  skipPhotos: $('#skip-photos'),
  btnDebug: $('#btn-debug'),
};

function send(type, payload = {}) {
  return chrome.runtime.sendMessage(createMessage(type, payload));
}

// Detect what Activity Log page the user is currently on
async function detectCurrentPage() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const url = (tabs[0]?.url || '').toLowerCase();

  // Highlight the active nav button
  elements.navPosts.classList.remove('active');
  elements.navComments.classList.remove('active');
  elements.navReactions.classList.remove('active');

  if (url.includes('statuscluster')) {
    elements.navPosts.classList.add('active');
    elements.currentPage.textContent = 'Currently on: Posts';
  } else if (url.includes('commentscluster')) {
    elements.navComments.classList.add('active');
    elements.currentPage.textContent = 'Currently on: Comments';
  } else if (url.includes('category_key=likes')) {
    elements.navReactions.classList.add('active');
    elements.currentPage.textContent = 'Currently on: Reactions';
  } else if (url.includes('allactivity')) {
    elements.currentPage.textContent = 'On Activity Log (pick a category)';
  } else {
    elements.currentPage.textContent = 'Not on Activity Log — pick a category';
  }
}

// Navigate to a category
async function navigateTo(category) {
  const urls = {
    posts: SC_CONSTANTS.URLS.POSTS,
    comments: SC_CONSTANTS.URLS.COMMENTS,
    reactions: SC_CONSTANTS.URLS.REACTIONS,
  };

  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tabs[0]) {
    await chrome.tabs.update(tabs[0].id, { url: urls[category] });
  } else {
    await chrome.tabs.create({ url: urls[category] });
  }
  // Close popup — user will see the page loading
  window.close();
}

function updateUI(state) {
  if (!state) return;
  // Guard against null elements (stale popup or missing DOM)
  if (!elements.statusBar) return;

  const status = state.status || SC_CONSTANTS.STATUS.IDLE;
  elements.statusBar.className = `status ${status}`;

  const statusLabels = {
    idle: 'Idle',
    running: 'Running...',
    paused: 'Paused',
    rate_limited: 'Rate Limited — backing off',
    complete: 'Complete!',
    error: 'Error',
  };

  let statusText = statusLabels[status] || status;
  if (status === SC_CONSTANTS.STATUS.RATE_LIMITED && state.backoffUntil) {
    const remaining = Math.max(0, Math.ceil((state.backoffUntil - Date.now()) / 1000));
    statusText += ` (${remaining}s)`;
  }
  elements.statusText.textContent = statusText;

  const isIdle = status === SC_CONSTANTS.STATUS.IDLE || status === SC_CONSTANTS.STATUS.COMPLETE;
  const isRunning = status === SC_CONSTANTS.STATUS.RUNNING || status === SC_CONSTANTS.STATUS.RATE_LIMITED;
  const isPaused = status === SC_CONSTANTS.STATUS.PAUSED;

  elements.btnStart.hidden = !isIdle;
  elements.btnPause.hidden = !isRunning;
  elements.btnResume.hidden = !isPaused;
  elements.btnStop.hidden = isIdle;

  if (elements.deleteBefore) {
    elements.deleteBefore.disabled = !isIdle;
    if (state.deleteBefore && !elements.deleteBefore.value) {
      elements.deleteBefore.value = state.deleteBefore;
    }
  }
  if (elements.skipPhotos) {
    elements.skipPhotos.disabled = !isIdle;
    // Restore checkbox from state so it persists across popup opens
    if (state.skipPhotoPosts !== undefined) {
      elements.skipPhotos.checked = state.skipPhotoPosts;
    }
  }

  if (state.categories) {
    elements.stats.hidden = false;
    elements.statPosts.textContent = state.categories.posts.deleted;
    elements.statComments.textContent = state.categories.comments.deleted;
    elements.statReactions.textContent = state.categories.reactions.deleted;
  }

  if (state.log && state.log.length > 0) {
    elements.logContainer.hidden = false;
    elements.log.innerHTML = state.log.slice(0, 50).map(entry => {
      const time = new Date(entry.time).toLocaleTimeString();
      return `<div class="log-entry"><span class="log-time">${time}</span>${escapeHtml(entry.message)}</div>`;
    }).join('');
  }
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Navigation buttons
elements.navPosts.addEventListener('click', () => navigateTo('posts'));
elements.navComments.addEventListener('click', () => navigateTo('comments'));
elements.navReactions.addEventListener('click', () => navigateTo('reactions'));

// Start — just tells background to go, background detects the current tab
elements.btnStart.addEventListener('click', async () => {
  const categories = { posts: true, comments: true, reactions: true };
  const deleteBefore = elements.deleteBefore.value || null;
  const skipPhotoPosts = elements.skipPhotos.checked;
  const state = await send(SC_MESSAGES.USER_START, { categories, deleteBefore, skipPhotoPosts });
  updateUI(state);
});

elements.btnPause.addEventListener('click', async () => {
  const state = await send(SC_MESSAGES.USER_PAUSE);
  updateUI(state);
});

elements.btnResume.addEventListener('click', async () => {
  const state = await send(SC_MESSAGES.USER_RESUME);
  updateUI(state);
});

elements.btnStop.addEventListener('click', async () => {
  const state = await send(SC_MESSAGES.USER_STOP);
  updateUI(state);
});

elements.btnDebug.addEventListener('click', async () => {
  elements.btnDebug.textContent = 'Dumping...';
  elements.btnDebug.disabled = true;
  const result = await send(SC_MESSAGES.DUMP_DEBUG);
  elements.btnDebug.textContent = result.error ? 'Error — see console' : 'Saved!';
  if (result.error) console.error('Debug dump error:', result.error);
  setTimeout(() => {
    elements.btnDebug.textContent = 'Dump Debug Log';
    elements.btnDebug.disabled = false;
  }, 2000);
});

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === SC_MESSAGES.STATE_UPDATE) {
    updateUI(message.payload);
  }
});

// Initial load
send(SC_MESSAGES.GET_STATE).then(updateUI);
detectCurrentPage();

setInterval(async () => {
  const state = await send(SC_MESSAGES.GET_STATE);
  updateUI(state);
}, 2000);
