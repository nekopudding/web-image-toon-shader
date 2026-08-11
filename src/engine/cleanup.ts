export function modeFilter(
  clusterIds: Uint8Array<ArrayBuffer>,
  width: number,
  height: number,
  passes = 1,
): Uint8Array<ArrayBuffer> {
  let current = new Uint8Array(clusterIds) as Uint8Array<ArrayBuffer>;

  for (let pass = 0; pass < passes; pass++) {
    const next = new Uint8Array(current) as Uint8Array<ArrayBuffer>;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const counts = new Map<number, number>();

        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
              const id = current[ny * width + nx];
              counts.set(id, (counts.get(id) ?? 0) + 1);
            }
          }
        }

        let maxCount = 0;
        let modeId = current[y * width + x];
        for (const [id, count] of counts) {
          if (count > maxCount) {
            maxCount = count;
            modeId = id;
          }
        }

        next[y * width + x] = modeId;
      }
    }

    current = next;
  }

  return current;
}

export function removeSmallRegions(
  clusterIds: Uint8Array<ArrayBuffer>,
  width: number,
  height: number,
  minArea: number,
): Uint8Array<ArrayBuffer> {
  const n = width * height;
  const labels = new Int32Array(n).fill(-1);
  let nextLabel = 0;
  const regionMembers: number[][] = [];

  // BFS connected component labeling (4-connectivity)
  const queue: number[] = [];

  for (let start = 0; start < n; start++) {
    if (labels[start] !== -1) continue;

    const clusterId = clusterIds[start];
    const label = nextLabel++;
    regionMembers.push([]);

    labels[start] = label;
    queue.length = 0;
    queue.push(start);

    let qi = 0;
    while (qi < queue.length) {
      const idx = queue[qi++];
      regionMembers[label].push(idx);

      const x = idx % width;
      const y = Math.floor(idx / width);

      const neighbors = [
        y > 0 ? idx - width : -1,
        y < height - 1 ? idx + width : -1,
        x > 0 ? idx - 1 : -1,
        x < width - 1 ? idx + 1 : -1,
      ];

      for (const nb of neighbors) {
        if (nb >= 0 && labels[nb] === -1 && clusterIds[nb] === clusterId) {
          labels[nb] = label;
          queue.push(nb);
        }
      }
    }
  }

  const result = new Uint8Array(clusterIds) as Uint8Array<ArrayBuffer>;

  for (let label = 0; label < regionMembers.length; label++) {
    const members = regionMembers[label];
    if (members.length >= minArea) continue;

    // Find the neighbor cluster with the most pixels
    const neighborCounts = new Map<number, number>();

    for (const idx of members) {
      const x = idx % width;
      const y = Math.floor(idx / width);

      const neighbors = [
        y > 0 ? idx - width : -1,
        y < height - 1 ? idx + width : -1,
        x > 0 ? idx - 1 : -1,
        x < width - 1 ? idx + 1 : -1,
      ];

      for (const nb of neighbors) {
        if (nb >= 0 && labels[nb] !== label) {
          const nbCluster = clusterIds[nb];
          neighborCounts.set(nbCluster, (neighborCounts.get(nbCluster) ?? 0) + 1);
        }
      }
    }

    if (neighborCounts.size === 0) continue;

    let maxCount = 0;
    let bestCluster = clusterIds[members[0]];
    for (const [clusterId, count] of neighborCounts) {
      if (count > maxCount) {
        maxCount = count;
        bestCluster = clusterId;
      }
    }

    for (const idx of members) {
      result[idx] = bestCluster;
    }
  }

  return result;
}
