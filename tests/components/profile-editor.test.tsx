import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { EligibleStop } from "../../src/domain/gtfs";
import type { MappingProfile } from "../../src/domain/profile";
import { ProfileEditor } from "../../src/components/ProfileEditor";
import { getProfileForFeedId, getProfileForFeedIds } from "../../src/profiles";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function exampleStop(stopId: string): EligibleStop {
  return {
    featureId: `US-WA-KCM:${stopId}`,
    sourceFeedId: "US-WA-KCM",
    sourceFeedName: "King County Metro",
    stopId,
    stopName: `Stop ${stopId}`,
    stopNameExpanded: `Stop ${stopId}`,
    latitude: 47,
    longitude: -122,
    locationKind: "platform",
    parentStation: undefined,
    rawFields: { stop_id: stopId },
    identityTag: {
      key: "gtfs:stop_id:US-WA-KCM",
      value: stopId
    }
  };
}

describe("ProfileEditor", () => {
  it("reports invalid radii without publishing an unusable profile", () => {
    const profile = getProfileForFeedId("US-WA-KCM");
    if (profile === undefined) {
      throw new Error("Missing stock profile");
    }
    const onChange = vi.fn();
    render(
      <ProfileEditor profile={profile} onChange={onChange} onReset={vi.fn()} />
    );
    fireEvent.change(screen.getByLabelText("Auto-match radius"), {
      target: { value: "51" }
    });
    expect(screen.getByRole("alert")).toHaveTextContent("cannot exceed");
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Candidate radius (m)"), {
      target: { value: "10001" }
    });
    expect(screen.getByRole("alert")).toHaveTextContent("10,000");
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Candidate radius (m)"), {
      target: { value: "100" }
    });
    expect(screen.queryByRole("alert")).toBeNull();
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ candidateRadiusMeters: 100 })
    );
  });

  it("preserves the focused constant value input as its value changes", () => {
    const profile = getProfileForFeedId("US-WA-KCM");
    if (profile === undefined) {
      throw new Error("Missing stock profile");
    }
    const onReset = vi.fn();
    const onChange = vi.fn();
    const view = render(
      <ProfileEditor profile={profile} onChange={onChange} onReset={onReset} />
    );
    const input = screen.getByLabelText(
      'OSM tag value for constant "platform"'
    );
    input.focus();
    fireEvent.change(input, { target: { value: "platforms" } });
    const updatedProfile: MappingProfile = onChange.mock.calls[0]?.[0];
    view.rerender(
      <ProfileEditor
        profile={updatedProfile}
        onChange={onChange}
        onReset={onReset}
      />
    );
    expect(
      screen.getByLabelText('OSM tag value for constant "platforms"')
    ).toBe(input);
    expect(input).toHaveFocus();
  });

  it("renders uploaded fields and adds a field mapping", () => {
    const profile = getProfileForFeedId("US-WA-KCM");
    if (profile === undefined) {
      throw new Error("stock fixture profile is missing");
    }
    const onChange = vi.fn();
    render(
      <ProfileEditor
        profile={profile}
        availableFields={["stop_id", "custom_zone"]}
        onChange={onChange}
        onReset={vi.fn()}
      />
    );

    expect(screen.getByText("custom_zone")).toBeInTheDocument();
    const stopIdMapping = screen.getByLabelText("OSM tag key for stop_id");
    expect(stopIdMapping).toHaveValue("");
    fireEvent.change(stopIdMapping, {
      target: { value: "gtfs:stop_id:US-WA-KCM" }
    });
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        mappingRules: expect.arrayContaining([
          {
            key: "gtfs:stop_id:US-WA-KCM",
            value: { kind: "field", field: "stop_id" }
          }
        ])
      })
    );
    fireEvent.change(screen.getByLabelText("OSM tag key for custom_zone"), {
      target: { value: "ref:zone" }
    });

    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        mappingRules: expect.arrayContaining([
          {
            key: "ref:zone",
            value: { kind: "field", field: "custom_zone" }
          }
        ])
      })
    );
  });

  it("shows that an unmapped field is ignored and previews explicit mappings", () => {
    const profile = getProfileForFeedId("US-WA-KCM");
    if (profile === undefined) {
      throw new Error("stock fixture profile is missing");
    }
    const profileWithStopIdMapping = {
      ...profile,
      mappingRules: [
        ...profile.mappingRules,
        {
          key: "gtfs:stop_id:US-WA-KCM",
          value: { kind: "field" as const, field: "stop_id" },
          appliesTo: { sourceFeedIds: ["US-WA-KCM"] }
        }
      ]
    };
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    render(
      <ProfileEditor
        profile={profileWithStopIdMapping}
        availableFields={["stop_id"]}
        exampleStops={Array.from({ length: 100 }, (_, index) =>
          exampleStop(String(index))
        )}
        onChange={vi.fn()}
        onReset={vi.fn()}
      />
    );

    const example = screen.getByLabelText("Example mapping for stop_id");
    expect(example).toHaveTextContent("49 → gtfs:stop_id:US-WA-KCM=49");
    expect(example.parentElement?.tagName).toBe("TD");
    expect(example.parentElement).toHaveAttribute("colspan", "2");
    const exampleRow = example.closest("tr");
    expect(exampleRow).not.toBeNull();
    expect(exampleRow?.previousElementSibling).toHaveClass(
      "mapping-field-row-with-example"
    );
    expect(
      screen.getByRole("columnheader", { name: "GTFS Field" })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("columnheader", { name: "OSM Key" })
    ).toBeInTheDocument();
  });

  it("changes the geometry target for an uploaded feed", () => {
    const profile = getProfileForFeedId("US-WA-KCM");
    if (profile === undefined) {
      throw new Error("stock fixture profile is missing");
    }
    const onChange = vi.fn();
    render(
      <ProfileEditor profile={profile} onChange={onChange} onReset={vi.fn()} />
    );

    const geometryToggle = screen.getByRole("switch", {
      name: "Geometry target for US-WA-KCM"
    });
    expect(geometryToggle).toHaveAttribute("aria-checked", "false");
    expect(screen.getByText("GTFS")).toBeInTheDocument();
    expect(screen.getByText("OSM")).toBeInTheDocument();

    fireEvent.click(geometryToggle);

    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        sourceFeeds: [
          expect.objectContaining({
            id: "US-WA-KCM",
            geometryTarget: "gtfs"
          })
        ]
      })
    );
  });

  it("changes street-name cleanup for an uploaded feed", () => {
    const profile = getProfileForFeedId("US-WA-KCM");
    if (profile === undefined) {
      throw new Error("stock fixture profile is missing");
    }
    const onChange = vi.fn();
    render(
      <ProfileEditor profile={profile} onChange={onChange} onReset={vi.fn()} />
    );

    const cleanupToggle = screen.getByRole("switch", {
      name: "Street name cleanup for US-WA-KCM"
    });
    expect(cleanupToggle).toHaveAttribute("aria-checked", "true");

    fireEvent.click(cleanupToggle);

    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        sourceFeeds: [
          expect.objectContaining({
            id: "US-WA-KCM",
            streetNameCleanup: false
          })
        ]
      })
    );
  });

  it("separates mapping fields by uploaded feed", () => {
    const profile = getProfileForFeedIds(["US-WA-KCM", "US-WA-ST"]);
    if (profile === undefined) {
      throw new Error("combined fixture profile is missing");
    }
    const { container } = render(
      <ProfileEditor
        profile={profile}
        availableFieldsByFeed={
          new Map([
            ["US-WA-KCM", ["stop_id", "kcm_zone"]],
            ["US-WA-ST", ["stop_id", "st_zone"]]
          ])
        }
        uploadedFeedIds={["US-WA-KCM", "US-WA-ST"]}
        onChange={vi.fn()}
        onReset={vi.fn()}
      />
    );

    expect(
      screen.getByText("King County Metro (US-WA-KCM)")
    ).toBeInTheDocument();
    expect(screen.getByText("Sound Transit (US-WA-ST)")).toBeInTheDocument();
    expect(
      screen.getByLabelText("OSM tag key for US-WA-KCM stop_id")
    ).toHaveValue("");
    expect(
      Array.from(
        container.querySelectorAll<HTMLDetailsElement>(
          "details.profile-feed-section"
        )
      ).every((section) => section.open)
    ).toBe(true);
    expect(
      screen.getByLabelText("OSM tag key for US-WA-ST stop_id")
    ).toHaveValue("");
    expect(
      screen.getByLabelText("OSM tag key for US-WA-KCM kcm_zone")
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText("OSM tag key for US-WA-ST st_zone")
    ).toBeInTheDocument();
  });

  it("collapses and labels sections for an auto-matched stock profile", () => {
    const profile = getProfileForFeedIds(["US-WA-KCM", "US-WA-ST"]);
    if (profile === undefined) {
      throw new Error("combined fixture profile is missing");
    }
    const { container } = render(
      <ProfileEditor
        profile={profile}
        autoMatchedStockProfile
        uploadedFeedIds={["US-WA-KCM", "US-WA-ST"]}
        onChange={vi.fn()}
        onReset={vi.fn()}
      />
    );
    const feedSections = container.querySelectorAll<HTMLDetailsElement>(
      "details.profile-feed-section"
    );

    expect(feedSections).toHaveLength(2);
    expect(Array.from(feedSections).every((section) => !section.open)).toBe(
      true
    );
    expect(screen.getAllByText("Auto-matched")).toHaveLength(2);
    for (const section of Array.from(feedSections)) {
      expect(
        section.querySelector(".profile-feed-auto-matched")
      ).toHaveTextContent("Auto-matched");
    }
  });

  it("shows feed sections only for imported matching feeds", () => {
    const profile = getProfileForFeedIds(["US-WA-KCM", "US-WA-ST"]);
    if (profile === undefined) {
      throw new Error("combined fixture profile is missing");
    }
    const onChange = vi.fn();
    const onReset = vi.fn();
    const { container, rerender } = render(
      <ProfileEditor
        profile={profile}
        uploadedFeedIds={[]}
        onChange={onChange}
        onReset={onReset}
      />
    );

    expect(container.querySelectorAll(".profile-feed-section")).toHaveLength(0);
    expect(
      screen.getByText(
        "Import a matching GTFS feed to view its mapping options."
      )
    ).toBeInTheDocument();

    rerender(
      <ProfileEditor
        profile={profile}
        uploadedFeedIds={["US-WA-KCM"]}
        onChange={onChange}
        onReset={onReset}
      />
    );

    expect(container.querySelectorAll(".profile-feed-section")).toHaveLength(1);
    expect(
      screen.getByText("King County Metro (US-WA-KCM)")
    ).toBeInTheDocument();
    expect(screen.queryByText("Sound Transit (US-WA-ST)")).toBeNull();
    expect(
      screen.getByText("2 feed mapping profiles applies to US-WA-KCM.")
    ).toBeInTheDocument();
  });

  it("keeps additional tag edits inside their feed card", () => {
    const profile = getProfileForFeedIds(["US-WA-KCM", "US-WA-ST"]);
    if (profile === undefined) {
      throw new Error("combined fixture profile is missing");
    }
    const onChange = vi.fn();
    render(
      <ProfileEditor
        profile={profile}
        uploadedFeedIds={["US-WA-KCM", "US-WA-ST"]}
        onChange={onChange}
        onReset={vi.fn()}
      />
    );

    const addButtons = screen.getAllByRole("button", {
      name: "Add OSM tag"
    });
    expect(addButtons).toHaveLength(2);
    fireEvent.click(addButtons[1]);

    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        sourceFeeds: [
          expect.objectContaining({
            id: "US-WA-KCM",
            additionalTags: expect.not.arrayContaining([
              { key: "", value: { kind: "constant", value: "" } }
            ])
          }),
          expect.objectContaining({
            id: "US-WA-ST",
            additionalTags: expect.arrayContaining([
              { key: "", value: { kind: "constant", value: "" } }
            ])
          })
        ]
      })
    );
  });

  it("keeps OSM key removal rules inside their feed card", () => {
    const profile = getProfileForFeedIds(["US-WA-KCM", "US-WA-ST"]);
    if (profile === undefined) {
      throw new Error("combined fixture profile is missing");
    }
    const onChange = vi.fn();
    render(
      <ProfileEditor
        profile={profile}
        uploadedFeedIds={["US-WA-KCM", "US-WA-ST"]}
        onChange={onChange}
        onReset={vi.fn()}
      />
    );

    const addButtons = screen.getAllByRole("button", {
      name: "Add OSM key to remove"
    });
    expect(addButtons).toHaveLength(2);
    fireEvent.click(addButtons[1]);

    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        sourceFeeds: [
          expect.objectContaining({
            id: "US-WA-KCM",
            removeKeys: ["gtfs:stop_id", "gtfs:stop_id:US-WA-KCM", "gtfs:feed"]
          }),
          expect.objectContaining({
            id: "US-WA-ST",
            removeKeys: [
              "gtfs:stop_id",
              "gtfs:stop_id:US-WA-ST",
              "gtfs:feed",
              ""
            ]
          })
        ]
      })
    );
  });

  it("edits and removes configured OSM keys", () => {
    const profile = getProfileForFeedId("US-WA-KCM");
    if (profile === undefined) {
      throw new Error("stock fixture profile is missing");
    }
    const profileWithRemoval = {
      ...profile,
      sourceFeeds: profile.sourceFeeds.map((sourceFeed) => ({
        ...sourceFeed,
        removeKeys: ["obsolete:tag"]
      }))
    };
    let updatedProfile: MappingProfile = profileWithRemoval;
    const onChange = vi.fn((nextProfile: MappingProfile) => {
      updatedProfile = nextProfile;
    });
    const onReset = vi.fn();
    const { rerender } = render(
      <ProfileEditor
        profile={updatedProfile}
        onChange={onChange}
        onReset={onReset}
      />
    );

    const removeKeyInput = screen.getByLabelText("OSM tag key to remove");
    removeKeyInput.focus();
    fireEvent.change(removeKeyInput, {
      target: { value: "old:tag" }
    });
    rerender(
      <ProfileEditor
        profile={updatedProfile}
        onChange={onChange}
        onReset={onReset}
      />
    );
    expect(screen.getByLabelText("OSM tag key to remove")).toBe(removeKeyInput);
    expect(removeKeyInput).toHaveFocus();
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        sourceFeeds: [expect.objectContaining({ removeKeys: ["old:tag"] })]
      })
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: 'Remove OSM key "old:tag"'
      })
    );
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        sourceFeeds: [expect.objectContaining({ removeKeys: [] })]
      })
    );
  });

  it("edits both the key and value of a constant OSM tag", () => {
    const profile = getProfileForFeedId("US-WA-KCM");
    if (profile === undefined) {
      throw new Error("stock fixture profile is missing");
    }
    const onChange = vi.fn();
    render(
      <ProfileEditor profile={profile} onChange={onChange} onReset={vi.fn()} />
    );

    fireEvent.change(
      screen.getByLabelText('OSM tag key for constant "platform"'),
      { target: { value: "amenity" } }
    );
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        sourceFeeds: [
          expect.objectContaining({
            additionalTags: expect.arrayContaining([
              expect.objectContaining({
                key: "amenity",
                value: { kind: "constant", value: "platform" }
              })
            ])
          })
        ]
      })
    );

    fireEvent.change(
      screen.getByLabelText('OSM tag value for constant "platform"'),
      { target: { value: "transit_platform" } }
    );
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        sourceFeeds: [
          expect.objectContaining({
            additionalTags: expect.arrayContaining([
              expect.objectContaining({
                key: "public_transport",
                value: { kind: "constant", value: "transit_platform" }
              })
            ])
          })
        ]
      })
    );
  });

  it("removes an additional tag rule and adds a new constant tag", () => {
    const profile = getProfileForFeedId("US-WA-KCM");
    if (profile === undefined) {
      throw new Error("stock fixture profile is missing");
    }
    const onChange = vi.fn();
    render(
      <ProfileEditor profile={profile} onChange={onChange} onReset={vi.fn()} />
    );

    fireEvent.click(
      screen.getByRole("button", { name: 'Remove constant "platform"' })
    );
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        sourceFeeds: [
          expect.objectContaining({
            additionalTags: expect.not.arrayContaining([
              expect.objectContaining({
                value: { kind: "constant", value: "platform" }
              })
            ])
          })
        ]
      })
    );

    fireEvent.click(screen.getByRole("button", { name: "Add OSM tag" }));
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        sourceFeeds: [
          expect.objectContaining({
            additionalTags: expect.arrayContaining([
              { key: "", value: { kind: "constant", value: "" } }
            ])
          })
        ]
      })
    );
  });
});
