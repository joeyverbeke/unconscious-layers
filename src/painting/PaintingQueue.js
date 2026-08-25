const COMPACTION_THRESHOLD = 8192;

export class PaintingQueue {
  constructor(items = []) {
    this.items = [...items];
    this.head = 0;
  }

  get length() {
    return this.items.length - this.head;
  }

  push(...items) {
    this.items.push(...items);
    return this.length;
  }

  shift() {
    if (this.length === 0) return undefined;
    const item = this.items[this.head];
    this.items[this.head] = undefined;
    this.head += 1;
    this.compactIfNeeded();
    return item;
  }

  discardOldest(count) {
    const discardCount = Math.min(Math.max(0, count), this.length);
    for (let index = 0; index < discardCount; index += 1) {
      this.items[this.head + index] = undefined;
    }
    this.head += discardCount;
    this.compactIfNeeded(true);
  }

  extractFirst(predicate, maximumCount) {
    const extracted = [];
    const retained = [];

    for (let index = this.head; index < this.items.length; index += 1) {
      const item = this.items[index];
      if (extracted.length < maximumCount && predicate(item)) {
        extracted.push(item);
      } else {
        retained.push(item);
      }
    }

    this.items = retained;
    this.head = 0;
    return extracted;
  }

  *[Symbol.iterator]() {
    for (let index = this.head; index < this.items.length; index += 1) {
      yield this.items[index];
    }
  }

  compactIfNeeded(force = false) {
    if (!force && this.head < COMPACTION_THRESHOLD) return;
    if (this.head === 0) return;
    this.items = this.items.slice(this.head);
    this.head = 0;
  }
}
