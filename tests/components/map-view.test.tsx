import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MapLegend } from "../../src/components/MapView";

afterEach(() => cleanup());

describe("MapLegend", () => {
  it("starts open and toggles the legend items with accessible state", () => {
    render(<MapLegend />);

    const toggle = screen.getByRole("button", { name: "Collapse map legend" });
    const items = screen.getByRole("list");

    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(toggle).toHaveAttribute("aria-controls", "map-legend-items");
    expect(items).not.toHaveAttribute("hidden");

    fireEvent.click(toggle);

    expect(
      screen.getByRole("button", { name: "Expand map legend" })
    ).toHaveAttribute("aria-expanded", "false");
    expect(items).toHaveAttribute("hidden");

    fireEvent.click(screen.getByRole("button", { name: "Expand map legend" }));

    expect(
      screen.getByRole("button", { name: "Collapse map legend" })
    ).toHaveAttribute("aria-expanded", "true");
    expect(items).not.toHaveAttribute("hidden");
  });
});
