// ship-or-theater site: copy buttons, install tabs, gallery filter. Content is static HTML; this only adds behaviour.
(() => {
  const status = document.getElementById("copy-status");

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      let ok = false;
      try { ok = document.execCommand("copy"); } catch { ok = false; }
      ta.remove();
      return ok;
    }
  }

  document.querySelectorAll(".copy").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const wrap = btn.closest("[data-copy-wrap]");
      const text = btn.dataset.copy ?? wrap?.querySelector("pre code")?.textContent ?? "";
      const ok = await copyText(text.trim());
      btn.textContent = ok ? "Copied" : "Press Ctrl+C";
      if (ok) btn.dataset.done = ""; else delete btn.dataset.done;
      if (status) status.textContent = ok ? "Copied to clipboard" : "Copy failed; select the text and copy it";
      clearTimeout(btn._t);
      btn._t = setTimeout(() => { btn.textContent = "Copy"; delete btn.dataset.done; }, 1800);
    });
  });

  // Tabs (WAI-ARIA tabs pattern, automatic activation)
  const tablist = document.querySelector('[role="tablist"]');
  if (tablist) {
    const tabs = [...tablist.querySelectorAll('[role="tab"]')];
    const select = (tab, focus) => {
      tabs.forEach((t) => {
        const on = t === tab;
        t.setAttribute("aria-selected", String(on));
        t.tabIndex = on ? 0 : -1;
        document.getElementById(t.getAttribute("aria-controls")).hidden = !on;
      });
      if (focus) tab.focus();
    };
    tabs.forEach((t, i) => {
      t.addEventListener("click", () => select(t, false));
      t.addEventListener("keydown", (e) => {
        let j = null;
        if (e.key === "ArrowRight") j = (i + 1) % tabs.length;
        else if (e.key === "ArrowLeft") j = (i - 1 + tabs.length) % tabs.length;
        else if (e.key === "Home") j = 0;
        else if (e.key === "End") j = tabs.length - 1;
        if (j !== null) { e.preventDefault(); select(tabs[j], true); }
      });
    });
  }

  // Gallery filter
  const chips = [...document.querySelectorAll(".chip[data-filter]")];
  const cards = [...document.querySelectorAll(".card[data-verdict]")];
  const fstatus = document.getElementById("filter-status");
  chips.forEach((chip) => {
    chip.addEventListener("click", () => {
      const f = chip.dataset.filter;
      chips.forEach((c) => c.setAttribute("aria-pressed", String(c === chip)));
      let shown = 0;
      cards.forEach((card) => {
        const on = f === "all" || card.dataset.verdict === f;
        card.hidden = !on;
        if (on) shown++;
      });
      if (fstatus) fstatus.textContent = `Showing ${shown} scorecard${shown === 1 ? "" : "s"}`;
    });
  });

  // Gallery layout: each card spans its own height in 1px grid rows, so opening one only grows its column.
  const grid = document.querySelector(".cards");
  if (grid && "ResizeObserver" in window) {
    grid.classList.add("is-masonry");
    const fit = (card) => {
      const h = card.getBoundingClientRect().height;
      if (h > 0) card.style.gridRowEnd = `span ${Math.ceil(h) + (parseFloat(getComputedStyle(grid).columnGap) || 0)}`;
    };
    const ro = new ResizeObserver((entries) => entries.forEach((e) => fit(e.target)));
    cards.forEach((c) => { fit(c); ro.observe(c); });
  }

  // Phone menu (disclosure): Escape or a link closes it, focus goes back to the button; leaving it closes it.
  const toggle = document.querySelector(".nav-toggle");
  const menu = toggle && document.getElementById(toggle.getAttribute("aria-controls"));
  if (toggle && menu) {
    const setOpen = (on, refocus) => {
      toggle.setAttribute("aria-expanded", String(on));
      if (!on && refocus) toggle.focus();
    };
    toggle.addEventListener("click", () => setOpen(toggle.getAttribute("aria-expanded") !== "true"));
    menu.addEventListener("click", (e) => { if (e.target.closest("a")) setOpen(false); });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && toggle.getAttribute("aria-expanded") === "true") setOpen(false, true);
    });
    document.addEventListener("click", (e) => {
      if (toggle.getAttribute("aria-expanded") === "true" && !e.target.closest(".nav")) setOpen(false);
    });
    toggle.parentElement.addEventListener("focusout", (e) => {
      if (toggle.getAttribute("aria-expanded") === "true" && e.relatedTarget && !toggle.parentElement.contains(e.relatedTarget)) setOpen(false);
    });
  }

  // Open a card when its anchor is the target (hero "Full scorecard" link)
  const openTarget = () => {
    const el = location.hash && document.getElementById(location.hash.slice(1));
    const d = el?.querySelector?.("details");
    if (d) d.open = true;
  };
  window.addEventListener("hashchange", openTarget);
  openTarget();
})();
