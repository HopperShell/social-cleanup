// content/content.js
(function () {
  'use strict';

  // Prevent multiple injections from creating duplicate loops
  // Version bump this when code changes to allow new injection after extension reload
  const SC_VERSION = 10;
  if (window._socialCleanupVersion === SC_VERSION) return;
  window._socialCleanupVersion = SC_VERSION;

  let isRunning = false;
  let isPaused = false;
  let currentCategory = null;
  let deleteBefore = null; // ISO date string cutoff
  let skipPhotoPosts = false;

  // Runtime log buffer — captured by debug dump
  const runtimeLog = [];
  function rlog(msg) {
    const entry = `${new Date().toISOString()} ${msg}`;
    runtimeLog.push(entry);
    if (runtimeLog.length > 200) runtimeLog.shift();
    console.log(`Social Cleanup: ${msg}`);
  }
  // Expose for debug dump
  window._socialCleanupLog = runtimeLog;

  function isPhotoPost(item) {
    const text = item.textContent.trim().toLowerCase();
    return text.includes('added a new photo') || text.includes('added new photo') ||
      text.includes('new photos') || text.includes('added a photo') ||
      text.includes('updated his profile picture') || text.includes('updated her profile picture') ||
      text.includes('updated his cover photo') || text.includes('updated her cover photo') ||
      text.includes('updated their profile picture') || text.includes('updated their cover photo') ||
      text.includes('shared a photo') || text.includes('posted a photo');
  }

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
    element.scrollIntoView({ behavior: 'instant', block: 'center' });
    // Try multiple click strategies — Facebook's React is picky
    // Strategy 1: Full mouse event sequence with pointer events
    for (const eventType of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
      element.dispatchEvent(new PointerEvent(eventType, {
        bubbles: true,
        cancelable: true,
        view: window,
        pointerId: 1,
        pointerType: 'mouse',
      }));
    }
    // Strategy 2: Direct .click() as fallback
    try { element.click(); } catch {}
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
    // Dismiss any stale menu/dialog first
    const existingMenu = document.querySelector('[role="menu"]');
    if (existingMenu) {
      document.body.click();
      await delay(100, 200);
    }
    // Dismiss stale confirmation dialogs (skip persistent ones like Notifications)
    const existingDialogs = document.querySelectorAll('[role="dialog"]');
    for (const dialog of existingDialogs) {
      const dialogText = dialog.textContent.trim().toLowerCase();
      if (dialogText.includes('move to trash') || dialogText.includes('delete') ||
          dialogText.includes('are you sure') || dialogText.includes('confirm')) {
        const closeBtn = dialog.querySelector('[aria-label="Close"]');
        if (closeBtn) {
          simulateClick(closeBtn);
          await delay(100, 200);
        }
      }
    }

    const menuBtn = SC_SELECTORS.getMenuButton(item);
    if (!menuBtn) {
      throw new Error('Could not find action menu button');
    }
    simulateClick(menuBtn);

    // Wait for the menu to appear with polling
    const deleteTexts = currentCategory === 'reactions'
      ? ['remove', 'unlike', 'delete']
      : ['delete', 'move to trash', 'trash', 'remove'];

    let deleteOption = null;
    // Poll for menu options
    for (let attempt = 0; attempt < 6; attempt++) {
      await delay(150, 300);

      const allMenuItems = document.querySelectorAll('[role="menuitem"], [role="option"]');
      const menuTexts = Array.from(allMenuItems).map(el => el.textContent.trim()).filter(t => t.length > 0);

      if (attempt === 0 || menuTexts.length > 0) {
        rlog(`Menu options (attempt ${attempt}): ${menuTexts.join(', ')}`);
      }

      for (const text of deleteTexts) {
        deleteOption = SC_SELECTORS.getMenuOption(text);
        if (deleteOption) break;
      }
      if (deleteOption) break;

      // If no menu items at all, the menu might not have opened — try clicking again
      if (attempt === 2 && menuTexts.length === 0) {
        rlog('Menu empty after 3 attempts, re-clicking menu button');
        document.body.click();
        await delay(100, 200);
        simulateClick(menuBtn);
      }
    }

    if (!deleteOption) {
      document.body.click();
      throw new Error('Could not find delete/remove option after 6 attempts');
    }

    simulateClick(deleteOption);
    rlog(`Clicked: ${deleteOption.textContent.trim()}`);

    // Wait for confirmation dialog or direct deletion
    try {
      const confirmBtn = await waitFor(() => SC_SELECTORS.getConfirmButton(), 2000, 100);
      if (confirmBtn) {
        rlog(`Confirm button found: "${confirmBtn.textContent.trim()}" in dialog`);

        // Try multiple click strategies — Facebook's React can be picky about confirm buttons
        for (let clickAttempt = 0; clickAttempt < 3; clickAttempt++) {
          // Strategy 1: Full pointer event sequence
          simulateClick(confirmBtn);
          await delay(300, 500);

          // Check if dialog was dismissed
          const dialogStillOpen = SC_SELECTORS.getConfirmButton();
          if (!dialogStillOpen) break; // success

          rlog(`Confirm click attempt ${clickAttempt + 1} didn't dismiss dialog, retrying`);

          // Strategy 2: Try keyboard Enter on the button
          if (clickAttempt === 1) {
            confirmBtn.focus();
            confirmBtn.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
            confirmBtn.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', bubbles: true }));
            await delay(300, 500);
            if (!SC_SELECTORS.getConfirmButton()) break;
          }

          // Strategy 3: Find and click the button fresh (DOM may have changed)
          if (clickAttempt === 2) {
            const freshBtn = SC_SELECTORS.getConfirmButton();
            if (freshBtn) {
              freshBtn.click();
              await delay(300, 500);
            }
          }
        }
      }
    } catch {
      rlog('No confirmation dialog appeared');
    }
  }

  async function processPost(item) {
    await deleteItem(item);

    const description = item.textContent.trim().substring(0, 50);
    await chrome.runtime.sendMessage(
      createMessage(SC_MESSAGES.ITEM_DELETED, {
        category: 'posts',
        description,
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

    rlog(`Starting ${currentCategory} cleanup`);
    rlog(`deleteBefore = ${deleteBefore}`);

    // Phase 1: If date filter is set, scroll down until we reach items older than the cutoff
    if (deleteBefore) {
      rlog(`Scrolling to find items before ${deleteBefore}...`);
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
            rlog(`Found items from ${lastDate}, ready to delete`);
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
          rlog(`Scrolled ${scrollAttempts} times, latest loaded: ${lastDate2}`);
        }

        if (SC_SELECTORS.isEndOfList()) {
          rlog('Reached end of list before finding target date');
          break;
        }
      }

      if (!foundOldItems) {
        rlog('Could not find items before cutoff date');
      }
    }

    // Phase 2: Process items (delete from the bottom up to avoid skipping)
    let noNewItemsCount = 0;
    let totalDeleted = 0;
    let lastItemText = '';
    let sameItemCount = 0;
    const failedItemTexts = new Set(); // items we couldn't delete — never retry

    while (isRunning && !isPaused) {
      // Invalidate cache each iteration to get fresh DOM
      SC_SELECTORS._containerCache = null;
      const items = SC_SELECTORS.getActivityItems();
      rlog(`Loop: ${items.length} items, noNew=${noNewItemsCount}, deleted=${totalDeleted}, paused=${isPaused}, running=${isRunning}`);

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
            rlog(`No more ${currentCategory} to process (gave up after 10 empty checks)`);
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
      const lastItemDate = SC_SELECTORS.getItemDate(items[items.length - 1]);
      const firstItemDate = SC_SELECTORS.getItemDate(items[0]);
      rlog(`Dates: first=${firstItemDate}, last=${lastItemDate}, cutoff=${deleteBefore}`);

      let skippedPhotos = 0;
      for (let i = items.length - 1; i >= 0; i--) {
        if (isTooRecent(items[i])) continue;
        if (skipPhotoPosts && currentCategory === 'posts' && isPhotoPost(items[i])) {
          skippedPhotos++;
          continue;
        }
        if (failedItemTexts.has(items[i].textContent.trim().substring(0, 80))) continue;
        item = items[i];
        break;
      }
      // If no deletable items found (all too recent, all photo posts, or all failed)
      if (!item) {
        const lastDate = items.length > 0 ? SC_SELECTORS.getItemDate(items[items.length - 1]) : 'none';
        const firstDate = items.length > 0 ? SC_SELECTORS.getItemDate(items[0]) : 'none';

        if (skippedPhotos > 0) {
          rlog(`Done — ${skippedPhotos} photo post(s) remain (skipped). ${totalDeleted} deleted total.`);
          await chrome.runtime.sendMessage(
            createMessage(SC_MESSAGES.PROGRESS_UPDATE, {
              message: `Done — skipped ${skippedPhotos} photo post(s), deleted ${totalDeleted} non-photo posts`
            })
          );
        } else {
          rlog(`No deletable items — ${items.length} items, dates ${firstDate} to ${lastDate}, cutoff ${deleteBefore}`);
        }
        await chrome.runtime.sendMessage(
          createMessage(SC_MESSAGES.CATEGORY_COMPLETE, { category: currentCategory })
        );
        isRunning = false;
        return;
      }

      // Detect if we're stuck on the same item
      const itemText = item.textContent.trim().substring(0, 80);
      if (itemText === lastItemText) {
        sameItemCount++;
        if (sameItemCount >= 3) {
          rlog(`Stuck on same item ${sameItemCount} times, permanently skipping: ${itemText.substring(0, 50)}`);
          failedItemTexts.add(itemText);
          // Dismiss any leftover dialogs/menus before moving on
          document.body.click();
          await delay(300, 500);
          const dialogs = document.querySelectorAll('[role="dialog"]');
          for (const d of dialogs) {
            const closeBtn = d.querySelector('[aria-label="Close"]');
            if (closeBtn) {
              simulateClick(closeBtn);
              await delay(200, 300);
            }
          }
          sameItemCount = 0;
          lastItemText = '';
          continue;
        }
      } else {
        sameItemCount = 1;
        lastItemText = itemText;
      }

      try {
        // Wrap deletion in a timeout so we never hang forever
        const deletePromise = (async () => {
          switch (currentCategory) {
            case 'posts': await processPost(item); break;
            case 'comments': await processComment(item); break;
            case 'reactions': await processReaction(item); break;
          }
        })();

        await Promise.race([
          deletePromise,
          new Promise((_, reject) => setTimeout(() => reject(new Error('Deletion timed out after 15s')), 15000)),
        ]);

        totalDeleted++;
        await delay(300, 600);
        rlog(`Deleted item #${totalDeleted}: ${itemText.substring(0, 60)}`);
      } catch (err) {
        rlog(`Error processing item: ${err.message}`);

        // Dismiss any stale menus/dialogs after an error
        document.body.click();
        await delay(200, 400);

        // Check if element was already removed (stale reference)
        if (err.message.includes('not attached') || err.message.includes('stale')) {
          continue;
        }

        try {
          await chrome.runtime.sendMessage(
            createMessage(SC_MESSAGES.ACTION_ERROR, { error: err.message })
          );
        } catch {
          // Extension context may have been invalidated
          rlog('Lost connection to extension — stopping');
          isRunning = false;
          return;
        }

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
          skipPhotoPosts = !!(s && s.skipPhotoPosts);
          rlog(`START_CLEANUP received, deleteBefore = ${deleteBefore}, skipPhotoPosts = ${skipPhotoPosts}`);
          runCleanupLoop();
        });
        sendResponse({ ok: true });
        break;

      case SC_MESSAGES.PAUSE_CLEANUP:
        isPaused = true;
        isRunning = false;
        rlog('PAUSE received — stopping loop');
        sendResponse({ ok: true });
        break;

      case SC_MESSAGES.USER_STOP:
        isPaused = true;
        isRunning = false;
        rlog('STOP received — stopping loop');
        sendResponse({ ok: true });
        break;

      case SC_MESSAGES.RESUME_CLEANUP:
        isPaused = false;
        chrome.runtime.sendMessage(createMessage(SC_MESSAGES.GET_STATE)).then(s => {
          deleteBefore = (s && s.deleteBefore) || null;
          skipPhotoPosts = !!(s && s.skipPhotoPosts);
          if (!isRunning) {
            runCleanupLoop();
          }
        });
        sendResponse({ ok: true });
        break;

      case SC_MESSAGES.DUMP_DEBUG:
        // Run diagnostics and send report to background
        SC_DEBUG.clear();
        SC_DEBUG.log('init', 'Debug dump triggered', {
          url: window.location.href,
          isRunning,
          isPaused,
          currentCategory,
          deleteBefore,
        });
        SC_DEBUG.capturePageSnapshot();
        SC_DEBUG.testSelectors();
        SC_DEBUG.log('category', 'Detected category', detectCategory());
        SC_DEBUG.log('runtimeLog', 'Last 200 runtime log entries', window._socialCleanupLog || []);
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
  async function tryAutoStart() {
    try {
      const state = await chrome.runtime.sendMessage(createMessage(SC_MESSAGES.GET_STATE));
      if (state && state.status === SC_CONSTANTS.STATUS.RUNNING && !state.reusingTab) {
        deleteBefore = state.deleteBefore || null;
        skipPhotoPosts = !!state.skipPhotoPosts;
        rlog(`Auto-start: page loaded, deleteBefore = ${deleteBefore}, skipPhotoPosts = ${skipPhotoPosts}`);
        runCleanupLoop();
        return true;
      }
    } catch {
      // Extension context may have been invalidated
    }
    return false;
  }

  // Try after page settles, retry once if Activity Log hasn't loaded yet
  setTimeout(async () => {
    const started = await tryAutoStart();
    if (!started) {
      // Retry after 5 more seconds in case page was slow
      setTimeout(() => tryAutoStart(), 5000);
    }
  }, 3000);
})();
