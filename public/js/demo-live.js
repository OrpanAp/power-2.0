// Live stream demo: one Server-Sent Events connection, no polling.
(() => {
  const root = document.getElementById("live-demo");
  if (!root) return;
  const $ = (id) => document.getElementById(id),
    rss = [];
  const bytes = (n) => {
    const u = ["B", "KB", "MB", "GB"];
    let i = 0;
    while (n >= 1024 && i < 3) {
      n /= 1024;
      i++;
    }
    return `${n.toFixed(i ? 1 : 0)} ${u[i]}`;
  };
  const up = (s) => {
    const m = Math.floor(s / 60);
    return m ? `${m}m ${s % 60}s` : `${s}s`;
  };
  const es = new EventSource(root.dataset.src);
  es.onopen = () => {
    $("m-status").textContent = "connected";
  };
  es.onerror = () => {
    $("m-status").textContent = "reconnecting…";
  };
  es.addEventListener("viewers", (e) => {
    $("m-viewers").textContent = JSON.parse(e.data).count;
  });
  es.addEventListener("tick", (e) => {
    const d = JSON.parse(e.data);
    $("m-viewers").textContent = d.viewers;
    $("m-uptime").textContent = up(d.uptime);
    $("m-rss").textContent = bytes(d.rss);
    $("m-req").textContent = d.requests;
    rss.push(d.rss);
    if (rss.length > 60) rss.shift();
    const lo = Math.min(...rss),
      hi = Math.max(...rss),
      span = hi - lo || 1;
    $("spark-line").setAttribute(
      "points",
      rss
        .map(
          (v, i) =>
            `${(i / Math.max(rss.length - 1, 1)) * 600},${110 - ((v - lo) / span) * 100}`,
        )
        .join(" "),
    );
    $("m-range").textContent = `${bytes(lo)} - ${bytes(hi)}`;
  });
  window.addEventListener("pagehide", () => es.close());
})();
