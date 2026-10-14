// Presentation editor: debounced server-side preview (same sanitising renderer the audience sees) + Ctrl/Cmd+S.
(() => {
  const form = document.getElementById("editor");
  if (!form) return;
  const ta = form.querySelector("#markdown"),
    theme = form.querySelector("#theme"),
    box = document.getElementById("preview");
  const err = document.getElementById("perror"),
    count = document.getElementById("pcount"),
    csrf = form.dataset.csrf;
  let timer,
    seq = 0;
  async function refresh() {
    const mine = ++seq;
    try {
      const r = await fetch("/admin/presentations/preview", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
        body: JSON.stringify({ markdown: ta.value }),
      });
      const d = await r.json();
      if (mine !== seq) return; // a newer request superseded this one
      if (!r.ok) {
        err.textContent = d.error || "Preview failed";
        return;
      }
      err.textContent = "";
      count.textContent = `(${d.slides.length} slides)`;
      box.innerHTML = d.slides
        .map(
          (s, k) =>
            `<div class="thumb"><span class="tnum">${k + 1}</span><div class="stage small theme-${theme.value}"><div class="slidehost"><section class="slide ${s.classes}">${s.html}</section></div></div>${s.notes ? `<div class="tnotes">${s.notes}</div>` : ""}</div>`,
        )
        .join("");
    } catch {
      err.textContent = "Preview unavailable";
    }
  }
  const later = () => {
    clearTimeout(timer);
    timer = setTimeout(refresh, 300);
  };
  ta.addEventListener("input", later);
  theme.addEventListener("change", refresh);
  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "s") {
      e.preventDefault();
      form.requestSubmit();
    }
  });
  refresh();
})();
