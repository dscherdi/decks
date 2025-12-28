/**
 * Binary min-heap implementation for O(log n) operations
 * Used for efficient priority queue operations in simulations
 */
export class MinHeap<T> {
  private heap: T[] = [];
  private compareFunc: (a: T, b: T) => number;

  /**
   * Creates a new MinHeap
   * @param compareFunc - Comparison function that returns negative if a < b, positive if a > b, 0 if equal
   */
  constructor(compareFunc: (a: T, b: T) => number) {
    this.compareFunc = compareFunc;
  }

  /**
   * Returns the number of elements in the heap
   */
  size(): number {
    return this.heap.length;
  }

  /**
   * Adds an element to the heap in O(log n) time
   */
  push(node: T): void {
    this.heap.push(node);
    this.bubbleUp(this.heap.length - 1);
  }

  /**
   * Removes and returns the minimum element in O(log n) time
   */
  pop(): T | undefined {
    if (this.heap.length === 0) return undefined;
    if (this.heap.length === 1) return this.heap.pop();

    const min = this.heap[0];
    this.heap[0] = this.heap.pop()!;
    this.bubbleDown(0);
    return min;
  }

  /**
   * Returns the minimum element without removing it
   */
  peek(): T | undefined {
    return this.heap[0];
  }

  /**
   * Moves an element up the heap to maintain heap property
   */
  private bubbleUp(index: number): void {
    while (index > 0) {
      const parentIndex = Math.floor((index - 1) / 2);
      if (this.compareFunc(this.heap[index], this.heap[parentIndex]) >= 0) {
        break;
      }

      [this.heap[index], this.heap[parentIndex]] = [
        this.heap[parentIndex],
        this.heap[index],
      ];
      index = parentIndex;
    }
  }

  /**
   * Moves an element down the heap to maintain heap property
   */
  private bubbleDown(index: number): void {
    while (true) {
      const leftChild = 2 * index + 1;
      const rightChild = 2 * index + 2;
      let smallest = index;

      if (
        leftChild < this.heap.length &&
        this.compareFunc(this.heap[leftChild], this.heap[smallest]) < 0
      ) {
        smallest = leftChild;
      }

      if (
        rightChild < this.heap.length &&
        this.compareFunc(this.heap[rightChild], this.heap[smallest]) < 0
      ) {
        smallest = rightChild;
      }

      if (smallest === index) break;

      [this.heap[index], this.heap[smallest]] = [
        this.heap[smallest],
        this.heap[index],
      ];
      index = smallest;
    }
  }
}
