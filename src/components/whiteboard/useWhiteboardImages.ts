import { useRef, useCallback, useEffect } from 'react';
import { nanoid } from 'nanoid';
import type * as Y from 'yjs';
import type { Doc } from 'yjs';
import type { DrawOp } from './types';
import { MAX_IMAGES, CANVAS_WIDTH, CANVAS_HEIGHT } from './types';
import { processImage } from './image-processing';

export interface WhiteboardImagesState {
  /** Retrieve a cached ImageBitmap by imageId. Returns undefined if not yet loaded. */
  getCachedImage: (imageId: string) => ImageBitmap | undefined;
  /** Add an image from a File/Blob. Returns the DrawOp or null if limit reached. */
  addImage: (
    source: File | Blob,
    centerX: number,
    centerY: number,
    viewWidth: number,
    viewHeight: number,
  ) => Promise<DrawOp | null>;
  /** Get the Y.Map for direct access (e.g., undo/redo image data) */
  imageMap: Y.Map<Uint8Array>;
  /** Number of images currently stored */
  imageCount: () => number;
  /** Store raw image data in the Y.Map and cache it (used by redo) */
  storeImageData: (imageId: string, data: Uint8Array) => Promise<void>;
  /** Remove image data from Y.Map and cache (used by undo) */
  removeImageData: (imageId: string) => void;
  /** Notify the hook that the world canvas needs rebuilding after images load */
  setRebuildCallback: (cb: () => void) => void;
}

export function useWhiteboardImages(
  doc: Doc,
  opsArray: Y.Array<DrawOp>,
): WhiteboardImagesState {
  const imageMap = doc.getMap<Uint8Array>('whiteboard-images');
  const cacheRef = useRef<Map<string, ImageBitmap>>(new Map());
  const loadingRef = useRef<Set<string>>(new Set());
  const rebuildCallbackRef = useRef<(() => void) | null>(null);

  const setRebuildCallback = useCallback((cb: () => void) => {
    rebuildCallbackRef.current = cb;
  }, []);

  const triggerRebuild = useCallback(() => {
    rebuildCallbackRef.current?.();
  }, []);

  // Decode a Uint8Array into an ImageBitmap and cache it
  const decodeAndCache = useCallback(
    async (
      imageId: string,
      data: Uint8Array,
    ): Promise<ImageBitmap | undefined> => {
      if (cacheRef.current.has(imageId)) return cacheRef.current.get(imageId);
      if (loadingRef.current.has(imageId)) return undefined;

      loadingRef.current.add(imageId);
      try {
        const blob = new Blob([new Uint8Array(data)]);
        const bitmap = await createImageBitmap(blob);
        cacheRef.current.set(imageId, bitmap);
        loadingRef.current.delete(imageId);
        return bitmap;
      } catch {
        loadingRef.current.delete(imageId);
        return undefined;
      }
    },
    [],
  );

  // Pre-load all existing images into cache on mount and when Y.Map changes
  useEffect(() => {
    const loadAll = async () => {
      const entries = Array.from(imageMap.entries());
      let anyNew = false;
      for (const [imageId, data] of entries) {
        if (
          !cacheRef.current.has(imageId) &&
          !loadingRef.current.has(imageId)
        ) {
          anyNew = true;
          decodeAndCache(imageId, data).then((bitmap) => {
            if (bitmap) triggerRebuild();
          });
        }
      }
      if (!anyNew) return;
    };

    loadAll();

    const observer = (event: Y.YMapEvent<Uint8Array>) => {
      // Handle additions
      event.keysChanged.forEach((key) => {
        const change = event.changes.keys.get(key);
        if (change?.action === 'add' || change?.action === 'update') {
          const data = imageMap.get(key);
          if (data && !cacheRef.current.has(key)) {
            decodeAndCache(key, data).then((bitmap) => {
              if (bitmap) triggerRebuild();
            });
          }
        } else if (change?.action === 'delete') {
          // Clean up cache
          const bitmap = cacheRef.current.get(key);
          if (bitmap) {
            bitmap.close();
            cacheRef.current.delete(key);
          }
        }
      });
    };

    imageMap.observe(observer);
    return () => {
      imageMap.unobserve(observer);
    };
  }, [imageMap, decodeAndCache, triggerRebuild]);

  // Clean up all bitmaps on unmount
  useEffect(() => {
    const cache = cacheRef.current;
    return () => {
      for (const bitmap of cache.values()) {
        bitmap.close();
      }
      cache.clear();
    };
  }, []);

  const getCachedImage = useCallback(
    (imageId: string): ImageBitmap | undefined => {
      const cached = cacheRef.current.get(imageId);
      if (cached) return cached;

      // Trigger async load if not cached and not loading
      const data = imageMap.get(imageId);
      if (data && !loadingRef.current.has(imageId)) {
        decodeAndCache(imageId, data).then((bitmap) => {
          if (bitmap) triggerRebuild();
        });
      }
      return undefined;
    },
    [imageMap, decodeAndCache, triggerRebuild],
  );

  const imageCount = useCallback(() => {
    return imageMap.size;
  }, [imageMap]);

  const storeImageData = useCallback(
    async (imageId: string, data: Uint8Array): Promise<void> => {
      imageMap.set(imageId, data);
      await decodeAndCache(imageId, data);
    },
    [imageMap, decodeAndCache],
  );

  const removeImageData = useCallback(
    (imageId: string): void => {
      imageMap.delete(imageId);
      const bitmap = cacheRef.current.get(imageId);
      if (bitmap) {
        bitmap.close();
        cacheRef.current.delete(imageId);
      }
    },
    [imageMap],
  );

  const addImage = useCallback(
    async (
      source: File | Blob,
      centerX: number,
      centerY: number,
      viewWidth: number,
      viewHeight: number,
    ): Promise<DrawOp | null> => {
      // Enforce image limit
      if (imageMap.size >= MAX_IMAGES) {
        return null;
      }

      const processed = await processImage(source);
      const imageId = nanoid(8);

      // Fit image within 60% of the visible viewport area, maintaining aspect ratio
      const maxW = viewWidth * 0.6;
      const maxH = viewHeight * 0.6;
      const ratio = Math.min(
        maxW / processed.width,
        maxH / processed.height,
        1,
      );
      const displayW = processed.width * ratio;
      const displayH = processed.height * ratio;

      let x1 = centerX - displayW / 2;
      let y1 = centerY - displayH / 2;
      let x2 = centerX + displayW / 2;
      let y2 = centerY + displayH / 2;

      // Keep image placement within the whiteboard world so it remains reachable.
      if (x1 < 0) {
        const shift = -x1;
        x1 += shift;
        x2 += shift;
      }
      if (y1 < 0) {
        const shift = -y1;
        y1 += shift;
        y2 += shift;
      }
      if (x2 > CANVAS_WIDTH) {
        const shift = x2 - CANVAS_WIDTH;
        x1 -= shift;
        x2 -= shift;
      }
      if (y2 > CANVAS_HEIGHT) {
        const shift = y2 - CANVAS_HEIGHT;
        y1 -= shift;
        y2 -= shift;
      }

      x1 = Math.max(0, x1);
      y1 = Math.max(0, y1);
      x2 = Math.min(CANVAS_WIDTH, x2);
      y2 = Math.min(CANVAS_HEIGHT, y2);

      const op: DrawOp = {
        id: nanoid(8),
        ts: Date.now(),
        type: 'image',
        colour: '',
        size: 0,
        imageId,
        x1,
        y1,
        x2,
        y2,
      };

      // Store image data and push the op in a single Yjs transaction
      doc.transact(() => {
        imageMap.set(imageId, processed.data);
        opsArray.push([op]);
      });

      // Eagerly cache
      await decodeAndCache(imageId, processed.data);

      return op;
    },
    [doc, imageMap, opsArray, decodeAndCache],
  );

  return {
    getCachedImage,
    addImage,
    imageMap,
    imageCount,
    storeImageData,
    removeImageData,
    setRebuildCallback,
  };
}
