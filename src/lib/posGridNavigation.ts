export type PosGridDirection = 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight';

/** Move highlight index across a responsive product grid. */
export function movePosGridIndex(
  current: number,
  direction: PosGridDirection,
  length: number,
  columns: number,
): number {
  if (length <= 0) return -1;
  if (current < 0) return 0;

  const cols = Math.max(1, columns);
  const col = current % cols;
  const row = Math.floor(current / cols);
  const maxRow = Math.floor((length - 1) / cols);

  switch (direction) {
    case 'ArrowRight': {
      if (col < cols - 1 && current + 1 < length) return current + 1;
      const nextRowFirst = (row + 1) * cols;
      if (nextRowFirst < length) return nextRowFirst;
      return current;
    }
    case 'ArrowLeft': {
      if (col > 0) return current - 1;
      if (row > 0) {
        const prevRowStart = (row - 1) * cols;
        const prevRowLast = Math.min(prevRowStart + cols, length) - 1;
        return Math.min(prevRowStart + col, prevRowLast);
      }
      return current;
    }
    case 'ArrowDown': {
      const below = current + cols;
      if (below < length) return below;
      const target = maxRow * cols + col;
      if (target < length && target > current) return target;
      return current;
    }
    case 'ArrowUp': {
      const above = current - cols;
      if (above >= 0) return above;
      if (col < length) return col;
      return current;
    }
    default:
      return current;
  }
}

/** Count columns in a CSS grid by comparing tile vertical positions. */
export function measurePosGridColumns(gridEl: HTMLElement | null): number {
  if (!gridEl) return 2;

  const items = gridEl.querySelectorAll<HTMLElement>('[data-pos-product-id]');
  if (items.length <= 1) return Math.max(1, items.length);

  const firstTop = items[0].getBoundingClientRect().top;
  let cols = 1;
  for (let i = 1; i < items.length; i++) {
    const top = items[i].getBoundingClientRect().top;
    if (Math.abs(top - firstTop) <= 4) cols += 1;
    else break;
  }
  return Math.max(1, cols);
}
