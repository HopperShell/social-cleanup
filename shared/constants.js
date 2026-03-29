// shared/constants.js
const SC_CONSTANTS = {
  URLS: {
    POSTS: 'https://www.facebook.com/me/allactivity?entry_point=profile_shortcut&category_key=statuscluster',
    COMMENTS: 'https://www.facebook.com/me/allactivity?entry_point=profile_shortcut&category_key=commentscluster',
    REACTIONS: 'https://www.facebook.com/me/allactivity?entry_point=profile_shortcut&category_key=likes',
  },
  CATEGORIES: ['posts', 'comments', 'reactions'],
  TIMING: {
    MIN_DELAY: 500,
    MAX_DELAY: 1200,
    MUTATION_WAIT: 1000,
    BACKOFF_BASE: 30000,
    BACKOFF_MAX: 120000,
  },
  STATUS: {
    IDLE: 'idle',
    RUNNING: 'running',
    PAUSED: 'paused',
    RATE_LIMITED: 'rate_limited',
    COMPLETE: 'complete',
    ERROR: 'error',
  },
  MAX_CONSECUTIVE_FAILURES: 3,
  STORAGE_KEY: 'socialCleanupState',
};

if (typeof globalThis !== 'undefined') {
  globalThis.SC_CONSTANTS = SC_CONSTANTS;
}
