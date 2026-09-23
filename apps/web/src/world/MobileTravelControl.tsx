import {
  useCallback,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from "react";

interface MobileTravelControlProps {
  onThrottleChange: (throttle: number) => void;
}

const KEYBOARD_STEP = 0.35;
const THUMB_TRAVEL_PX = 28;

function clampThrottle(value: number): number {
  return Math.max(-1, Math.min(1, value));
}

export function MobileTravelControl({
  onThrottleChange,
}: MobileTravelControlProps) {
  const controlRef = useRef<HTMLDivElement>(null);
  const activePointerRef = useRef<number | null>(null);
  const [throttle, setThrottle] = useState(0);

  const updateThrottle = useCallback(
    (nextThrottle: number) => {
      const next = clampThrottle(nextThrottle);
      setThrottle(next);
      onThrottleChange(next);
    },
    [onThrottleChange],
  );

  const updateFromPointer = (event: PointerEvent<HTMLDivElement>) => {
    const bounds = controlRef.current?.getBoundingClientRect();
    if (!bounds) return;
    const centerY = bounds.top + bounds.height / 2;
    updateThrottle((centerY - event.clientY) / THUMB_TRAVEL_PX);
  };

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    activePointerRef.current = event.pointerId;
    event.currentTarget.setPointerCapture(event.pointerId);
    updateFromPointer(event);
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (activePointerRef.current !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    updateFromPointer(event);
  };

  const releasePointer = (event: PointerEvent<HTMLDivElement>) => {
    if (activePointerRef.current !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    activePointerRef.current = null;
    updateThrottle(0);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowUp") {
      event.preventDefault();
      updateThrottle(throttle + KEYBOARD_STEP);
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      updateThrottle(throttle - KEYBOARD_STEP);
    } else if (event.key === " " || event.key === "Escape") {
      event.preventDefault();
      updateThrottle(0);
    }
  };

  return (
    <div className="mobile-travel-control-shell">
      <span className="mobile-travel-control__hint">倾斜转向</span>
      <div
        ref={controlRef}
        className="mobile-travel-control"
        role="slider"
        tabIndex={0}
        aria-label="移动摇杆：向上前进，向下后退"
        aria-valuemin={-100}
        aria-valuemax={100}
        aria-valuenow={Math.round(throttle * 100)}
        onKeyDown={handleKeyDown}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={releasePointer}
        onPointerCancel={releasePointer}
        onLostPointerCapture={releasePointer}
      >
        <span className="mobile-travel-control__direction" aria-hidden="true">
          ↑
        </span>
        <span
          className="mobile-travel-control__thumb"
          style={{ transform: `translateY(${-throttle * THUMB_TRAVEL_PX}px)` }}
          aria-hidden="true"
        />
        <span className="mobile-travel-control__direction" aria-hidden="true">
          ↓
        </span>
      </div>
    </div>
  );
}
