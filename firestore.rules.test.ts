import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const rulesContent = fs.readFileSync(new URL('./firestore.rules', import.meta.url), 'utf8');

test('firestore.rules includes mandatory safety net and version 2', () => {
  assert.match(rulesContent, /rules_version = '2';/);
  assert.match(rulesContent, /match \/\{document=\*\*\} \{\s*allow read, write: if false;\s*\}/);
});

test('firestore.rules enforces email_verified on admin checks and PII isolation', () => {
  assert.match(rulesContent, /request\.auth\.token\.email_verified == true/);
  assert.match(rulesContent, /match \/bookings\/\{bookingId\}[\s\S]*?allow get: if isAdmin\(\)/);
  assert.match(rulesContent, /match \/bookings\/\{bookingId\}[\s\S]*?allow list: if isAdmin\(\);/);
  assert.match(rulesContent, /match \/inquiries\/\{inquiryId\}[\s\S]*?allow list: if isAdmin\(\);/);
});

test('firestore.rules enforces pending status and atomic booking_status projection on booking create', () => {
  assert.match(rulesContent, /incoming\(\)\.status == 'pending'/);
  assert.match(rulesContent, /existsAfter\(\/databases\/\$\(database\)\/documents\/booking_status\/\$\(incoming\(\)\.bookingCode\)\)/);
  assert.match(rulesContent, /match \/booking_status\/\{bookingCode\}[\s\S]*?allow list: if false;/);
});

test('firestore.rules restricts unpublished testimonials from public list queries', () => {
  assert.match(rulesContent, /allow list: if resource\.data\.isPublished == true \|\| isAdmin\(\);/);
});
