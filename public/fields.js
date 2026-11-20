// The Fields and statuses screen (Settings). She adds her own statuses (like
// Reading next) and her own fields for the book page (like Signed or Gift
// from), renames them, and removes them. Each change saves right away, and
// Remove has Undo. A removed field comes back with what she'd typed on every book.

const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const books = (n) => `${n} ${n === 1 ? "book" : "books"}`;

export const TYPE_LABELS = { text: "Text", number: "Number", date: "Date", yesno: "Yes or no" };

let ctx = null; // { api, toast, getSettings, onChange }

// The line under each one.
export function statusNote(s) {
  return s.is_default ? `${books(s.count)}. New books start here, so it stays.` : books(s.count);
}
export function fieldNote(f) {
  return `${TYPE_LABELS[f.field_type] ?? "Text"}. Filled in on ${books(f.count)}.`;
}

function rowHtml({ kind, key, name, note, removable }) {
  return `<li>
      <input value="${esc(name)}" data-kind="${kind}" data-key="${esc(key)}" data-name="${esc(name)}" aria-label="Name of ${esc(name)}" autocomplete="off" maxlength="60">
      ${removable ? `<button type="button" class="ghost" data-remove="${esc(key)}" data-kind="${kind}" data-name="${esc(name)}">Remove</button>` : "<span></span>"}
      <p class="count">${esc(note)}</p>
    </li>`;
}

export function fieldsHtml(settings) {
  const statuses = settings.statuses.map((s) =>
    rowHtml({ kind: "statuses", key: s.code, name: s.label, note: statusNote(s), removable: !s.is_default })).join("");
  const fields = (settings.custom_fields || []).map((f) =>
    rowHtml({ kind: "fields", key: f.id, name: f.name, note: fieldNote(f), removable: true })).join("");
  return `<h3>Statuses</h3>
    <p class="muted">The status button on each book steps through these in order.</p>
    <ul class="section-list">${statuses}</ul>
    <div class="section-add">
      <input data-add="statuses" placeholder="New status" aria-label="New status" autocomplete="off" maxlength="60">
      <button type="button" data-add-btn="statuses">Add</button>
    </div>
    <h3>Your own fields</h3>
    <p class="muted">They show on every book page, under More details.</p>
    ${fields ? `<ul class="section-list">${fields}</ul>` : `<p class="muted">None yet. Try Signed, Gift from or Edition.</p>`}
    <div class="field-add">
      <input data-add="fields" placeholder="New field" aria-label="New field" autocomplete="off" maxlength="60">
      <select id="field-type" aria-label="Kind of field">${Object.entries(TYPE_LABELS).map(([v, l]) => `<option value="${v}">${l}</option>`).join("")}</select>
      <button type="button" data-add-btn="fields">Add</button>
    </div>`;
}

const say = (t) => ($("#fields-msg").textContent = t || "");
const render = () => { $("#fields-body").innerHTML = fieldsHtml(ctx.getSettings()); };
async function refresh() {
  await ctx.onChange();
  render();
}
const bodyFor = (kind, name) => (kind === "statuses" ? { label: name } : { name });

async function rename(input) {
  const name = input.value.trim();
  if (!name || name === input.dataset.name) { input.value = input.dataset.name; return; }
  try {
    await ctx.api(`/api/${input.dataset.kind}/${input.dataset.key}`, { method: "PATCH", body: bodyFor(input.dataset.kind, name) });
    say("");
    await refresh();
  } catch (err) {
    say(err.message);
    input.value = input.dataset.name;
  }
}

async function add(kind) {
  const input = $(`[data-add="${kind}"]`);
  const name = input.value.trim();
  if (!name) return;
  const body = kind === "statuses" ? { label: name } : { name, field_type: $("#field-type").value };
  try {
    await ctx.api(`/api/${kind}`, { method: "POST", body });
    say("");
    await refresh();
    $(`[data-add="${kind}"]`)?.focus();
  } catch (err) {
    say(err.message);
  }
}

async function remove(btn) {
  const { kind, remove: key, name } = btn.dataset;
  try {
    await ctx.api(`/api/${kind}/${key}`, { method: "DELETE" });
    say("");
    await refresh();
    ctx.toast(`Removed ${name}`, async () => {
      try {
        await ctx.api(`/api/${kind}/${key}/restore`, { method: "POST" });
      } catch (err) {
        ctx.toast(err.message);
      }
      await refresh();
    });
  } catch (err) {
    say(err.message);
  }
}

export async function openFields() {
  say("");
  render();
  $("#fields-dialog").showModal();
  try { await refresh(); } catch { /* counts stay as they were */ }
}

export function wireFields(c) {
  ctx = c;
  const body = $("#fields-body");
  // A rename saves when she leaves the box or presses Enter.
  body.addEventListener("change", (e) => { if (e.target.dataset.key) rename(e.target); });
  body.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" || e.isComposing || e.target.tagName !== "INPUT") return;
    e.preventDefault(); // Enter never closes the screen
    if (e.target.dataset.add) add(e.target.dataset.add);
    else e.target.blur();
  });
  body.addEventListener("click", (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;
    if (btn.dataset.remove) remove(btn);
    else if (btn.dataset.addBtn) add(btn.dataset.addBtn);
  });
}
