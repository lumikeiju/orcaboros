import {
  Fragment,
  type ChangeEvent,
  type ReactElement,
  useMemo,
  useState
} from "react";
import type { EligibleStop } from "../domain/gtfs";
import {
  MappingField,
  MappingProfile,
  ProfileSourceFeed,
  MappingRule,
  ProfileValidationError,
  mappingFieldValue
} from "../domain/profile";
import {
  DEFAULT_GEOMETRY_TARGET,
  type GeometryTarget
} from "../domain/source-feed";
import { readUtf8Stream } from "../infrastructure/browser/text-stream";
import { parseProfileJson, serializeProfile } from "../profiles";

type ProfileEditorProps = {
  profile: MappingProfile;
  availableFields?: readonly string[];
  availableFieldsByFeed?: ReadonlyMap<string, readonly string[]>;
  uploadedFeedIds?: readonly string[];
  exampleStops?: readonly EligibleStop[];
  exampleRowCounts?: ReadonlyMap<string, number>;
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

function isDirectFieldRuleForFeed(
  rule: MappingRule,
  sourceFeedId: string
): boolean {
  if (rule.value.kind !== "field") {
    return false;
  }
  return (
    rule.appliesTo?.locationKinds === undefined &&
    (rule.appliesTo?.sourceFeedIds === undefined ||
      rule.appliesTo.sourceFeedIds.includes(sourceFeedId))
  );
}

function ruleAppliesToFeed(rule: MappingRule, sourceFeedId: string): boolean {
  return (
    rule.appliesTo?.sourceFeedIds === undefined ||
    rule.appliesTo.sourceFeedIds.includes(sourceFeedId)
  );
}

function exampleStopIndex(
  eligibleRowCount: number,
  inputRowCount: number
): number {
  const rowCount = Math.max(1, inputRowCount);
  const minimum = Math.max(0, Math.ceil(rowCount * 0.25) - 1);
  const maximum = Math.max(
    minimum,
    Math.min(rowCount - 1, Math.floor(rowCount * 0.75) - 1)
  );
  const selectedInputRow =
    minimum + Math.floor(Math.random() * (maximum - minimum + 1));
  const inputIndexScale = Math.max(1, rowCount - 1);
  const eligibleIndexScale = Math.max(0, eligibleRowCount - 1);
  return Math.min(
    eligibleIndexScale,
    Math.round((selectedInputRow / inputIndexScale) * eligibleIndexScale)
  );
}

function mappingRuleValue(rule: MappingRule, stop: EligibleStop): string {
  if (rule.value.kind === "constant") {
    return rule.value.value;
  }
  if (rule.value.kind === "field") {
    return mappingFieldValue(rule.value.field, stop);
  }
  return stop.sourceFeedMetadata?.[rule.value.key] ?? "";
}

function exampleText(
  field: string,
  rule: MappingRule | undefined,
  stop: EligibleStop
): string {
  const sourceValue = mappingFieldValue(field, stop);
  const sourceText = sourceValue.length > 0 ? sourceValue : "(empty)";
  if (rule === undefined || rule.key.trim().length === 0) {
    return `${sourceText} → (ignored)`;
  }
  const mappedValue = mappingRuleValue(rule, stop);
  const mappedText = mappedValue.length > 0 ? mappedValue : "(empty)";
  return `${sourceText} → ${rule.key}=${mappedText}`;
}

export function ProfileEditor({
  profile,
  availableFields = [],
  availableFieldsByFeed = new Map(),
  uploadedFeedIds = [],
  exampleStops = [],
  exampleRowCounts = new Map(),
  onChange,
  onReset
}: ProfileEditorProps): ReactElement {
  const [jsonError, setJsonError] = useState<string | undefined>();
  const exampleStopsByFeed = useMemo(() => {
    const stopsByFeed = new Map<string, EligibleStop[]>();
    for (const stop of exampleStops) {
      const stops = stopsByFeed.get(stop.sourceFeedId) ?? [];
      stops.push(stop);
      stopsByFeed.set(stop.sourceFeedId, stops);
    }
    return new Map(
      [...stopsByFeed.entries()].map(([sourceFeedId, stops]) => [
        sourceFeedId,
        stops[
          exampleStopIndex(
            stops.length,
            exampleRowCounts.get(sourceFeedId) ?? stops.length
          )
        ]
      ])
    );
  }, [exampleRowCounts, exampleStops]);
  const uploadedFeedIdSet = new Set(uploadedFeedIds);
  const feedSections = profile.sourceFeeds.filter(
    (sourceFeed) =>
      sourceFeed.enabled &&
      (uploadedFeedIdSet.size === 0 || uploadedFeedIdSet.has(sourceFeed.id))
  );
  const visibleFeedSections =
    feedSections.length > 0
      ? feedSections
      : profile.sourceFeeds.filter((sourceFeed) => sourceFeed.enabled);

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

  function updateGeometryTarget(
    sourceFeedId: string,
    geometryTarget: GeometryTarget
  ): void {
    onChange({
      ...profile,
      sourceFeeds: profile.sourceFeeds.map((sourceFeed) =>
        sourceFeed.id === sourceFeedId
          ? { ...sourceFeed, geometryTarget }
          : sourceFeed
      )
    });
  }

  function updateStreetNameCleanup(
    sourceFeedId: string,
    streetNameCleanup: boolean
  ): void {
    onChange({
      ...profile,
      sourceFeeds: profile.sourceFeeds.map((sourceFeed) =>
        sourceFeed.id === sourceFeedId
          ? { ...sourceFeed, streetNameCleanup }
          : sourceFeed
      )
    });
  }

  function directFieldRuleIndex(
    sourceFeedId: string,
    field: string
  ): number | undefined {
    const index = profile.mappingRules.findIndex(
      (rule) =>
        rule.value.kind === "field" &&
        rule.value.field === field &&
        isDirectFieldRuleForFeed(rule, sourceFeedId)
    );
    return index < 0 ? undefined : index;
  }

  function updateFieldMapping(
    sourceFeedId: string,
    field: string,
    key: string
  ): void {
    const nextKey = key.trim();
    const mappingRules = [...profile.mappingRules];
    const existingIndex = directFieldRuleIndex(sourceFeedId, field);
    if (nextKey.length === 0) {
      if (existingIndex === undefined) {
        return;
      }
      mappingRules.splice(existingIndex, 1);
    } else if (existingIndex !== undefined) {
      mappingRules[existingIndex] = {
        ...mappingRules[existingIndex],
        key: nextKey
      };
    } else {
      const nextRule: MappingRule = {
        key: nextKey,
        value: { kind: "field", field: field as MappingField },
        ...(profile.sourceFeeds.length === 1
          ? {}
          : { appliesTo: { sourceFeedIds: [sourceFeedId] } })
      };
      mappingRules.push(nextRule);
    }
    onChange({ ...profile, mappingRules });
  }

  function updateAdditionalTags(
    sourceFeedId: string,
    update: (rules: readonly MappingRule[]) => readonly MappingRule[]
  ): void {
    onChange({
      ...profile,
      sourceFeeds: profile.sourceFeeds.map((sourceFeed) =>
        sourceFeed.id === sourceFeedId
          ? {
              ...sourceFeed,
              additionalTags: update(sourceFeed.additionalTags ?? [])
            }
          : sourceFeed
      )
    });
  }

  function updateAdditionalRuleKey(
    sourceFeedId: string,
    index: number,
    key: string
  ): void {
    const nextKey = key.trim();
    updateAdditionalTags(sourceFeedId, (rules) => {
      const additionalTags = [...rules];
      if (nextKey.length === 0) {
        additionalTags.splice(index, 1);
      } else if (additionalTags[index] !== undefined) {
        additionalTags[index] = { ...additionalTags[index], key: nextKey };
      }
      return additionalTags;
    });
  }

  function updateAdditionalConstantValue(
    sourceFeedId: string,
    index: number,
    value: string
  ): void {
    const rule = profile.sourceFeeds.find(
      (sourceFeed) => sourceFeed.id === sourceFeedId
    )?.additionalTags?.[index];
    if (rule === undefined || rule.value.kind !== "constant") {
      return;
    }
    updateAdditionalTags(sourceFeedId, (rules) =>
      rules.map((candidate, ruleIndex) =>
        ruleIndex === index
          ? { ...candidate, value: { ...rule.value, value } }
          : candidate
      )
    );
  }

  function removeAdditionalRule(sourceFeedId: string, index: number): void {
    updateAdditionalTags(sourceFeedId, (rules) =>
      rules.filter((_rule, ruleIndex) => ruleIndex !== index)
    );
  }

  function addConstantTag(sourceFeedId: string): void {
    updateAdditionalTags(sourceFeedId, (rules) => [
      ...rules,
      { key: "", value: { kind: "constant", value: "" } }
    ]);
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

  function fieldsForFeed(sourceFeedId: string): readonly string[] {
    const feedFields =
      availableFieldsByFeed.get(sourceFeedId) ??
      (visibleFeedSections.length === 1 ? availableFields : []);
    return [
      ...new Set([
        ...feedFields,
        ...profile.mappingRules.flatMap((rule) =>
          rule.value.kind === "field" && ruleAppliesToFeed(rule, sourceFeedId)
            ? [rule.value.field]
            : []
        )
      ])
    ];
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
          Auto-match radius
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
      <div className="profile-feed-sections">
        {visibleFeedSections.map((sourceFeed: ProfileSourceFeed) => {
          const mappingFields = fieldsForFeed(sourceFeed.id);
          const exampleStop = exampleStopsByFeed.get(sourceFeed.id);
          const geometryTarget =
            sourceFeed.geometryTarget ?? DEFAULT_GEOMETRY_TARGET;
          const additionalTags = sourceFeed.additionalTags ?? [];
          return (
            <details className="profile-feed-section" key={sourceFeed.id} open>
              <summary>
                {sourceFeed.displayName} ({sourceFeed.id})
              </summary>
              <div className="profile-geometry-target">
                <span>Geometry target</span>
                <button
                  type="button"
                  className={`profile-geometry-toggle${
                    geometryTarget === "gtfs" ? " is-gtfs" : ""
                  }`}
                  role="switch"
                  aria-checked={geometryTarget === "gtfs"}
                  aria-label={`Geometry target for ${sourceFeed.id}`}
                  onClick={() =>
                    updateGeometryTarget(
                      sourceFeed.id,
                      geometryTarget === "gtfs" ? "osm" : "gtfs"
                    )
                  }
                >
                  <span
                    className="profile-geometry-toggle-option"
                    aria-hidden="true"
                  >
                    GTFS
                  </span>
                  <span
                    className="profile-geometry-toggle-track"
                    aria-hidden="true"
                  >
                    <span className="profile-geometry-toggle-thumb" />
                  </span>
                  <span
                    className="profile-geometry-toggle-option"
                    aria-hidden="true"
                  >
                    OSM
                  </span>
                </button>
              </div>
              <p className="workflow-step-hint">
                GTFS moves a matched OSM element to the feed point. OSM keeps
                the existing OSM location and applies the mapped GTFS tags.
              </p>
              <div className="profile-street-name-cleanup">
                <span>Street name cleanup</span>
                <button
                  type="button"
                  className={`profile-cleanup-toggle${
                    sourceFeed.streetNameCleanup ? " is-on" : ""
                  }`}
                  role="switch"
                  aria-checked={sourceFeed.streetNameCleanup}
                  aria-label={`Street name cleanup for ${sourceFeed.id}`}
                  onClick={() =>
                    updateStreetNameCleanup(
                      sourceFeed.id,
                      !sourceFeed.streetNameCleanup
                    )
                  }
                >
                  <span
                    className="profile-cleanup-toggle-option"
                    aria-hidden="true"
                  >
                    Off
                  </span>
                  <span
                    className="profile-cleanup-toggle-track"
                    aria-hidden="true"
                  >
                    <span className="profile-cleanup-toggle-thumb" />
                  </span>
                  <span
                    className="profile-cleanup-toggle-option"
                    aria-hidden="true"
                  >
                    On
                  </span>
                </button>
              </div>
              <p className="workflow-step-hint">
                Expand US street-name abbreviations and clean all-uppercase
                names before mapping the OSM name tag.
              </p>
              <fieldset>
                <legend>GTFS fields to OSM tags</legend>
                {mappingFields.length === 0 && (
                  <p className="workflow-step-hint">
                    Import this feed to inspect its stops.txt fields. Blank tag
                    keys are ignored during conflation.
                  </p>
                )}
                <table className="mapping-table">
                  <caption className="visually-hidden">
                    GTFS fields and their resulting OpenStreetMap tag keys for{" "}
                    {sourceFeed.displayName}
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">GTFS Field</th>
                      <th scope="col">OSM Key</th>
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
                        const ruleIndex = directFieldRuleIndex(
                          sourceFeed.id,
                          field
                        );
                        const rule =
                          ruleIndex === undefined
                            ? undefined
                            : profile.mappingRules[ruleIndex];
                        const exampleRule =
                          rule ??
                          profile.mappingRules.find(
                            (candidate) =>
                              candidate.value.kind === "field" &&
                              candidate.value.field === field &&
                              ruleAppliesToFeed(candidate, sourceFeed.id)
                          );
                        const fieldLabel =
                          visibleFeedSections.length === 1
                            ? `OSM tag key for ${field}`
                            : `OSM tag key for ${sourceFeed.id} ${field}`;
                        const exampleLabel =
                          visibleFeedSections.length === 1
                            ? `Example mapping for ${field}`
                            : `Example mapping for ${sourceFeed.id} ${field}`;
                        return (
                          <Fragment key={field}>
                            <tr
                              className={
                                exampleStop === undefined
                                  ? undefined
                                  : "mapping-field-row-with-example"
                              }
                            >
                              <th scope="row">
                                <code>{field}</code>
                              </th>
                              <td>
                                <input
                                  type="text"
                                  value={rule?.key ?? ""}
                                  aria-label={fieldLabel}
                                  placeholder="Ignore field"
                                  onChange={(event) =>
                                    updateFieldMapping(
                                      sourceFeed.id,
                                      field,
                                      event.target.value
                                    )
                                  }
                                />
                              </td>
                            </tr>
                            {exampleStop !== undefined && (
                              <tr>
                                <td colSpan={2}>
                                  <output
                                    className="mapping-example"
                                    aria-label={exampleLabel}
                                  >
                                    {exampleText(
                                      field,
                                      exampleRule,
                                      exampleStop
                                    )}
                                  </output>
                                </td>
                              </tr>
                            )}
                          </Fragment>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </fieldset>
              <fieldset>
                <legend>Additional OSM tags</legend>
                {additionalTags.length === 0 ? (
                  <p className="workflow-step-hint">
                    No additional tags are defined for this feed.
                  </p>
                ) : (
                  <table className="mapping-table">
                    <caption className="visually-hidden">
                      Additional OpenStreetMap tag rules for{" "}
                      {sourceFeed.displayName}
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
                      {additionalTags.map((rule, index) => (
                        <tr key={`${mappingValueLabel(rule)}-${index}`}>
                          <td>
                            <input
                              type="text"
                              value={rule.key}
                              aria-label={`OSM tag key for ${mappingValueLabel(rule)}`}
                              onChange={(event) =>
                                updateAdditionalRuleKey(
                                  sourceFeed.id,
                                  index,
                                  event.target.value
                                )
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
                                    sourceFeed.id,
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
                              onClick={() =>
                                removeAdditionalRule(sourceFeed.id, index)
                              }
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
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => addConstantTag(sourceFeed.id)}
                  >
                    <svg
                      aria-hidden="true"
                      viewBox="0 0 24 24"
                      focusable="false"
                    >
                      <path d="M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6V5Z" />
                    </svg>
                    Add OSM tag
                  </button>
                </div>
              </fieldset>
            </details>
          );
        })}
      </div>
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
