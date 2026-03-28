# Facebook Cleanup Chrome Extension — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Chrome extension that bulk-deletes Facebook posts (downloading photos first), comments, and reactions via the Activity Log UI, running unattended in the background.

**Architecture:** Chrome Manifest V3 extension with four layers: popup UI for control, background service worker for orchestration and state, content script for DOM interaction on Activity Log pages, and message-passing glue between them. State persisted to chrome.storage.local for resume capability.

**Tech Stack:** Vanilla JS, Chrome Extension Manifest V3, chrome.storage/chrome.downloads/chrome.tabs APIs

---

## File Structure

```
social-cleanup/
├── manifest.json              # Extension manifest (permissions, scripts, icons)
├── popup/
│   ├── popup.html             # Control panel markup
│   ├── popup.js               # Popup logic (start/stop, display stats)
│   └── popup.css              # Popup styling
├── background/
│   └── background.js          # Service worker (state machine, downloads, coordination)
├── content/
│   ├── content.js             # DOM interaction entry point (delegates to modules)
│   ├── selectors.js           # Facebook DOM selector strategies (centralized)
│   ├── posts.js               # Post detection, photo extraction, post deletion
│   ├── comments.js            # Comment deletion logic
│   └── reactions.js           # Reaction removal logic
├── shared/
│   ├── constants.js           # Shared constants (URLs, timing, message types)
│   └── messages.js            # Message type definitions and helpers
├── icons/
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
└── docs/
    └── superpowers/
        ├── specs/...
        └── plans/...
```

**Key design decisions:**
- Content script split into modules by category (posts/comments/reactions) + centralized selectors file. Selectors change when Facebook updates UI — isolating them makes maintenance easier.
- `shared/` for constants and message definitions used by both background and content scripts. Since Manifest V3 content scripts can't use ES modules, we'll load these as multiple script entries in the manifest.
- No build step — plain JS, loaded via manifest script arrays.

---

### Task 1: Project Skeleton and Manifest

**Files:**
- Create: `manifest.json`
- Create: `shared/constants.js`
- Create: `shared/messages.js`
- Create: `icons/icon16.png`, `icons/icon48.png`, `icons/icon128.png`

- [ ] **Step 1: Create manifest.json**

```json
{
  "manifest_version": 3,
  "name": "Social Cleanup",
  "version": "1.0.0",
  "description": "Bulk-delete Facebook posts, comments, and reactions via Activity Log",
  "permissions": [
    "activeTab",
    "downloads",
    "storage",
    "tabs"
  ],
  "host_permissions": [
    "*://*.facebook.com/*"
  ],
  "background": {
    "service_worker": "background/background.js",
    "type": "module"
  },
  "content_scripts": [
    {
      "matches": ["*://*.facebook.com/allactivity*"],
      "js": [
        "shared/constants.js",
        "shared/messages.js",
        "content/selectors.js",
        "content/posts.js",
        "content/comments.js",
        "content/reactions.js",
        "content/content.js"
      ],
      "run_at": "document_idle"
    }
  ],
  "action": {
    "default_popup": "popup/popup.html",
    "default_icon": {
      "16": "icons/icon16.png",
      "48": "icons/icon48.png",
      "128": "icons/icon128.png"
    }
  },
  "icons": {
    "16": "icons/icon16.png",
    "48": "icons/icon48.png",
    "128": "icons/icon128.png"
  }
}
```

- [ ] **Step 2: Create shared/constants.js**

```js
// shared/constants.js
// Wrapped in globalThis to work in both content scripts and ES module (background)
const SC_CONSTANTS = {
  // Activity Log URLs
  URLS: {
    POSTS: 'https://www.facebook.com/allactivity?activity_history=false&category_key=POSTSYOUVEWRITTEN',
    COMMENTS: 'https://www.facebook.com/allactivity?activity_history=false&category_key=COMMENTSCLIPS',
    REACTIONS: 'https://www.facebook.com/allactivity?activity_history=false&category_key=REACTIONSCLIPS',
  },

  // Categories in processing order
  CATEGORIES: ['posts', 'comments', 'reactions'],

  // Timing (milliseconds)
  TIMING: {
    MIN_DELAY: 2000,
    MAX_DELAY: 5000,
    MUTATION_WAIT: 1500,
    BACKOFF_BASE: 30000,
    BACKOFF_MAX: 120000,
  },

  // State machine states
  STATUS: {
    IDLE: 'idle',
    RUNNING: 'running',
    PAUSED: 'paused',
    RATE_LIMITED: 'rate_limited',
    COMPLETE: 'complete',
    ERROR: 'error',
  },

  // Download subfolder
  DOWNLOAD_PATH: 'FacebookBackup',

  // Max consecutive failures before backoff
  MAX_CONSECUTIVE_FAILURES: 3,

  // Storage keys
  STORAGE_KEY: 'socialCleanupState',
};

// Make available to ES modules (background service worker)
if (typeof globalThis !== 'undefined') {
  globalThis.SC_CONSTANTS = SC_CONSTANTS;
}
```

- [ ] **Step 3: Create shared/messages.js**

```js
// shared/messages.js
const SC_MESSAGES = {
  // Background -> Content
  START_CLEANUP: 'START_CLEANUP',
  PAUSE_CLEANUP: 'PAUSE_CLEANUP',
  RESUME_CLEANUP: 'RESUME_CLEANUP',

  // Content -> Background
  ITEM_DELETED: 'ITEM_DELETED',
  PHOTO_FOUND: 'PHOTO_FOUND',
  DOWNLOAD_PHOTO: 'DOWNLOAD_PHOTO',
  CATEGORY_COMPLETE: 'CATEGORY_COMPLETE',
  ACTION_ERROR: 'ACTION_ERROR',
  PROGRESS_UPDATE: 'PROGRESS_UPDATE',

  // Background -> Popup
  STATE_UPDATE: 'STATE_UPDATE',

  // Popup -> Background
  GET_STATE: 'GET_STATE',
  USER_START: 'USER_START',
  USER_PAUSE: 'USER_PAUSE',
  USER_RESUME: 'USER_RESUME',
  USER_STOP: 'USER_STOP',
};

function createMessage(type, payload = {}) {
  return { type, payload, timestamp: Date.now() };
}

if (typeof globalThis !== 'undefined') {
  globalThis.SC_MESSAGES = SC_MESSAGES;
  globalThis.createMessage = createMessage;
}
```

- [ ] **Step 4: Create placeholder icons**

Generate simple colored square icons at 16x16, 48x48, and 128x128 pixels. Use an HTML canvas approach or simply create minimal PNG files. These are placeholders — a broom or trash icon can replace them later.

Create `icons/` directory and generate icons using a simple script:

```bash
# We'll create simple solid-color PNGs using ImageMagick if available, or just note them as TODO
mkdir -p icons
# If ImageMagick is installed:
convert -size 16x16 xc:#e74c3c icons/icon16.png
convert -size 48x48 xc:#e74c3c icons/icon48.png
convert -size 128x128 xc:#e74c3c icons/icon128.png
# If not, create them manually or use any 16/48/128px PNGs
```

- [ ] **Step 5: Verify extension loads in Chrome**

1. Open `chrome://extensions/`
2. Enable "Developer mode"
3. Click "Load unpacked" and select the `social-cleanup/` directory
4. Verify: extension appears with name "Social Cleanup", no errors in the console

- [ ] **Step 6: Commit**

```bash
git add manifest.json shared/ icons/
git commit -m "feat: add extension manifest, shared constants, and message definitions"
```

---

### Task 2: Background Service Worker — State Machine

**Files:**
- Create: `background/background.js`

- [ ] **Step 1: Implement the state manager**

```js
// background/background.js

// Import shared modules (service worker is type: module)
importScripts('../shared/constants.js', '../shared/messages.js');

const DEFAULT_STATE = {
  status: SC_CONSTANTS.STATUS.IDLE,
  currentCategory: null,
  categories: {
    posts: { enabled: true, deleted: 0, photosSaved: 0 },
    comments: { enabled: true, deleted: 0 },
    reactions: { enabled: true, deleted: 0 },
  },
  consecutiveFailures: 0,
  backoffUntil: null,
  log: [], // Recent activity log entries, max 100
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
```

- [ ] **Step 2: Implement message handler for popup communication**

Add to `background/background.js`:

```js
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender).then(sendResponse);
  return true; // async response
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

    default:
      console.warn('Unknown message type:', message.type);
      return { error: 'Unknown message type' };
  }
}
```

- [ ] **Step 3: Implement start/pause/stop handlers**

Add to `background/background.js`:

```js
async function handleStart(payload) {
  await loadState();

  // Apply category selections from popup
  if (payload && payload.categories) {
    for (const cat of SC_CONSTANTS.CATEGORIES) {
      state.categories[cat].enabled = !!payload.categories[cat];
    }
  }

  state.status = SC_CONSTANTS.STATUS.RUNNING;
  state.currentCategory = getEnabledCategories()[0] || null;
  state.consecutiveFailures = 0;
  state.backoffUntil = null;

  if (!state.currentCategory) {
    state.status = SC_CONSTANTS.STATUS.IDLE;
    await saveState();
    return { error: 'No categories selected' };
  }

  addLogEntry(`Starting cleanup: ${getEnabledCategories().join(', ')}`);
  await saveState();
  await navigateToCategory(state.currentCategory);
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

  // Tell content script to continue
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
  chrome.runtime.sendMessage(createMessage(SC_MESSAGES.STATE_UPDATE, { ...state })).catch(() => {
    // Popup may not be open — ignore
  });
}
```

- [ ] **Step 4: Implement navigation and category transition**

Add to `background/background.js`:

```js
async function navigateToCategory(category) {
  const urlMap = {
    posts: SC_CONSTANTS.URLS.POSTS,
    comments: SC_CONSTANTS.URLS.COMMENTS,
    reactions: SC_CONSTANTS.URLS.REACTIONS,
  };

  const url = urlMap[category];
  if (!url) return;

  addLogEntry(`Navigating to ${category} activity log`);

  if (state.activeTabId) {
    try {
      await chrome.tabs.update(state.activeTabId, { url });
    } catch {
      // Tab was closed — create new one
      const tab = await chrome.tabs.create({ url });
      state.activeTabId = tab.id;
    }
  } else {
    const tab = await chrome.tabs.create({ url });
    state.activeTabId = tab.id;
  }

  await saveState();
}

async function handleCategoryComplete(payload) {
  const category = payload.category || state.currentCategory;
  addLogEntry(`Finished ${category}`);

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
```

- [ ] **Step 5: Implement item-deleted and photo-download handlers**

Add to `background/background.js`:

```js
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
```

- [ ] **Step 6: Implement error handling and backoff**

Add to `background/background.js`:

```js
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

    // Schedule resume after backoff
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
```

- [ ] **Step 7: Add startup resume detection and tab close listener**

Add to `background/background.js`:

```js
// On extension startup, check for interrupted session
chrome.runtime.onStartup.addListener(async () => {
  await loadState();
  if (state.status === SC_CONSTANTS.STATUS.RUNNING || state.status === SC_CONSTANTS.STATUS.RATE_LIMITED) {
    state.status = SC_CONSTANTS.STATUS.PAUSED;
    addLogEntry('Session interrupted — paused. Click Resume to continue.');
    await saveState();
  }
});

// If the active tab is closed, pause
chrome.tabs.onRemoved.addListener(async (tabId) => {
  if (tabId === state.activeTabId && state.status === SC_CONSTANTS.STATUS.RUNNING) {
    state.status = SC_CONSTANTS.STATUS.PAUSED;
    state.activeTabId = null;
    addLogEntry('Activity tab closed — paused');
    await saveState();
    broadcastState();
  }
});

// Initialize state on load
loadState();
```

- [ ] **Step 8: Verify background script loads without errors**

1. Reload the extension in `chrome://extensions/`
2. Click "Inspect views: service worker" link
3. Verify no errors in the console
4. In the console, test: `chrome.runtime.sendMessage({ type: 'GET_STATE' }, r => console.log(r))`
5. Should return the default state object with status "idle"

- [ ] **Step 9: Commit**

```bash
git add background/
git commit -m "feat: add background service worker with state machine and message handling"
```

---

### Task 3: Content Script — Selectors and Core Loop

**Files:**
- Create: `content/selectors.js`
- Create: `content/content.js`

- [ ] **Step 1: Implement Facebook DOM selectors**

```js
// content/selectors.js
// Centralized selector strategies for Facebook's Activity Log
// Facebook uses dynamic class names — we target stable attributes instead

const SC_SELECTORS = {
  // Find activity log item rows
  getActivityItems() {
    // Activity log items are rendered as rows with role="row" or in list items
    // Look for the container that holds individual activity entries
    const items = document.querySelectorAll('[data-visualcompletion="ignore-dynamic"] [role="listitem"]');
    if (items.length > 0) return Array.from(items);

    // Fallback: look for rows with checkbox + action menu pattern
    const rows = document.querySelectorAll('[role="row"]');
    return Array.from(rows).filter(row =>
      row.querySelector('[aria-label]') && row.textContent.trim().length > 0
    );
  },

  // Find the "..." or three-dot menu button on an activity item
  getMenuButton(item) {
    // Look for the action menu button (usually has aria-label or aria-haspopup)
    const btn = item.querySelector('[aria-haspopup="menu"]')
      || item.querySelector('[aria-label="Action options"]')
      || item.querySelector('[aria-label="More options"]');
    return btn;
  },

  // Find a menu option by text content (e.g., "Delete", "Remove reaction")
  getMenuOption(text) {
    const menuItems = document.querySelectorAll('[role="menuitem"], [role="option"]');
    for (const el of menuItems) {
      if (el.textContent.trim().toLowerCase().includes(text.toLowerCase())) {
        return el;
      }
    }

    // Fallback: search all clickable elements in visible menus
    const allSpans = document.querySelectorAll('[role="menu"] span, [role="listbox"] span');
    for (const span of allSpans) {
      if (span.textContent.trim().toLowerCase().includes(text.toLowerCase())) {
        return span.closest('[role="menuitem"]') || span.closest('[tabindex]') || span;
      }
    }
    return null;
  },

  // Find confirmation dialog and its confirm button
  getConfirmButton() {
    // Facebook confirmation dialogs typically have role="dialog"
    const dialog = document.querySelector('[role="dialog"]');
    if (!dialog) return null;

    // Look for the primary action button (Delete/Confirm/Remove)
    const buttons = dialog.querySelectorAll('[role="button"]');
    for (const btn of buttons) {
      const text = btn.textContent.trim().toLowerCase();
      if (text === 'delete' || text === 'confirm' || text === 'remove' || text === 'continue') {
        return btn;
      }
    }
    return null;
  },

  // Check if an activity item contains photos
  itemHasPhoto(item) {
    // Check for image elements (not profile pics or icons)
    const imgs = item.querySelectorAll('img');
    for (const img of imgs) {
      const src = img.src || '';
      // Facebook photo URLs contain these patterns; profile pics are smaller
      if ((src.includes('scontent') || src.includes('fbcdn')) &&
          img.width > 60 && img.height > 60) {
        return true;
      }
    }
    return false;
  },

  // Extract full-resolution photo URLs from a post
  getPhotoUrls(item) {
    const urls = [];
    const imgs = item.querySelectorAll('img');
    for (const img of imgs) {
      const src = img.src || '';
      if ((src.includes('scontent') || src.includes('fbcdn')) &&
          img.width > 60 && img.height > 60) {
        // Try to get highest resolution — replace size parameters
        const highRes = src.replace(/\/[sp]\d+x\d+\//, '/').replace(/&width=\d+/, '');
        urls.push(highRes);
      }
    }
    return urls;
  },

  // Extract a post ID from an activity item (for file naming)
  getItemId(item) {
    // Look for links containing post IDs
    const links = item.querySelectorAll('a[href]');
    for (const link of links) {
      const href = link.href;
      const match = href.match(/\/posts\/(\d+)/) || href.match(/story_fbid=(\d+)/) || href.match(/\/(\d{10,})/);
      if (match) return match[1];
    }
    // Fallback: use a hash of the text content
    return 'post_' + Date.now();
  },

  // Extract date from an activity item
  getItemDate(item) {
    // Activity log items usually show a date
    const timeEl = item.querySelector('time') || item.querySelector('[data-utime]');
    if (timeEl) {
      const datetime = timeEl.getAttribute('datetime') || timeEl.getAttribute('data-utime');
      if (datetime) {
        try {
          return new Date(datetime).toISOString().split('T')[0];
        } catch { /* fall through */ }
      }
    }
    // Look for date-like text patterns
    const text = item.textContent;
    const dateMatch = text.match(/(\w+ \d{1,2}, \d{4})/);
    if (dateMatch) {
      try {
        return new Date(dateMatch[1]).toISOString().split('T')[0];
      } catch { /* fall through */ }
    }
    return new Date().toISOString().split('T')[0];
  },

  // Check if we've scrolled to the end (no more items to load)
  isEndOfList() {
    // Facebook shows a "You have no more activity" type message or the spinner stops
    const endIndicators = document.querySelectorAll('[role="status"]');
    for (const el of endIndicators) {
      const text = el.textContent.toLowerCase();
      if (text.includes('no more') || text.includes('end of') || text.includes("you're all caught up")) {
        return true;
      }
    }
    return false;
  },

  // Scroll the activity list to trigger lazy loading
  scrollToLoadMore() {
    window.scrollTo(0, document.body.scrollHeight);
  },
};

if (typeof globalThis !== 'undefined') {
  globalThis.SC_SELECTORS = SC_SELECTORS;
}
```

- [ ] **Step 2: Implement the content script core loop**

```js
// content/content.js
// Main content script — orchestrates the cleanup loop on Activity Log pages

(function () {
  'use strict';

  let isRunning = false;
  let isPaused = false;
  let currentCategory = null;

  // Determine category from URL
  function detectCategory() {
    const url = window.location.href;
    if (url.includes('POSTSYOUVEWRITTEN')) return 'posts';
    if (url.includes('COMMENTSCLIPS')) return 'comments';
    if (url.includes('REACTIONSCLIPS')) return 'reactions';
    return null;
  }

  // Random delay between min and max
  function delay(min = SC_CONSTANTS.TIMING.MIN_DELAY, max = SC_CONSTANTS.TIMING.MAX_DELAY) {
    const ms = min + Math.random() * (max - min);
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Simulate a click (Facebook listens for mousedown/mouseup/click sequence)
  function simulateClick(element) {
    if (!element) return false;
    element.scrollIntoView({ behavior: 'smooth', block: 'center' });

    const events = ['mousedown', 'mouseup', 'click'];
    for (const eventType of events) {
      element.dispatchEvent(new MouseEvent(eventType, {
        bubbles: true,
        cancelable: true,
        view: window,
      }));
    }
    return true;
  }

  // Wait for a condition to be true, with timeout
  function waitFor(conditionFn, timeoutMs = 5000, pollMs = 200) {
    return new Promise((resolve, reject) => {
      const start = Date.now();
      const check = () => {
        const result = conditionFn();
        if (result) return resolve(result);
        if (Date.now() - start > timeoutMs) return reject(new Error('waitFor timeout'));
        setTimeout(check, pollMs);
      };
      check();
    });
  }

  // Wait for new items to appear after scrolling
  function waitForMutation(timeoutMs = SC_CONSTANTS.TIMING.MUTATION_WAIT) {
    return new Promise(resolve => {
      const observer = new MutationObserver(() => {
        observer.disconnect();
        resolve(true);
      });
      observer.observe(document.body, { childList: true, subtree: true });
      setTimeout(() => {
        observer.disconnect();
        resolve(false);
      }, timeoutMs);
    });
  }

  // Delete a single item (post, comment, or reaction)
  async function deleteItem(item) {
    // Step 1: Open the action menu
    const menuBtn = SC_SELECTORS.getMenuButton(item);
    if (!menuBtn) {
      throw new Error('Could not find action menu button');
    }
    simulateClick(menuBtn);
    await delay(500, 1000);

    // Step 2: Click the delete/remove option
    let deleteOption;
    if (currentCategory === 'reactions') {
      deleteOption = SC_SELECTORS.getMenuOption('remove') || SC_SELECTORS.getMenuOption('unlike');
    } else {
      deleteOption = SC_SELECTORS.getMenuOption('delete');
    }

    if (!deleteOption) {
      // Close menu and report failure
      document.body.click();
      throw new Error('Could not find delete/remove option in menu');
    }
    simulateClick(deleteOption);
    await delay(500, 1000);

    // Step 3: Confirm dialog if present
    try {
      const confirmBtn = await waitFor(() => SC_SELECTORS.getConfirmButton(), 3000);
      if (confirmBtn) {
        simulateClick(confirmBtn);
        await delay(500, 1000);
      }
    } catch {
      // No confirmation dialog — that's fine, some actions don't require confirmation
    }
  }

  // Process a single post — handle photo download before deletion
  async function processPost(item) {
    const hasPhoto = SC_SELECTORS.itemHasPhoto(item);

    if (hasPhoto) {
      const photoUrls = SC_SELECTORS.getPhotoUrls(item);
      const postId = SC_SELECTORS.getItemId(item);
      const postDate = SC_SELECTORS.getItemDate(item);

      if (photoUrls.length > 0) {
        // Request background to download photos
        const response = await chrome.runtime.sendMessage(
          createMessage(SC_MESSAGES.PHOTO_FOUND, {
            urls: photoUrls,
            postId,
            postDate,
          })
        );

        if (!response || !response.allSuccess) {
          console.warn('Some photos failed to download, proceeding with deletion anyway');
        }
      }
    }

    await deleteItem(item);

    const description = item.textContent.trim().substring(0, 50);
    await chrome.runtime.sendMessage(
      createMessage(SC_MESSAGES.ITEM_DELETED, {
        category: 'posts',
        description,
        hadPhoto: hasPhoto,
      })
    );
  }

  // Process a single comment
  async function processComment(item) {
    await deleteItem(item);
    const description = item.textContent.trim().substring(0, 50);
    await chrome.runtime.sendMessage(
      createMessage(SC_MESSAGES.ITEM_DELETED, {
        category: 'comments',
        description,
      })
    );
  }

  // Process a single reaction
  async function processReaction(item) {
    await deleteItem(item);
    const description = item.textContent.trim().substring(0, 50);
    await chrome.runtime.sendMessage(
      createMessage(SC_MESSAGES.ITEM_DELETED, {
        category: 'reactions',
        description,
      })
    );
  }

  // Main cleanup loop
  async function runCleanupLoop() {
    isRunning = true;
    currentCategory = detectCategory();

    if (!currentCategory) {
      console.error('Social Cleanup: Cannot determine category from URL');
      return;
    }

    console.log(`Social Cleanup: Starting ${currentCategory} cleanup`);

    let noNewItemsCount = 0;

    while (isRunning && !isPaused) {
      const items = SC_SELECTORS.getActivityItems();

      if (items.length === 0) {
        // Try scrolling to load more
        SC_SELECTORS.scrollToLoadMore();
        const loaded = await waitForMutation(3000);

        if (!loaded || SC_SELECTORS.isEndOfList()) {
          noNewItemsCount++;
          if (noNewItemsCount >= 3) {
            // Truly done with this category
            console.log(`Social Cleanup: No more ${currentCategory} to process`);
            await chrome.runtime.sendMessage(
              createMessage(SC_MESSAGES.CATEGORY_COMPLETE, { category: currentCategory })
            );
            isRunning = false;
            return;
          }
          await delay(2000, 3000);
          continue;
        }
        noNewItemsCount = 0;
        continue;
      }

      noNewItemsCount = 0;

      // Process the first item (items shift as we delete)
      const item = items[0];

      try {
        switch (currentCategory) {
          case 'posts':
            await processPost(item);
            break;
          case 'comments':
            await processComment(item);
            break;
          case 'reactions':
            await processReaction(item);
            break;
        }
      } catch (err) {
        console.warn(`Social Cleanup: Error processing item:`, err.message);
        await chrome.runtime.sendMessage(
          createMessage(SC_MESSAGES.ACTION_ERROR, { error: err.message })
        );

        // If we can't process this item, try to skip it by scrolling past
        // or break if we're stuck
        if (items.length === 1) {
          SC_SELECTORS.scrollToLoadMore();
          await waitForMutation(3000);
        }
      }

      // Random delay between actions
      await delay();
    }
  }

  // Listen for messages from background
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    switch (message.type) {
      case SC_MESSAGES.START_CLEANUP:
        isPaused = false;
        if (!isRunning) {
          runCleanupLoop();
        }
        sendResponse({ ok: true });
        break;

      case SC_MESSAGES.PAUSE_CLEANUP:
        isPaused = true;
        sendResponse({ ok: true });
        break;

      case SC_MESSAGES.RESUME_CLEANUP:
        isPaused = false;
        if (!isRunning) {
          runCleanupLoop();
        }
        sendResponse({ ok: true });
        break;

      default:
        sendResponse({ error: 'Unknown message' });
    }
    return true;
  });

  // Auto-start if navigated here by the extension
  // Wait a moment for the page to fully render, then notify background we're ready
  setTimeout(async () => {
    try {
      const state = await chrome.runtime.sendMessage(createMessage(SC_MESSAGES.GET_STATE));
      if (state && state.status === SC_CONSTANTS.STATUS.RUNNING) {
        console.log('Social Cleanup: Page loaded, auto-starting cleanup');
        runCleanupLoop();
      }
    } catch {
      // Extension context may have been invalidated
    }
  }, 2000);
})();
```

- [ ] **Step 3: Verify content script injects on Activity Log**

1. Reload extension
2. Navigate to `https://www.facebook.com/allactivity?activity_history=false&category_key=POSTSYOUVEWRITTEN`
3. Open DevTools console
4. Should see no errors. Type `SC_SELECTORS` — should be defined
5. Type `SC_SELECTORS.getActivityItems()` — should return an array (possibly empty if activity log layout differs)

- [ ] **Step 4: Commit**

```bash
git add content/
git commit -m "feat: add content script with selectors, DOM interaction, and cleanup loop"
```

---

### Task 4: Content Script — Category Modules

**Files:**
- Create: `content/posts.js`
- Create: `content/comments.js`
- Create: `content/reactions.js`

These modules are thin wrappers — the main logic is already in `content.js`. These exist to hold any category-specific selector overrides or special handling that emerges during testing.

- [ ] **Step 1: Create posts.js**

```js
// content/posts.js
// Post-specific helpers for the cleanup content script

const SC_POSTS = {
  // Check if a post item is a photo/video post that needs downloading
  needsPhotoDownload(item) {
    return SC_SELECTORS.itemHasPhoto(item);
  },

  // Extract all downloadable media from a post
  extractMedia(item) {
    const photos = SC_SELECTORS.getPhotoUrls(item);
    const postId = SC_SELECTORS.getItemId(item);
    const postDate = SC_SELECTORS.getItemDate(item);

    // Also check for video thumbnails (we save the thumbnail as a reference)
    const videos = [];
    const videoEls = item.querySelectorAll('video[src], video source[src]');
    for (const v of videoEls) {
      const src = v.src || v.getAttribute('src');
      if (src) videos.push(src);
    }

    return {
      photos,
      videos,
      allUrls: [...photos, ...videos],
      postId,
      postDate,
    };
  },

  // Get a human-readable description of the post
  describe(item) {
    const text = item.textContent.trim();
    const hasPhoto = SC_SELECTORS.itemHasPhoto(item);
    const preview = text.substring(0, 60).replace(/\s+/g, ' ');
    return hasPhoto ? `[Photo] ${preview}` : preview;
  },
};

if (typeof globalThis !== 'undefined') {
  globalThis.SC_POSTS = SC_POSTS;
}
```

- [ ] **Step 2: Create comments.js**

```js
// content/comments.js
// Comment-specific helpers

const SC_COMMENTS = {
  // Get the text of the comment for logging
  describe(item) {
    const text = item.textContent.trim();
    return text.substring(0, 60).replace(/\s+/g, ' ');
  },

  // Comments sometimes have a different delete flow — "Delete comment" vs "Delete"
  getDeleteText() {
    return ['delete comment', 'delete'];
  },
};

if (typeof globalThis !== 'undefined') {
  globalThis.SC_COMMENTS = SC_COMMENTS;
}
```

- [ ] **Step 3: Create reactions.js**

```js
// content/reactions.js
// Reaction-specific helpers

const SC_REACTIONS = {
  // Describe the reaction for logging
  describe(item) {
    const text = item.textContent.trim();
    return text.substring(0, 60).replace(/\s+/g, ' ');
  },

  // Reactions use "Remove" or "Unlike" instead of "Delete"
  getRemoveText() {
    return ['remove reaction', 'remove', 'unlike'];
  },
};

if (typeof globalThis !== 'undefined') {
  globalThis.SC_REACTIONS = SC_REACTIONS;
}
```

- [ ] **Step 4: Commit**

```bash
git add content/posts.js content/comments.js content/reactions.js
git commit -m "feat: add category-specific helper modules for posts, comments, reactions"
```

---

### Task 5: Popup UI

**Files:**
- Create: `popup/popup.html`
- Create: `popup/popup.css`
- Create: `popup/popup.js`

- [ ] **Step 1: Create popup.html**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <link rel="stylesheet" href="popup.css">
</head>
<body>
  <div class="container">
    <h1>Social Cleanup</h1>
    <p class="subtitle">Facebook Activity Cleaner</p>

    <div id="status-bar" class="status idle">
      <span id="status-icon">●</span>
      <span id="status-text">Idle</span>
    </div>

    <div class="categories">
      <label><input type="checkbox" id="cat-posts" checked> Posts</label>
      <label><input type="checkbox" id="cat-comments" checked> Comments</label>
      <label><input type="checkbox" id="cat-reactions" checked> Reactions</label>
    </div>

    <div class="controls">
      <button id="btn-start" class="btn btn-primary">Start Cleanup</button>
      <button id="btn-pause" class="btn btn-warning" hidden>Pause</button>
      <button id="btn-resume" class="btn btn-primary" hidden>Resume</button>
      <button id="btn-stop" class="btn btn-danger" hidden>Stop</button>
    </div>

    <div class="stats" id="stats" hidden>
      <div class="stat-row">
        <span class="stat-label">Posts deleted:</span>
        <span id="stat-posts">0</span>
        <span class="stat-sub">(<span id="stat-photos">0</span> photos saved)</span>
      </div>
      <div class="stat-row">
        <span class="stat-label">Comments deleted:</span>
        <span id="stat-comments">0</span>
      </div>
      <div class="stat-row">
        <span class="stat-label">Reactions removed:</span>
        <span id="stat-reactions">0</span>
      </div>
    </div>

    <div class="log-container" id="log-container" hidden>
      <h3>Activity Log</h3>
      <div id="log" class="log"></div>
    </div>
  </div>

  <script src="../shared/constants.js"></script>
  <script src="../shared/messages.js"></script>
  <script src="popup.js"></script>
</body>
</html>
```

- [ ] **Step 2: Create popup.css**

```css
/* popup/popup.css */
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

body {
  width: 340px;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  font-size: 13px;
  color: #1a1a2e;
  background: #f8f9fa;
}

.container {
  padding: 16px;
}

h1 {
  font-size: 18px;
  font-weight: 700;
  color: #1a1a2e;
  margin-bottom: 2px;
}

.subtitle {
  font-size: 11px;
  color: #6c757d;
  margin-bottom: 12px;
}

/* Status Bar */
.status {
  padding: 8px 12px;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 600;
  margin-bottom: 12px;
  display: flex;
  align-items: center;
  gap: 6px;
}

.status.idle { background: #e9ecef; color: #495057; }
.status.running { background: #d4edda; color: #155724; }
.status.paused { background: #fff3cd; color: #856404; }
.status.rate_limited { background: #f8d7da; color: #721c24; }
.status.complete { background: #cce5ff; color: #004085; }
.status.error { background: #f8d7da; color: #721c24; }

/* Categories */
.categories {
  display: flex;
  gap: 12px;
  margin-bottom: 12px;
}

.categories label {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  cursor: pointer;
}

/* Buttons */
.controls {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
}

.btn {
  padding: 8px 16px;
  border: none;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  flex: 1;
  transition: opacity 0.15s;
}

.btn:hover { opacity: 0.85; }
.btn:disabled { opacity: 0.5; cursor: not-allowed; }

.btn-primary { background: #4361ee; color: white; }
.btn-warning { background: #f59e0b; color: white; }
.btn-danger { background: #ef4444; color: white; }

/* Stats */
.stats {
  background: white;
  border-radius: 6px;
  padding: 10px 12px;
  margin-bottom: 12px;
  border: 1px solid #e9ecef;
}

.stat-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 3px 0;
  font-size: 12px;
}

.stat-label {
  color: #6c757d;
}

.stat-sub {
  color: #adb5bd;
  font-size: 11px;
}

/* Log */
.log-container h3 {
  font-size: 12px;
  color: #6c757d;
  margin-bottom: 6px;
}

.log {
  max-height: 180px;
  overflow-y: auto;
  background: white;
  border: 1px solid #e9ecef;
  border-radius: 6px;
  padding: 8px;
}

.log-entry {
  font-size: 11px;
  color: #495057;
  padding: 2px 0;
  border-bottom: 1px solid #f1f3f5;
}

.log-entry:last-child {
  border-bottom: none;
}

.log-time {
  color: #adb5bd;
  margin-right: 6px;
}
```

- [ ] **Step 3: Create popup.js**

```js
// popup/popup.js

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
};

// Send message to background
function send(type, payload = {}) {
  return chrome.runtime.sendMessage(createMessage(type, payload));
}

// Update UI from state
function updateUI(state) {
  if (!state) return;

  // Status bar
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

  // Buttons
  const isIdle = status === SC_CONSTANTS.STATUS.IDLE || status === SC_CONSTANTS.STATUS.COMPLETE;
  const isRunning = status === SC_CONSTANTS.STATUS.RUNNING || status === SC_CONSTANTS.STATUS.RATE_LIMITED;
  const isPaused = status === SC_CONSTANTS.STATUS.PAUSED;

  elements.btnStart.hidden = !isIdle;
  elements.btnPause.hidden = !isRunning;
  elements.btnResume.hidden = !isPaused;
  elements.btnStop.hidden = isIdle;

  // Disable category checkboxes while running
  elements.catPosts.disabled = !isIdle;
  elements.catComments.disabled = !isIdle;
  elements.catReactions.disabled = !isIdle;

  // Stats
  if (state.categories) {
    elements.stats.hidden = false;
    elements.statPosts.textContent = state.categories.posts.deleted;
    elements.statPhotos.textContent = state.categories.posts.photosSaved;
    elements.statComments.textContent = state.categories.comments.deleted;
    elements.statReactions.textContent = state.categories.reactions.deleted;
  }

  // Activity log
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

// Button handlers
elements.btnStart.addEventListener('click', async () => {
  const categories = {
    posts: elements.catPosts.checked,
    comments: elements.catComments.checked,
    reactions: elements.catReactions.checked,
  };
  const state = await send(SC_MESSAGES.USER_START, { categories });
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

// Listen for state broadcasts from background
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === SC_MESSAGES.STATE_UPDATE) {
    updateUI(message.payload);
  }
});

// Initial load
send(SC_MESSAGES.GET_STATE).then(updateUI);

// Poll for updates (backup in case messages are missed)
setInterval(async () => {
  const state = await send(SC_MESSAGES.GET_STATE);
  updateUI(state);
}, 2000);
```

- [ ] **Step 4: Verify popup renders and connects to background**

1. Reload extension
2. Click the extension icon — popup should appear with "Idle" status
3. Check/uncheck category boxes — should be responsive
4. Open DevTools on the popup (right-click popup > Inspect)
5. Verify no console errors
6. Verify GET_STATE returns the default state

- [ ] **Step 5: Commit**

```bash
git add popup/
git commit -m "feat: add popup UI with controls, stats display, and activity log"
```

---

### Task 6: Integration — Wire Up Background Tab Navigation

**Files:**
- Modify: `background/background.js`

The background script needs to detect when the content script is ready on a newly navigated Activity Log page and send it the START_CLEANUP command.

- [ ] **Step 1: Add tab update listener to background.js**

Add this to `background/background.js` before the `loadState()` call at the bottom:

```js
// When the Activity Log tab finishes loading, tell content script to start
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (tabId !== state.activeTabId) return;
  if (changeInfo.status !== 'complete') return;
  if (state.status !== SC_CONSTANTS.STATUS.RUNNING) return;

  // Give the page a moment to render its content
  setTimeout(() => {
    chrome.tabs.sendMessage(tabId, createMessage(SC_MESSAGES.START_CLEANUP)).catch(() => {
      // Content script may not be injected yet — the content script's auto-start will handle it
    });
  }, 3000);
});
```

- [ ] **Step 2: Verify end-to-end flow**

1. Reload extension
2. Click extension icon
3. Check "Posts" only (uncheck Comments and Reactions for testing)
4. Click "Start Cleanup"
5. Verify:
   - Status changes to "Running"
   - A new tab opens to the Posts Activity Log URL
   - Content script begins attempting to find and process items
   - Activity log in popup shows entries
6. Click "Pause" — verify it stops
7. Click "Resume" — verify it continues
8. Click "Stop" — verify it resets

- [ ] **Step 3: Commit**

```bash
git add background/background.js
git commit -m "feat: wire up tab navigation listener for content script auto-start"
```

---

### Task 7: Selector Tuning and Real-World Testing

**Files:**
- Modify: `content/selectors.js`

Facebook's DOM is notoriously dynamic. This task is about loading the actual Activity Log pages and tuning selectors to match the real DOM structure.

- [ ] **Step 1: Inspect the real Activity Log DOM**

1. Log into Facebook
2. Navigate to `https://www.facebook.com/allactivity?activity_history=false&category_key=POSTSYOUVEWRITTEN`
3. Open DevTools and inspect the structure:
   - What element wraps each activity item?
   - What does the "..." menu button look like (tag, attributes)?
   - What does the delete option look like in the dropdown?
   - What does the confirmation dialog look like?
4. Do the same for Comments and Reactions pages

Document findings and update selectors accordingly.

- [ ] **Step 2: Update selectors.js based on real DOM inspection**

Update `SC_SELECTORS` methods to match the actual Facebook DOM structure observed in Step 1. The current selectors are best-guess starting points — they will almost certainly need adjustment.

Key areas to verify and fix:
- `getActivityItems()` — does `[role="listitem"]` or `[role="row"]` match?
- `getMenuButton()` — is it `[aria-haspopup="menu"]` or something else?
- `getMenuOption()` — is it `[role="menuitem"]` or a different structure?
- `getConfirmButton()` — does the dialog use `[role="dialog"]`?
- `itemHasPhoto()` — do Activity Log items show photo thumbnails inline?

- [ ] **Step 3: Test deletion of one item manually**

1. In DevTools console on the Activity Log page, run:
   ```js
   const items = SC_SELECTORS.getActivityItems();
   console.log('Found items:', items.length);
   console.log('First item:', items[0]?.textContent?.substring(0, 100));
   ```
2. Verify items are found
3. Test menu button detection:
   ```js
   SC_SELECTORS.getMenuButton(items[0])
   ```
4. If working, try a manual single-item delete via the content script

- [ ] **Step 4: Commit updated selectors**

```bash
git add content/selectors.js
git commit -m "fix: tune Activity Log selectors to match actual Facebook DOM structure"
```

---

### Task 8: Photo Detection and Download Testing

**Files:**
- Modify: `content/selectors.js` (if photo detection needs tuning)
- Modify: `background/background.js` (if download logic needs adjustment)

- [ ] **Step 1: Test photo detection on real posts**

1. Navigate to Posts Activity Log
2. Find a post you know has a photo
3. In console:
   ```js
   const items = SC_SELECTORS.getActivityItems();
   const photoItem = items.find(item => SC_SELECTORS.itemHasPhoto(item));
   console.log('Photo item found:', !!photoItem);
   console.log('Photo URLs:', SC_SELECTORS.getPhotoUrls(photoItem));
   ```
4. Verify photo URLs are valid by opening one in a new tab

- [ ] **Step 2: Test photo download via background**

1. With a photo URL from Step 1, test the download in the background console:
   ```js
   chrome.downloads.download({
     url: 'THE_PHOTO_URL',
     filename: 'FacebookBackup/test_photo.jpg',
     conflictAction: 'uniquify'
   });
   ```
2. Verify the file downloads to `Downloads/FacebookBackup/test_photo.jpg`

- [ ] **Step 3: Test full post-with-photo flow**

1. Start the cleanup targeting just Posts
2. Verify that when it hits a photo post:
   - Photo(s) download to `FacebookBackup/` directory
   - Post is deleted after download completes
   - Stats show photos saved count incrementing
3. Check the downloaded files have correct naming format

- [ ] **Step 4: Commit any fixes**

```bash
git add content/ background/
git commit -m "fix: tune photo detection and download flow for real Facebook posts"
```

---

### Task 9: Polish and Edge Cases

**Files:**
- Modify: `content/content.js`
- Modify: `background/background.js`
- Modify: `popup/popup.js`

- [ ] **Step 1: Handle "no items" edge case**

In `content/content.js`, the Activity Log may show a "You have no activity to review" message when empty. Update the end-of-list detection:

Add to `SC_SELECTORS.isEndOfList()` in `content/selectors.js`:

```js
// Also check for empty state messages
const bodyText = document.body.textContent.toLowerCase();
if (bodyText.includes('no activity to review') || bodyText.includes('nothing to show')) {
  return true;
}
```

- [ ] **Step 2: Handle stale element references**

When an item is deleted, the DOM changes. Add error recovery in the main loop in `content/content.js` — if a `deleteItem` call fails with a stale element, just refresh the items list and continue:

In the catch block of the main loop, add:

```js
catch (err) {
  console.warn(`Social Cleanup: Error processing item:`, err.message);

  // Check if element was already removed (stale reference)
  if (err.message.includes('not attached') || err.message.includes('stale')) {
    continue; // Item was already deleted, move on
  }

  await chrome.runtime.sendMessage(
    createMessage(SC_MESSAGES.ACTION_ERROR, { error: err.message })
  );

  // Try scrolling past problematic item
  if (items.length === 1) {
    SC_SELECTORS.scrollToLoadMore();
    await waitForMutation(3000);
  }
}
```

- [ ] **Step 3: Add backoff countdown to popup**

In `popup/popup.js`, update the polling interval to refresh the backoff countdown more frequently when rate-limited:

Replace the setInterval at the bottom:

```js
// Poll for updates — faster when rate-limited for countdown display
let pollInterval = setInterval(async () => {
  try {
    const state = await send(SC_MESSAGES.GET_STATE);
    updateUI(state);

    // Adjust poll rate based on status
    const newRate = state.status === SC_CONSTANTS.STATUS.RATE_LIMITED ? 1000 : 2000;
    if (newRate !== currentPollRate) {
      currentPollRate = newRate;
      clearInterval(pollInterval);
      pollInterval = setInterval(arguments.callee, newRate);
    }
  } catch { /* popup closing */ }
}, 2000);
let currentPollRate = 2000;
```

- [ ] **Step 4: Test full end-to-end run**

1. Reload extension
2. Start cleanup with all three categories enabled
3. Let it run through several items in each category
4. Verify:
   - Posts with photos get downloaded before deletion
   - Text posts get deleted immediately
   - Comments get deleted
   - Reactions get removed
   - Transitions between categories work
   - Stats update in popup
   - Activity log shows entries
5. Test pause/resume mid-run
6. Test closing and reopening the browser — should show "Paused" state

- [ ] **Step 5: Commit**

```bash
git add content/ background/ popup/
git commit -m "fix: handle edge cases — stale elements, empty state, backoff countdown"
```

---

### Task 10: Final Cleanup and README

**Files:**
- Modify: `manifest.json` (if any permission changes needed)
- Create: `README.md`

- [ ] **Step 1: Create README.md**

```markdown
# Social Cleanup

Chrome extension that bulk-deletes your Facebook posts, comments, and reactions via the Activity Log. Automatically downloads photos before deleting posts that contain them.

## Features

- **Posts**: Detects photos, downloads them to `Downloads/FacebookBackup/`, then deletes the post
- **Comments**: Removes all your comments from other people's posts
- **Reactions**: Removes all your likes, loves, and other reactions
- **Unattended**: Runs in the background with automatic rate-limit handling
- **Resumable**: Saves progress — survives browser restarts

## Install

1. Clone this repo
2. Open `chrome://extensions/`
3. Enable "Developer mode" (top right)
4. Click "Load unpacked"
5. Select the `social-cleanup/` folder

## Usage

1. Log into Facebook in Chrome
2. Click the Social Cleanup extension icon
3. Select which categories to clean (Posts, Comments, Reactions)
4. Click "Start Cleanup"
5. The extension opens your Activity Log and begins deleting items
6. Monitor progress in the popup — or just let it run

## How It Works

The extension navigates to Facebook's Activity Log filtered views and programmatically clicks through the delete flow for each item. It uses randomized delays (2-5s) between actions and exponential backoff on rate limits.

Photos are downloaded via Chrome's downloads API to `Downloads/FacebookBackup/` with filenames like `2024-03-15_postid_1.jpg`.

## Notes

- Facebook's UI changes frequently. Selectors in `content/selectors.js` may need updating.
- The extension processes items from newest to oldest (Activity Log default order).
- Rate limiting kicks in after 3 consecutive failures, backing off 30s → 60s → 120s.
- Progress persists in `chrome.storage.local` — you can close Chrome and resume later.
```

- [ ] **Step 2: Verify final extension state**

1. Reload extension one final time
2. Verify no console errors in background worker or content script
3. Verify popup loads cleanly
4. Run a short cleanup (pause after a few items) to confirm everything works

- [ ] **Step 3: Commit**

```bash
git add README.md manifest.json
git commit -m "docs: add README with install and usage instructions"
```
