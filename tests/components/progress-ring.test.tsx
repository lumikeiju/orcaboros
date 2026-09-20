import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ProgressRing } from "../../src/components/ProgressRing";

afterEach(() => cleanup());

describe("ProgressRing", () => {
  it("renders an accessible label with resolved and total counts", () => {
    render(<ProgressRing resolved={2} total={4} />);

    expect(
      screen.getByRole("img", {
        name: "Conflation progress: 2 of 4 resolved (50%)"
      })
    ).toBeInTheDocument();
  });

  it("renders zero percent when nothing is resolved", () => {
    render(<ProgressRing resolved={0} total={3} />);

    expect(
      screen.getByRole("img", {
        name: "Conflation progress: 0 of 3 resolved (0%)"
      })
    ).toBeInTheDocument();
  });

  it("renders full progress when every feature is resolved", () => {
    render(<ProgressRing resolved={5} total={5} />);

    expect(
      screen.getByRole("img", {
        name: "Conflation progress: 5 of 5 resolved (100%)"
      })
    ).toBeInTheDocument();
  });

  it("renders zero percent when there is nothing to resolve", () => {
    render(<ProgressRing resolved={0} total={0} />);

    expect(
      screen.getByRole("img", {
        name: "Conflation progress: 0 of 0 resolved (0%)"
      })
    ).toBeInTheDocument();
  });
});
