// content/selectors.js
// Facebook Activity Log DOM selectors — tuned to real 2025/2026 Facebook markup
// The Activity Log lives inside [aria-label="Activity Log Item"] > ... > div with many children.
// Child 0 is the "Activity log" header, children 1+ are date-grouped activity entries.

const SC_SELECTORS = {
  // Cache the activity container reference
  _containerCache: null,
  _containerCacheTime: 0,

  // Find the activity log container (the div with many children inside [aria-label="Activity Log Item"])
  getContainer() {
    // Cache for 2 seconds to avoid repeated DOM walks
    if (this._containerCache && Date.now() - this._containerCacheTime < 2000) {
      if (document.contains(this._containerCache)) return this._containerCache;
    }

    const root = document.querySelector('[aria-label="Activity Log Item"]');
    if (!root) return null;

    // Walk down single-child divs until we find the branching point
    let current = root;
    for (let i = 0; i < 20; i++) {
      if (!current.children || current.children.length === 0) break;
      if (current.children.length > 1) {
        this._containerCache = current;
        this._containerCacheTime = Date.now();
        return current;
      }
      current = current.children[0];
    }
    return null;
  },

  // Get activity items (skip the first child which is the "Activity log" header)
  getActivityItems() {
    const container = this.getContainer();
    if (!container) return [];

    return Array.from(container.children).filter((child, index) => {
      // Skip the header (first child, usually just says "Activity log")
      if (index === 0 && child.textContent.trim().length < 30) return false;
      // Each real item has a "More options for..." button
      const hasMenu = child.querySelector('[aria-label^="More options for"]');
      return !!hasMenu;
    });
  },

  // Find the "More options for..." menu button on an activity item
  getMenuButton(item) {
    return item.querySelector('[aria-label^="More options for"]');
  },

  // Find a menu option by text content (e.g., "Delete", "Move to trash", "Remove")
  getMenuOption(text) {
    // Check for role="menuitem" first
    const menuItems = document.querySelectorAll('[role="menuitem"], [role="option"]');
    for (const el of menuItems) {
      if (el.textContent.trim().toLowerCase().includes(text.toLowerCase())) {
        return el;
      }
    }
    // Fallback: search in any visible menu/popover
    const allSpans = document.querySelectorAll('[role="menu"] span, [role="listbox"] span, [role="dialog"] span');
    for (const span of allSpans) {
      if (span.textContent.trim().toLowerCase().includes(text.toLowerCase())) {
        return span.closest('[role="menuitem"]') || span.closest('[tabindex]') || span;
      }
    }
    return null;
  },

  // Find confirmation dialog and its confirm button
  getConfirmButton() {
    const dialog = document.querySelector('[role="dialog"]');
    if (!dialog) return null;
    // Look for buttons and anything clickable in the dialog
    const buttons = dialog.querySelectorAll('[role="button"], button');
    for (const btn of buttons) {
      const text = btn.textContent.trim().toLowerCase();
      if (text.includes('move to trash') || text.includes('delete') ||
          text.includes('confirm') || text.includes('remove') || text.includes('continue')) {
        return btn;
      }
    }
    // Fallback: look for the primary/blue styled button (not "Cancel")
    for (const btn of buttons) {
      const text = btn.textContent.trim().toLowerCase();
      if (text !== 'cancel' && text !== 'close' && text.length > 0) {
        return btn;
      }
    }
    return null;
  },

  // Check if an activity item contains photos
  // Activity items with photos have text like "added a new photo" or "added X new photos"
  itemHasPhoto(item) {
    const text = item.textContent.trim().toLowerCase();
    if (text.includes('added a new photo') || text.includes('added new photo') ||
        text.includes('new photos') || text.includes('added a photo') ||
        text.includes('updated his profile picture') || text.includes('updated her profile picture') ||
        text.includes('updated his cover photo') || text.includes('updated her cover photo')) {
      return true;
    }
    // Also check for actual images (not icons/avatars)
    const imgs = item.querySelectorAll('img');
    for (const img of imgs) {
      const src = img.src || '';
      if ((src.includes('scontent') || src.includes('fbcdn')) &&
          img.width > 60 && img.height > 60) {
        return true;
      }
    }
    return false;
  },

  // Extract photo URLs from an item
  getPhotoUrls(item) {
    const urls = [];
    const imgs = item.querySelectorAll('img');
    for (const img of imgs) {
      const src = img.src || '';
      if ((src.includes('scontent') || src.includes('fbcdn')) &&
          img.width > 60 && img.height > 60) {
        const highRes = src.replace(/\/[sp]\d+x\d+\//, '/').replace(/&width=\d+/, '');
        urls.push(highRes);
      }
    }
    return urls;
  },

  // Extract a post ID from a "View" link
  getItemId(item) {
    const links = item.querySelectorAll('a[href]');
    for (const link of links) {
      const href = link.href;
      // Match /posts/XXXXX or /pfbid0XXXXX patterns
      const match = href.match(/\/posts\/(pfbid[A-Za-z0-9]+)/)
        || href.match(/\/posts\/(\d+)/)
        || href.match(/story_fbid=(\d+)/)
        || href.match(/\/(\d{10,})/);
      if (match) return match[1];
    }
    return 'post_' + Date.now();
  },

  // Extract date from the activity item text
  // Items start with date like "March 27, 2026" or "March 21, 2026"
  getItemDate(item) {
    const text = item.textContent.trim();
    // Match patterns like "March 27, 2026" or "Jan 5, 2020"
    const dateMatch = text.match(/^(\w+ \d{1,2}, \d{4})/);
    if (dateMatch) {
      try {
        return new Date(dateMatch[1]).toISOString().split('T')[0];
      } catch { /* fall through */ }
    }
    // Also try matching dates elsewhere in the text
    const anyDateMatch = text.match(/(\w+ \d{1,2}, \d{4})/);
    if (anyDateMatch) {
      try {
        return new Date(anyDateMatch[1]).toISOString().split('T')[0];
      } catch { /* fall through */ }
    }
    return new Date().toISOString().split('T')[0];
  },

  // Check if we've scrolled to the end
  isEndOfList() {
    const endIndicators = document.querySelectorAll('[role="status"]');
    for (const el of endIndicators) {
      const text = el.textContent.toLowerCase();
      if (text.includes('no more') || text.includes('end of') || text.includes("you're all caught up")) {
        return true;
      }
    }
    const bodyText = document.body.textContent.toLowerCase();
    if (bodyText.includes('no activity to review') || bodyText.includes('nothing to show')) {
      return true;
    }
    return false;
  },

  scrollToLoadMore() {
    window.scrollTo(0, document.body.scrollHeight);
  },
};

if (typeof globalThis !== 'undefined') {
  globalThis.SC_SELECTORS = SC_SELECTORS;
}
