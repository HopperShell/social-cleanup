// content/posts.js
const SC_POSTS = {
  needsPhotoDownload(item) {
    return SC_SELECTORS.itemHasPhoto(item);
  },

  extractMedia(item) {
    const photos = SC_SELECTORS.getPhotoUrls(item);
    const postId = SC_SELECTORS.getItemId(item);
    const postDate = SC_SELECTORS.getItemDate(item);

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
