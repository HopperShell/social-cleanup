// content/content.js
(function () {
  'use strict';

  // Prevent multiple injections from creating duplicate loops
  if (window._socialCleanupLoaded) return;
  window._socialCleanupLoaded = true;

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
    console.log(`Social Cleanup: deleteBefore = ${deleteBefore}`);

    // Phase 1: If date filter is set, scroll down until we reach items older than the cutoff
    if (deleteBefore) {
      console.log(`Social Cleanup: Scrolling to find items before ${deleteBefore}...`);
      await chrome.runtime.sendMessage(
        createMessage(SC_MESSAGES.PROGRESS_UPDATE, { message: `Scrolling to reach posts before ${deleteBefore}...` })
      );

      let foundOldItems = false;
      let scrollAttempts = 0;
      const maxScrollAttempts = 5000; // Safety limit

      while (isRunning && !isPaused && !foundOldItems && scrollAttempts < maxScrollAttempts) {
        const items = SC_SELECTORS.getActivityItems();

        // Check the LAST item on the page — is it old enough?
        if (items.length > 0) {
          const lastItem = items[items.length - 1];
          const lastDate = SC_SELECTORS.getItemDate(lastItem);
          if (lastDate < deleteBefore) {
            foundOldItems = true;
            console.log(`Social Cleanup: Found items from ${lastDate}, ready to delete`);
            break;
          }
        }

        // Keep scrolling
        SC_SELECTORS.scrollToLoadMore();
        await waitForMutation(2000);
        await delay(300, 600);
        scrollAttempts++;

        // Log progress every 50 scrolls
        if (scrollAttempts % 50 === 0) {
          const items2 = SC_SELECTORS.getActivityItems();
          const lastDate2 = items2.length > 0 ? SC_SELECTORS.getItemDate(items2[items2.length - 1]) : 'unknown';
          console.log(`Social Cleanup: Scrolled ${scrollAttempts} times, latest loaded: ${lastDate2}`);
        }

        if (SC_SELECTORS.isEndOfList()) {
          console.log('Social Cleanup: Reached end of list before finding target date');
          break;
        }
      }

      if (!foundOldItems) {
        console.log('Social Cleanup: Could not find items before cutoff date');
      }
    }

    // Phase 2: Process items (delete from the bottom up to avoid skipping)
    let noNewItemsCount = 0;

    while (isRunning && !isPaused) {
      const items = SC_SELECTORS.getActivityItems();

      if (items.length === 0) {
        // After a deletion, the DOM may be updating — wait longer before giving up
        await delay(1500, 2500);

        // Re-check after waiting
        const itemsRetry = SC_SELECTORS.getActivityItems();
        if (itemsRetry.length > 0) {
          noNewItemsCount = 0;
          continue;
        }

        // Still empty — try scrolling to load more
        SC_SELECTORS.scrollToLoadMore();
        const loaded = await waitForMutation(3000);

        if (!loaded || SC_SELECTORS.isEndOfList()) {
          noNewItemsCount++;
          // Be patient — need 10 consecutive empty checks before giving up
          if (noNewItemsCount >= 10) {
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

      // Find the last item that's old enough to delete (work from bottom up)
      let item = null;
      for (let i = items.length - 1; i >= 0; i--) {
        if (!isTooRecent(items[i])) {
          item = items[i];
          break;
        }
      }

      // If no deletable items found, we're done (all remaining are too recent)
      if (!item) {
        console.log('Social Cleanup: All remaining items are newer than cutoff — done');
        await chrome.runtime.sendMessage(
          createMessage(SC_MESSAGES.CATEGORY_COMPLETE, { category: currentCategory })
        );
        isRunning = false;
        return;
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
        // Invalidate selector cache after successful deletion
        SC_SELECTORS._containerCache = null;
        // Wait for DOM to settle after deletion
        await delay(1000, 2000);
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
        isRunning = false; // Reset so a new run can start
        // Load date filter from background state BEFORE starting the loop
        chrome.runtime.sendMessage(createMessage(SC_MESSAGES.GET_STATE)).then(s => {
          deleteBefore = (s && s.deleteBefore) || null;
          console.log('Social Cleanup: deleteBefore =', deleteBefore);
          runCleanupLoop();
        });
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
          if (!isRunning) {
            runCleanupLoop();
          }
        });
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
      if (state && state.status === SC_CONSTANTS.STATUS.RUNNING && !state.reusingTab) {
        deleteBefore = state.deleteBefore || null;
        console.log('Social Cleanup: Page loaded, auto-starting cleanup');
        runCleanupLoop();
      }
    } catch {
      // Extension context may have been invalidated
    }
  }, 2000);
})();
