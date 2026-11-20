import test from "node:test";
import assert from "node:assert/strict";
import { authorKey, sortByAuthor } from "../src/sort.js";

test("authorKey files names by last name", () => {
  assert.equal(authorKey("Jane Austen"), "austen jane");
  assert.equal(authorKey("Austen, Jane"), "austen jane");
  assert.equal(authorKey("Ursula K. Le Guin"), "le guin ursula k.");
  assert.equal(authorKey("Martin Luther King Jr."), "king martin luther");
  assert.equal(authorKey("Martin Luther King, Jr."), "king martin luther");
  assert.equal(authorKey("Ludwig van Beethoven"), "van beethoven ludwig");
  assert.equal(authorKey("Plato"), "plato");
  assert.equal(authorKey("Robert Arp (Editor)"), "arp robert");
  assert.equal(authorKey("Marc Brackett, Ph.D."), "brackett marc");
  assert.equal(authorKey("Kwame Alexander with Mary Rand Hess"), "alexander kwame");
  assert.equal(authorKey("  "), "");
  assert.equal(authorKey(undefined), "");
});

test("sortByAuthor puts books with no author last and keeps ties in order", () => {
  const items = [
    { title: "Z no author", authors: [] },
    { title: "Emma", authors: ["Jane Austen"] },
    { title: "Dracula", authors: ["Bram Stoker"] },
    { title: "Persuasion", authors: ["Jane Austen"] },
    { title: "A Wizard of Earthsea", authors: ["Ursula K. Le Guin"] },
  ];
  assert.deepEqual(sortByAuthor(items).map((i) => i.title),
    ["Emma", "Persuasion", "A Wizard of Earthsea", "Dracula", "Z no author"]);
});
