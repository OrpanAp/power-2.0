# Databases & models

One API works on **SQLite**, **PostgreSQL** and **MySQL/MariaDB**, and you can use several at once.

## Connections

```env
DB_URL=sqlite:storage/power.sqlite
# DB_URL=postgres://user:pass@db.example.com:5432/app?sslmode=verify-full
# DB_URL=mysql://user:pass@db.example.com:3306/app?ssl=true
DB_ANALYTICS_URL=postgres://user:pass@host/analytics   # an extra named connection
```

| URL option | Meaning |
|---|---|
| `sslmode=disable, require, verify-ca, verify-full` | TLS for PostgreSQL. `ssl=true` works for MySQL |
| `sslca=/path/ca.pem` | Custom certificate authority |
| `pool=5` | Pool size |
| `timeout=30000` | Statement timeout (PostgreSQL) in milliseconds |

> **Note:** the PostgreSQL and MySQL drivers are written in this repository on top of `node:net` and `node:tls` (SCRAM-SHA-256, `caching_sha2_password`, prepared statements). They are verified with RFC test vectors and protocol-level tests. Run `TEST_PG_URL=... TEST_MYSQL_URL=... npm test` against your real servers before relying on them.

## The query API

```js
import { db, manager } from '../core/database.js';

const rows = await db.all('SELECT * FROM users WHERE role = ?', ['admin']);
const one  = await db.get('SELECT * FROM users WHERE id = ?', [5]);
const info = await db.run('UPDATE users SET name = ? WHERE id = ?', ['Ada', 5]);  // { changes, lastId }
const id   = await db.insert('users', { name: 'Ada', email: 'ada@example.com' });
await db.upsert('kv', { k: 'a', v: '1' }, ['k']);

const analytics = manager.connection('analytics');
```

Always use `?` placeholders and pass values as the second argument. Values are **bound parameters** and never become part of the SQL text, on every database. Table and column names go through `db.q(name)`, which validates them.

### Transactions

```js
await db.transaction(async (tx) => {
  await tx.run('UPDATE accounts SET balance = balance - ? WHERE id = ?', [10, 1]);
  await tx.run('UPDATE accounts SET balance = balance + ? WHERE id = ?', [10, 2]);
});   // commits, or rolls back if anything throws
```

> **Warning:** inside the callback use only `tx`. Calling the global `db` there waits for the transaction lock on SQLite and will hang.

### Introspection

```js
await db.tables();            // ['migrations', 'sessions', 'users', ...]
await db.columns('users');    // [{ name, type, notnull, pk, default }]
await db.ping();              // true / false
```

## Schema builder and migrations

Migrations are portable: the same file runs on all three databases.

```js
// database/migrations/20260401000001_create_posts_table.js
export async function up(db) {
  await db.schema.createTable('posts', (t) => {
    t.id();
    t.string('title', 120).notNull();
    t.text('body');
    t.integer('is_public').notNull().default(0);
    t.bigInteger('author_id');
    t.timestamps();                              // created_at, updated_at
    t.foreign('author_id', 'users', 'id', 'SET NULL');
    t.index('author_id');
  });
}
export async function down(db) { await db.schema.dropTable('posts'); }
```

| Builder | Notes |
|---|---|
| `id(name='id')` | Auto-increment primary key |
| `string(name, len=255)`, `text`, `integer`, `bigInteger` | Column types |
| `timestamps()` | `created_at` and `updated_at` (ISO strings) |
| `.notNull() .nullable() .default(v) .unique() .primary() .check(sql) .index()` | Column modifiers |
| `foreign(col, table, ref='id', onDelete='CASCADE')` | Foreign key |
| `index(cols, name?)`, `unique(cols, name?)` | Indexes |
| `schema.alterTable(name, cb)` | Adds columns |
| `schema.dropTable(name)`, `schema.hasTable(name)` | Helpers |

The [schema demo](/demo/schema) shows the SQL generated for each database.

```bash
node bin/power-cli.js make:migration create_posts_table
node bin/power-cli.js db:migrate
node bin/power-cli.js db:rollback
node bin/power-cli.js db:status
node bin/power-cli.js db:migrate --connection=analytics   # uses database/migrations/analytics/
```

> **Warning:** MySQL commits DDL statements implicitly, so a failed MySQL migration cannot be rolled back automatically.

## Models

```js
import { Model } from '../../core/model.js';

export class Post extends Model {
  static table = 'posts';
  static connection = 'default';             // or 'analytics'
  static fillable = ['title', 'body'];       // mass-assignment whitelist
  static hidden = [];                        // removed by Post.serialize()
}

const post  = await Post.create({ title: 'Hi', body: '...', is_admin: 1 });  // is_admin is ignored
const found = await Post.find(post.id);
const list  = await Post.all({ is_public: 1 }, { orderBy: 'id', order: 'DESC', limit: 10 });
const page  = await Post.paginate(2, 15, { is_public: 1 });   // { data, total, page, pages }
await Post.update(post.id, { title: 'New title' });
await Post.delete(post.id);
```

`where` objects match equality, `null` becomes `IS NULL` and arrays become `IN (...)`. `create` and `update` set the timestamps automatically.

Generate a model and its migration together:

```bash
node bin/power-cli.js make:model Post -m
```

## Portable SQL tips

* Use `LIMIT ? OFFSET ?`, `COUNT(*) AS c` (cast with `Number()`), and `LOWER(col) = LOWER(?)` for case-insensitive matches.
* Use `ESCAPE '!'` in `LIKE` patterns (the same on every database).
* Store timestamps as ISO strings, booleans as `0` or `1`.
* Use `db.upsert()` instead of hand-written `ON CONFLICT` or `ON DUPLICATE KEY`.
