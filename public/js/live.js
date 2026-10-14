// Audience view: follows the presenter in real time (SSE); viewers can browse freely and jump back to live.
(() => {
  const root = document.getElementById("live");
  if (!root) return;
  const slug = root.dataset.slug,
    $ = (id) => document.getElementById(id),
    deck = $("deck");
  let live = {};
  try {
    live = JSON.parse(root.dataset.state || "{}");
  } catch {
    /* defaults */
  }
  let local = null,
    connected = false,
    closed = false;
  const slides = () => deck.querySelectorAll(":scope > .slide");
  const total = () => slides().length;
  const cur = () =>
    Math.min(Math.max(local ?? live.index ?? 0, 0), Math.max(total() - 1, 0));
  const LABEL = {
    live: "LIVE",
    idle: "Waiting for presenter",
    ended: "Presentation ended",
  };
  const EMOJI = {
    clap: "👏",
    heart: "❤️",
    wow: "😮",
    laugh: "😂",
    thumbs: "👍",
  };

  function render() {
    const i = cur(),
      n = total(),
      st = live.status || "idle";
    slides().forEach((s, k) => s.classList.toggle("active", k === i));
    $("counter").textContent = `${i + 1} / ${n}`;
    $("bar").value = n > 1 ? Math.round((i / (n - 1)) * 100) : 100;
    const pill = $("status");
    pill.textContent = closed
      ? "Closed"
      : connected
        ? LABEL[st]
        : "Reconnecting…";
    pill.className = "pill " + (connected && !closed ? st : "idle");
    $("viewers").textContent = live.viewers ?? 0;
    $("resume").hidden = !(
      local !== null &&
      st === "live" &&
      local !== live.index
    );
    const ov = $("overlay");
    ov.textContent = closed
      ? "This presentation is no longer available."
      : st === "ended"
        ? "The presentation has ended. Thanks for watching!"
        : "Waiting for the presenter to start…";
    ov.hidden = !(closed || (st !== "live" && local === null));
  }
  function go(d) {
    local = Math.min(Math.max(cur() + d, 0), total() - 1);
    if (live.status === "live" && local === live.index) local = null;
    render();
  }
  function bounce(kind) {
    const el = document.createElement("span");
    el.className = "float";
    el.textContent = EMOJI[kind] || "👍";
    el.style.left = 8 + Math.random() * 84 + "%";
    $("stage").appendChild(el);
    setTimeout(() => el.remove(), 2400);
  }
  async function refetch() {
    try {
      const r = await fetch(`/live/${slug}/slides`, {
        credentials: "same-origin",
      });
      if (!r.ok) return;
      const d = await r.json();
      deck.innerHTML = d.slides
        .map((s) => `<section class="slide ${s.classes}">${s.html}</section>`)
        .join(""); // server-sanitised HTML
      render();
    } catch {
      /* keep current slides */
    }
  }

  const es = new EventSource(`/live/${slug}/events`);
  es.onopen = () => {
    connected = true;
    render();
  };
  es.onerror = () => {
    connected = false;
    render();
  };
  es.addEventListener("state", (e) => {
    live = { ...live, ...JSON.parse(e.data) };
    if (local !== null && local === live.index) local = null;
    render();
  });
  es.addEventListener("viewers", (e) => {
    live.viewers = JSON.parse(e.data).count;
    render();
  });
  es.addEventListener("reaction", (e) => bounce(JSON.parse(e.data).kind));
  es.addEventListener("content", refetch);
  es.addEventListener("closed", () => {
    closed = true;
    es.close();
    render();
  });

  $("prev").addEventListener("click", () => go(-1));
  $("next").addEventListener("click", () => go(1));
  $("resume").addEventListener("click", () => {
    local = null;
    render();
  });
  $("fs").addEventListener("click", () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else root.requestFullscreen?.();
  });
  let last = 0;
  document.querySelectorAll(".react").forEach((b) =>
    b.addEventListener("click", () => {
      if (Date.now() - last < 250) return;
      last = Date.now();
      fetch(`/live/${slug}/react`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ kind: b.dataset.kind }),
      }).catch(() => {});
    }),
  );
  document.addEventListener("keydown", (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (["ArrowRight", "PageDown", " "].includes(e.key)) {
      e.preventDefault();
      go(1);
    } else if (["ArrowLeft", "PageUp"].includes(e.key)) {
      e.preventDefault();
      go(-1);
    } else if (e.key === "Home") {
      local = 0;
      render();
    } else if (e.key === "End") {
      local = total() - 1;
      render();
    } else if (e.key === "f") $("fs").click();
  });
  let x0 = null;
  $("stage").addEventListener("pointerdown", (e) => {
    x0 = e.clientX;
  });
  $("stage").addEventListener("pointerup", (e) => {
    if (x0 !== null && Math.abs(e.clientX - x0) > 50)
      go(e.clientX < x0 ? 1 : -1);
    x0 = null;
  });
  render();
})();
