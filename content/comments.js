// content/comments.js
const SC_COMMENTS = {
  describe(item) {
    const text = item.textContent.trim();
    return text.substring(0, 60).replace(/\s+/g, ' ');
  },

  getDeleteText() {
    return ['delete comment', 'delete'];
  },
};

if (typeof globalThis !== 'undefined') {
  globalThis.SC_COMMENTS = SC_COMMENTS;
}
