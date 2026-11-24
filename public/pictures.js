// Settings > Add pictures: takes a pictures file (spines cut from her row
// photos, and cover photos) and adds each picture to the book it names.
// The file is made outside the app, one row or a few at a time.

import { chunks } from "./shelf.js";

const $ = (sel) => document.querySelector(sel);
const PER_CALL = 20; // same as PICTURES_MAX in src/pictures.js

// The file's pictures, or an error a person can act on.
export function readPicturesFile(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return { error: "That file isn't a pictures file." };
  }
  if (!data || data.kind !== "library-pictures" || !Array.isArray(data.pictures)) return { error: "That file isn't a pictures file." };
  if (!data.pictures.length) return { error: "That file has no pictures in it." };
  return { pictures: data.pictures };
}

export function resultLine(added, missing) {
  const n = (k, word) => `${k} ${word}${k === 1 ? "" : "s"}`;
  const head = `Added ${n(added, "picture")}.`;
  return missing ? `${head} ${n(missing, "picture")} named a book that isn't in the library now, so ${missing === 1 ? "it was" : "they were"} skipped.` : head;
}

export function wirePictures({ api, onChange }) {
  const dlg = $("#pictures-dialog");
  const msg = (t) => ($("#pictures-msg").textContent = t);
  $("#pictures-open").addEventListener("click", () => {
    $("#settings-dialog").close();
    $("#pictures-file").value = "";
    msg("");
    dlg.showModal();
  });
  $("#pictures-file").addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const read = readPicturesFile(await file.text());
    if (read.error) { msg(read.error); return; }
    let added = 0;
    let missing = 0;
    try {
      const parts = chunks(read.pictures, PER_CALL);
      for (const [i, part] of parts.entries()) {
        msg(`Adding pictures, part ${i + 1} of ${parts.length}...`);
        const r = await api("/api/pictures", { method: "POST", body: { pictures: part } });
        added += r.added;
        missing += r.missing.length;
      }
      msg(resultLine(added, missing));
    } catch (err) {
      msg(added ? `${resultLine(added, missing)} Then it stopped: ${err.message}` : `Couldn't add them: ${err.message}`);
    }
    await onChange();
  });
}
