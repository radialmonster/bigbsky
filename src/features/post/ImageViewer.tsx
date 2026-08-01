import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Info, Link as LinkIcon, X } from "lucide-react";
import { MOBILE_SCROLL_QUERY } from "../../lib/scroll";

export type ImageViewerImage = {
  src: string;
  previewSrc?: string;
  alt: string;
};

export type ImageViewerState = {
  images: ImageViewerImage[];
  index: number;
} | null;

export function ImageViewer({
  image,
  onChange,
  onClose,
}: {
  image: NonNullable<ImageViewerState>;
  onChange: (image: NonNullable<ImageViewerState>) => void;
  onClose: () => void;
}) {
  const selected = image.images[image.index] ?? image.images[0];
  const hasMultiple = image.images.length > 1;
  const [loadedOriginals, setLoadedOriginals] = useState<Set<string>>(() => new Set());
  const [infoVisible, setInfoVisible] = useState(() =>
    typeof window === "undefined" ? true : !window.matchMedia(MOBILE_SCROLL_QUERY).matches,
  );
  const [zoom, setZoom] = useState({ scale: 1, x: 0, y: 0 });
  const pointerPositionsRef = useRef(new Map<number, { x: number; y: number }>());
  const gestureRef = useRef<{
    swipeStart?: { pointerId: number; x: number; y: number };
    panStart?: { pointerId: number; x: number; y: number; originX: number; originY: number };
    pinchStart?: { distance: number; scale: number };
    moved: boolean;
  }>({ moved: false });
  const suppressNextClickRef = useRef(false);
  const zoomRef = useRef(zoom);
  const imgRef = useRef<HTMLImageElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const transformFrameRef = useRef<number | null>(null);
  const zoomDirtyRef = useRef(false);
  const wheelCommitRef = useRef<number | null>(null);
  const displayedSrc = selected && loadedOriginals.has(selected.src) ? selected.src : selected?.previewSrc || selected?.src;
  const clearSelection = useCallback(() => {
    window.getSelection()?.removeAllRanges();
  }, []);
  // Write the transform straight to the DOM node so a pinch/pan gesture never
  // has to round-trip through React state (which would re-render the whole
  // viewer — thumbnails and all — on every pointermove and cause the jank).
  const applyTransform = useCallback((z: { scale: number; x: number; y: number }) => {
    const node = imgRef.current;
    if (node) {
      node.style.transform = `translate3d(${z.x}px, ${z.y}px, 0) scale(${z.scale})`;
    }
  }, []);
  // Coalesce the imperative writes to one per animation frame.
  const scheduleTransform = useCallback(() => {
    if (transformFrameRef.current != null) {
      return;
    }
    transformFrameRef.current = requestAnimationFrame(() => {
      transformFrameRef.current = null;
      applyTransform(zoomRef.current);
    });
  }, [applyTransform]);
  // Commit the live gesture value back into React state once the gesture ends,
  // so the rendered className/click behavior reflect the final zoom.
  const commitZoom = useCallback(() => {
    if (transformFrameRef.current != null) {
      cancelAnimationFrame(transformFrameRef.current);
      transformFrameRef.current = null;
    }
    if (zoomDirtyRef.current) {
      zoomDirtyRef.current = false;
      applyTransform(zoomRef.current);
      setZoom(zoomRef.current);
    }
  }, [applyTransform]);
  const resetZoom = useCallback(() => {
    zoomDirtyRef.current = false;
    zoomRef.current = { scale: 1, x: 0, y: 0 };
    setZoom({ scale: 1, x: 0, y: 0 });
  }, []);
  const goPrevious = useCallback(() => {
    if (!hasMultiple) {
      return;
    }

    clearSelection();
    onChange({
      images: image.images,
      index: (image.index - 1 + image.images.length) % image.images.length,
    });
    requestAnimationFrame(clearSelection);
  }, [clearSelection, hasMultiple, image, onChange]);
  const goNext = useCallback(() => {
    if (!hasMultiple) {
      return;
    }

    clearSelection();
    onChange({
      images: image.images,
      index: (image.index + 1) % image.images.length,
    });
    requestAnimationFrame(clearSelection);
  }, [clearSelection, hasMultiple, image, onChange]);
  const openAtIndex = useCallback(
    (index: number) => {
      resetZoom();
      onChange({ images: image.images, index });
    },
    [image.images, onChange, resetZoom],
  );
  const preloadImagesRef = useRef<Set<HTMLImageElement>>(new Set());
  const preloadOriginal = useCallback((viewerImage?: ImageViewerImage) => {
    if (!viewerImage?.src) {
      return;
    }
    if (loadedOriginals.has(viewerImage.src)) {
      return;
    }

    const img = new window.Image();
    img.onload = () => {
      preloadImagesRef.current.delete(img);
      setLoadedOriginals((current) => {
        if (current.has(viewerImage.src)) {
          return current;
        }
        const next = new Set(current);
        next.add(viewerImage.src);
        return next;
      });
    };
    preloadImagesRef.current.add(img);
    img.src = viewerImage.src;
    if (img.complete) {
      img.onload?.(new Event("load"));
    }
  }, [loadedOriginals]);
  // Detach any still-loading preload handlers on unmount so a late onload can't
  // setState on the closed viewer (and hold it in memory until the image loads).
  useEffect(() => {
    const pending = preloadImagesRef.current;
    return () => {
      pending.forEach((img) => {
        img.onload = null;
      });
      pending.clear();
    };
  }, []);
  const imageDistance = useCallback((points: Array<{ x: number; y: number }>) => {
    const [a, b] = points;
    return Math.hypot(b.x - a.x, b.y - a.y);
  }, []);
  const clampZoom = useCallback((value: number) => Math.max(1, Math.min(4, value)), []);
  // Keep the panned/zoomed image from drifting entirely off-screen. The bounds
  // are derived from the scaled overflow past the viewport (plus a little slack
  // so the edges can be brought comfortably into view).
  const clampTranslate = useCallback((z: { scale: number; x: number; y: number }) => {
    const node = imgRef.current;
    if (!node || z.scale <= 1.01) {
      return { scale: z.scale, x: 0, y: 0 };
    }
    const scaledW = node.offsetWidth * z.scale;
    const scaledH = node.offsetHeight * z.scale;
    const maxX = Math.max(0, (scaledW - window.innerWidth) / 2 + 40);
    const maxY = Math.max(0, (scaledH - window.innerHeight) / 2 + 40);
    return {
      scale: z.scale,
      x: Math.max(-maxX, Math.min(maxX, z.x)),
      y: Math.max(-maxY, Math.min(maxY, z.y)),
    };
  }, []);
  // Zoom toward a screen point (cursor / double-click / pinch focus) so the
  // content under that point stays put — the native image-viewer feel. With
  // transform-origin: center, the new translate is `t + (point - center)·(1 - r)`
  // where `r` is the scale ratio and `center` is the current on-screen image
  // center. We flush any pending transform first so the measured rect matches
  // the live `zoomRef` value rather than a frame-stale one.
  const applyZoomAtPoint = useCallback(
    (nextScaleRaw: number, clientX: number, clientY: number, commit: boolean) => {
      const node = imgRef.current;
      if (!node) {
        return;
      }
      const current = zoomRef.current;
      const nextScale = clampZoom(nextScaleRaw);
      if (Math.abs(nextScale - current.scale) < 0.0005) {
        return;
      }
      if (transformFrameRef.current != null) {
        cancelAnimationFrame(transformFrameRef.current);
        transformFrameRef.current = null;
      }
      applyTransform(current);
      const rect = node.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      const ratio = nextScale / current.scale;
      const next =
        nextScale <= 1.01
          ? { scale: 1, x: 0, y: 0 }
          : clampTranslate({
              scale: nextScale,
              x: current.x + (clientX - centerX) * (1 - ratio),
              y: current.y + (clientY - centerY) * (1 - ratio),
            });
      zoomRef.current = next;
      if (commit) {
        zoomDirtyRef.current = false;
        applyTransform(next);
        setZoom(next);
      } else {
        zoomDirtyRef.current = true;
        scheduleTransform();
      }
    },
    [applyTransform, clampTranslate, clampZoom, scheduleTransform],
  );
  // Mouse wheel / trackpad pinch (arrives as a ctrl+wheel) zooms toward the
  // cursor. The gesture has no pointerup, so we drive the transform imperatively
  // and debounce a single React commit once the wheel settles.
  const handleWheel = useCallback(
    (event: WheelEvent) => {
      event.preventDefault();
      const factor = Math.exp(-event.deltaY * 0.0015);
      applyZoomAtPoint(zoomRef.current.scale * factor, event.clientX, event.clientY, false);
      if (zoomRef.current.scale > 1.02) {
        suppressNextClickRef.current = true;
      }
      if (wheelCommitRef.current != null) {
        window.clearTimeout(wheelCommitRef.current);
      }
      wheelCommitRef.current = window.setTimeout(() => {
        wheelCommitRef.current = null;
        commitZoom();
      }, 140);
    },
    [applyZoomAtPoint, commitZoom],
  );
  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      clearSelection();
      if (event.button !== 0 || (event.target as HTMLElement).closest("button, a, .image-viewer-footer, .image-viewer-thumbs")) {
        return;
      }

      try {
        event.currentTarget.setPointerCapture?.(event.pointerId);
      } catch {
        // Synthetic pointer events used by tests may not be eligible for capture.
      }
      const position = { x: event.clientX, y: event.clientY };
      pointerPositionsRef.current.set(event.pointerId, position);
      gestureRef.current.moved = false;
      const points = Array.from(pointerPositionsRef.current.values());
      if (points.length >= 2) {
        gestureRef.current = {
          moved: true,
          pinchStart: {
            distance: imageDistance(points.slice(0, 2)),
            scale: zoomRef.current.scale,
          },
        };
        suppressNextClickRef.current = true;
        return;
      }

      if (zoomRef.current.scale > 1.02) {
        gestureRef.current = {
          moved: false,
          panStart: {
            pointerId: event.pointerId,
            x: event.clientX,
            y: event.clientY,
            originX: zoomRef.current.x,
            originY: zoomRef.current.y,
          },
        };
        return;
      }

      gestureRef.current = hasMultiple
        ? { moved: false, swipeStart: { pointerId: event.pointerId, x: event.clientX, y: event.clientY } }
        : { moved: false };
    },
    [clearSelection, hasMultiple, imageDistance],
  );
  const handlePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (!pointerPositionsRef.current.has(event.pointerId)) {
        return;
      }

      pointerPositionsRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
      const points = Array.from(pointerPositionsRef.current.values());
      const gesture = gestureRef.current;
      if (gesture.pinchStart && points.length >= 2) {
        const distance = imageDistance(points.slice(0, 2));
        const nextScale = clampZoom(gesture.pinchStart.scale * (distance / Math.max(1, gesture.pinchStart.distance)));
        gesture.moved = true;
        suppressNextClickRef.current = true;
        const current = zoomRef.current;
        zoomRef.current = {
          scale: nextScale,
          x: nextScale <= 1.01 ? 0 : current.x,
          y: nextScale <= 1.01 ? 0 : current.y,
        };
        zoomDirtyRef.current = true;
        scheduleTransform();
        return;
      }

      if (gesture.panStart?.pointerId === event.pointerId) {
        const deltaX = event.clientX - gesture.panStart.x;
        const deltaY = event.clientY - gesture.panStart.y;
        if (Math.abs(deltaX) > 3 || Math.abs(deltaY) > 3) {
          gesture.moved = true;
          suppressNextClickRef.current = true;
          zoomRef.current = clampTranslate({
            ...zoomRef.current,
            x: gesture.panStart.originX + deltaX,
            y: gesture.panStart.originY + deltaY,
          });
          zoomDirtyRef.current = true;
          scheduleTransform();
        }
      }
    },
    [clampTranslate, clampZoom, imageDistance, scheduleTransform],
  );
  const handlePointerUp = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const start = gestureRef.current.swipeStart;
      const wasGestureMove = gestureRef.current.moved;
      pointerPositionsRef.current.delete(event.pointerId);
      if (pointerPositionsRef.current.size < 2) {
        gestureRef.current.pinchStart = undefined;
      }
      if (pointerPositionsRef.current.size === 0) {
        gestureRef.current.panStart = undefined;
      }
      // Flush the live gesture value into React state once no fingers remain.
      if (pointerPositionsRef.current.size === 0) {
        commitZoom();
      }
      if (wasGestureMove || zoomRef.current.scale > 1.02) {
        suppressNextClickRef.current = true;
      }
      if (!start || start.pointerId !== event.pointerId || zoomRef.current.scale > 1.02) {
        return;
      }

      const deltaX = event.clientX - start.x;
      const deltaY = event.clientY - start.y;
      const horizontalSwipe = Math.abs(deltaX) >= 48 && Math.abs(deltaX) > Math.abs(deltaY) * 1.25;
      if (!horizontalSwipe) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      suppressNextClickRef.current = true;
      if (deltaX < 0) {
        goNext();
      } else {
        goPrevious();
      }
    },
    [commitZoom, goNext, goPrevious],
  );

  useEffect(() => {
    zoomRef.current = zoom;
  }, [zoom]);

  // Apply the committed zoom to the DOM node. Gesture moves write the transform
  // imperatively; this keeps the node in sync with React state (mount, reset,
  // double-click, gesture commit) without binding transform to every render.
  useLayoutEffect(() => {
    applyTransform(zoomDirtyRef.current ? zoomRef.current : zoom);
  }, [applyTransform, zoom, displayedSrc]);

  useEffect(() => {
    resetZoom();
    pointerPositionsRef.current.clear();
    gestureRef.current = { moved: false };
  }, [image.index, resetZoom]);

  useEffect(() => {
    return () => {
      if (transformFrameRef.current != null) {
        cancelAnimationFrame(transformFrameRef.current);
      }
      if (wheelCommitRef.current != null) {
        window.clearTimeout(wheelCommitRef.current);
      }
    };
  }, []);

  // Bind the wheel listener natively (non-passive) so we can preventDefault and
  // stop the page/browser from zooming or scrolling under the overlay.
  useEffect(() => {
    const node = containerRef.current;
    if (!node) {
      return;
    }
    node.addEventListener("wheel", handleWheel, { passive: false });
    return () => node.removeEventListener("wheel", handleWheel);
  }, [handleWheel]);

  useEffect(() => {
    const imagesToPreload = [
      image.images[image.index],
      image.images[(image.index + 1) % image.images.length],
      image.images[(image.index - 1 + image.images.length) % image.images.length],
    ];
    imagesToPreload.forEach(preloadOriginal);
  }, [image.images, image.index, preloadOriginal]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        goPrevious();
      }
      if (event.key === "ArrowRight") {
        event.preventDefault();
        goNext();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [goNext, goPrevious, onClose]);

  // Defensive: an embed whose images all lack a usable src would leave `selected`
  // undefined. Callers already filter these out, so just close rather than crash.
  if (!selected) {
    return null;
  }

  return (
    <div
      ref={containerRef}
      className={infoVisible ? "image-viewer" : "image-viewer info-hidden"}
      role="dialog"
      aria-modal="true"
      aria-label="Image viewer"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={(event) => {
        pointerPositionsRef.current.delete(event.pointerId);
        gestureRef.current = { moved: false };
        if (pointerPositionsRef.current.size === 0) {
          commitZoom();
        }
      }}
      onMouseDown={clearSelection}
      onMouseUp={clearSelection}
      onSelect={clearSelection}
      onDragStart={(event) => {
        event.preventDefault();
        clearSelection();
      }}
      onClick={(event) => {
        clearSelection();
        if (suppressNextClickRef.current) {
          suppressNextClickRef.current = false;
          return;
        }
        if (zoom.scale > 1.02) {
          return;
        }
        const halfway = window.innerWidth / 2;
        if (!hasMultiple) {
          onClose();
          return;
        }

        if (event.clientX < halfway) {
          goPrevious();
        } else {
          goNext();
        }
      }}
    >
      <div className="image-viewer-controls" onClick={(event) => event.stopPropagation()}>
        <button
          className={infoVisible ? "image-viewer-info active" : "image-viewer-info"}
          type="button"
          onClick={() => setInfoVisible((visible) => !visible)}
          aria-label={infoVisible ? "Hide image information" : "Show image information"}
          aria-pressed={infoVisible}
          title={infoVisible ? "Hide image information" : "Show image information"}
        >
          <Info size={21} />
        </button>
        <button
          className="image-viewer-close"
          type="button"
          onClick={onClose}
          aria-label="Close image viewer"
          title="Close image viewer"
        >
          <X size={22} />
        </button>
      </div>
      {hasMultiple && (
        <>
          <div className="image-viewer-count">
            {image.index + 1} / {image.images.length}
          </div>
        </>
      )}
      <img
        ref={imgRef}
        className={zoom.scale > 1.02 ? "zoomed" : ""}
        src={displayedSrc}
        alt={selected.alt}
        draggable={false}
        onDragStart={(event) => {
          event.preventDefault();
          clearSelection();
        }}
        onClick={(event) => {
          event.stopPropagation();
          clearSelection();
        }}
        onDoubleClick={(event) => {
          event.stopPropagation();
          suppressNextClickRef.current = true;
          if (zoomRef.current.scale > 1.02) {
            resetZoom();
          } else {
            applyZoomAtPoint(2.5, event.clientX, event.clientY, true);
          }
        }}
      />
      {infoVisible && (
        <div className="image-viewer-footer" onClick={(event) => event.stopPropagation()}>
          <div>
            <strong>{hasMultiple ? `Image ${image.index + 1} of ${image.images.length}` : "Image"}</strong>
            <span>{selected.alt || "No alt text provided."}</span>
          </div>
          <a href={selected.src} target="_blank" rel="noreferrer">
            <LinkIcon size={15} /> Open original
          </a>
        </div>
      )}
      {hasMultiple && (
        <div className="image-viewer-thumbs" onClick={(event) => event.stopPropagation()}>
          {image.images.map((thumb, index) => (
            <button
              className={index === image.index ? "selected" : ""}
              key={`${thumb.src}:${index}`}
              type="button"
              onClick={() => openAtIndex(index)}
              aria-label={`Open image ${index + 1}`}
            >
              <img src={thumb.previewSrc || thumb.src} alt="" draggable={false} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
