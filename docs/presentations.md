# Live presentations

Write slides in Markdown, present them from a console, and let the audience follow **in real time** on their own devices. Try the seeded deck: `/live/welcome` (audience) and `/present/welcome` (presenter, admins only).

## Pages

| URL | Who | Purpose |
|---|---|---|
| `/admin/presentations` | admin | Create and edit decks, with a live preview |
| `/present/<slug>` | admin | Presenter console: current and next slide, **speaker notes**, timer, viewer count, reactions |
| `/live/<slug>` | everyone (public decks) or signed-in users | Audience view |
| `/presentations` | everyone | List of public decks, with a LIVE badge |

## Deck format

```text
<!-- class: center dark -->
# My talk

A subtitle

Notes: only the presenter sees this

---

## Second slide

- Lists, **bold**, *italic*, ~~strike~~ and `code`
- [Links](https://example.com)

| Column | Column |
|---|---|
| a | b |

---

## Code

Fenced code blocks work on slides too.
```

* Slides are separated by a line containing only `---` (fenced code can contain `---`).
* `Notes:` starts the presenter-only speaker notes for that slide.
* An optional first line `<!-- class: center dark accent big top light -->` styles the slide.
* Themes: `light`, `dark`, `contrast`.
* Images: only same-site paths (`/img/photo.png`) and `data:image/png|jpeg|gif|webp`.

## Presenting

Open `/present/<slug>`. You can rehearse before starting, because the audience does not follow until you press **Start**.

| Key | Action |
|---|---|
| Right arrow, Space, Page Down | Next slide |
| Left arrow, Page Up | Previous slide |
| Home, End | First, last slide |
| `S` | Start |
| Esc | End (asks for confirmation) |

## Audience

Viewers follow your slide automatically. They can browse freely and a **Return to live** button appears. They can send reactions (clap, heart, wow, laugh, thumbs-up), go fullscreen with `F`, or swipe on a phone. The presenter sees the live viewer count and reaction totals.

Editing the deck while it is live updates every viewer instantly. Deleting it closes their streams.

## How it works

The audience connects to `/live/<slug>/events` (Server-Sent Events). The presenter's actions are `POST /present/<slug>/control` with `{ "action": "start" }`, `{ "action": "goto", "index": 3 }`, `{ "action": "end" }` or `{ "action": "reset" }`. Events sent to clients: `state`, `viewers`, `reaction`, `content`, `closed`. Slide size scales with the container, with no JavaScript scaling.

## Security

* Markdown is **escaped first**. There is no raw HTML. Only `http(s)`, `mailto:`, same-site paths and anchors become links.
* **Speaker notes never reach audience endpoints.**
* Control endpoints require an admin and a CSRF token. Reactions need no token but are origin-checked and rate-limited.
* Connections are capped per IP and per deck (`PRESENTATION_MAX_CONN_PER_IP`, `PRESENTATION_MAX_VIEWERS`).

## Import from a file

```bash
node bin/power-cli.js presentation:import talk.md --slug=my-talk --theme=dark --public
```

> **Note:** live state is kept in memory by one server process. After a restart decks return to idle and browsers reconnect automatically. For several server processes you need a shared pub/sub in front of the hub.

You can also experiment with the renderer in the [Markdown playground](/demo/markdown).
