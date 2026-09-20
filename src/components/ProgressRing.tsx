import { type ReactElement } from "react";

export type ProgressRingProps = {
  resolved: number;
  total: number;
};

const RADIUS = 15.9155;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export function ProgressRing({
  resolved,
  total
}: ProgressRingProps): ReactElement {
  const fraction = total > 0 ? Math.min(Math.max(resolved / total, 0), 1) : 0;
  const dashOffset = CIRCUMFERENCE * (1 - fraction);
  const percent = Math.round(fraction * 100);

  return (
    <span className="progress-ring">
      <svg
        viewBox="0 0 36 36"
        role="img"
        aria-label={`Conflation progress: ${resolved} of ${total} resolved (${percent}%)`}
      >
        <circle className="progress-ring-track" cx="18" cy="18" r={RADIUS} />
        <circle
          className="progress-ring-value"
          cx="18"
          cy="18"
          r={RADIUS}
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={dashOffset}
        />
      </svg>
      <span className="progress-ring-label" aria-hidden="true">
        {percent}%
      </span>
    </span>
  );
}
