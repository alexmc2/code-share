/**
 * Flood fill that keeps strokes and fills on separate layers to avoid anti-aliasing artifacts.
 */
export function floodFillWithBoundary(
  fillCtx: CanvasRenderingContext2D,
  strokeImageData: ImageData,
  startX: number,
  startY: number,
  fillColor: string,
): void {
  const width = fillCtx.canvas.width;
  const height = fillCtx.canvas.height;

  // Clamp start position to canvas bounds
  const x = Math.floor(Math.max(0, Math.min(width - 1, startX)));
  const y = Math.floor(Math.max(0, Math.min(height - 1, startY)));

  // Convert fill color to RGBA
  const tempCanvas = document.createElement('canvas');
  tempCanvas.width = 1;
  tempCanvas.height = 1;
  const tempCtx = tempCanvas.getContext('2d')!;
  tempCtx.fillStyle = fillColor;
  tempCtx.fillRect(0, 0, 1, 1);
  const fillRGBA = tempCtx.getImageData(0, 0, 1, 1).data;

  // Get fill canvas image data
  const fillImageData = fillCtx.getImageData(0, 0, width, height);
  const fillData = fillImageData.data;
  const strokeData = strokeImageData.data;

  // Check if start position has a stroke boundary
  const startStrokeIdx = (y * width + x) * 4;
  if (strokeData[startStrokeIdx + 3] > 30) {
    // Clicked on a stroke, don't fill
    return;
  }

  // Get target color at start position from fill canvas
  const startFillIdx = (y * width + x) * 4;
  const targetR = fillData[startFillIdx];
  const targetG = fillData[startFillIdx + 1];
  const targetB = fillData[startFillIdx + 2];
  const targetA = fillData[startFillIdx + 3];

  // Don't fill if clicking on the same color
  if (
    Math.abs(targetR - fillRGBA[0]) < 5 &&
    Math.abs(targetG - fillRGBA[1]) < 5 &&
    Math.abs(targetB - fillRGBA[2]) < 5 &&
    Math.abs(targetA - fillRGBA[3]) < 5
  ) {
    return;
  }

  // Tolerance for matching target color
  const tolerance = 32;

  // Match target color on fill canvas (what we're replacing)
  const matchesTarget = (idx: number): boolean => {
    return (
      Math.abs(fillData[idx] - targetR) <= tolerance &&
      Math.abs(fillData[idx + 1] - targetG) <= tolerance &&
      Math.abs(fillData[idx + 2] - targetB) <= tolerance &&
      Math.abs(fillData[idx + 3] - targetA) <= tolerance
    );
  };

  // Check if pixel is a stroke boundary (from strokeCanvas)
  const isBoundary = (pixelIdx: number): boolean => {
    const idx = pixelIdx * 4;
    // If stroke has significant alpha, it's a boundary
    return strokeData[idx + 3] > 30;
  };

  // Use Uint8Array for fast visited tracking
  const visited = new Uint8Array(width * height);

  // Scanline fill using spans
  const stack: [number, number, number, number][] = []; // [x1, x2, y, direction]

  // Check if starting point is valid
  const startPixelIdx = y * width + x;
  if (isBoundary(startPixelIdx) || !matchesTarget(startPixelIdx * 4)) {
    return;
  }

  // Find initial span
  let x1 = x;
  let x2 = x;
  while (x1 > 0) {
    const leftIdx = y * width + x1 - 1;
    if (isBoundary(leftIdx) || !matchesTarget(leftIdx * 4)) break;
    x1--;
  }
  while (x2 < width - 1) {
    const rightIdx = y * width + x2 + 1;
    if (isBoundary(rightIdx) || !matchesTarget(rightIdx * 4)) break;
    x2++;
  }

  // Fill the initial span immediately to prevent gap in the first row
  for (let fx = x1; fx <= x2; fx++) {
    const pixelIdx = y * width + fx;
    visited[pixelIdx] = 1;
    const di = pixelIdx * 4;
    fillData[di] = fillRGBA[0];
    fillData[di + 1] = fillRGBA[1];
    fillData[di + 2] = fillRGBA[2];
    fillData[di + 3] = fillRGBA[3];
  }

  stack.push([x1, x2, y, 1]); // down
  stack.push([x1, x2, y, -1]); // up

  while (stack.length > 0) {
    const [sx1, sx2, sy, dy] = stack.pop()!;
    const ny = sy + dy;

    if (ny < 0 || ny >= height) continue;

    let cx = sx1;
    while (cx <= sx2) {
      const pixelIdx = ny * width + cx;
      const dataIdx = pixelIdx * 4;

      // Skip if already visited, is a boundary, or doesn't match
      if (
        visited[pixelIdx] ||
        isBoundary(pixelIdx) ||
        !matchesTarget(dataIdx)
      ) {
        cx++;
        continue;
      }

      // Find span boundaries
      let spanX1 = cx;
      let spanX2 = cx;

      // Extend left
      while (spanX1 > 0) {
        const leftIdx = ny * width + spanX1 - 1;
        if (
          visited[leftIdx] ||
          isBoundary(leftIdx) ||
          !matchesTarget(leftIdx * 4)
        )
          break;
        spanX1--;
      }

      // Extend right and fill
      while (spanX2 < width) {
        const rightIdx = ny * width + spanX2;
        if (
          visited[rightIdx] ||
          isBoundary(rightIdx) ||
          !matchesTarget(rightIdx * 4)
        )
          break;

        // Fill this pixel
        visited[rightIdx] = 1;
        const di = rightIdx * 4;
        fillData[di] = fillRGBA[0];
        fillData[di + 1] = fillRGBA[1];
        fillData[di + 2] = fillRGBA[2];
        fillData[di + 3] = fillRGBA[3];

        spanX2++;
      }
      spanX2--;

      // Also mark and fill the left extension
      for (let fx = spanX1; fx < cx; fx++) {
        const fillIdx = ny * width + fx;
        visited[fillIdx] = 1;
        const di = fillIdx * 4;
        fillData[di] = fillRGBA[0];
        fillData[di + 1] = fillRGBA[1];
        fillData[di + 2] = fillRGBA[2];
        fillData[di + 3] = fillRGBA[3];
      }

      // Add spans for next rows
      stack.push([spanX1, spanX2, ny, dy]);
      // Check opposite direction if we extended beyond original span
      if (spanX1 < sx1) stack.push([spanX1, sx1 - 1, ny, -dy]);
      if (spanX2 > sx2) stack.push([sx2 + 1, spanX2, ny, -dy]);

      cx = spanX2 + 1;
    }
  }

  fillCtx.putImageData(fillImageData, 0, 0);
}
