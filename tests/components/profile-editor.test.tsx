import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { EligibleStop } from "../../src/domain/gtfs";
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
    expect(screen.getByLabelText("OSM tag key for stop_id")).toHaveValue(
      "gtfs:stop_id:US-WA-KCM"
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

  it("shows a mid-file source value and resulting identity tag", () => {
    const profile = getProfileForFeedId("US-WA-KCM");
    if (profile === undefined) {
      throw new Error("stock fixture profile is missing");
    }
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    render(
      <ProfileEditor
        profile={profile}
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

  it("separates mapping fields by uploaded feed", () => {
    const profile = getProfileForFeedIds(["US-WA-KCM", "US-WA-ST"]);
    if (profile === undefined) {
      throw new Error("combined fixture profile is missing");
    }
    render(
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
    ).toHaveValue("gtfs:stop_id:US-WA-KCM");
    expect(
      screen.getByLabelText("OSM tag key for US-WA-ST stop_id")
    ).toHaveValue("gtfs:stop_id:US-WA-ST");
    expect(
      screen.getByLabelText("OSM tag key for US-WA-KCM kcm_zone")
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText("OSM tag key for US-WA-ST st_zone")
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
