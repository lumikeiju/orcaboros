import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { IntroWarning } from "../../src/components/IntroWarning";

afterEach(() => cleanup());

describe("IntroWarning", () => {
  it("explains the beta, review, OSM policy, and licensing warnings", () => {
    render(<IntroWarning />);

    expect(
      screen.getByRole("alertdialog", { name: "Before you use Orcaboros" })
    ).toBeInTheDocument();
    expect(screen.getByText(/is beta software/i)).toBeInTheDocument();
    expect(
      screen.getByText(/review every proposed change individually/i)
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Automated Edits Code of Conduct" })
    ).toHaveAttribute(
      "href",
      "https://wiki.openstreetmap.org/wiki/Automated_Edits_code_of_conduct"
    );
    expect(
      screen.getByText(
        /responsible for checking that each GTFS feed's license/i
      )
    ).toBeInTheDocument();
    const continueButton = screen.getByRole("button", {
      name: /I have read these warnings/
    });
    expect(continueButton).toHaveClass("glass-button--warning");
    expect(continueButton).toHaveFocus();
  });

  it("keeps keyboard focus in the warning until the user continues", () => {
    render(<IntroWarning />);

    const continueButton = screen.getByRole("button", {
      name: /I have read these warnings/
    });
    const firstLink = screen.getByRole("link", {
      name: "Automated Edits Code of Conduct"
    });

    fireEvent.keyDown(continueButton, { key: "Tab" });
    expect(firstLink).toHaveFocus();

    fireEvent.keyDown(firstLink, { key: "Tab", shiftKey: true });
    expect(continueButton).toHaveFocus();
  });

  it("dismisses after acknowledgement", () => {
    render(<IntroWarning />);

    fireEvent.click(
      screen.getByRole("button", {
        name: /I have read these warnings/
      })
    );

    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("runs the continue callback after dismissing the warning", () => {
    const onContinue = vi.fn(() => {
      screen.getByRole("textbox", { name: "GTFS file input" }).focus();
    });
    render(
      <>
        <input aria-label="GTFS file input" />
        <IntroWarning onContinue={onContinue} />
      </>
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: /I have read these warnings/
      })
    );

    expect(onContinue).toHaveBeenCalledOnce();
    expect(
      screen.getByRole("textbox", { name: "GTFS file input" })
    ).toHaveFocus();
  });
});
