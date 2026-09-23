import {
  useCallback,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from "react";

interface MobileTravelControlProps {
  onTravelChange: (strafe: number, forward: number) => void;
}

const KEYBOARD_STEP = 0.35;
const THUMB_TRAVEL_PX = 30;

interface TravelInput {
  strafe: number;
  forward: number;
}

function clampTravelInput(strafe: number, forward: number): TravelInput {
  const magnitude = Math.hypot(strafe, forward);
  if (magnitude <= 1) return { strafe, forward };
  return {
    strafe: strafe / magnitude,
    forward: forward / magnitude,
  };
}

export function MobileTravelControl({
  onTravelChange,
}: MobileTravelControlProps) {
  const controlRef = useRef<HTMLDivElement>(null);
  const activePointerRef = useRef<number | null>(null);
  const [travel, setTravel] = useState<TravelInput>({
    strafe: 0,
    forward: 0,
  });

  const updateTravel = useCallback(
    (strafe: number, forward: number) => {
      const next = clampTravelInput(strafe, forward);
      setTravel(next);
      onTravelChange(next.strafe, next.forward);
    },
    [onTravelChange],
  );

  const updateFromPointer = (event: PointerEvent<HTMLDivElement>) => {
    const bounds = controlRef.current?.getBoundingClientRect();
    if (!bounds) return;
    const centerX = bounds.left + bounds.width / 2;
    const centerY = bounds.top + bounds.height / 2;
    updateTravel(
      (event.clientX - centerX) / THUMB_TRAVEL_PX,
      (centerY - event.clientY) / THUMB_TRAVEL_PX,
    );
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
    updateTravel(0, 0);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowUp") {
      event.preventDefault();
      updateTravel(travel.strafe, travel.forward + KEYBOARD_STEP);
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      updateTravel(travel.strafe, travel.forward - KEYBOARD_STEP);
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      updateTravel(travel.strafe - KEYBOARD_STEP, travel.forward);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      updateTravel(travel.strafe + KEYBOARD_STEP, travel.forward);
    } else if (event.key === " " || event.key === "Escape") {
      event.preventDefault();
      updateTravel(0, 0);
    }
  };

  return (
    <div className="mobile-travel-control-shell">
      <div
        ref={controlRef}
        className="mobile-travel-control"
        role="group"
        tabIndex={0}
        aria-label="移动摇杆：前后左右移动，移动方向跟随相机朝向"
        onKeyDown={handleKeyDown}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={releasePointer}
        onPointerCancel={releasePointer}
        onLostPointerCapture={releasePointer}
      >
        <span
          className="mobile-travel-control__thumb"
          style={{
            transform: `translate(${travel.strafe * THUMB_TRAVEL_PX}px, ${-travel.forward * THUMB_TRAVEL_PX}px)`,
          }}
          aria-hidden="true"
        />
      </div>
    </div>
  );
}
