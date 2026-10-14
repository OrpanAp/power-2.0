// Docs enhancements: copy buttons on code blocks, "/" focuses search, table-of-contents scroll spy.
(() => {
  document.querySelectorAll(".doc pre").forEach((pre) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "copy";
    b.textContent = "Copy";
    b.setAttribute("aria-label", "Copy code");
    b.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(
          pre.querySelector("code").innerText,
        );
        b.textContent = "Copied!";
        setTimeout(() => {
          b.textContent = "Copy";
        }, 1400);
      } catch {
        /* clipboard blocked */
      }
    });
    pre.appendChild(b);
  });
  document.addEventListener("keydown", (e) => {
    if (
      e.key === "/" &&
      !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName) &&
      !e.metaKey &&
      !e.ctrlKey
    ) {
      const i = document.getElementById("docsearch");
      if (i) {
        e.preventDefault();
        i.focus();
        i.select();
      }
    }
  });
  const links = [...document.querySelectorAll(".toc a")];
  if (!links.length || !("IntersectionObserver" in window)) return;
  const byId = new Map(links.map((a) => [a.getAttribute("href").slice(1), a]));
  const io = new IntersectionObserver(
    (entries) => {
      for (const en of entries)
        if (en.isIntersecting) {
          links.forEach((a) => a.classList.remove("on"));
          byId.get(en.target.id)?.classList.add("on");
        }
    },
    { rootMargin: "0px 0px -75% 0px" },
  );
  byId.forEach((_, id) => {
    const h = document.getElementById(id);
    if (h) io.observe(h);
  });
  const active = document.querySelector(".dnav a.active");
  if (active) active.scrollIntoView({ block: "nearest" });
})();
