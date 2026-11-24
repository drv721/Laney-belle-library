// The Subcategories and locations screen. She adds, renames and removes
// them here; each change saves right away. Remove has Undo, and a removed one
// comes back with every book that was in it.

const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const books = (n) => `${n} ${n === 1 ? "book" : "books"}`;

let ctx = null; // { api, toast, getSettings, onChange }

const WORDS = ["Row", "Cubby", "Shelf"]; // same as src/sections.js

// A location also has its room, how many rows it has, and the word for one.
function detailsHtml(r) {
  const word = r.shelf_word || "Row";
  return `<div class="section-details">
      <label>Room <input data-detail="room" data-id="${esc(r.id)}" value="${esc(r.room)}" autocomplete="off" maxlength="60"></label>
      <label>How many <input data-detail="shelf_count" data-id="${esc(r.id)}" value="${esc(r.shelf_count)}" inputmode="numeric" autocomplete="off" maxlength="2"></label>
      <label>Called <select data-detail="shelf_word" data-id="${esc(r.id)}">${WORDS.map((w) => `<option ${w === word ? "selected" : ""}>${w}</option>`).join("")}</select></label>
      <label class="check"><input type="checkbox" data-detail="doors" data-id="${esc(r.id)}" ${r.doors === "glass" ? "checked" : ""}> Glass doors</label>
    </div>`;
}

function listHtml(kind, rows) {
  const word = kind === "subcategories" ? "subcategory" : "location";
  return `<ul class="section-list">${rows.map((r) => `
      <li>
        <input value="${esc(r.name)}" data-kind="${kind}" data-id="${esc(r.id)}" data-name="${esc(r.name)}" aria-label="Name of ${word} ${esc(r.name)}" autocomplete="off" maxlength="60">
        <button type="button" class="ghost" data-remove="${esc(r.id)}" data-kind="${kind}" data-name="${esc(r.name)}">Remove</button>
        <p class="count">${books(r.count)}</p>
        ${kind === "locations" ? detailsHtml(r) : ""}
      </li>`).join("")}</ul>`;
}

async function saveDetail(el) {
  const f = el.dataset.detail;
  const value = f === "doors" ? (el.checked ? "glass" : null)
    : f === "shelf_count" ? (el.value.trim() === "" ? null : Number(el.value.trim()))
    : el.value;
  try {
    await ctx.api(`/api/locations/${el.dataset.id}`, { method: "PATCH", body: { [f]: value } });
    $("#sections-msg").textContent = "";
  } catch (err) {
    $("#sections-msg").textContent = err.message;
  }
  await refresh();
}

function addHtml(kind, collectionId, placeholder) {
  return `<div class="section-add">
      <input data-add="${kind}" ${collectionId ? `data-collection="${esc(collectionId)}"` : ""} placeholder="${placeholder}" autocomplete="off" maxlength="60" aria-label="${placeholder}">
      <button type="button" data-add-btn>Add</button>
    </div>`;
}

export function render(settings) {
  const several = settings.collections.length > 1;
  const subs = settings.collections.map((c) => {
    const rows = settings.subcategories.filter((s) => s.collection_id === c.id);
    return `<h3>Subcategories${several ? ` in ${esc(c.name)}` : ""}</h3>
      ${rows.length ? "" : `<p class="muted">None yet. Try Classics, Fiction, Fantasy or Work.</p>`}
      ${listHtml("subcategories", rows)}
      ${addHtml("subcategories", c.id, "New subcategory")}`;
  }).join("");
  $("#sections-body").innerHTML = `${subs}
    <h3>Locations</h3>
    ${settings.locations.length ? "" : `<p class="muted">None yet.</p>`}
    ${listHtml("locations", settings.locations)}
    ${addHtml("locations", null, "New location")}`;
}

async function refresh() {
  await ctx.onChange();
  render(ctx.getSettings());
}

async function rename(input) {
  const name = input.value.trim();
  if (!name || name === input.dataset.name) { input.value = input.dataset.name; return; }
  try {
    await ctx.api(`/api/${input.dataset.kind}/${input.dataset.id}`, { method: "PATCH", body: { name } });
    $("#sections-msg").textContent = "";
    await refresh();
  } catch (err) {
    $("#sections-msg").textContent = err.message;
    input.value = input.dataset.name;
  }
}

async function add(input) {
  const name = input.value.trim();
  if (!name) return;
  const kind = input.dataset.add;
  try {
    await ctx.api(`/api/${kind}`, { method: "POST", body: { name, collection_id: input.dataset.collection } });
    $("#sections-msg").textContent = "";
    await refresh();
    $(`[data-add="${kind}"]${input.dataset.collection ? `[data-collection="${input.dataset.collection}"]` : ""}`)?.focus();
  } catch (err) {
    $("#sections-msg").textContent = err.message;
  }
}

async function remove(btn) {
  const { kind, remove: id, name } = btn.dataset;
  try {
    await ctx.api(`/api/${kind}/${id}`, { method: "DELETE" });
    $("#sections-msg").textContent = "";
    await refresh();
    ctx.toast(`Removed ${name}`, async () => {
      try {
        await ctx.api(`/api/${kind}/${id}/restore`, { method: "POST" });
      } catch (err) {
        ctx.toast(err.message);
      }
      await refresh();
    });
  } catch (err) {
    $("#sections-msg").textContent = err.message;
  }
}

export async function openSections() {
  $("#sections-msg").textContent = "";
  render(ctx.getSettings());
  $("#sections-dialog").showModal();
  try { await refresh(); } catch { /* counts stay as they were */ }
}

export function wireSections(c) {
  ctx = c;
  const body = $("#sections-body");
  // A rename saves when she leaves the box or presses Enter.
  body.addEventListener("change", (e) => {
    if (e.target.dataset.detail) saveDetail(e.target);
    else if (e.target.dataset.id) rename(e.target);
  });
  body.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" || e.isComposing || e.target.tagName !== "INPUT") return;
    e.preventDefault(); // Enter never closes the screen
    if (e.target.dataset.add) add(e.target);
    else e.target.blur();
  });
  body.addEventListener("click", (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;
    if (btn.dataset.remove) remove(btn);
    else if (btn.hasAttribute("data-add-btn")) add(btn.previousElementSibling);
  });
}
