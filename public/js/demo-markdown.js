// Markdown playground: debounced server-side rendering with the same sanitising renderer the docs and slides use.
(() => {
  const $ = (id) => document.getElementById(id),
    ta = $("md-in"),
    view = $("md-view"),
    status = $("md-status");
  const mode = () => document.querySelector('input[name="mode"]:checked').value;
  let timer,
    seq = 0;
  async function render() {
    const mine = ++seq;
    try {
      const r = await fetch("/demo/api/markdown", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ markdown: ta.value, mode: mode() }),
      });
      const d = await r.json();
      if (mine !== seq) return;
      if (!r.ok) {
        status.textContent = d.error || "Error";
        return;
      }
      status.textContent =
        d.mode === "slides" ? `${d.slides.length} slide(s)` : "";
      if (d.mode === "doc") {
        view.className = "doc mdview";
        view.innerHTML = d.html;
      } else {
        view.className = "mdview";
        view.innerHTML = d.slides
          .map(
            (s, i) =>
              `<div class="thumb"><span class="tnum">${i + 1}</span><div class="stage small theme-light"><div class="slidehost"><section class="slide ${s.classes}">${s.html}</section></div></div>${s.notes ? `<div class="tnotes"><b>Notes:</b> ${s.notes}</div>` : ""}</div>`,
          )
          .join("");
      }
    } catch {
      status.textContent = "Preview unavailable";
    }
  }
  const later = () => {
    clearTimeout(timer);
    timer = setTimeout(render, 250);
  };
  ta.addEventListener("input", later);
  document
    .querySelectorAll('input[name="mode"]')
    .forEach((r) => r.addEventListener("change", render));
  render();
})();
