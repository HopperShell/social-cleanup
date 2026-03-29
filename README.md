# Social Cleanup

Bulk-delete your old Facebook posts, comments, and reactions. Runs right in your browser.

---

## Install (2 minutes)

1. **Download** this extension: [Click here to download ZIP](https://github.com/HopperShell/social-cleanup/releases/latest/download/social-cleanup-v1.0.0.zip)
2. **Unzip** the downloaded file (double-click it)
3. Open Chrome and go to **chrome://extensions**
4. Turn on **Developer mode** (toggle in the top-right corner)
5. Click **Load unpacked**
6. Select the **social-cleanup-main** folder you just unzipped
7. Done! You'll see the Social Cleanup icon in your toolbar

> **Tip:** If you don't see the icon, click the puzzle piece icon in Chrome's toolbar and pin Social Cleanup.

---

## How to Use

### Step 1: Pick what to clean
Click the extension icon. You'll see three buttons: **Posts**, **Comments**, **Reactions**. Click one — it opens your Facebook Activity Log filtered to that category.

### Step 2: Wait for the page to load
Facebook needs to load your activity history. For old accounts this can take a minute. Just let it load.

### Step 3: Set a date (optional)
If you only want to delete OLD stuff, pick a date. Everything **older** than that date gets deleted. Leave it blank to delete everything.

### Step 4: Click Start
Hit **Start Cleanup**. The extension will automatically:
- Scroll through your activity
- Click the menu on each item
- Select "Move to Trash" or "Delete"
- Confirm the dialog
- Move to the next item

You can watch it work or switch to another tab. Click **Pause** or **Stop** anytime.

### Step 5: Repeat for other categories
When it finishes (or you stop it), go back to the extension and click another category button (Comments, Reactions) to clean those too.

---

## FAQ

**Will this delete my photos?**
Photos in posts are automatically downloaded to your Downloads/FacebookBackup folder before the post is deleted.

**Can I undo this?**
Facebook moves items to trash first. They're permanently deleted after 30 days. You can restore them from your Facebook trash before then.

**It stopped working / got stuck**
Facebook changes their website frequently. Click the "Dump Debug Log" button in the extension and [open an issue](https://github.com/HopperShell/social-cleanup/issues) with the downloaded file attached.

**Does this work on Firefox?**
Not yet — Chrome only for now.
