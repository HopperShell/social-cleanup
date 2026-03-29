// content/posts.js
const SC_POSTS = {
  describe(item) {
    const text = item.textContent.trim();
    const preview = text.substring(0, 60).replace(/\s+/g, ' ');
    return preview;
  },
};

if (typeof globalThis !== 'undefined') {
  globalThis.SC_POSTS = SC_POSTS;
}
