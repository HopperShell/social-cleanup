// shared/constants.js
const SC_CONSTANTS = {
  URLS: {
    POSTS: 'https://www.facebook.com/allactivity?activity_history=false&category_key=POSTSYOUVEWRITTEN',
    COMMENTS: 'https://www.facebook.com/allactivity?activity_history=false&category_key=COMMENTSCLIPS',
    REACTIONS: 'https://www.facebook.com/allactivity?activity_history=false&category_key=REACTIONSCLIPS',
  },
  CATEGORIES: ['posts', 'comments', 'reactions'],
  TIMING: {
    MIN_DELAY: 2000,
    MAX_DELAY: 5000,
    MUTATION_WAIT: 1500,
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
  DOWNLOAD_PATH: 'FacebookBackup',
  MAX_CONSECUTIVE_FAILURES: 3,
  STORAGE_KEY: 'socialCleanupState',
};

if (typeof globalThis !== 'undefined') {
  globalThis.SC_CONSTANTS = SC_CONSTANTS;
}
