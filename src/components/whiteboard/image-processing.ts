const MAX_DIMENSION = 1920;
const WEBP_QUALITY = 0.8;
const MAX_INPUT_SIZE = 10 * 1024 * 1024; // 10 MB

export interface ProcessedImage {
  data: Uint8Array;
  width: number;
  height: number;
}

/**
 * Validates, resizes (if needed), and compresses an image to WebP.
 * Falls back to PNG if WebP encoding is unsupported.
 */
export async function processImage(
  source: File | Blob,
): Promise<ProcessedImage> {
  // Validate type
  if (!source.type.startsWith('image/')) {
    throw new Error('File is not an image');
  }

  // Validate size
  if (source.size > MAX_INPUT_SIZE) {
    throw new Error(
      `Image too large (${(source.size / 1024 / 1024).toFixed(1)} MB). Maximum is 10 MB.`,
    );
  }

  // Load the image into an HTMLImageElement
  const bitmap = await createImageBitmap(source);
  const { width: srcW, height: srcH } = bitmap;

  // Compute target dimensions (scale down if either side exceeds MAX_DIMENSION)
  let targetW = srcW;
  let targetH = srcH;
  if (srcW > MAX_DIMENSION || srcH > MAX_DIMENSION) {
    const ratio = Math.min(MAX_DIMENSION / srcW, MAX_DIMENSION / srcH);
    targetW = Math.round(srcW * ratio);
    targetH = Math.round(srcH * ratio);
  }

  // Draw to an offscreen canvas at target size
  const canvas = new OffscreenCanvas(targetW, targetH);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Failed to get canvas context');
  ctx.drawImage(bitmap, 0, 0, targetW, targetH);
  bitmap.close();

  // Encode to WebP, fallback to PNG
  let blob: Blob;
  try {
    blob = await canvas.convertToBlob({
      type: 'image/webp',
      quality: WEBP_QUALITY,
    });
    // Verify the browser actually produced WebP (some return PNG silently)
    if (blob.type !== 'image/webp') {
      blob = await canvas.convertToBlob({ type: 'image/png' });
    }
  } catch {
    blob = await canvas.convertToBlob({ type: 'image/png' });
  }

  const arrayBuffer = await blob.arrayBuffer();
  return {
    data: new Uint8Array(arrayBuffer),
    width: targetW,
    height: targetH,
  };
}
