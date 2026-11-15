# Bidyanidhi Hostel Security Specification

## 1. Data Invariants
1. **Booking Integrity & Availability**: A booking cannot be created without referencing an existing `rooms/{roomId}` document whose `availableSeats >= incoming().occupants`, and initial `status` must strictly equal `'pending'`.
2. **Atomic Status Projection**: Every `bookings/{bookingId}` creation must atomically create a matching non-PII `booking_status/{bookingCode}` document (`existsAfter` check) so students can verify status by unique Booking ID without exposing PII.
3. **PII Isolation**: `bookings` and `inquiries` contain phone numbers and student names; `get` and `list` are strictly restricted to `isAdmin()`. Public users can only `get` a specific `booking_status/{bookingCode}` document (zero PII) and `list` is forbidden.
4. **Admin RBAC & Spoofing Prevention**: Admin access requires `request.auth != null && request.auth.token.email_verified == true` AND either membership in `/admins/{request.auth.uid}` or the bootstrapped owner email. Users cannot self-assign admin roles in `/admins/{uid}`.
5. **Testimonials Truthfulness**: Unauthenticated users can only read `testimonials` where `resource.data.isPublished == true`. Only admins can create, publish, or delete testimonials.
6. **Immutable Timestamps & Keys**: `createdAt` must equal `request.time` on creation and cannot be altered on update; `updatedAt` must equal `request.time`.

## 2. The "Dirty Dozen" Adversarial Payloads
1. **Booking Pre-Confirmed Spoof**: Creating `/bookings/b1` with `status: 'approved'` (rejected: must be `'pending'`).
2. **Orphan Room Booking**: Creating `/bookings/b2` referencing a non-existent `roomId: 'ghost-room'` (rejected: `exists()` fails).
3. **Over-Capacity Booking**: Creating `/bookings/b3` with `occupants: 5` on a room with `availableSeats: 1` (rejected: `get()` capacity check fails).
4. **Missing Status Projection**: Creating `/bookings/b4` without atomically creating `/booking_status/{bookingCode}` (rejected: `existsAfter()` fails).
5. **Shadow Field Injection on Booking**: Creating `/bookings/b5` with extra key `isAdminApproved: true` (rejected: `keys().hasOnly(...)` fails).
6. **PII Scraping List**: Querying `list` on `/bookings` or `/inquiries` as an unauthenticated or non-admin user (rejected: `isAdmin()` required).
7. **Unverified Admin Email Spoof**: Calling admin endpoints with `email: 'jahidhasantareqamazon@gmail.com'` and `email_verified: false` (rejected: `email_verified == true` enforced).
8. **Self-Assigned Admin Escalation**: Writing `/admins/{myUid}` as a regular verified Google user (rejected: `isAdmin()` required).
9. **Resource Exhaustion / Giant ID**: Creating `/bookings/{1500-char-id}` or injecting 50KB strings (rejected: `isValidId()` and `.size()` checks).
10. **Client Timestamp Forgery**: Creating `/bookings/b6` with backdated `createdAt` not equal to `request.time` (rejected: `createdAt == request.time`).
11. **Reading Unpublished Testimonials**: Listing `/testimonials` without filtering `isPublished == true` as a guest (rejected: `allow list` checks `resource.data.isPublished == true || isAdmin()`).
12. **Website Settings Tampering**: Updating `/website_settings/main` phone numbers as a non-admin user (rejected: `isAdmin()` required).
