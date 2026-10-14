// Presenter console: controls the live deck, shows notes, next slide, timer, audience size and reactions.
(() => {
  const root = document.getElementById("presenter");
  if (!root) return;
  const slug = root.dataset.slug,
    csrf = document.querySelector('meta[name="csrf"]').content;
  const $ = (id) => document.getElementById(id),
    deck = $("deck");
  const slides = [...deck.querySelectorAll(":scope > .slide")],
    notes = [...deck.querySelectorAll(":scope > .slide-notes")];
  const n = slides.length;
  const EMOJI = {
    clap: "👏",
    heart: "❤️",
    wow: "😮",
    laugh: "😂",
    thumbs: "👍",
  };
  let live = {};
  try {
    live = JSON.parse(root.dataset.state || "{}");
  } catch {
    /* defaults */
  }
  let i = Math.min(live.index || 0, n - 1),
    lastSent = 0,
    timerId = null,
    pending = null;

  function show() {
    $("cur").innerHTML = slides[i].outerHTML;
    $("nxt").innerHTML = slides[i + 1]
      ? slides[i + 1].outerHTML
      : '<section class="slide center"><p>End of deck</p></section>';
    $("notes").innerHTML =
      notes[i].innerHTML.trim() ||
      '<p class="muted">No notes for this slide.</p>';
    $("idx").textContent = `${i + 1} / ${n}`;
    document
      .querySelectorAll(".jumpbtn")
      .forEach((b) => b.classList.toggle("on", +b.dataset.i === i));
  }
  function status() {
    const st = live.status || "idle",
      pill = $("status");
    pill.textContent = st === "live" ? "LIVE" : st;
    pill.className = "pill " + st;
    $("start").hidden = st === "live";
    $("start").textContent = st === "ended" ? "Restart" : "Start";
    $("end").hidden = st !== "live";
    $("viewers").textContent = live.viewers ?? 0;
    $("react").innerHTML =
      Object.entries(live.reactions || {})
        .map(([k, v]) => `<span>${EMOJI[k] || ""} ${Number(v)}</span>`)
        .join("") || '<span class="muted small">none yet</span>';
    clearInterval(timerId);
    const tick = () => {
      if (st === "live" && live.startedAt) {
        const s = Math.max(0, Math.floor((Date.now() - live.startedAt) / 1000));
        $("timer").textContent =
          `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
      }
    };
    if (st === "live") {
      tick();
      timerId = setInterval(tick, 1000);
    }
  }
  async function send(body) {
    try {
      const r = await fetch(`/present/${slug}/control`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
        body: JSON.stringify(body),
      });
      if (!r.ok) {
        const e = await r.json().catch(() => ({}));
        $("notes").innerHTML =
          `<p class="err">${(e.error || "Request failed").replace(/[<>&]/g, "")}</p>`;
        return null;
      }
      return r.json();
    } catch {
      return null;
    }
  }
  function go(k) {
    i = Math.min(Math.max(k, 0), n - 1);
    show();
    if (live.status !== "live") return; // rehearsal mode: audience isn't following yet
    lastSent = Date.now();
    clearTimeout(pending);
    pending = setTimeout(() => send({ action: "goto", index: i }), 60); // coalesce rapid key presses
  }
  async function start() {
    if (await send({ action: "start" })) {
      live.status = "live";
      await send({ action: "goto", index: i });
    }
  }
  function end() {
    if (live.status === "live" && confirm("End the presentation for everyone?"))
      send({ action: "end" });
  }

  const es = new EventSource(`/present/${slug}/events`);
  es.addEventListener("state", (e) => {
    live = { ...live, ...JSON.parse(e.data) };
    if (
      live.status === "live" &&
      Date.now() - lastSent > 700 &&
      live.index !== i
    ) {
      i = Math.min(live.index, n - 1);
      show();
    } // a co-presenter moved
    status();
  });
  es.addEventListener("viewers", (e) => {
    live.viewers = JSON.parse(e.data).count;
    status();
  });
  es.addEventListener("reaction", (e) => {
    live.reactions = JSON.parse(e.data).counts;
    status();
  });
  es.addEventListener("content", () => location.reload());
  es.addEventListener("closed", () => {
    location.href = "/admin/presentations";
  });

  $("start").addEventListener("click", start);
  $("end").addEventListener("click", end);
  document
    .querySelectorAll(".jumpbtn")
    .forEach((b) => b.addEventListener("click", () => go(+b.dataset.i)));
  document.addEventListener("keydown", (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (["ArrowRight", "PageDown", " "].includes(e.key)) {
      e.preventDefault();
      go(i + 1);
    } else if (["ArrowLeft", "PageUp"].includes(e.key)) {
      e.preventDefault();
      go(i - 1);
    } else if (e.key === "Home") go(0);
    else if (e.key === "End") go(n - 1);
    else if (e.key === "s" && live.status !== "live") start();
    else if (e.key === "Escape") end();
  });
  show();
  status();
})();
