// content/content.js
(function () {
  'use strict';

  let isRunning = false;
  let isPaused = false;
  let currentCategory = null;
  let deleteBefore = null; // ISO date string cutoff

  function detectCategory() {
    const url = window.location.href.toLowerCase();
    // Current Facebook URL patterns (2025+)
    if (url.includes('category_key=statuscluster')) return 'posts';
    if (url.includes('category_key=commentscluster')) return 'comments';
    if (url.includes('category_key=likes')) return 'reactions';
    // Legacy URL patterns (pre-2025)
    if (url.includes('postsyouvewritten')) return 'posts';
    if (url.includes('commentsclips')) return 'comments';
    if (url.includes('reactionsclips')) return 'reactions';
    return null;
  }

  // Returns true if the item is too recent to delete
  function isTooRecent(item) {
    if (!deleteBefore) return false;
    const itemDate = SC_SELECTORS.getItemDate(item);
    return itemDate >= deleteBefore; // ISO date strings compare correctly
  }

  function delay(min = SC_CONSTANTS.TIMING.MIN_DELAY, max = SC_CONSTANTS.TIMING.MAX_DELAY) {
    const ms = min + Math.random() * (max - min);
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function simulateClick(element) {
    if (!element) return false;
    element.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const events = ['mousedown', 'mouseup', 'click'];
    for (const eventType of events) {
      element.dispatchEvent(new MouseEvent(eventType, {
        bubbles: true,
        cancelable: true,
        view: window,
      }));
    }
    return true;
  }

  function waitFor(conditionFn, timeoutMs = 5000, pollMs = 200) {
    return new Promise((resolve, reject) => {
      const start = Date.now();
      const check = () => {
        const result = conditionFn();
        if (result) return resolve(result);
        if (Date.now() - start > timeoutMs) return reject(new Error('waitFor timeout'));
        setTimeout(check, pollMs);
      };
      check();
    });
  }

  function waitForMutation(timeoutMs = SC_CONSTANTS.TIMING.MUTATION_WAIT) {
    return new Promise(resolve => {
      const observer = new MutationObserver(() => {
        observer.disconnect();
        resolve(true);
      });
      observer.observe(document.body, { childList: true, subtree: true });
      setTimeout(() => {
        observer.disconnect();
        resolve(false);
      }, timeoutMs);
    });
  }

  async function deleteItem(item) {
    const menuBtn = SC_SELECTORS.getMenuButton(item);
    if (!menuBtn) {
      throw new Error('Could not find action menu button');
    }
    simulateClick(menuBtn);
    await delay(500, 1000);

    let deleteOption;
    if (currentCategory === 'reactions') {
      deleteOption = SC_SELECTORS.getMenuOption('remove') || SC_SELECTORS.getMenuOption('unlike');
    } else {
      // Facebook uses "Move to trash", "Trash", or "Delete" depending on context
      deleteOption = SC_SELECTORS.getMenuOption('move to trash')
        || SC_SELECTORS.getMenuOption('trash')
        || SC_SELECTORS.getMenuOption('delete');
    }

    if (!deleteOption) {
      document.body.click();
      throw new Error('Could not find delete/remove option in menu');
    }
    simulateClick(deleteOption);
    await delay(500, 1000);

    try {
      const confirmBtn = await waitFor(() => SC_SELECTORS.getConfirmButton(), 3000);
      if (confirmBtn) {
        simulateClick(confirmBtn);
        await delay(500, 1000);
      }
    } catch {
      // No confirmation dialog — fine
    }
  }

  async function processPost(item) {
    const hasPhoto = SC_SELECTORS.itemHasPhoto(item);

    if (hasPhoto) {
      const photoUrls = SC_SELECTORS.getPhotoUrls(item);
      const postId = SC_SELECTORS.getItemId(item);
      const postDate = SC_SELECTORS.getItemDate(item);

      if (photoUrls.length > 0) {
        const response = await chrome.runtime.sendMessage(
          createMessage(SC_MESSAGES.PHOTO_FOUND, {
            urls: photoUrls,
            postId,
            postDate,
          })
        );

        if (!response || !response.allSuccess) {
          console.warn('Some photos failed to download, proceeding with deletion anyway');
        }
      }
    }

    await deleteItem(item);

    const description = item.textContent.trim().substring(0, 50);
    await chrome.runtime.sendMessage(
      createMessage(SC_MESSAGES.ITEM_DELETED, {
        category: 'posts',
        description,
        hadPhoto: hasPhoto,
      })
    );
  }

  async function processComment(item) {
    await deleteItem(item);
    const description = item.textContent.trim().substring(0, 50);
    await chrome.runtime.sendMessage(
      createMessage(SC_MESSAGES.ITEM_DELETED, {
        category: 'comments',
        description,
      })
    );
  }

  async function processReaction(item) {
    await deleteItem(item);
    const description = item.textContent.trim().substring(0, 50);
    await chrome.runtime.sendMessage(
      createMessage(SC_MESSAGES.ITEM_DELETED, {
        category: 'reactions',
        description,
      })
    );
  }

  async function runCleanupLoop() {
    isRunning = true;
    currentCategory = detectCategory();

    if (!currentCategory) {
      console.error('Social Cleanup: Cannot determine category from URL');
      return;
    }

    console.log(`Social Cleanup: Starting ${currentCategory} cleanup`);

    let noNewItemsCount = 0;

    while (isRunning && !isPaused) {
      const items = SC_SELECTORS.getActivityItems();

      if (items.length === 0) {
        SC_SELECTORS.scrollToLoadMore();
        const loaded = await waitForMutation(3000);

        if (!loaded || SC_SELECTORS.isEndOfList()) {
          noNewItemsCount++;
          if (noNewItemsCount >= 3) {
            console.log(`Social Cleanup: No more ${currentCategory} to process`);
            await chrome.runtime.sendMessage(
              createMessage(SC_MESSAGES.CATEGORY_COMPLETE, { category: currentCategory })
            );
            isRunning = false;
            return;
          }
          await delay(2000, 3000);
          continue;
        }
        noNewItemsCount = 0;
        continue;
      }

      noNewItemsCount = 0;
      const item = items[0];

      // Skip items newer than the date cutoff
      if (isTooRecent(item)) {
        // Activity Log shows newest first — scroll to find older items
        item.scrollIntoView({ behavior: 'smooth', block: 'center' });
        await delay(500, 1000);
        // Remove this item from consideration by scrolling past it
        SC_SELECTORS.scrollToLoadMore();
        await waitForMutation(2000);
        continue;
      }

      try {
        switch (currentCategory) {
          case 'posts':
            await processPost(item);
            break;
          case 'comments':
            await processComment(item);
            break;
          case 'reactions':
            await processReaction(item);
            break;
        }
      } catch (err) {
        console.warn(`Social Cleanup: Error processing item:`, err.message);

        // Check if element was already removed (stale reference)
        if (err.message.includes('not attached') || err.message.includes('stale')) {
          continue;
        }

        await chrome.runtime.sendMessage(
          createMessage(SC_MESSAGES.ACTION_ERROR, { error: err.message })
        );

        if (items.length === 1) {
          SC_SELECTORS.scrollToLoadMore();
          await waitForMutation(3000);
        }
      }

      await delay();
    }
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    switch (message.type) {
      case SC_MESSAGES.START_CLEANUP:
        isPaused = false;
        // Load date filter from background state
        chrome.runtime.sendMessage(createMessage(SC_MESSAGES.GET_STATE)).then(s => {
          deleteBefore = (s && s.deleteBefore) || null;
        });
        if (!isRunning) {
          runCleanupLoop();
        }
        sendResponse({ ok: true });
        break;

      case SC_MESSAGES.PAUSE_CLEANUP:
        isPaused = true;
        sendResponse({ ok: true });
        break;

      case SC_MESSAGES.RESUME_CLEANUP:
        isPaused = false;
        chrome.runtime.sendMessage(createMessage(SC_MESSAGES.GET_STATE)).then(s => {
          deleteBefore = (s && s.deleteBefore) || null;
        });
        if (!isRunning) {
          runCleanupLoop();
        }
        sendResponse({ ok: true });
        break;

      case SC_MESSAGES.DUMP_DEBUG:
        // Run diagnostics and send report to background
        SC_DEBUG.clear();
        SC_DEBUG.log('init', 'Debug dump triggered', { url: window.location.href });
        SC_DEBUG.capturePageSnapshot();
        SC_DEBUG.testSelectors();
        SC_DEBUG.log('category', 'Detected category', detectCategory());
        chrome.runtime.sendMessage(
          createMessage(SC_MESSAGES.DEBUG_REPORT, { report: SC_DEBUG.getReport() })
        );
        sendResponse({ ok: true });
        break;

      default:
        sendResponse({ error: 'Unknown message' });
    }
    return true;
  });

  // Auto-start if navigated here by the extension
  setTimeout(async () => {
    try {
      const state = await chrome.runtime.sendMessage(createMessage(SC_MESSAGES.GET_STATE));
      if (state && state.status === SC_CONSTANTS.STATUS.RUNNING) {
        deleteBefore = state.deleteBefore || null;
        console.log('Social Cleanup: Page loaded, auto-starting cleanup');
        runCleanupLoop();
      }
    } catch {
      // Extension context may have been invalidated
    }
  }, 2000);
})();
