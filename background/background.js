importScripts('../shared/constants.js', '../shared/messages.js');

// ---------------------------------------------------------------------------
// 1. State Manager
// ---------------------------------------------------------------------------

const DEFAULT_STATE = {
  status: SC_CONSTANTS.STATUS.IDLE,
  currentCategory: null,
  categories: {
    posts: { enabled: true, deleted: 0, photosSaved: 0 },
    comments: { enabled: true, deleted: 0 },
    reactions: { enabled: true, deleted: 0 },
  },
  deleteBefore: null, // ISO date string — only delete items older than this
  reusingTab: false, // true if we're using a pre-existing Activity Log tab
  consecutiveFailures: 0,
  backoffUntil: null,
  log: [],
  activeTabId: null,
};

let state = { ...DEFAULT_STATE };

async function loadState() {
  const result = await chrome.storage.local.get(SC_CONSTANTS.STORAGE_KEY);
  if (result[SC_CONSTANTS.STORAGE_KEY]) {
    state = { ...DEFAULT_STATE, ...result[SC_CONSTANTS.STORAGE_KEY] };
  }
  return state;
}

async function saveState() {
  await chrome.storage.local.set({ [SC_CONSTANTS.STORAGE_KEY]: state });
}

function addLogEntry(message) {
  state.log.unshift({ message, time: Date.now() });
  if (state.log.length > 100) {
    state.log = state.log.slice(0, 100);
  }
}

function getEnabledCategories() {
  return SC_CONSTANTS.CATEGORIES.filter(cat => state.categories[cat].enabled);
}

function getNextCategory() {
  const enabled = getEnabledCategories();
  if (!state.currentCategory) return enabled[0] || null;
  const currentIndex = enabled.indexOf(state.currentCategory);
  if (currentIndex === -1 || currentIndex >= enabled.length - 1) return null;
  return enabled[currentIndex + 1];
}

// ---------------------------------------------------------------------------
// 2. Message Handler
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender).then(sendResponse);
  return true;
});

async function handleMessage(message, sender) {
  switch (message.type) {
    case SC_MESSAGES.GET_STATE:
      return { ...state };
    case SC_MESSAGES.USER_START:
      return await handleStart(message.payload);
    case SC_MESSAGES.USER_PAUSE:
      return await handlePause();
    case SC_MESSAGES.USER_RESUME:
      return await handleResume();
    case SC_MESSAGES.USER_STOP:
      return await handleStop();
    case SC_MESSAGES.ITEM_DELETED:
      return await handleItemDeleted(message.payload);
    case SC_MESSAGES.PHOTO_FOUND:
      return await handlePhotoFound(message.payload);
    case SC_MESSAGES.CATEGORY_COMPLETE:
      return await handleCategoryComplete(message.payload);
    case SC_MESSAGES.ACTION_ERROR:
      return await handleActionError(message.payload);
    case SC_MESSAGES.DUMP_DEBUG:
      return await handleDumpDebug();
    case SC_MESSAGES.DEBUG_REPORT:
      return await handleDebugReport(message.payload);
    default:
      console.warn('Unknown message type:', message.type);
      return { error: 'Unknown message type' };
  }
}

// ---------------------------------------------------------------------------
// 3. Start/Pause/Stop Handlers
// ---------------------------------------------------------------------------

async function handleStart(payload) {
  await loadState();
  if (payload && payload.categories) {
    for (const cat of SC_CONSTANTS.CATEGORIES) {
      state.categories[cat].enabled = !!payload.categories[cat];
    }
  }
  state.deleteBefore = (payload && payload.deleteBefore) || null;
  state.status = SC_CONSTANTS.STATUS.RUNNING;
  state.currentCategory = getEnabledCategories()[0] || null;
  state.consecutiveFailures = 0;
  state.backoffUntil = null;
  if (!state.currentCategory) {
    state.status = SC_CONSTANTS.STATUS.IDLE;
    await saveState();
    return { error: 'No categories selected' };
  }
  const dateMsg = state.deleteBefore ? ` (before ${state.deleteBefore})` : '';
  addLogEntry(`Starting cleanup: ${getEnabledCategories().join(', ')}${dateMsg}`);
  await saveState();

  // Check if there's already an Activity Log tab open — if so, just start on it
  const existingTabs = await chrome.tabs.query({ url: '*://*.facebook.com/*/allactivity*' });
  if (existingTabs.length > 0) {
    state.activeTabId = existingTabs[0].id;
    state.reusingTab = true;
    addLogEntry('Using existing Activity Log tab — will not navigate away');
    await saveState();
    // Inject scripts and start cleanup directly on the existing tab
    try {
      await chrome.tabs.sendMessage(state.activeTabId, createMessage(SC_MESSAGES.START_CLEANUP));
    } catch {
      try {
        await chrome.scripting.executeScript({
          target: { tabId: state.activeTabId },
          files: [
            'shared/constants.js',
            'shared/messages.js',
            'content/debug.js',
            'content/selectors.js',
            'content/posts.js',
            'content/comments.js',
            'content/reactions.js',
            'content/content.js',
          ],
        });
        await new Promise(r => setTimeout(r, 1000));
        await chrome.tabs.sendMessage(state.activeTabId, createMessage(SC_MESSAGES.START_CLEANUP));
      } catch (err) {
        addLogEntry(`Failed to start on existing tab: ${err.message}`);
      }
    }
  } else {
    await navigateToCategory(state.currentCategory);
  }
  return { ...state };
}

async function handlePause() {
  state.status = SC_CONSTANTS.STATUS.PAUSED;
  addLogEntry('Paused');
  await saveState();
  broadcastState();
  return { ...state };
}

async function handleResume() {
  state.status = SC_CONSTANTS.STATUS.RUNNING;
  state.consecutiveFailures = 0;
  state.backoffUntil = null;
  addLogEntry('Resumed');
  await saveState();
  if (state.activeTabId) {
    chrome.tabs.sendMessage(state.activeTabId, createMessage(SC_MESSAGES.RESUME_CLEANUP));
  }
  broadcastState();
  return { ...state };
}

async function handleStop() {
  state.status = SC_CONSTANTS.STATUS.IDLE;
  state.currentCategory = null;
  state.activeTabId = null;
  addLogEntry('Stopped by user');
  await saveState();
  broadcastState();
  return { ...state };
}

function broadcastState() {
  chrome.runtime.sendMessage(createMessage(SC_MESSAGES.STATE_UPDATE, { ...state })).catch(() => {});
}

// ---------------------------------------------------------------------------
// 4. Navigation and Category Transition
// ---------------------------------------------------------------------------

async function navigateToCategory(category) {
  const urlMap = {
    posts: SC_CONSTANTS.URLS.POSTS,
    comments: SC_CONSTANTS.URLS.COMMENTS,
    reactions: SC_CONSTANTS.URLS.REACTIONS,
  };
  const url = urlMap[category];
  if (!url) return;

  // First, check if there's already an Activity Log tab open — use it instead of opening a new one
  const existingTabs = await chrome.tabs.query({ url: '*://*.facebook.com/*/allactivity*' });
  const meTab = await chrome.tabs.query({ url: '*://*.facebook.com/me/allactivity*' });
  const allActivityTabs = [...meTab, ...existingTabs];

  if (allActivityTabs.length > 0) {
    // Reuse the existing Activity Log tab
    state.activeTabId = allActivityTabs[0].id;
    addLogEntry(`Using existing Activity Log tab`);
    // Only navigate if the tab isn't already on the right category
    const currentUrl = allActivityTabs[0].url || '';
    const categoryKey = new URL(url).searchParams.get('category_key');
    if (!currentUrl.includes(categoryKey)) {
      await chrome.tabs.update(state.activeTabId, { url });
      addLogEntry(`Navigating to ${category} activity log`);
    } else {
      addLogEntry(`Already on ${category} activity log — starting cleanup`);
      // Tab is already on the right page, just tell content script to start
      setTimeout(() => {
        chrome.tabs.sendMessage(state.activeTabId, createMessage(SC_MESSAGES.START_CLEANUP)).catch(() => {});
      }, 1000);
    }
  } else if (state.activeTabId) {
    addLogEntry(`Navigating to ${category} activity log`);
    try {
      await chrome.tabs.update(state.activeTabId, { url });
    } catch {
      const tab = await chrome.tabs.create({ url });
      state.activeTabId = tab.id;
    }
  } else {
    addLogEntry(`Opening ${category} activity log`);
    const tab = await chrome.tabs.create({ url });
    state.activeTabId = tab.id;
  }
  await saveState();
}

async function handleCategoryComplete(payload) {
  const category = payload.category || state.currentCategory;
  addLogEntry(`Finished ${category}`);

  // If we're reusing an existing tab, don't navigate away — just stop
  if (state.reusingTab) {
    state.status = SC_CONSTANTS.STATUS.COMPLETE;
    state.currentCategory = null;
    state.reusingTab = false;
    addLogEntry('Done! Change date or category and run again.');
    await saveState();
    broadcastState();
    return { ...state };
  }

  const next = getNextCategory();
  if (next) {
    state.currentCategory = next;
    await saveState();
    await navigateToCategory(next);
  } else {
    state.status = SC_CONSTANTS.STATUS.COMPLETE;
    state.currentCategory = null;
    addLogEntry('All categories complete!');
    await saveState();
  }
  broadcastState();
  return { ...state };
}

// ---------------------------------------------------------------------------
// 5. Item Deleted and Photo Download
// ---------------------------------------------------------------------------

async function handleItemDeleted(payload) {
  const { category } = payload;
  const cat = category || state.currentCategory;
  if (state.categories[cat]) {
    state.categories[cat].deleted++;
  }
  state.consecutiveFailures = 0;
  addLogEntry(`Deleted ${cat.slice(0, -1)} ${payload.description || ''}`);
  await saveState();
  broadcastState();
  return { ok: true };
}

async function handlePhotoFound(payload) {
  const { urls, postId, postDate } = payload;
  const results = [];
  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    const ext = guessExtension(url);
    const dateStr = postDate || new Date().toISOString().split('T')[0];
    const filename = `${SC_CONSTANTS.DOWNLOAD_PATH}/${dateStr}_${postId}_${i + 1}.${ext}`;
    try {
      const downloadId = await chrome.downloads.download({
        url,
        filename,
        conflictAction: 'uniquify',
      });
      results.push({ downloadId, filename, success: true });
    } catch (err) {
      results.push({ filename, success: false, error: err.message });
      addLogEntry(`Failed to download photo: ${err.message}`);
    }
  }
  const successCount = results.filter(r => r.success).length;
  if (state.categories.posts) {
    state.categories.posts.photosSaved += successCount;
  }
  addLogEntry(`Downloaded ${successCount}/${urls.length} photos from post`);
  await saveState();
  broadcastState();
  return { results, allSuccess: results.every(r => r.success) };
}

function guessExtension(url) {
  try {
    const pathname = new URL(url).pathname;
    const match = pathname.match(/\.(jpg|jpeg|png|gif|webp|mp4)/i);
    return match ? match[1].toLowerCase() : 'jpg';
  } catch {
    return 'jpg';
  }
}

// ---------------------------------------------------------------------------
// 6. Debug Logging
// ---------------------------------------------------------------------------

async function handleDumpDebug() {
  // Prefer Activity Log tab, fall back to any Facebook tab
  let tabs = await chrome.tabs.query({ url: '*://*.facebook.com/*/allactivity*' });
  if (tabs.length === 0) {
    tabs = await chrome.tabs.query({ url: '*://*.facebook.com/*' });
  }
  if (tabs.length === 0) {
    return { error: 'No Facebook tab open. Open Facebook first, then try again.' };
  }
  const tabId = tabs[0].id;

  // Try messaging first, if that fails, forcefully inject content scripts
  try {
    await chrome.tabs.sendMessage(tabId, createMessage(SC_MESSAGES.DUMP_DEBUG));
    return { ok: true, message: 'Debug dump requested — check Downloads for social-cleanup-debug.json' };
  } catch {
    // Content script not loaded — inject it now
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: [
          'shared/constants.js',
          'shared/messages.js',
          'content/debug.js',
          'content/selectors.js',
          'content/posts.js',
          'content/comments.js',
          'content/reactions.js',
          'content/content.js',
        ],
      });
      // Wait a moment for scripts to initialize, then send the debug message
      await new Promise(r => setTimeout(r, 1000));
      await chrome.tabs.sendMessage(tabId, createMessage(SC_MESSAGES.DUMP_DEBUG));
      return { ok: true, message: 'Scripts injected and debug dump requested' };
    } catch (err) {
      return { error: `Failed to inject scripts: ${err.message}` };
    }
  }
}

async function handleDebugReport(payload) {
  const { report } = payload;
  // Save debug report as a downloadable file via data URL (no Blob API in service workers)
  const dataUrl = 'data:application/json;base64,' + btoa(unescape(encodeURIComponent(report)));
  try {
    await chrome.downloads.download({
      url: dataUrl,
      filename: 'social-cleanup-debug.json',
      conflictAction: 'overwrite',
    });
    addLogEntry('Debug log saved to Downloads/social-cleanup-debug.json');
    await saveState();
    broadcastState();
  } catch (err) {
    addLogEntry(`Failed to save debug log: ${err.message}`);
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// 7. Error Handling and Backoff
// ---------------------------------------------------------------------------

async function handleActionError(payload) {
  state.consecutiveFailures++;
  addLogEntry(`Error: ${payload.error || 'unknown'} (failure ${state.consecutiveFailures})`);
  if (state.consecutiveFailures >= SC_CONSTANTS.MAX_CONSECUTIVE_FAILURES) {
    const backoffMs = Math.min(
      SC_CONSTANTS.TIMING.BACKOFF_BASE * Math.pow(2, state.consecutiveFailures - SC_CONSTANTS.MAX_CONSECUTIVE_FAILURES),
      SC_CONSTANTS.TIMING.BACKOFF_MAX
    );
    state.status = SC_CONSTANTS.STATUS.RATE_LIMITED;
    state.backoffUntil = Date.now() + backoffMs;
    addLogEntry(`Rate limited — backing off ${backoffMs / 1000}s`);
    setTimeout(async () => {
      if (state.status === SC_CONSTANTS.STATUS.RATE_LIMITED) {
        state.status = SC_CONSTANTS.STATUS.RUNNING;
        state.consecutiveFailures = 0;
        state.backoffUntil = null;
        addLogEntry('Resuming after backoff');
        await saveState();
        broadcastState();
        if (state.activeTabId) {
          chrome.tabs.sendMessage(state.activeTabId, createMessage(SC_MESSAGES.RESUME_CLEANUP));
        }
      }
    }, backoffMs);
  }
  await saveState();
  broadcastState();
  return { ...state };
}

// ---------------------------------------------------------------------------
// 7. Startup Resume and Tab Close Listener
// ---------------------------------------------------------------------------

chrome.runtime.onStartup.addListener(async () => {
  await loadState();
  if (state.status === SC_CONSTANTS.STATUS.RUNNING || state.status === SC_CONSTANTS.STATUS.RATE_LIMITED) {
    state.status = SC_CONSTANTS.STATUS.PAUSED;
    addLogEntry('Session interrupted — paused. Click Resume to continue.');
    await saveState();
  }
});

// When the Activity Log tab finishes loading, inject scripts and tell content script to start
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (tabId !== state.activeTabId) return;
  if (changeInfo.status !== 'complete') return;
  if (state.status !== SC_CONSTANTS.STATUS.RUNNING) return;

  // Give the page a moment to render, then inject scripts and start
  setTimeout(async () => {
    try {
      await chrome.tabs.sendMessage(tabId, createMessage(SC_MESSAGES.START_CLEANUP));
    } catch {
      // Content script not loaded — inject it
      try {
        await chrome.scripting.executeScript({
          target: { tabId },
          files: [
            'shared/constants.js',
            'shared/messages.js',
            'content/debug.js',
            'content/selectors.js',
            'content/posts.js',
            'content/comments.js',
            'content/reactions.js',
            'content/content.js',
          ],
        });
        await new Promise(r => setTimeout(r, 1000));
        await chrome.tabs.sendMessage(tabId, createMessage(SC_MESSAGES.START_CLEANUP));
      } catch (err) {
        addLogEntry(`Failed to inject scripts: ${err.message}`);
        await saveState();
        broadcastState();
      }
    }
  }, 3000);
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  if (tabId === state.activeTabId && state.status === SC_CONSTANTS.STATUS.RUNNING) {
    state.status = SC_CONSTANTS.STATUS.PAUSED;
    state.activeTabId = null;
    addLogEntry('Activity tab closed — paused');
    await saveState();
    broadcastState();
  }
});

loadState();
