import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ProgressIndicator } from "../../src/components/ProgressIndicator";

describe("ProgressIndicator", () => {
  it("renders an accessible indeterminate indicator", () => {
    render(
      <ProgressIndicator
        label="GTFS import: US-WA-KCM"
        detail="Feed 1 of 1 - reading stops - 42 rows"
      />
    );

    const progress = screen.getByRole("progressbar", {
      name: "GTFS import: US-WA-KCM"
    });
    expect(progress).not.toHaveAttribute("value");
    expect(
      screen.getByText("Feed 1 of 1 - reading stops - 42 rows")
    ).toBeInTheDocument();
  });

  it("renders determinate progress values", () => {
    render(
      <ProgressIndicator
        label="Overpass query"
        detail="Query 1 of 2"
        value={1}
        max={2}
      />
    );

    const progress = screen.getByRole("progressbar", {
      name: "Overpass query"
    });
    expect(progress).toHaveAttribute("value", "1");
    expect(progress).toHaveAttribute("max", "2");
  });
});
