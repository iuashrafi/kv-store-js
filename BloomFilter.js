export class BloomFilter {
  constructor(size = 1000, hashCount = 3) {
    this.size = size;
    this.hashCount = hashCount;

    // Array of 0/1 bits
    this.bits = new Array(size).fill(0);
  }

  // Simple hash function
  hash(value, seed) {
    let hash = seed;

    for (let i = 0; i < value.length; i++) {
      hash = (hash * 31 + value.charCodeAt(i)) % this.size;
    }

    return Math.abs(hash);
  }

  add(key) {
    for (let i = 0; i < this.hashCount; i++) {
      const position = this.hash(key, i + 1);

      this.bits[position] = 1;
    }
  }

  mightContain(key) {
    for (let i = 0; i < this.hashCount; i++) {
      const position = this.hash(key, i + 1);

      // One bit is 0 → definitely not present
      if (this.bits[position] === 0) {
        return false;
      }
    }

    // All bits are 1 → maybe present
    return true;
  }
}
