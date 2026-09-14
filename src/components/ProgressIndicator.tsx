import { type ReactElement } from "react";

export type ProgressIndicatorProps = {
  label: string;
  detail: string;
  value?: number;
  max?: number;
};

export function ProgressIndicator({
  label,
  detail,
  value,
  max
}: ProgressIndicatorProps): ReactElement {
  const isDeterminate = value !== undefined && max !== undefined;

  return (
    <div className="progress-indicator" role="status" aria-live="polite">
      <div className="progress-indicator-heading">
        <strong>{label}</strong>
        <span>{detail}</span>
      </div>
      {isDeterminate ? (
        <progress aria-label={label} max={max} value={value} />
      ) : (
        <progress aria-label={label} />
      )}
    </div>
  );
}
