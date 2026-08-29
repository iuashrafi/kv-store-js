const test = require("node:test");
const assert = require("node:assert/strict");

const BloomFilter = require("./BloomFilter.js");

test("mightContain is true for every key that was added", () => {
  const filter = new BloomFilter(1000, 3);

  const keys = ["apple", "banana", "cherry", "date", "elderberry"];

  for (const key of keys) {
    filter.add(key);
  }

  for (const key of keys) {
    assert.equal(filter.mightContain(key), true);
  }
});

test("mightContain is false for a key that was never added, when the filter is not saturated", () => {
  // A large, mostly-empty filter keeps false-positive probability
  // effectively zero for this small a set of additions.
  const filter = new BloomFilter(10000, 3);

  filter.add("apple");
  filter.add("banana");

  assert.equal(filter.mightContain("not-in-the-filter"), false);
});

test("never produces a false negative for an added key, even in a small/saturated filter", () => {
  const filter = new BloomFilter(50, 3);

  const keys = Array.from({ length: 40 }, (_, i) => `key-${i}`);

  for (const key of keys) {
    filter.add(key);
  }

  for (const key of keys) {
    assert.equal(filter.mightContain(key), true, `false negative for ${key}`);
  }
});
