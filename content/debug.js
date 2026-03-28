// content/debug.js
// Debug logging — collects DOM diagnostics and sends to background for download

const SC_DEBUG = {
  entries: [],

  log(category, message, data = null) {
    const entry = {
      time: new Date().toISOString(),
      category,
      message,
      data,
    };
    this.entries.push(entry);
    console.log(`[SC Debug] [${category}] ${message}`, data || '');
  },

  // Capture a snapshot of the current page for debugging
  capturePageSnapshot() {
    const snapshot = {
      url: window.location.href,
      title: document.title,
      timestamp: new Date().toISOString(),
      bodyTextLength: document.body.textContent.length,
      // Sample key elements
      roles: {},
      ariaLabels: [],
      dataAttributes: [],
    };

    // Count elements by role
    const roledElements = document.querySelectorAll('[role]');
    for (const el of roledElements) {
      const role = el.getAttribute('role');
      snapshot.roles[role] = (snapshot.roles[role] || 0) + 1;
    }

    // Collect aria-labels (first 50)
    const ariaElements = document.querySelectorAll('[aria-label]');
    for (let i = 0; i < Math.min(ariaElements.length, 50); i++) {
      const el = ariaElements[i];
      snapshot.ariaLabels.push({
        tag: el.tagName.toLowerCase(),
        label: el.getAttribute('aria-label'),
        role: el.getAttribute('role') || null,
        hasPopup: el.getAttribute('aria-haspopup') || null,
      });
    }

    // Collect data-* attributes on key containers (first 30)
    const allElements = document.querySelectorAll('[data-visualcompletion], [data-pagelet], [data-testid]');
    for (let i = 0; i < Math.min(allElements.length, 30); i++) {
      const el = allElements[i];
      const attrs = {};
      for (const attr of el.attributes) {
        if (attr.name.startsWith('data-')) {
          attrs[attr.name] = attr.value;
        }
      }
      snapshot.dataAttributes.push({
        tag: el.tagName.toLowerCase(),
        attrs,
        childCount: el.children.length,
        textPreview: el.textContent.trim().substring(0, 80),
      });
    }

    // Try to find anything that looks like activity items
    const candidates = {
      listItems: document.querySelectorAll('[role="listitem"]').length,
      rows: document.querySelectorAll('[role="row"]').length,
      articles: document.querySelectorAll('[role="article"]').length,
      links: document.querySelectorAll('a[href*="activity"]').length,
      checkboxes: document.querySelectorAll('[role="checkbox"]').length,
      menuButtons: document.querySelectorAll('[aria-haspopup="menu"]').length,
    };
    snapshot.candidates = candidates;

    // Sample the first few of each candidate type
    snapshot.samples = {};
    for (const [name, selector] of [
      ['listItems', '[role="listitem"]'],
      ['rows', '[role="row"]'],
      ['articles', '[role="article"]'],
      ['checkboxes', '[role="checkbox"]'],
    ]) {
      const els = document.querySelectorAll(selector);
      snapshot.samples[name] = [];
      for (let i = 0; i < Math.min(els.length, 3); i++) {
        const el = els[i];
        snapshot.samples[name].push({
          tag: el.tagName.toLowerCase(),
          className: el.className.substring(0, 100),
          childCount: el.children.length,
          textPreview: el.textContent.trim().substring(0, 120),
          innerHTML: el.innerHTML.substring(0, 300),
        });
      }
    }

    // Deep dive into [role="main"] — the actual page content, not sidebar/Messenger
    const mainRegion = document.querySelector('[role="main"]');
    snapshot.mainContent = null;
    if (mainRegion) {
      // Get all direct and near-direct children structure
      const mainChildren = [];
      const walk = (el, depth) => {
        if (depth > 4 || mainChildren.length > 50) return;
        const info = {
          tag: el.tagName?.toLowerCase(),
          role: el.getAttribute?.('role') || null,
          ariaLabel: el.getAttribute?.('aria-label') || null,
          dataTestId: el.getAttribute?.('data-testid') || null,
          childCount: el.children?.length || 0,
          textPreview: el.textContent?.trim()?.substring(0, 80) || '',
          depth,
        };
        // Only include elements that have meaningful content or attributes
        if (info.role || info.ariaLabel || info.dataTestId || info.childCount > 0) {
          mainChildren.push(info);
        }
        if (el.children) {
          for (const child of el.children) {
            walk(child, depth + 1);
          }
        }
      };
      walk(mainRegion, 0);

      // Also look for anything that has text containing activity-related keywords
      const activityKeywords = ['delete', 'trash', 'remove', 'posted', 'shared', 'commented', 'liked', 'reacted'];
      const keywordHits = [];
      const allEls = mainRegion.querySelectorAll('*');
      for (const el of allEls) {
        const text = el.textContent?.trim()?.toLowerCase() || '';
        if (text.length > 5 && text.length < 200) {
          for (const kw of activityKeywords) {
            if (text.includes(kw)) {
              keywordHits.push({
                tag: el.tagName?.toLowerCase(),
                role: el.getAttribute?.('role') || null,
                text: el.textContent?.trim()?.substring(0, 100),
                parentTag: el.parentElement?.tagName?.toLowerCase(),
                parentRole: el.parentElement?.getAttribute?.('role') || null,
              });
              break;
            }
          }
          if (keywordHits.length >= 20) break;
        }
      }

      snapshot.mainContent = {
        tag: mainRegion.tagName?.toLowerCase(),
        role: mainRegion.getAttribute('role'),
        childCount: mainRegion.children.length,
        textLength: mainRegion.textContent.length,
        textPreview: mainRegion.textContent.trim().substring(0, 300),
        structure: mainChildren.slice(0, 30),
        keywordHits,
      };
    }

    // Deep dive into Activity Log items — find the actual post entries
    const activityMain = document.querySelector('[aria-label="Activity Log Item"]')
      || document.querySelector('[role="main"]');
    snapshot.activityItems = [];
    if (activityMain) {
      // Facebook Activity Log items are typically siblings at some depth.
      // Look for repeating div patterns that contain activity text.
      const allDivs = activityMain.querySelectorAll('div');
      const seen = new Set();
      for (const div of allDivs) {
        const text = div.textContent?.trim() || '';
        // Activity items typically start with the user's name and an action
        if (text.length > 20 && text.length < 500 &&
            (text.includes('shared') || text.includes('updated') || text.includes('posted') ||
             text.includes('wrote') || text.includes('added') || text.includes('changed') ||
             text.includes('liked') || text.includes('commented'))) {
          // Avoid duplicates (parent divs contain same text)
          const key = text.substring(0, 80);
          if (seen.has(key)) continue;
          seen.add(key);

          // Get info about this element and its clickable children
          const buttons = div.querySelectorAll('[role="button"], button, [aria-haspopup]');
          const links = div.querySelectorAll('a[href]');
          const imgs = div.querySelectorAll('img');

          snapshot.activityItems.push({
            text: text.substring(0, 200),
            tag: div.tagName.toLowerCase(),
            className: div.className.substring(0, 80),
            parentClassName: div.parentElement?.className?.substring(0, 80) || '',
            childCount: div.children.length,
            depth: getDepth(div, activityMain),
            buttons: Array.from(buttons).slice(0, 5).map(b => ({
              tag: b.tagName.toLowerCase(),
              role: b.getAttribute('role'),
              ariaLabel: b.getAttribute('aria-label'),
              text: b.textContent?.trim()?.substring(0, 50),
              hasPopup: b.getAttribute('aria-haspopup'),
            })),
            links: Array.from(links).slice(0, 3).map(l => ({
              href: l.href.substring(0, 100),
              text: l.textContent?.trim()?.substring(0, 50),
            })),
            imgCount: imgs.length,
            outerHTML: div.outerHTML.substring(0, 400),
          });

          if (snapshot.activityItems.length >= 5) break;
        }
      }
    }

    function getDepth(el, root) {
      let depth = 0;
      let current = el;
      while (current && current !== root) {
        depth++;
        current = current.parentElement;
      }
      return depth;
    }

    this.log('snapshot', 'Page snapshot captured', snapshot);
    return snapshot;
  },

  // Test each selector and report what it finds
  testSelectors() {
    const results = {};

    // Test getActivityItems
    try {
      const items = SC_SELECTORS.getActivityItems();
      results.getActivityItems = {
        count: items.length,
        firstText: items[0]?.textContent?.trim()?.substring(0, 100) || null,
        firstHTML: items[0]?.innerHTML?.substring(0, 300) || null,
      };
    } catch (e) {
      results.getActivityItems = { error: e.message };
    }

    // Test getMenuButton on first item
    try {
      const items = SC_SELECTORS.getActivityItems();
      if (items[0]) {
        const btn = SC_SELECTORS.getMenuButton(items[0]);
        results.getMenuButton = {
          found: !!btn,
          tag: btn?.tagName?.toLowerCase() || null,
          ariaLabel: btn?.getAttribute('aria-label') || null,
          text: btn?.textContent?.trim()?.substring(0, 50) || null,
        };
      } else {
        results.getMenuButton = { skipped: 'no items found' };
      }
    } catch (e) {
      results.getMenuButton = { error: e.message };
    }

    // Test isEndOfList
    try {
      results.isEndOfList = SC_SELECTORS.isEndOfList();
    } catch (e) {
      results.isEndOfList = { error: e.message };
    }

    this.log('selectors', 'Selector test results', results);
    return results;
  },

  // Get full debug report as JSON string
  getReport() {
    return JSON.stringify({
      generatedAt: new Date().toISOString(),
      userAgent: navigator.userAgent,
      url: window.location.href,
      entries: this.entries,
    }, null, 2);
  },

  // Clear log for fresh run
  clear() {
    this.entries = [];
  },
};

if (typeof globalThis !== 'undefined') {
  globalThis.SC_DEBUG = SC_DEBUG;
}
