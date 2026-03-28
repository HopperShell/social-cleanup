# Facebook Comment/Reaction/Post Cleanup Tool — Design Spec

## Overview

Chrome extension that bulk-deletes Facebook posts, comments, and reactions via the Activity Log UI. Downloads photos from posts before deleting them. Runs unattended in the background.

## Architecture

Four components:

1. **Popup UI** — Control panel with start/stop/pause, category toggles, progress stats, activity log
2. **Background Service Worker** — State machine, coordinates workflow, handles photo downloads, persists progress
3. **Content Script** — DOM interaction on Activity Log pages, clicks delete buttons, extracts photo URLs
4. **State Machine** — Tracks category/position/retries, enables resume across browser restarts

Flow: Popup → Background → Content Script → Background (save state + download photos) → repeat

## Cleanup Workflow

Processes three categories in order: **Posts → Comments → Reactions**

Activity Log URLs:
- Posts: `facebook.com/allactivity?activity_history=false&category_key=POSTSYOUVEWRITTEN`
- Comments: `facebook.com/allactivity?activity_history=false&category_key=COMMENTSCLIPS`
- Reactions: `facebook.com/allactivity?activity_history=false&category_key=REACTIONSCLIPS`

### Post Handling
1. Check if post contains photos/videos
2. If yes: extract image URLs → download to `FacebookBackup/` → confirm download → delete post
3. If no: delete immediately

### Comment & Reaction Handling
- Delete/remove directly, no photo logic

### Delete Pattern
1. Click "..." menu on item
2. Click "Delete" / "Remove reaction"
3. Confirm dialog if present
4. Wait 2-5 seconds (randomized) before next action
5. On rate limit/error: exponential backoff (30s, 60s, 120s...)
6. When no more items load, move to next category

## Extension Components

### Popup UI (`popup.html` + `popup.js`)
- Category checkboxes (Posts, Comments, Reactions — all default checked)
- Start/Pause/Resume button
- Progress: `Posts: 47 deleted (12 photos saved) | Comments: 0/? | Reactions: 0/?`
- Scrollable activity log of recent actions
- Status indicator: Running / Paused / Rate Limited / Complete

### Content Script (`content.js`)
- Activates on `facebook.com/allactivity*`
- Uses `MutationObserver` for lazy-loaded items
- Targets `aria-label`, `role`, `data-*` attributes and text content (not dynamic CSS classes)
- Falls back to text matching for buttons ("Delete", "Remove", "Unlike")
- Reports action results to background worker

### Background Service Worker (`background.js`)
- State machine management
- `chrome.downloads.download()` for photos
- Persists state to `chrome.storage.local` on every action
- Resume detection on startup
- Rate limit detection: 3 consecutive failures → backoff mode

### Manifest (`manifest.json`)
- Manifest V3
- Permissions: `activeTab`, `downloads`, `storage`, `tabs`
- Host permission: `*://*.facebook.com/*`
- Content script match: `*://*.facebook.com/allactivity*`

## Photo Handling
- Photos saved to `FacebookBackup/` subfolder in downloads directory
- Naming: `YYYY-MM-DD_postid_N.ext` (e.g., `2024-03-15_postid_1.jpg`)
- Download confirmed before post deletion proceeds

## Rate Limiting Strategy
- Randomized 2-5 second delay between actions
- Exponential backoff on consecutive failures (30s → 60s → 120s)
- Status visible in popup UI

## Tech Stack
- Vanilla JS (no framework needed for this scope)
- Chrome Extension Manifest V3
- chrome.storage, chrome.downloads, chrome.tabs APIs
