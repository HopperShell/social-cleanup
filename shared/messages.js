// shared/messages.js
const SC_MESSAGES = {
  START_CLEANUP: 'START_CLEANUP',
  PAUSE_CLEANUP: 'PAUSE_CLEANUP',
  RESUME_CLEANUP: 'RESUME_CLEANUP',
  ITEM_DELETED: 'ITEM_DELETED',
  CATEGORY_COMPLETE: 'CATEGORY_COMPLETE',
  ACTION_ERROR: 'ACTION_ERROR',
  PROGRESS_UPDATE: 'PROGRESS_UPDATE',
  STATE_UPDATE: 'STATE_UPDATE',
  GET_STATE: 'GET_STATE',
  USER_START: 'USER_START',
  USER_PAUSE: 'USER_PAUSE',
  USER_RESUME: 'USER_RESUME',
  USER_STOP: 'USER_STOP',
  DUMP_DEBUG: 'DUMP_DEBUG',
  DEBUG_REPORT: 'DEBUG_REPORT',
};

function createMessage(type, payload = {}) {
  return { type, payload, timestamp: Date.now() };
}

if (typeof globalThis !== 'undefined') {
  globalThis.SC_MESSAGES = SC_MESSAGES;
  globalThis.createMessage = createMessage;
}
