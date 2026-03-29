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
    // Cache for 5 seconds — only invalidate if element is gone or lost its children
    if (this._containerCache && Date.now() - this._containerCacheTime < 5000) {
      if (document.contains(this._containerCache) && this._containerCache.children.length > 5) {
        return this._containerCache;
      }
    }

    const root = document.querySelector('[aria-label="Activity Log Item"]');
    if (!root) return null;

    // Walk down looking for the div with MANY children (the actual item list)
    // After a deletion, React may re-render and add intermediate wrappers,
    // so we need to find the level with the most children, not just the first branch.
    let best = null;
    let bestCount = 0;

    function walk(el, depth) {
      if (depth > 15) return;
      if (!el.children) return;
      if (el.children.length > bestCount) {
        best = el;
        bestCount = el.children.length;
      }
      // If we already found a huge container, stop
      if (bestCount > 50) return;
      // Walk into children — but only first child if this isn't a branch
      if (el.children.length <= 3) {
        for (const child of el.children) {
          walk(child, depth + 1);
        }
      }
    }

    walk(root, 0);

    if (best && bestCount > 5) {
      this._containerCache = best;
      this._containerCacheTime = Date.now();
      return best;
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
  // Searches ALL dialogs on the page since Facebook may have multiple
  // (e.g., Notifications dialog) and querySelector only returns the first
  getConfirmButton() {
    const dialogs = document.querySelectorAll('[role="dialog"]');
    if (!dialogs.length) return null;

    const confirmTexts = ['move to trash', 'delete', 'confirm', 'remove', 'continue'];

    // First pass: find a dialog with an explicit confirm action button
    for (const dialog of dialogs) {
      const buttons = dialog.querySelectorAll('[role="button"], button');
      for (const btn of buttons) {
        const text = btn.textContent.trim().toLowerCase();
        if (confirmTexts.some(t => text.includes(t))) {
          return btn;
        }
      }
    }
    // Fallback: any dialog with a non-Cancel button
    for (const dialog of dialogs) {
      const buttons = dialog.querySelectorAll('[role="button"], button');
      for (const btn of buttons) {
        const text = btn.textContent.trim().toLowerCase();
        if (text !== 'cancel' && text !== 'close' && text.length > 0) {
          return btn;
        }
      }
    }
    return null;
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
