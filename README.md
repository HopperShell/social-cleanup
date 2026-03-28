# Social Cleanup

Chrome extension that bulk-deletes your Facebook posts, comments, and reactions via the Activity Log. Automatically downloads photos before deleting posts that contain them.

## Features

- **Posts**: Detects photos, downloads them to `Downloads/FacebookBackup/`, then deletes the post
- **Comments**: Removes all your comments from other people's posts
- **Reactions**: Removes all your likes, loves, and other reactions
- **Unattended**: Runs in the background with automatic rate-limit handling
- **Resumable**: Saves progress — survives browser restarts

## Install

1. Clone this repo
2. Open `chrome://extensions/`
3. Enable "Developer mode" (top right)
4. Click "Load unpacked"
5. Select the `social-cleanup/` folder

## Usage

1. Log into Facebook in Chrome
2. Click the Social Cleanup extension icon
3. Select which categories to clean (Posts, Comments, Reactions)
4. Click "Start Cleanup"
5. The extension opens your Activity Log and begins deleting items
6. Monitor progress in the popup — or just let it run

## How It Works

The extension navigates to Facebook's Activity Log filtered views and programmatically clicks through the delete flow for each item. It uses randomized delays (2-5s) between actions and exponential backoff on rate limits.

Photos are downloaded via Chrome's downloads API to `Downloads/FacebookBackup/` with filenames like `2024-03-15_postid_1.jpg`.

## Notes

- Facebook's UI changes frequently. Selectors in `content/selectors.js` may need updating.
- The extension processes items from newest to oldest (Activity Log default order).
- Rate limiting kicks in after 3 consecutive failures, backing off 30s → 60s → 120s.
- Progress persists in `chrome.storage.local` — you can close Chrome and resume later.
