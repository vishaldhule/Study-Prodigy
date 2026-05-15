# Security Specification for Prodigy

## 1. Data Invariants
- A `User` profile must always have an `email` and `uid`.
- A `StudySession` must belong to the user (`userId` matches the parent doc and `request.auth.uid`).
- A `Reminder` must belong to the user.
- Timestamps must be verified.

## 2. The Dirty Dozen Payloads (Rejection Tests)
1. Write to someone else's profile.
2. Create a session with a different `userId`.
3. Update a session's `id` (immutable).
4. Inject a huge string as a topic in a reminder.
5. Set `dailyStreak` to 99999 without permission.
6. Delete another user's session.
7. Read all sessions without being their owner.
8. Create a reminder with a past date (if applicable).
9. Update `email` in user profile to a non-existent value.
10. Spoof `displayName` as "Admin".
11. Inject junk in ID path.
12. Bulk read users collection.

## 3. Test Runner
Planned tests to verify PERMISSION_DENIED for above cases.
