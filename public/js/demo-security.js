// Security lab: calls real, stateless endpoints (rate limited + origin checked) and shows the results.
(() => {
  const $ = (id) => document.getElementById(id);
  const post = async (url, body) => {
    const r = await fetch(url, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  };
  const debounce = (fn, ms = 250) => {
    let t;
    return (...a) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...a), ms);
    };
  };

  // 1 — escaping + SQL
  const input = $("esc-in");
  const run = debounce(async () => {
    try {
      const d = await post("/demo/api/escape", { text: input.value });
      $("esc-out").textContent = d.escaped;
      $("strip-out").textContent = d.stripped;
      $("md-out").innerHTML = d.markdown; // server-sanitised HTML
      $("sql-out").textContent =
        `${d.sql}\n-- ? is bound to: ${JSON.stringify(d.params[0])}\n-- rows matched: ${d.matches}   (the payload is data, never SQL)`;
    } catch (e) {
      $("esc-out").textContent = e.message;
    }
  });
  input.addEventListener("input", run);
  $("payloads").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-v]");
    if (b) {
      input.value = b.dataset.v;
      run();
    }
  });

  // 2 — validation
  const form = $("vform");
  const validate = debounce(async () => {
    const body = Object.fromEntries(new FormData(form));
    try {
      const d = await post("/demo/api/validate", body),
        out = $("v-out");
      out.replaceChildren();
      const add = (cls, text) => {
        const p = document.createElement("div");
        p.className = "vrow " + cls;
        p.textContent = text;
        out.appendChild(p);
      };
      if (d.ok) {
        add("vok", "✓ valid");
        add("", "validated(): " + JSON.stringify(d.validated));
      } else
        Object.entries(d.errors).forEach(([f, msgs]) =>
          add("vbad", `✗ ${f}: ${msgs[0]}`),
        );
    } catch (e) {
      $("v-out").textContent = e.message;
    }
  }, 200);
  form.addEventListener("input", validate);
  validate();

  // 3 — password policy
  const pw = $("pw-in");
  pw.addEventListener(
    "input",
    debounce(async () => {
      try {
        const d = await post("/demo/api/password", { password: pw.value });
        const v = $("pw-out");
        v.textContent = d.message;
        v.className = "verdict " + (pw.value ? (d.ok ? "good" : "bad") : "");
      } catch (e) {
        $("pw-out").textContent = e.message;
      }
    }),
  );
})();
