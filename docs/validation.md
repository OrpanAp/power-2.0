# Validation & sanitization

## Validating input

```js
import { Validator } from '../../core/validator.js';

const v = await Validator.make(req.body, {
  name: 'required|string|min:2|max:80',
  email: 'required|email|max:190|unique:users,email',
  age: 'nullable|integer|between:13,120',
  role: 'required|in:admin,user',
  password_confirmation: 'required|same:password',
});

if (v.fails()) return res.invalid(v.errors, req.body, '/register');   // flashes errors and old input
const data = v.validated();                                          // only the fields with rules, cast to their types
```

`Validator.make` is `async` because rules such as `unique` query the database. Only the **first** failing rule per field is reported.

## Rules

| Rule | Passes when |
|---|---|
| `required` | Present and not empty |
| `nullable`, `sometimes` | Skip the other rules when the field is empty |
| `string`, `numeric`, `integer`, `boolean` | Type checks (`validated()` casts numbers and booleans) |
| `email`, `url`, `date` | Format checks (`url` allows only http and https) |
| `alpha`, `alpha_num`, `alpha_dash` | Character classes |
| `min:n`, `max:n`, `between:a,b` | Length for text, value for numbers (with `numeric` or `integer`) |
| `in:a,b`, `not_in:a,b` | Whitelist or blacklist |
| `same:field`, `different:field` | Compare two fields |
| `unique:table,column[,ignoreId]` | No row has this value (case-insensitive) |
| `exists:table,column` | A row has this value |

### Custom rules

Pass a function. Return `true` to pass, or a message string to fail:

```js
password: ['required', 'string', (value, data) => value !== data.email || 'Must differ from email'],
```

Register a reusable rule name:

```js
Validator.extend('even', (value) => Number(value) % 2 === 0, 'The :field must be even.');
// then: 'count: required|integer|even'
```

## Showing errors

```html
<input name="email" value="{{ old.email }}">
<% if errors.email %><small class="err">{{ errors.email[0] }}</small><% endif %>
```

## Sanitization (automatic)

Every request body and query string is cleaned before your code sees it:

* control characters and NUL bytes are removed,
* values are trimmed (except fields whose name contains `pass`, `token` or `secret`),
* Unicode is normalized (NFC),
* the keys `__proto__`, `constructor` and `prototype` are dropped (prototype pollution),
* nesting deeper than 8 levels is rejected.

Output escaping happens in the template engine, so there is no double-escaping and no need to pre-escape.

```js
import { escapeHtml, stripTags } from '../../core/security.js';

escapeHtml('<b>"hi"</b>');   // &lt;b&gt;&quot;hi&quot;&lt;/b&gt;
```

Try it on the [security demo](/demo/security).

## Password policy

```js
import { checkPassword, passwordRule } from '../../core/passwordPolicy.js';

checkPassword('hunter2');                            // 'The password must be at least 10 characters.'
checkPassword('Tr0ub4dor&3-horse', { email, name }); // null when acceptable

password: ['required', 'string', passwordRule],       // as a validator rule
```

The policy follows NIST SP 800-63B: 10 to 128 characters, a blocklist of common passwords, no repetitive or sequence-only passwords, and it must not contain the user's email name or first name. There are deliberately no "must contain a symbol" rules.
