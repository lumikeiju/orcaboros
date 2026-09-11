import { type ChangeEvent, type ReactElement, useMemo } from "react";
import {
  deriveSourceFeedId,
  SourceFeedDefinition,
  validateSourceFeedSelection
} from "../domain/source-feed";

export type SelectedArchive = {
  file: File;
  sourceFeedId: string;
};

type SourcePickerProps = {
  definitions: readonly SourceFeedDefinition[];
  selected: readonly SelectedArchive[];
  onSelected: (
    archives: readonly SelectedArchive[],
    errors: readonly string[]
  ) => void;
};

export function SourcePicker({
  definitions,
  selected,
  onSelected
}: SourcePickerProps): ReactElement {
  const selectedIds = useMemo(
    () => selected.map((archive) => archive.sourceFeedId),
    [selected]
  );
  const profileIssues = validateSourceFeedSelection(selectedIds, definitions);

  function handleChange(event: ChangeEvent<HTMLInputElement>): void {
    const files = [...(event.target.files ?? [])];
    const errors: string[] = [];
    const archives: SelectedArchive[] = [];
    for (const file of files) {
      try {
        const sourceFeedId = deriveSourceFeedId(file.name);
        archives.push({ file, sourceFeedId });
      } catch (error) {
        errors.push(
          error instanceof Error
            ? error.message
            : "The selected filename is invalid"
        );
      }
    }
    const issues = validateSourceFeedSelection(
      archives.map((archive) => archive.sourceFeedId),
      definitions
    );
    for (const issue of issues) {
      errors.push(
        issue.kind === "duplicate"
          ? `${issue.sourceFeedId} was selected more than once`
          : issue.kind === "consolidated"
            ? "The consolidated US-WA-PSC feed is not supported"
            : `${issue.sourceFeedId} is not enabled in this profile`
      );
    }
    onSelected(archives, errors);
  }

  return (
    <section className="panel" aria-labelledby="source-heading">
      <h2 id="source-heading">1. Select local GTFS feeds</h2>
      <p>
        Only <code>stops.txt</code> is read. The source-feed ID comes from each
        ZIP filename before parsing.
      </p>
      <label className="file-control" htmlFor="gtfs-files">
        <span>Select one or more ZIP archives</span>
        <input
          id="gtfs-files"
          type="file"
          accept=".zip,application/zip"
          multiple
          onChange={handleChange}
        />
      </label>
      <ul className="source-list" aria-label="Selected source feeds">
        {selected.length === 0 ? (
          <li className="muted">No archives selected.</li>
        ) : (
          selected.map((archive) => (
            <li key={`${archive.sourceFeedId}-${archive.file.name}`}>
              <strong>{archive.sourceFeedId}</strong>
              <span>{archive.file.name}</span>
            </li>
          ))
        )}
      </ul>
      {profileIssues.length > 0 && (
        <p className="error" role="alert">
          {profileIssues.map((issue) => issue.sourceFeedId).join(", ")} cannot
          be imported with this profile.
        </p>
      )}
    </section>
  );
}
