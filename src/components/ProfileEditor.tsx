import { type ChangeEvent, type ReactElement, useState } from "react";
import { MappingProfile, ProfileValidationError } from "../domain/profile";
import { readUtf8Stream } from "../infrastructure/browser/text-stream";
import { parseProfileJson, serializeProfile } from "../profiles";

type ProfileEditorProps = {
  profile: MappingProfile;
  onChange: (profile: MappingProfile) => void;
  onReset: () => void;
};

export function ProfileEditor({
  profile,
  onChange,
  onReset
}: ProfileEditorProps): ReactElement {
  const [jsonError, setJsonError] = useState<string | undefined>();

  function updateRadius(
    field: "candidateRadiusMeters" | "autoIdRadiusMeters",
    value: string
  ): void {
    const radius = Number(value);
    if (!Number.isFinite(radius) || radius <= 0) {
      return;
    }
    onChange({ ...profile, [field]: radius });
  }

  function exportProfile(): void {
    const blob = new Blob([serializeProfile(profile)], {
      type: "application/json"
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${profile.id}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function importProfile(event: ChangeEvent<HTMLInputElement>): void {
    const file = event.target.files?.[0];
    if (file === undefined) {
      return;
    }
    void readUtf8Stream(file)
      .then((text) => {
        const next = parseProfileJson(text);
        onChange(next);
        setJsonError(undefined);
      })
      .catch((error: unknown) => {
        setJsonError(
          error instanceof ProfileValidationError
            ? error.issues
                .map((issue) => `${issue.path}: ${issue.message}`)
                .join("; ")
            : "The profile file could not be read"
        );
      });
  }

  return (
    <details className="panel">
      <summary>Mapping profile</summary>
      <div className="profile-grid">
        <label>
          Candidate radius (m)
          <input
            type="number"
            min="1"
            max="10000"
            value={profile.candidateRadiusMeters}
            onChange={(event) =>
              updateRadius("candidateRadiusMeters", event.target.value)
            }
          />
        </label>
        <label>
          Exact-ID auto-match radius (m)
          <input
            type="number"
            min="1"
            max="10000"
            value={profile.autoIdRadiusMeters}
            onChange={(event) =>
              updateRadius("autoIdRadiusMeters", event.target.value)
            }
          />
        </label>
      </div>
      <p>
        Enabled feeds:{" "}
        {profile.sourceFeeds
          .filter((source) => source.enabled)
          .map((source) => source.id)
          .join(", ")}
      </p>
      <fieldset>
        <legend>Enabled source feeds</legend>
        <div className="source-grid">
          {profile.sourceFeeds.map((source) => (
            <label className="choice" key={source.id}>
              <input
                type="checkbox"
                checked={source.enabled}
                onChange={(event) =>
                  onChange({
                    ...profile,
                    sourceFeeds: profile.sourceFeeds.map((candidate) =>
                      candidate.id === source.id
                        ? { ...candidate, enabled: event.target.checked }
                        : candidate
                    )
                  })
                }
              />
              <span>
                {source.id} — {source.displayName}
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend>Direct tag mappings</legend>
        <ul className="mapping-list">
          {profile.mappingRules.map((rule, index) => (
            <li key={`${rule.key}-${index}`}>
              <code>{rule.key}</code> ←{" "}
              {rule.value.kind === "constant" ? (
                <code>{JSON.stringify(rule.value.value)}</code>
              ) : rule.value.kind === "field" ? (
                <code>{rule.value.field}</code>
              ) : (
                <code>metadata:{rule.value.key}</code>
              )}
            </li>
          ))}
        </ul>
      </fieldset>
      <div className="button-row">
        <button type="button" onClick={exportProfile}>
          Export profile JSON
        </button>
        <label className="button-like" htmlFor="profile-file">
          Import profile JSON
          <input
            id="profile-file"
            type="file"
            accept="application/json,.json"
            onChange={importProfile}
          />
        </label>
        <button type="button" className="secondary" onClick={onReset}>
          Reset stock profile
        </button>
      </div>
      {jsonError !== undefined && (
        <p className="error" role="alert">
          {jsonError}
        </p>
      )}
    </details>
  );
}
