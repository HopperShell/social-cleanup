// test/test-content-logic.js
// Run with: node test/test-content-logic.js

let passed = 0;
let failed = 0;

function assert(condition, msg) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${msg}`);
  } else {
    failed++;
    console.log(`  ✗ FAIL: ${msg}`);
  }
}

// Copy of isPhotoPost from content.js
function isPhotoPost(text) {
  text = text.trim().toLowerCase();
  return text.includes('added a new photo') || text.includes('added new photo') ||
    text.includes('new photos') || text.includes('added a photo') ||
    text.includes('updated his profile picture') || text.includes('updated her profile picture') ||
    text.includes('updated his cover photo') || text.includes('updated her cover photo') ||
    text.includes('updated their profile picture') || text.includes('updated their cover photo') ||
    text.includes('shared a photo') || text.includes('posted a photo');
}

// ── isPhotoPost tests ──
console.log('\n── isPhotoPost detection ──');

// Should match (photo posts)
assert(isPhotoPost('March 21, 2026Andrew Arz added a new photo.I told Amanda...'), 'added a new photo');
assert(isPhotoPost('March 19, 2026Andrew Arz added 2 new photos.Spent a lot...'), 'added 2 new photos');
assert(isPhotoPost('February 8, 2015Andrew Arz added 5 new photos.Got...'), 'added 5 new photos');
assert(isPhotoPost('March 14, 2026Andrew Arz added a new photo.Dropping this summer'), 'added a new photo (2)');
assert(isPhotoPost('Andrew Arz updated his profile picture'), 'updated his profile picture');
assert(isPhotoPost('Andrew Arz updated her profile picture'), 'updated her profile picture');
assert(isPhotoPost('Andrew Arz updated their profile picture'), 'updated their profile picture');
assert(isPhotoPost('Andrew Arz updated his cover photo'), 'updated his cover photo');
assert(isPhotoPost('Andrew Arz updated her cover photo'), 'updated her cover photo');
assert(isPhotoPost('Andrew Arz updated their cover photo'), 'updated their cover photo');
assert(isPhotoPost('Andrew Arz shared a photo.Check this out'), 'shared a photo');
assert(isPhotoPost('Andrew Arz posted a photo.Fun times'), 'posted a photo');
assert(isPhotoPost('Andrew Arz added a photo to the album Vacation'), 'added a photo to album');
assert(isPhotoPost('Andrew Arz added new photos to the album Summer 2015'), 'added new photos to album');

// Should NOT match (non-photo posts)
assert(!isPhotoPost('March 28, 2026Andrew Arz shared a link.Here is the early copy'), 'shared a link');
assert(!isPhotoPost('Andrew Arz updated his status.Cold weather.'), 'updated his status');
assert(!isPhotoPost('Andrew Arz shared a post.Way to go Oregon'), 'shared a post');
assert(!isPhotoPost('Andrew Arz was with Matt Miller and 3 others.'), 'was with friends');
assert(!isPhotoPost('Andrew Arz shared a reel.1 carry 85 yards'), 'shared a reel');
assert(!isPhotoPost('Andrew Arz was at Lynch\'s Irish Pub.'), 'checked in');
assert(!isPhotoPost('Andrew Arz wrote on a profile.4:18 PM'), 'wrote on profile');
assert(!isPhotoPost('Andrew Arz shared a link.Navy introverts are m'), 'shared a link (2)');

// Edge case: status that mentions "photo" in the text but isn't a photo post
assert(!isPhotoPost('June 19, 2015Andrew Arz updated his status.No, I can\'t photo'), 'status mentioning photo');
// BUT wait — this one DOES contain "photo" but not in the patterns we check for.
// "can't photo" does not match "added a photo", "new photo", etc. ✓

// Edge case: "shared a photo" vs "shared a post"
assert(isPhotoPost('Andrew Arz shared a photo.'), 'shared a photo (bare)');
assert(!isPhotoPost('Andrew Arz shared a post.'), 'shared a post (bare)');

// ── isTooRecent tests ──
console.log('\n── isTooRecent logic ──');

function isTooRecent(itemDate, deleteBefore) {
  if (!deleteBefore) return false;
  return itemDate >= deleteBefore;
}

assert(isTooRecent('2026-03-28', '2016-01-29'), 'March 2026 is too recent for 2016 cutoff');
assert(!isTooRecent('2015-01-03', '2016-01-29'), 'Jan 2015 is old enough for 2016 cutoff');
assert(!isTooRecent('2016-01-28', '2016-01-29'), 'Jan 28 2016 is old enough (one day before cutoff)');
assert(isTooRecent('2016-01-29', '2016-01-29'), 'Jan 29 2016 is too recent (same as cutoff)');
assert(isTooRecent('2016-01-30', '2016-01-29'), 'Jan 30 2016 is too recent');
assert(!isTooRecent('2013-08-02', '2016-01-29'), 'Aug 2013 is old enough');
assert(!isTooRecent('2015-06-19', null), 'no cutoff means nothing is too recent');

// ── Item selection logic ──
console.log('\n── Item selection (skip photo posts + date filter) ──');

function selectItem(items, deleteBefore, skipPhotoPosts) {
  for (let i = items.length - 1; i >= 0; i--) {
    if (deleteBefore && items[i].date >= deleteBefore) continue;
    if (skipPhotoPosts && isPhotoPost(items[i].text)) continue;
    return items[i];
  }
  return null;
}

const testItems = [
  { text: 'March 28, 2026Andrew Arz shared a link.', date: '2026-03-28' },
  { text: 'March 21, 2026Andrew Arz added a new photo.Seeing Project Hail Mary!', date: '2026-03-21' },
  { text: 'March 14, 2026Andrew Arz added a new photo.Dropping this summer', date: '2026-03-14' },
  { text: 'January 3, 2015Andrew Arz shared a link.http://youtu.be/', date: '2015-01-03' },
  { text: 'December 25, 2014Andrew Arz added a new photo.Christmas!', date: '2014-12-25' },
  { text: 'December 20, 2014Andrew Arz updated his status.Cold weather', date: '2014-12-20' },
  { text: 'November 7, 2011Andrew Arz updated his status.Quite hilarious', date: '2011-11-07' },
];

let selected;

selected = selectItem(testItems, '2016-01-29', true);
assert(selected && selected.date === '2011-11-07', 'with skip photos + cutoff: picks oldest non-photo post');

selected = selectItem(testItems, '2016-01-29', false);
assert(selected && selected.date === '2011-11-07', 'without skip photos + cutoff: picks oldest post');

selected = selectItem(testItems, null, true);
assert(selected && selected.date === '2011-11-07', 'skip photos, no cutoff: picks oldest non-photo');

selected = selectItem(testItems, null, false);
assert(selected && selected.date === '2011-11-07', 'no skip, no cutoff: picks oldest');

// All items are photos except the too-recent ones
const allPhotosOld = [
  { text: 'March 28, 2026Andrew Arz shared a link.', date: '2026-03-28' },
  { text: 'December 25, 2014Andrew Arz added a new photo.Christmas!', date: '2014-12-25' },
  { text: 'November 7, 2014Andrew Arz added 3 new photos.Fun!', date: '2014-11-07' },
];

selected = selectItem(allPhotosOld, '2016-01-29', true);
assert(selected === null, 'all old items are photos + skip enabled: returns null (should scroll)');

selected = selectItem(allPhotosOld, '2016-01-29', false);
assert(selected && selected.date === '2014-11-07', 'all old items are photos + skip disabled: deletes oldest');

// Mixed: some photos, some not, interleaved
const interleaved = [
  { text: 'March 28, 2026Andrew Arz shared a link.', date: '2026-03-28' },     // too recent
  { text: 'Jan 5, 2015Andrew Arz added a new photo.', date: '2015-01-05' },     // photo - skip
  { text: 'Jan 3, 2015Andrew Arz updated his status.Hello', date: '2015-01-03' }, // ✓ deletable
  { text: 'Dec 20, 2014Andrew Arz added 2 new photos.', date: '2014-12-20' },   // photo - skip
  { text: 'Dec 15, 2014Andrew Arz shared a link.', date: '2014-12-15' },        // ✓ deletable (oldest non-photo)
];

selected = selectItem(interleaved, '2016-01-29', true);
assert(selected && selected.date === '2014-12-15', 'interleaved: picks oldest non-photo, skipping photo posts between');

// After the Dec 15 item is deleted, next pick should be Jan 3
const afterDelete = [
  { text: 'March 28, 2026Andrew Arz shared a link.', date: '2026-03-28' },     // too recent
  { text: 'Jan 5, 2015Andrew Arz added a new photo.', date: '2015-01-05' },     // photo - skip
  { text: 'Jan 3, 2015Andrew Arz updated his status.Hello', date: '2015-01-03' }, // ✓ deletable
  { text: 'Dec 20, 2014Andrew Arz added 2 new photos.', date: '2014-12-20' },   // photo - skip
  // Dec 15 was deleted and removed from DOM
];

selected = selectItem(afterDelete, '2016-01-29', true);
assert(selected && selected.date === '2015-01-03', 'after deleting oldest: picks next non-photo');

// ── Stuck item detection ──
console.log('\n── Stuck item detection ──');

function simulateStuckDetection(itemTexts) {
  let lastItemText = '';
  let sameItemCount = 0;
  const actions = [];

  for (const text of itemTexts) {
    const itemText = text.substring(0, 80);
    if (itemText === lastItemText) {
      sameItemCount++;
      if (sameItemCount >= 3) {
        actions.push('SKIP');
        sameItemCount = 0;
        lastItemText = '';
        continue;
      }
    } else {
      sameItemCount = 1;
      lastItemText = itemText;
    }
    actions.push('DELETE');
  }
  return actions;
}

let actions;

actions = simulateStuckDetection(['post A', 'post B', 'post C']);
assert(actions.join(',') === 'DELETE,DELETE,DELETE', 'different items: all deleted');

actions = simulateStuckDetection(['post A', 'post A', 'post A', 'post B']);
assert(actions.join(',') === 'DELETE,DELETE,SKIP,DELETE', 'same item 3x: skip on 3rd, then continue');

actions = simulateStuckDetection(['post A', 'post A', 'post A', 'post A', 'post A']);
assert(actions.join(',') === 'DELETE,DELETE,SKIP,DELETE,DELETE', 'same item 5x: skip on 3rd, reset, skip again on 6th');

// ── Summary ──
console.log(`\n── Results: ${passed} passed, ${failed} failed ──`);
process.exit(failed > 0 ? 1 : 0);
