import { type ChangeEvent, type ReactElement, useState } from "react";
import {
  MappingField,
  MappingProfile,
  MappingRule,
  ProfileValidationError
} from "../domain/profile";
import { readUtf8Stream } from "../infrastructure/browser/text-stream";
import { parseProfileJson, serializeProfile } from "../profiles";

type ProfileEditorProps = {
  profile: MappingProfile;
  availableFields?: readonly string[];
  onChange: (profile: MappingProfile) => void;
  onReset: () => void;
};

function mappingValueLabel(rule: MappingRule): string {
  if (rule.value.kind === "constant") {
    if (rule.value.value.length === 0) {
      return "new constant tag";
    }
    return `constant ${JSON.stringify(rule.value.value)}`;
  }
  if (rule.value.kind === "field") {
    return `GTFS field ${rule.value.field}`;
  }
  return `source metadata ${rule.value.key}`;
}

export function ProfileEditor({
  profile,
  availableFields = [],
  onChange,
  onReset
}: ProfileEditorProps): ReactElement {
  const [jsonError, setJsonError] = useState<string | undefined>();
  const mappingFields = [
    ...new Set([
      ...availableFields,
      ...profile.mappingRules.flatMap((rule) =>
        rule.value.kind === "field" ? [rule.value.field] : []
      )
    ])
  ];
  const directFieldRuleIndexes = new Map<string, number>();
  profile.mappingRules.forEach((rule, index) => {
    if (
      rule.value.kind === "field" &&
      rule.appliesTo === undefined &&
      !directFieldRuleIndexes.has(rule.value.field)
    ) {
      directFieldRuleIndexes.set(rule.value.field, index);
    }
  });
  const additionalRuleEntries = profile.mappingRules
    .map((rule, index) => ({ rule, index }))
    .filter(
      ({ rule, index }) =>
        !(
          rule.value.kind === "field" &&
          rule.appliesTo === undefined &&
          directFieldRuleIndexes.get(rule.value.field) === index
        )
    );

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

  function updateFieldMapping(field: string, key: string): void {
    const nextKey = key.trim();
    const mappingRules = [...profile.mappingRules];
    const existingIndex = mappingRules.findIndex(
      (rule) =>
        rule.value.kind === "field" &&
        rule.value.field === field &&
        rule.appliesTo === undefined
    );
    if (nextKey.length === 0) {
      if (existingIndex < 0) {
        return;
      }
      mappingRules.splice(existingIndex, 1);
    } else if (existingIndex >= 0) {
      mappingRules[existingIndex] = {
        ...mappingRules[existingIndex],
        key: nextKey
      };
    } else {
      mappingRules.push({
        key: nextKey,
        value: { kind: "field", field: field as MappingField }
      });
    }
    onChange({ ...profile, mappingRules });
  }

  function updateAdditionalRuleKey(index: number, key: string): void {
    const nextKey = key.trim();
    const mappingRules = [...profile.mappingRules];
    if (nextKey.length === 0) {
      mappingRules.splice(index, 1);
    } else {
      mappingRules[index] = { ...mappingRules[index], key: nextKey };
    }
    onChange({ ...profile, mappingRules });
  }

  function updateAdditionalConstantValue(index: number, value: string): void {
    const rule = profile.mappingRules[index];
    if (rule === undefined || rule.value.kind !== "constant") {
      return;
    }
    const mappingRules = [...profile.mappingRules];
    mappingRules[index] = {
      ...rule,
      value: { ...rule.value, value }
    };
    onChange({ ...profile, mappingRules });
  }

  function removeAdditionalRule(index: number): void {
    onChange({
      ...profile,
      mappingRules: profile.mappingRules.filter(
        (_rule, ruleIndex) => ruleIndex !== index
      )
    });
  }

  function addConstantTag(): void {
    onChange({
      ...profile,
      mappingRules: [
        ...profile.mappingRules,
        { key: "", value: { kind: "constant", value: "" } }
      ]
    });
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
    <details className="panel" open>
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
        {profile.name} applies to{" "}
        {profile.sourceFeeds.map((source) => source.id).join(", ")}.
      </p>
      <fieldset>
        <legend>GTFS fields to OSM tags</legend>
        {mappingFields.length === 0 && (
          <p className="workflow-step-hint">
            Import a feed to inspect its stops.txt fields. Blank tag keys are
            ignored during conflation.
          </p>
        )}
        <table className="mapping-table">
          <caption className="visually-hidden">
            GTFS fields and their resulting OpenStreetMap tag keys
          </caption>
          <thead>
            <tr>
              <th scope="col">GTFS field</th>
              <th scope="col">OSM tag key</th>
            </tr>
          </thead>
          <tbody>
            {mappingFields.length === 0 ? (
              <tr>
                <td className="muted" colSpan={2}>
                  No feed fields are available yet.
                </td>
              </tr>
            ) : (
              mappingFields.map((field) => {
                const ruleIndex = directFieldRuleIndexes.get(field);
                const rule =
                  ruleIndex === undefined
                    ? undefined
                    : profile.mappingRules[ruleIndex];
                return (
                  <tr key={field}>
                    <th scope="row">
                      <code>{field}</code>
                    </th>
                    <td>
                      <input
                        type="text"
                        value={rule?.key ?? ""}
                        aria-label={`OSM tag key for ${field}`}
                        placeholder="Ignore field"
                        onChange={(event) =>
                          updateFieldMapping(field, event.target.value)
                        }
                      />
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </fieldset>
      <fieldset>
        <legend>Additional OSM tags</legend>
        {additionalRuleEntries.length === 0 ? (
          <p className="workflow-step-hint">
            No additional tags are defined for this profile.
          </p>
        ) : (
          <table className="mapping-table">
            <caption className="visually-hidden">
              Conditional and constant OpenStreetMap tag rules
            </caption>
            <thead>
              <tr>
                <th scope="col">OSM tag key</th>
                <th scope="col">OSM tag value</th>
                <th
                  scope="col"
                  className="mapping-table-actions"
                  aria-label="Actions"
                >
                  <span className="visually-hidden">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {additionalRuleEntries.map(({ rule, index }) => (
                <tr key={`${mappingValueLabel(rule)}-${index}`}>
                  <td>
                    <input
                      type="text"
                      value={rule.key}
                      aria-label={`OSM tag key for ${mappingValueLabel(rule)}`}
                      onChange={(event) =>
                        updateAdditionalRuleKey(index, event.target.value)
                      }
                    />
                  </td>
                  <td>
                    {rule.value.kind === "constant" ? (
                      <input
                        type="text"
                        value={rule.value.value}
                        aria-label={`OSM tag value for ${mappingValueLabel(rule)}`}
                        onChange={(event) =>
                          updateAdditionalConstantValue(
                            index,
                            event.target.value
                          )
                        }
                      />
                    ) : (
                      <span className="mapping-source-value">
                        <span className="visually-hidden">From </span>
                        <code>{mappingValueLabel(rule)}</code>
                      </span>
                    )}
                  </td>
                  <td className="mapping-table-actions">
                    <button
                      type="button"
                      className="icon-button secondary"
                      aria-label={`Remove ${mappingValueLabel(rule)}`}
                      title={`Remove ${mappingValueLabel(rule)}`}
                      onClick={() => removeAdditionalRule(index)}
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
              ))}
            </tbody>
          </table>
        )}
        <div className="mapping-actions">
          <button type="button" className="secondary" onClick={addConstantTag}>
            <svg aria-hidden="true" viewBox="0 0 24 24" focusable="false">
              <path d="M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6V5Z" />
            </svg>
            Add OSM tag
          </button>
        </div>
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
