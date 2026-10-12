import { useRef, useEffect } from "react";

/**
 * useTouchScroll
 * Provides smooth, natural iOS/Android-style finger drag and inertial momentum scrolling
 * for touchscreens (tablets, Raspberry Pi kiosks, touch monitors).
 */
export function useTouchScroll<T extends HTMLElement = HTMLDivElement>() {
  const ref = useRef<T | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    let isDown = false;
    let startY = 0;
    let startScrollTop = 0;
    let lastY = 0;
    let velocity = 0;
    let lastTime = 0;
    let animId: number | null = null;

    const stopMomentum = () => {
      if (animId !== null) {
        cancelAnimationFrame(animId);
        animId = null;
      }
    };

    const handleTouchStart = (e: TouchEvent) => {
      stopMomentum();
      isDown = true;
      startY = e.touches[0].pageY;
      lastY = startY;
      startScrollTop = el.scrollTop;
      lastTime = performance.now();
      velocity = 0;
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (!isDown) return;
      const currentY = e.touches[0].pageY;
      const deltaY = currentY - startY;
      const now = performance.now();
      const dt = now - lastTime;

      if (dt > 0) {
        velocity = (currentY - lastY) / dt;
      }

      lastY = currentY;
      lastTime = now;

      // Scroll container directly with finger movement
      el.scrollTop = startScrollTop - deltaY;
    };

    const handleTouchEnd = () => {
      if (!isDown) return;
      isDown = false;

      // Inertial momentum glide decay
      let currentVelocity = velocity * 14;
      const decay = 0.92;

      const step = () => {
        if (Math.abs(currentVelocity) < 0.5) {
          animId = null;
          return;
        }
        el.scrollTop -= currentVelocity;
        currentVelocity *= decay;
        animId = requestAnimationFrame(step);
      };

      if (Math.abs(currentVelocity) > 1) {
        animId = requestAnimationFrame(step);
      }
    };

    el.addEventListener("touchstart", handleTouchStart, { passive: true });
    el.addEventListener("touchmove", handleTouchMove, { passive: true });
    el.addEventListener("touchend", handleTouchEnd, { passive: true });
    el.addEventListener("touchcancel", handleTouchEnd, { passive: true });

    return () => {
      stopMomentum();
      el.removeEventListener("touchstart", handleTouchStart);
      el.removeEventListener("touchmove", handleTouchMove);
      el.removeEventListener("touchend", handleTouchEnd);
      el.removeEventListener("touchcancel", handleTouchEnd);
    };
  }, []);

  return ref;
}
