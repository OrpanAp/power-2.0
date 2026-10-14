// Event delegation so handlers survive live-reload DOM sync. No inline JS (strict CSP).
document.addEventListener("submit", (e) => {
  const msg = e.target.dataset && e.target.dataset.confirm;
  if (msg && !window.confirm(msg)) e.preventDefault();
});
// <button data-copy="text"> copies text to the clipboard
document.addEventListener("click", async (e) => {
  const b = e.target.closest && e.target.closest("[data-copy]");
  if (!b) return;
  try {
    await navigator.clipboard.writeText(b.dataset.copy);
    const t = b.textContent;
    b.textContent = "Copied!";
    setTimeout(() => {
      b.textContent = t;
    }, 1400);
  } catch {
    /* clipboard blocked */
  }
});
