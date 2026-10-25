import {
  type ChangeEvent,
  type DragEvent,
  type ReactElement,
  useMemo,
  useRef,
  useState
} from "react";
import {
  deriveSourceFeedId,
  normalizeSourceFeedId,
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
  allowUnknown?: boolean;
  onSelected: (
    archives: readonly SelectedArchive[],
    errors: readonly string[]
  ) => void;
};

export function SourcePicker({
  definitions,
  selected,
  allowUnknown = false,
  onSelected
}: SourcePickerProps): ReactElement {
  const [isDragActive, setIsDragActive] = useState(false);
  const dragDepth = useRef(0);
  const [fileSelectionErrors, setFileSelectionErrors] = useState<
    readonly string[]
  >([]);
  const selectedIds = useMemo(
    () => selected.map((archive) => archive.sourceFeedId),
    [selected]
  );
  const profileIssues = validateSourceFeedSelection(
    selectedIds,
    definitions
  ).filter((issue) => allowUnknown || issue.kind !== "unsupported");

  function selectionErrorsFor(
    archives: readonly SelectedArchive[],
    initialErrors: readonly string[] = []
  ): string[] {
    const errors = [...initialErrors];
    const issues = validateSourceFeedSelection(
      archives.map((archive) => archive.sourceFeedId),
      definitions
    );
    for (const issue of issues) {
      if (issue.kind === "duplicate") {
        errors.push(`${issue.sourceFeedId} was selected more than once`);
      }
    }
    return errors;
  }

  function handleFiles(files: readonly File[]): void {
    const errors: string[] = [];
    const newArchives: SelectedArchive[] = [];
    for (const file of files) {
      try {
        const sourceFeedId = deriveSourceFeedId(file.name);
        newArchives.push({ file, sourceFeedId });
      } catch (error) {
        errors.push(
          error instanceof Error
            ? error.message
            : "The selected filename is invalid"
        );
      }
    }
    const archives = [...selected, ...newArchives];
    setFileSelectionErrors(errors);
    onSelected(archives, selectionErrorsFor(archives, errors));
  }

  function isUnsupported(sourceFeedId: string): boolean {
    const issue = profileIssues.find(
      (candidate) =>
        candidate.sourceFeedId === normalizeSourceFeedId(sourceFeedId)
    );
    return issue?.kind === "unsupported" || issue?.kind === "consolidated";
  }

  const unsupportedFeedIds = profileIssues
    .filter(
      (issue) => issue.kind === "unsupported" || issue.kind === "consolidated"
    )
    .map((issue) => issue.sourceFeedId);

  function handleChange(event: ChangeEvent<HTMLInputElement>): void {
    const files = [...(event.currentTarget.files ?? [])];
    event.currentTarget.value = "";
    handleFiles(files);
  }

  function handleFeedIdChange(index: number, value: string): void {
    const archives = selected.map((archive, archiveIndex) =>
      archiveIndex === index ? { ...archive, sourceFeedId: value } : archive
    );
    onSelected(archives, selectionErrorsFor(archives, fileSelectionErrors));
  }

  function handleRemove(index: number): void {
    const archives = selected.filter(
      (_archive, archiveIndex) => archiveIndex !== index
    );
    onSelected(archives, selectionErrorsFor(archives, fileSelectionErrors));
  }

  function handleDragEnter(event: DragEvent<HTMLLabelElement>): void {
    event.preventDefault();
    dragDepth.current += 1;
    setIsDragActive(true);
  }

  function handleDragOver(event: DragEvent<HTMLLabelElement>): void {
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  }

  function handleDragLeave(event: DragEvent<HTMLLabelElement>): void {
    event.preventDefault();
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) {
      setIsDragActive(false);
    }
  }

  function handleDrop(event: DragEvent<HTMLLabelElement>): void {
    event.preventDefault();
    dragDepth.current = 0;
    setIsDragActive(false);
    handleFiles([...(event.dataTransfer.files ?? [])]);
  }

  return (
    <>
      <h2>Upload GTFS ZIPs</h2>
      <p>Feed ID defaults to the ZIP filename.</p>
      <label
        className={`file-control file-drop-zone${
          isDragActive ? " is-dragging" : ""
        }`}
        htmlFor="gtfs-files"
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <span>Choose or drop GTFS ZIPs</span>
        <input
          id="gtfs-files"
          type="file"
          accept=".zip,application/zip"
          multiple
          onChange={handleChange}
        />
      </label>
      <table className="source-table">
        <caption className="visually-hidden">Selected GTFS ZIPs</caption>
        <thead>
          <tr>
            <th scope="col">GTFS Feed ID</th>
            <th scope="col">GTFS ZIP</th>
            <th scope="col" aria-label="Actions">
              <span className="visually-hidden">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {selected.length === 0 ? (
            <tr>
              <td className="muted" colSpan={3}>
                No GTFS ZIPs selected.
              </td>
            </tr>
          ) : (
            selected.map((archive, index) => (
              <tr key={`${archive.file.name}-${index}`}>
                <td>
                  <input
                    id={`gtfs-feed-id-${index}`}
                    type="text"
                    value={archive.sourceFeedId}
                    aria-label={`GTFS Feed ID for ${archive.file.name}`}
                    aria-invalid={profileIssues.some(
                      (issue) =>
                        issue.sourceFeedId ===
                        normalizeSourceFeedId(archive.sourceFeedId)
                    )}
                    onChange={(event) =>
                      handleFeedIdChange(index, event.target.value)
                    }
                  />
                </td>
                <td>{archive.file.name}</td>
                <td className="source-table-actions">
                  {isUnsupported(archive.sourceFeedId) && (
                    <span
                      className="source-feed-warning"
                      role="img"
                      aria-label={`${archive.sourceFeedId} is not supported by this profile`}
                      title="This feed is not supported by the current profile and will be skipped"
                    >
                      !
                    </span>
                  )}
                  <button
                    type="button"
                    className="icon-button secondary"
                    aria-label={`Remove ${archive.file.name}`}
                    title={`Remove ${archive.file.name}`}
                    onClick={() => handleRemove(index)}
                  >
                    <svg
                      aria-hidden="true"
                      viewBox="0 0 24 24"
                      focusable="false"
                    >
                      <path d="M9 3h6l1 2h4v2H4V5h4l1-2Zm-3 6h12l-1 12H7L6 9Zm4 2v8h2v-8h-2Zm4 0v8h2v-8h-2Z" />
                    </svg>
                  </button>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
      {unsupportedFeedIds.length > 0 && (
        <p className="source-warning" role="status">
          Unsupported GTFS ZIPs will be skipped: {unsupportedFeedIds.join(", ")}
          .
        </p>
      )}
    </>
  );
}
