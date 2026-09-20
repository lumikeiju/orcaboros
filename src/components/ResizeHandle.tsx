import {
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
  useEffect,
  useRef,
  useState
} from "react";

type ResizeOrientation = "horizontal" | "vertical";

type ResizeHandleProps = {
  orientation: ResizeOrientation;
  value: number;
  min: number;
  max: number;
  label: string;
  onChange: (value: number) => void;
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function ResizeHandle({
  orientation,
  value,
  min,
  max,
  label,
  onChange
}: ResizeHandleProps): ReactElement {
  const [isDragging, setIsDragging] = useState(false);
  const pointerId = useRef<number | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    if (!isDragging) {
      return;
    }

    const resizingClass = `is-resizing-${orientation}`;
    document.body.classList.add(resizingClass);

    return () => {
      document.body.classList.remove(resizingClass);
    };
  }, [isDragging, max, min, orientation]);

  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>): void {
    if (event.button !== 0) {
      return;
    }
    event.preventDefault();
    pointerId.current = event.pointerId;
    if (typeof event.currentTarget.setPointerCapture === "function") {
      event.currentTarget.setPointerCapture(event.pointerId);
    }
    setIsDragging(true);
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLDivElement>): void {
    if (
      pointerId.current === null ||
      (event.pointerId !== undefined && event.pointerId !== pointerId.current)
    ) {
      return;
    }
    const viewportSize =
      orientation === "vertical"
        ? globalThis.innerWidth
        : globalThis.innerHeight;
    if (viewportSize <= 0) {
      return;
    }
    const rawValue =
      orientation === "vertical"
        ? (event.clientX / viewportSize) * 100
        : ((viewportSize - event.clientY) / viewportSize) * 100;
    onChangeRef.current(clamp(rawValue, min, max));
  }

  function handlePointerUp(event: ReactPointerEvent<HTMLDivElement>): void {
    if (event.pointerId !== pointerId.current) {
      return;
    }
    pointerId.current = null;
    setIsDragging(false);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    const step = event.shiftKey ? 5 : 1;
    let nextValue: number | undefined;

    if (event.key === "Home") {
      nextValue = min;
    } else if (event.key === "End") {
      nextValue = max;
    } else if (orientation === "vertical" && event.key === "ArrowLeft") {
      nextValue = value - step;
    } else if (orientation === "vertical" && event.key === "ArrowRight") {
      nextValue = value + step;
    } else if (orientation === "horizontal" && event.key === "ArrowDown") {
      nextValue = value - step;
    } else if (orientation === "horizontal" && event.key === "ArrowUp") {
      nextValue = value + step;
    }

    if (nextValue === undefined) {
      return;
    }
    event.preventDefault();
    onChangeRef.current(clamp(nextValue, min, max));
  }

  const valueText = `${Math.round(value)}% of viewport ${
    orientation === "vertical" ? "width" : "height"
  }`;

  return (
    <div
      className={`resize-handle resize-handle-${orientation}${
        isDragging ? " is-dragging" : ""
      }`}
      role="separator"
      aria-label={label}
      aria-orientation={orientation}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={Math.round(value)}
      aria-valuetext={valueText}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
    />
  );
}
