# Admin dashboard

Sign in as an administrator and open `/admin`. Only users with the `admin` role can enter, and with `REQUIRE_ADMIN_2FA=1` they must also have two-factor authentication enabled.

## Dashboard

* Counters: users, admins, live sessions, log entries, errors and warnings in the last 24 hours, users with 2FA, locked accounts.
* **System health**, refreshed every five seconds: uptime, Node version, memory (RSS and heap), event-loop delay, system load, database status for **every configured connection**, request and error counts, average response time.
* Recent activity from the system log.

The same data is available as JSON at `/admin/health.json`.

## Users

Search, create, edit and delete users. You can change the role, deactivate an account, set a new password and clear a lockout.

Safety rules: you cannot delete or demote yourself, and the **last active administrator** can never be removed. Changing a user's role, password or active state signs out their other sessions.

## Presentations

Create and edit Markdown decks, open the presenter console, see which decks are live. See [Live presentations](/docs/presentations).

## Database browser

Browse tables of **any configured connection** (switch with the buttons at the top). You see the schema and paged, sortable rows.

* Secret-looking columns (`password`, `secret`, `token`, `totp`, `backup`) and session IDs are masked.
* `users` and `migrations` are read-only. Other tables allow deleting a row when it has a single-column primary key.
* There is deliberately **no raw SQL console**.

## System logs

Security events (logins, lockouts, password changes, 2FA changes, CSRF rejections) and errors are written to the `system_logs` table with secrets redacted. Filter by level, and purge entries older than 30 days.
