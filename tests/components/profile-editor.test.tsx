import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProfileEditor } from "../../src/components/ProfileEditor";
import { getProfileForFeedId } from "../../src/profiles";

afterEach(() => cleanup());

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
        mappingRules: expect.arrayContaining([
          expect.objectContaining({
            key: "amenity",
            value: { kind: "constant", value: "platform" }
          })
        ])
      })
    );

    fireEvent.change(
      screen.getByLabelText('OSM tag value for constant "platform"'),
      { target: { value: "transit_platform" } }
    );
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        mappingRules: expect.arrayContaining([
          expect.objectContaining({
            key: "public_transport",
            value: { kind: "constant", value: "transit_platform" }
          })
        ])
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
        mappingRules: expect.not.arrayContaining([
          expect.objectContaining({
            value: { kind: "constant", value: "platform" }
          })
        ])
      })
    );

    fireEvent.click(screen.getByRole("button", { name: "Add OSM tag" }));
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        mappingRules: expect.arrayContaining([
          { key: "", value: { kind: "constant", value: "" } }
        ])
      })
    );
  });
});
