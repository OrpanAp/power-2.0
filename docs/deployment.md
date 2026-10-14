# Deployment

## Minimal production run

```bash
export NODE_ENV=production
export SESSION_SECRET="$(node bin/power-cli.js key:generate | cut -d= -f2)"
export ALLOWED_HOSTS=example.com
export POWER_ADMIN_EMAIL=you@example.com
export POWER_ADMIN_PASSWORD='choose a long unique password'
node --disable-warning=ExperimentalWarning app.js
```

Check the configuration first: `node bin/power-cli.js env:check --env=production`.

## systemd

```ini
[Unit]
Description=P.O.W.E.R. app
After=network.target

[Service]
WorkingDirectory=/srv/power
EnvironmentFile=/etc/power.env
ExecStart=/usr/bin/node --disable-warning=ExperimentalWarning app.js
Restart=always
User=power
NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=/srv/power/storage

[Install]
WantedBy=multi-user.target
```

## Behind nginx (TLS)

Set `TRUST_PROXY=1` and `ALLOWED_HOSTS=example.com`. Server-Sent Events (live presentations, live reload) need **buffering off**.

```nginx
server {
  listen 443 ssl http2;
  server_name example.com;
  ssl_certificate     /etc/letsencrypt/live/example.com/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/example.com/privkey.pem;

  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_http_version 1.1;
    proxy_buffering off;          # required for live streams
    proxy_read_timeout 1h;
  }
}
```

## Native HTTPS

```env
TLS_CERT=/etc/ssl/example.com/fullchain.pem
TLS_KEY=/etc/ssl/example.com/privkey.pem
FORCE_HTTPS=1
```

## Docker

```text
FROM node:22-slim
WORKDIR /app
COPY . .
ENV NODE_ENV=production
EXPOSE 3000
USER node
CMD ["node", "--disable-warning=ExperimentalWarning", "app.js"]
```

```text
services:
  app:
    build: .
    ports: ["3000:3000"]
    environment:
      HOST: 0.0.0.0
      ALLOWED_HOSTS: example.com
      SESSION_SECRET_FILE: /run/secrets/session_secret
      DB_URL: postgres://power:secret@db:5432/power
    secrets: [session_secret]
secrets:
  session_secret:
    file: ./session_secret.txt
```

Remember `HOST=0.0.0.0` inside containers, and mount `storage/` as a volume when using SQLite.

## Databases

* **SQLite** is fine for a single server. Back it up with `sqlite3 storage/power.sqlite ".backup backup.sqlite"` rather than copying a live file.
* **PostgreSQL or MySQL** for several servers or managed hosting. Use `sslmode=verify-full` or `ssl=true`.
* Migrations run automatically at start. To run them separately: `node bin/power-cli.js db:migrate`.

## Health checks and logs

* `GET /health` returns `{"status":"ok"}` (HTTP 503 when the database is unreachable). It reveals nothing else.
* Admins get detailed metrics at `/admin/health.json`.
* Logs go to standard output (journald or `docker logs`) and to the `system_logs` table.

## Scaling notes

These pieces keep state **inside one process**:

* the rate limiters,
* live presentation rooms and the demo stream,
* the live-reload channel (development only).

Sessions are in the database, so any number of processes can serve normal pages. To run several processes, use sticky routing for `/live/` and `/present/`, or replace `core/live.js` with a shared pub/sub, and put rate limiting in your reverse proxy.

## Upgrading

1. Back up the database.
2. Replace the code, keeping `.env*` and `storage/`.
3. Start the app: pending migrations run automatically.
4. Check `env:check` for new settings.
