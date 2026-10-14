# Authentication & roles

## Sessions

Sessions are stored **server-side** in the database. The browser only holds a random ID in a cookie (`power_sid`, or `__Host-power_sid` in production).

* The database key is `HMAC(SESSION_SECRET, id)`, so a leaked database cannot be replayed as cookies.
* Sessions are **lazy**: nothing is stored and no cookie is set until the session holds data (a flash message, a CSRF token, a login).
* Idle timeout `SESSION_TTL_HOURS` (sliding) and an absolute lifetime `SESSION_ABSOLUTE_HOURS`.
* A cookie replayed from a different `User-Agent` is rejected.
* The session ID is **regenerated** on login, password change and two-factor changes.

```js
req.session.get('key', default);
req.session.set('key', value);
req.session.forget('key');
req.session.flash('success', 'Saved!');   // available in the next request as `flash.success`
req.session.regenerate();                 // new ID and CSRF token
req.session.destroy();                    // sign out
```

## Protecting routes

```js
import { auth } from '../auth.js';

app.get('/dashboard', auth.requireAuth, HomeController.dashboard);
app.get('/login', auth.requireGuest, AuthController.showLogin);
app.group('/admin', [auth.requireRole('admin'), auth.require2fa], (r) => { /* ... */ });
```

| Middleware | Behaviour |
|---|---|
| `requireAuth` | Redirects guests to `/login` (remembering the page), JSON clients get 401 |
| `requireGuest` | Redirects signed-in users to `/dashboard` |
| `requireRole('admin', ...)` | 403 unless the user has one of the roles |
| `require2fa` | With `REQUIRE_ADMIN_2FA=1`, admins must enrol an authenticator first |

Roles are `admin` and `user` (enforced by a database CHECK constraint). To add a role, add a migration that changes the constraint and update `User.ROLES`.

## Passwords

* Hashed with **scrypt** (N = 2^15, r = 8, p = 1) with a random salt per password.
* Optional `PASSWORD_PEPPER`: the password is HMAC'd with a server-side secret first.
* Hashes with weaker parameters are **upgraded automatically** on the next successful login.
* Policy: 10 to 128 characters, not common, not containing your email name. See [Validation](/docs/validation).

## Brute-force protection

| Layer | Default |
|---|---|
| Per-IP login and register limit | 20 per 15 minutes (`AUTH_RATE_LIMIT`) |
| Global per-IP limit | 300 per minute |
| **Account lockout** | 5 failures locks the account for 15 minutes, doubling with each further failure up to 24 hours |
| Same message for every failure | "These credentials do not match our records." |
| Timing equalization | A hash is computed even for unknown emails and locked accounts |

An administrator can clear a lockout from the user edit page, or with `node bin/power-cli.js user:reset-password`.

> **Note:** lockouts protect an account from guessing but can be used to annoy its owner. The per-IP limits and 2FA reduce that risk.

## Two-factor authentication (TOTP)

Users enable it at `/account/security`:

1. Press **Set up 2FA** and add the shown key to an authenticator app (Google Authenticator, Aegis, 1Password, ...).
2. Enter the 6-digit code to confirm. **Eight single-use backup codes** are shown once.
3. From now on login is two steps: password, then the code.

Details: RFC 6238 (SHA-1, 6 digits, 30 seconds, plus or minus one step), **replay protection** (a code can be used once), secrets **encrypted at rest** with AES-256-GCM, backup codes stored only as SHA-256 hashes.

```bash
node bin/power-cli.js user:disable-2fa someone@example.com   # recovery when a device is lost
```

## Changing the password

`/account/security` asks for the current password, applies the policy, then signs out **all other devices**.

## The login flow

```js
const { user } = await auth.attempt(email, password, req.ip);
if (!user) return res.invalid({ email: ['These credentials do not match our records.'] }, { email }, '/login');
auth.login(req, user);          // regenerates the session ID
res.redirect('/dashboard');
```

See `app/controllers/AuthController.js` for the full version including two-factor.

## User model fields

`name`, `email` (stored lowercase), `password_hash`, `role`, `is_active`, `last_login_at`, `failed_logins`, `locked_until`, `password_changed_at`, `totp_secret`, `totp_enabled`, `totp_last_step`, `backup_codes`, `created_at`, `updated_at`. Sensitive columns are masked in the admin table browser.
