// content/selectors.js
const SC_SELECTORS = {
  getActivityItems() {
    const items = document.querySelectorAll('[data-visualcompletion="ignore-dynamic"] [role="listitem"]');
    if (items.length > 0) return Array.from(items);
    const rows = document.querySelectorAll('[role="row"]');
    return Array.from(rows).filter(row =>
      row.querySelector('[aria-label]') && row.textContent.trim().length > 0
    );
  },

  getMenuButton(item) {
    const btn = item.querySelector('[aria-haspopup="menu"]')
      || item.querySelector('[aria-label="Action options"]')
      || item.querySelector('[aria-label="More options"]');
    return btn;
  },

  getMenuOption(text) {
    const menuItems = document.querySelectorAll('[role="menuitem"], [role="option"]');
    for (const el of menuItems) {
      if (el.textContent.trim().toLowerCase().includes(text.toLowerCase())) {
        return el;
      }
    }
    const allSpans = document.querySelectorAll('[role="menu"] span, [role="listbox"] span');
    for (const span of allSpans) {
      if (span.textContent.trim().toLowerCase().includes(text.toLowerCase())) {
        return span.closest('[role="menuitem"]') || span.closest('[tabindex]') || span;
      }
    }
    return null;
  },

  getConfirmButton() {
    const dialog = document.querySelector('[role="dialog"]');
    if (!dialog) return null;
    const buttons = dialog.querySelectorAll('[role="button"]');
    for (const btn of buttons) {
      const text = btn.textContent.trim().toLowerCase();
      if (text === 'delete' || text === 'confirm' || text === 'remove' || text === 'continue') {
        return btn;
      }
    }
    return null;
  },

  itemHasPhoto(item) {
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

  getItemId(item) {
    const links = item.querySelectorAll('a[href]');
    for (const link of links) {
      const href = link.href;
      const match = href.match(/\/posts\/(\d+)/) || href.match(/story_fbid=(\d+)/) || href.match(/\/(\d{10,})/);
      if (match) return match[1];
    }
    return 'post_' + Date.now();
  },

  getItemDate(item) {
    const timeEl = item.querySelector('time') || item.querySelector('[data-utime]');
    if (timeEl) {
      const datetime = timeEl.getAttribute('datetime') || timeEl.getAttribute('data-utime');
      if (datetime) {
        try {
          return new Date(datetime).toISOString().split('T')[0];
        } catch { /* fall through */ }
      }
    }
    const text = item.textContent;
    const dateMatch = text.match(/(\w+ \d{1,2}, \d{4})/);
    if (dateMatch) {
      try {
        return new Date(dateMatch[1]).toISOString().split('T')[0];
      } catch { /* fall through */ }
    }
    return new Date().toISOString().split('T')[0];
  },

  isEndOfList() {
    const endIndicators = document.querySelectorAll('[role="status"]');
    for (const el of endIndicators) {
      const text = el.textContent.toLowerCase();
      if (text.includes('no more') || text.includes('end of') || text.includes("you're all caught up")) {
        return true;
      }
    }
    // Also check for empty state messages
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
