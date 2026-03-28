const $ = (sel) => document.querySelector(sel);

const elements = {
  statusBar: $('#status-bar'),
  statusIcon: $('#status-icon'),
  statusText: $('#status-text'),
  catPosts: $('#cat-posts'),
  catComments: $('#cat-comments'),
  catReactions: $('#cat-reactions'),
  btnStart: $('#btn-start'),
  btnPause: $('#btn-pause'),
  btnResume: $('#btn-resume'),
  btnStop: $('#btn-stop'),
  stats: $('#stats'),
  statPosts: $('#stat-posts'),
  statPhotos: $('#stat-photos'),
  statComments: $('#stat-comments'),
  statReactions: $('#stat-reactions'),
  logContainer: $('#log-container'),
  log: $('#log'),
  deleteBefore: $('#delete-before'),
};

function send(type, payload = {}) {
  return chrome.runtime.sendMessage(createMessage(type, payload));
}

function updateUI(state) {
  if (!state) return;

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

  elements.catPosts.disabled = !isIdle;
  elements.catComments.disabled = !isIdle;
  elements.catReactions.disabled = !isIdle;
  elements.deleteBefore.disabled = !isIdle;

  if (state.categories) {
    elements.stats.hidden = false;
    elements.statPosts.textContent = state.categories.posts.deleted;
    elements.statPhotos.textContent = state.categories.posts.photosSaved;
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

elements.btnStart.addEventListener('click', async () => {
  const categories = {
    posts: elements.catPosts.checked,
    comments: elements.catComments.checked,
    reactions: elements.catReactions.checked,
  };
  const deleteBefore = elements.deleteBefore.value || null;
  const state = await send(SC_MESSAGES.USER_START, { categories, deleteBefore });
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

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === SC_MESSAGES.STATE_UPDATE) {
    updateUI(message.payload);
  }
});

send(SC_MESSAGES.GET_STATE).then(updateUI);

setInterval(async () => {
  const state = await send(SC_MESSAGES.GET_STATE);
  updateUI(state);
}, 2000);
