/* Bridgewater Site Visibility Calendar */
(() => {
  const REFRESH_MS = 60 * 1000;
  const TYPES = {
    event: { label: "EVENT", plural: "Events", icon: "★" },
    contractor: { label: "CONTRACTOR", plural: "Contractors Onsite", icon: "⚒" },
    pto: { label: "PTO / OOO", plural: "PTO / OOO", icon: "✈" },
  };
  const DOW = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"];

  const state = { entries: [], view: "month", cursor: today(), filter: "all", lastSync: null, summaryOpen: false };
  let todayKey = key(today());

  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  /* ---------- Dates (local, no UTC drift) ---------- */
  function today() { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
  function key(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }
  function parse(k) { const [y, m, d] = k.split("-").map(Number); return new Date(y, m - 1, d); }
  function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
  function mondayOf(d) { return addDays(d, -((d.getDay() + 6) % 7)); }
  function fmtTime(t) {
    if (!t) return "";
    let [h, m] = t.split(":").map(Number);
    const ap = h >= 12 ? "PM" : "AM"; h = h % 12 || 12;
    return `${h}:${String(m).padStart(2, "0")} ${ap}`;
  }
  function shortTime(t) {
    let [h, m] = t.split(":").map(Number);
    const ap = h >= 12 ? "p" : "a"; h = h % 12 || 12;
    return m ? `${h}:${String(m).padStart(2, "0")}${ap}` : `${h}${ap}`;
  }
  function timeRange(e) {
    if (e.allDay || !e.startTime) return "All day";
    return e.endTime ? `${fmtTime(e.startTime)} – ${fmtTime(e.endTime)}` : fmtTime(e.startTime);
  }
  function fmtDate(k, opts = { weekday: "short", month: "short", day: "numeric" }) { return parse(k).toLocaleDateString(undefined, opts); }
  function dateRange(e) { return e.startDate === e.endDate ? fmtDate(e.startDate) : `${fmtDate(e.startDate)} – ${fmtDate(e.endDate)}`; }

  /* ---------- API ---------- */
  async function api(path, opts = {}) {
    const res = await fetch(path, { credentials: "same-origin", headers: { "Content-Type": "application/json" }, ...opts });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && path !== "/api/login") { showAccess(); throw new Error("Session expired"); }
    if (!res.ok) throw new Error(data.error || "Something went wrong");
    return data;
  }
  async function load(silent) {
    try {
      const { entries } = await api("/api/entries");
      state.entries = entries;
      state.lastSync = new Date();
      render();
    } catch (e) { if (!silent) toast(e.message); }
  }

  /* ---------- Access ---------- */
  function showAccess() { $("#app").classList.add("hidden"); $("#access").classList.remove("hidden"); setTimeout(() => $("#passkey").focus(), 50); }
  function showApp() { $("#access").classList.add("hidden"); $("#app").classList.remove("hidden"); load(); }
  $("#accessForm").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    $("#accessError").textContent = "";
    const btn = ev.target.querySelector("button"); btn.disabled = true; btn.textContent = "Checking…";
    try {
      await api("/api/login", { method: "POST", body: JSON.stringify({ passkey: $("#passkey").value }) });
      $("#passkey").value = "";
      showApp();
    } catch (e) { $("#accessError").textContent = e.message; }
    btn.disabled = false; btn.textContent = "Enter";
  });

  /* ---------- Data helpers ---------- */
  function visible() { return state.entries.filter((e) => state.filter === "all" || e.type === state.filter); }
  function sortEntries(list) {
    const order = { pto: 0, contractor: 1, event: 2 };
    return [...list].sort((a, b) => {
      const ad = a.allDay ? 0 : 1, bd = b.allDay ? 0 : 1;
      if (ad !== bd) return ad - bd;
      if (!a.allDay && a.startTime !== b.startTime) return a.startTime < b.startTime ? -1 : 1;
      if (order[a.type] !== order[b.type]) return order[a.type] - order[b.type];
      return a.title.localeCompare(b.title);
    });
  }
  function on(k, list = visible()) { return sortEntries(list.filter((e) => e.startDate <= k && e.endDate >= k)); }

  /* ---------- Rendering ---------- */
  function pill(e) {
    const tm = e.allDay || !e.startTime ? (e.type === "pto" ? "OOO" : "All day") : (e.endTime ? `${shortTime(e.startTime)}–${shortTime(e.endTime)}` : shortTime(e.startTime));
    return `<div class="pill ${e.type}" data-id="${e.id}"><span class="t">${esc(e.title)}</span>${tm ? `<span class="tm">${esc(tm)}</span>` : ""}</div>`;
  }
  function card(e, big) {
    const meta = [];
    if (e.type === "contractor" && e.purpose) meta.push(esc(e.purpose));
    if (e.location) meta.push("Location: " + esc(e.location));
    if (e.owner) meta.push((e.type === "contractor" ? "Host: " : "Owner: ") + esc(e.owner));
    if (e.startDate !== e.endDate) meta.push("Dates: " + esc(dateRange(e)));
    return `<div class="card ${e.type}" data-id="${e.id}">
      <span class="ctype">${TYPES[e.type].label}</span>
      <span class="ct">${esc(e.title)}</span>
      <span class="${big ? "ctime" : "cm"}">${esc(timeRange(e))}</span>
      ${meta.map((m) => `<span class="cm">${m}</span>`).join("")}
    </div>`;
  }

  function renderMonth() {
    const c = state.cursor, first = new Date(c.getFullYear(), c.getMonth(), 1);
    const start = mondayOf(first);
    const last = new Date(c.getFullYear(), c.getMonth() + 1, 0);
    const weeks = Math.ceil(((last - start) / 864e5 + 1) / 7);
    const list = visible();
    $("#rangeLabel").textContent = first.toLocaleDateString(undefined, { month: "long", year: "numeric" });
    const maxShow = weeks > 5 ? 3 : 4;
    let cells = "";
    for (let i = 0; i < weeks * 7; i++) {
      const d = addDays(start, i), k = key(d), items = on(k, list);
      const cls = ["day-cell", d.getMonth() !== c.getMonth() && "other", k === todayKey && "today", i % 7 >= 5 && "weekend"].filter(Boolean).join(" ");
      const shown = items.slice(0, maxShow).map(pill).join("");
      const more = items.length > maxShow ? `<div class="more">+${items.length - maxShow} more</div>` : "";
      cells += `<div class="${cls}" data-day="${k}"><div class="num"><span>${d.getDate()}</span>${k === todayKey ? '<em class="today-tag">TODAY</em>' : ""}</div>${shown}${more}</div>`;
    }
    $("#calendar").innerHTML = `<div class="month-scroll"><div class="month">
      <div class="month-head">${DOW.map((d) => `<div>${d.slice(0, 3)}</div>`).join("")}</div>
      <div class="month-grid" style="grid-template-rows:repeat(${weeks},1fr)">${cells}</div></div></div>`;
  }

  function renderWeek() {
    const start = mondayOf(state.cursor), end = addDays(start, 6), list = visible();
    const sameMonth = start.getMonth() === end.getMonth();
    const mo = (d) => d.toLocaleDateString(undefined, { month: "short" });
    $("#rangeLabel").textContent = sameMonth ? `${mo(start)} ${start.getDate()} – ${end.getDate()}, ${end.getFullYear()}` : `${mo(start)} ${start.getDate()} – ${mo(end)} ${end.getDate()}, ${end.getFullYear()}`;
    let cols = "";
    for (let i = 0; i < 7; i++) {
      const d = addDays(start, i), k = key(d), items = on(k, list);
      cols += `<div class="week-col ${k === todayKey ? "today" : ""}">
        <div class="week-col-head" data-day="${k}"><div class="wd">${DOW[i]}${k === todayKey ? " · TODAY" : ""}</div><div class="wn">${d.toLocaleDateString(undefined, { month: "short", day: "numeric" })}</div></div>
        <div class="week-col-body">${items.length ? items.map((e) => card(e)).join("") : '<div class="empty">Nothing scheduled</div>'}</div></div>`;
    }
    $("#calendar").innerHTML = `<div class="week">${cols}</div>`;
  }

  function renderDay() {
    const k = key(state.cursor), items = on(k);
    $("#rangeLabel").textContent = state.cursor.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" }) + (k === todayKey ? " · Today" : "");
    if (!items.length) { $("#calendar").innerHTML = `<div class="day-empty">Nothing scheduled for this day.</div>`; return; }
    const allDay = items.filter((e) => e.allDay), timed = items.filter((e) => !e.allDay);
    const sec = (title, arr) => arr.length ? `<div class="day-section"><h3>${title}</h3><div class="day-cards">${arr.map((e) => card(e, true)).join("")}</div></div>` : "";
    $("#calendar").innerHTML = `<div class="day">${sec("ALL DAY", allDay)}${sec("SCHEDULED", timed)}</div>`;
  }

  function renderSummary() {
    const items = on(todayKey, state.entries);
    const by = (t) => items.filter((e) => e.type === t);
    $("#summaryCounts").innerHTML = ["event", "contractor", "pto"].map((t) =>
      `<span><span class="dot ${t}"></span> <b>${by(t).length}</b> ${TYPES[t].plural}</span>`).join("");
    $("#summaryBody").innerHTML = ["event", "contractor", "pto"].map((t) => `
      <div class="summary-col ${t}"><h4 style="color:var(--c)">${TYPES[t].plural.toUpperCase()}</h4>
      <ul>${by(t).map((e) => `<li class="${t}" data-id="${e.id}">${esc(e.title)} <span class="muted">· ${esc(timeRange(e))}</span></li>`).join("") || '<li class="empty" style="background:none">None today</li>'}</ul></div>`).join("");
  }

  function renderHeader() {
    const t = new Date();
    $("#hdrDay").textContent = t.toLocaleDateString(undefined, { weekday: "long" });
    $("#hdrDate").textContent = t.toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" });
    $("#syncNote").textContent = state.lastSync ? `Last updated ${state.lastSync.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })} · refreshes automatically` : "";
  }

  function render() {
    renderHeader();
    ({ month: renderMonth, week: renderWeek, day: renderDay })[state.view]();
    renderSummary();
    document.querySelectorAll("#viewSeg button").forEach((b) => b.classList.toggle("active", b.dataset.view === state.view));
    document.querySelectorAll("#filterSeg button").forEach((b) => b.classList.toggle("active", b.dataset.filter === state.filter));
  }

  /* ---------- Modal ---------- */
  function openModal(html) { $("#modalCard").innerHTML = html; $("#modal").classList.remove("hidden"); }
  function closeModal() { $("#modal").classList.add("hidden"); $("#modalCard").innerHTML = ""; }
  $("#modal").addEventListener("click", (e) => { if (e.target.id === "modal") closeModal(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeModal(); });
  const head = (title, sub = "") => `<div class="modal-head"><div>${sub}<h2>${title}</h2></div><button class="close" data-act="close" aria-label="Close">✕</button></div>`;

  function openChooser() {
    openModal(head("What would you like to add?") + `<div class="choices">
      <button class="choice event" data-add="event"><span class="ic">${TYPES.event.icon}</span><span>ADD EVENT<small>Site events, training, tours, demos</small></span></button>
      <button class="choice contractor" data-add="contractor"><span class="ic">${TYPES.contractor.icon}</span><span>ADD CONTRACTOR<small>Vendors, service techs, project work</small></span></button>
      <button class="choice pto" data-add="pto"><span class="ic">${TYPES.pto.icon}</span><span>ADD PTO / OOO<small>Team out-of-office visibility</small></span></button>
    </div>`);
  }

  function field(name, label, val = "", type = "text", full = false, extra = "") {
    return `<div class="field ${full ? "full" : ""}"><label for="f_${name}">${label}</label><input id="f_${name}" name="${name}" type="${type}" value="${esc(val)}" ${extra}/></div>`;
  }
  function openForm(type, e = null) {
    const d = e || { startDate: key(state.view === "month" ? today() : state.cursor), allDay: type === "pto" };
    if (!e && state.view !== "month") d.startDate = key(state.cursor);
    d.endDate = d.endDate || d.startDate;
    const titleLbl = { event: "Event title *", contractor: "Contractor / vendor / company *", pto: "Person / name *" }[type];
    let f = field("title", titleLbl, d.title, "text", true, 'required maxlength="120"');
    if (type === "contractor") f += field("purpose", "Purpose of visit / work", d.purpose, "text", true, 'maxlength="200"');
    f += field("startDate", "Start date *", d.startDate, "date", false, "required");
    f += field("endDate", "End date", d.endDate, "date");
    f += `<div class="hint">For multi-day ${type === "pto" ? "PTO" : type === "event" ? "events" : "visits"}, set an end date. Leave it the same for a single day.</div>`;
    f += `<label class="check"><input type="checkbox" name="allDay" id="f_allDay" ${d.allDay ? "checked" : ""}/> All day</label>`;
    f += `<div class="field times">${`<label for="f_startTime">Start time</label><input id="f_startTime" name="startTime" type="time" value="${esc(d.startTime || "")}"/>`}</div>`;
    f += `<div class="field times">${`<label for="f_endTime">End time</label><input id="f_endTime" name="endTime" type="time" value="${esc(d.endTime || "")}"/>`}</div>`;
    if (type !== "pto") {
      f += field("location", type === "contractor" ? "Location / area" : "Location", d.location, "text", false, 'maxlength="120"');
      f += field("owner", type === "contractor" ? "Nestlé host / contact" : "Host / owner", d.owner, "text", false, 'maxlength="120"');
      f += `<div class="field full"><label for="f_notes">Short notes</label><textarea id="f_notes" name="notes" maxlength="500">${esc(d.notes || "")}</textarea></div>`;
    }
    openModal(head(e ? `Edit ${TYPES[type].label === "PTO / OOO" ? "PTO / OOO" : TYPES[type].label.toLowerCase()}` : `Add ${type === "pto" ? "PTO / OOO" : type}`, `<span class="type-badge ${type}">${TYPES[type].label}</span>`) +
      `<form id="entryForm" class="form ${type}">${f}</form>
       <div class="actions"><button class="btn btn-ghost" data-act="${e ? "details" : "back"}" data-id="${e ? e.id : ""}">${e ? "Cancel" : "Back"}</button>
       <button class="btn btn-primary btn-save" data-act="save" data-type="${type}" data-id="${e ? e.id : ""}">${e ? "Save changes" : "Save"}</button></div>`);
    const sync = () => document.querySelectorAll(".times").forEach((x) => x.classList.toggle("hidden", $("#f_allDay").checked));
    $("#f_allDay").addEventListener("change", sync); sync();
    $("#f_startDate").addEventListener("change", () => { if ($("#f_endDate").value < $("#f_startDate").value) $("#f_endDate").value = $("#f_startDate").value; });
    setTimeout(() => $("#f_title").focus(), 50);
  }

  async function save(type, id) {
    const form = $("#entryForm");
    if (!form.reportValidity()) return;
    const fd = Object.fromEntries(new FormData(form).entries());
    const body = { ...fd, type, allDay: $("#f_allDay").checked };
    if (body.allDay) { body.startTime = ""; body.endTime = ""; }
    else if (!body.startTime) { toast("Add a start time or select All day"); return; }
    if (body.endDate && body.endDate < body.startDate) { toast("End date cannot be before start date"); return; }
    const btn = document.querySelector(".btn-save"); btn.disabled = true; btn.textContent = "Saving…";
    try {
      const { entry } = await api(id ? `/api/entries/${encodeURIComponent(id)}` : "/api/entries", { method: id ? "PUT" : "POST", body: JSON.stringify(body) });
      state.entries = state.entries.filter((x) => x.id !== entry.id).concat(entry);
      closeModal(); render(); toast(id ? "Changes saved" : "Added to calendar");
    } catch (e) { toast(e.message); btn.disabled = false; btn.textContent = "Save"; }
  }

  function openDetails(id) {
    const e = state.entries.find((x) => x.id === id); if (!e) return;
    const rows = [["Date", dateRange(e)], ["Time", timeRange(e)]];
    if (e.type === "contractor") rows.push(["Purpose", e.purpose]);
    if (e.type !== "pto") rows.push(["Location", e.location], [e.type === "contractor" ? "Nestlé host" : "Host / owner", e.owner], ["Notes", e.notes]);
    openModal(head(esc(e.title), `<span class="type-badge ${e.type}">${TYPES[e.type].label}</span>`) +
      `<dl class="details">${rows.filter((r) => r[1]).map(([a, b]) => `<dt>${a}</dt><dd>${esc(b)}</dd>`).join("")}</dl>
      <div class="actions"><button class="btn btn-danger" data-act="confirmDelete" data-id="${e.id}">Delete</button>
      <button class="btn btn-primary" data-act="edit" data-id="${e.id}">Edit</button></div>`);
  }
  function confirmDelete(id) {
    const e = state.entries.find((x) => x.id === id); if (!e) return;
    openModal(head("Delete this activity?") + `<p style="font-size:1.1em">“<b>${esc(e.title)}</b>” on ${esc(dateRange(e))} will be removed for everyone.</p>
      <div class="actions"><button class="btn btn-ghost" data-act="details" data-id="${id}">Cancel</button><button class="btn btn-danger" data-act="delete" data-id="${id}">Yes, delete</button></div>`);
  }
  async function del(id) {
    try { await api(`/api/entries/${encodeURIComponent(id)}`, { method: "DELETE" }); state.entries = state.entries.filter((x) => x.id !== id); closeModal(); render(); toast("Deleted"); }
    catch (e) { toast(e.message); }
  }

  /* ---------- Events ---------- */
  document.addEventListener("click", (ev) => {
    const t = ev.target.closest("[data-act],[data-add],[data-id],[data-day]");
    if (!t) return;
    if (t.dataset.add) return openForm(t.dataset.add);
    const act = t.dataset.act, id = t.dataset.id;
    if (act === "close") return closeModal();
    if (act === "back") return openChooser();
    if (act === "save") return save(t.dataset.type, id || null);
    if (act === "edit") { const e = state.entries.find((x) => x.id === id); return e && openForm(e.type, e); }
    if (act === "details") return openDetails(id);
    if (act === "confirmDelete") return confirmDelete(id);
    if (act === "delete") return del(id);
    if (id) { ev.stopPropagation(); return openDetails(id); }
    if (t.dataset.day) { state.cursor = parse(t.dataset.day); state.view = "day"; render(); }
  });
  $("#addBtn").onclick = openChooser;
  $("#viewSeg").onclick = (e) => { const b = e.target.closest("button"); if (b) { state.view = b.dataset.view; render(); } };
  $("#filterSeg").onclick = (e) => { const b = e.target.closest("button"); if (b) { state.filter = b.dataset.filter; render(); } };
  $("#prevBtn").onclick = () => step(-1);
  $("#nextBtn").onclick = () => step(1);
  $("#todayBtn").onclick = () => { state.cursor = today(); render(); };
  $("#summaryToggle").onclick = () => { state.summaryOpen = !state.summaryOpen; $("#summaryBody").classList.toggle("hidden", !state.summaryOpen); $("#summary").classList.toggle("open", state.summaryOpen); };
  function step(n) {
    const c = state.cursor;
    state.cursor = state.view === "month" ? new Date(c.getFullYear(), c.getMonth() + n, 1) : addDays(c, state.view === "week" ? 7 * n : n);
    render();
  }

  let toastTimer;
  function toast(msg) { const t = $("#toast"); t.textContent = msg; t.classList.remove("hidden"); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.add("hidden"), 2600); }

  /* ---------- Auto refresh (skips while a form is open) ---------- */
  setInterval(() => {
    const k = key(today());
    if (k !== todayKey) { todayKey = k; state.cursor = today(); }
    if (!$("#app").classList.contains("hidden") && $("#modal").classList.contains("hidden")) load(true);
    else renderHeader();
  }, REFRESH_MS);
  document.addEventListener("visibilitychange", () => { if (!document.hidden && !$("#app").classList.contains("hidden")) load(true); });

  /* ---------- Start ---------- */
  fetch("/api/session", { credentials: "same-origin" })
    .then((r) => (r.ok ? showApp() : showAccess()))
    .catch(showAccess);
})();
