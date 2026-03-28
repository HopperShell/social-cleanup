// content/reactions.js
const SC_REACTIONS = {
  describe(item) {
    const text = item.textContent.trim();
    return text.substring(0, 60).replace(/\s+/g, ' ');
  },

  getRemoveText() {
    return ['remove reaction', 'remove', 'unlike'];
  },
};

if (typeof globalThis !== 'undefined') {
  globalThis.SC_REACTIONS = SC_REACTIONS;
}
