import type { BBox } from './types';

export class SegmentationMap {
  width: number;
  height: number;
  ids: Uint16Array; // 0 = unassigned

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.ids = new Uint16Array(width * height);
  }

  paint(mask: Uint8Array, segmentId: number, bbox: BBox): void {
    for (let py = 0; py < bbox.height; py++) {
      for (let px = 0; px < bbox.width; px++) {
        const maskIdx = py * bbox.width + px;
        if (mask[maskIdx] > 0) {
          const globalX = bbox.x + px;
          const globalY = bbox.y + py;
          if (globalX >= 0 && globalX < this.width && globalY >= 0 && globalY < this.height) {
            this.ids[globalY * this.width + globalX] = segmentId;
          }
        }
      }
    }
  }

  clear(segmentId: number): void {
    for (let i = 0; i < this.ids.length; i++) {
      if (this.ids[i] === segmentId) {
        this.ids[i] = 0;
      }
    }
  }

  query(x: number, y: number): number {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    if (ix < 0 || ix >= this.width || iy < 0 || iy >= this.height) return 0;
    return this.ids[iy * this.width + ix];
  }

  pixelsForSegment(segmentId: number): { indices: Uint32Array; bbox: BBox } {
    let minX = this.width;
    let minY = this.height;
    let maxX = 0;
    let maxY = 0;
    let count = 0;

    for (let i = 0; i < this.ids.length; i++) {
      if (this.ids[i] === segmentId) {
        const x = i % this.width;
        const y = Math.floor(i / this.width);
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
        count++;
      }
    }

    if (count === 0) {
      return {
        indices: new Uint32Array(0),
        bbox: { x: 0, y: 0, width: 0, height: 0 },
      };
    }

    const indices = new Uint32Array(count);
    let idx = 0;
    for (let i = 0; i < this.ids.length; i++) {
      if (this.ids[i] === segmentId) {
        indices[idx++] = i;
      }
    }

    return {
      indices,
      bbox: {
        x: minX,
        y: minY,
        width: maxX - minX + 1,
        height: maxY - minY + 1,
      },
    };
  }
}
