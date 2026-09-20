import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { App } from "../../src/App";
import packageMetadata from "../../package.json";

afterEach(() => cleanup());

describe("App workflow sidebar", () => {
  it("displays the version from package metadata", () => {
    render(<App />);

    expect(screen.getByText(`v${packageMetadata.version}`)).toBeInTheDocument();
  });

  it("opens one workflow panel beneath its step and closes the previous panel", () => {
    render(<App />);

    const importStep = screen.getByRole("button", {
      name: /1 Upload Load your GTFS feed\(s\)/
    });
    const profileStep = screen.getByRole("button", {
      name: /2 Profile Configure matching and region/
    });

    expect(importStep).toHaveAttribute("aria-expanded", "true");
    expect(importStep).toHaveAttribute("aria-controls", "upload-step-panel");
    expect(screen.getByText("Upload GTFS feed(s)")).toBeInTheDocument();

    fireEvent.click(profileStep);

    expect(importStep).toHaveAttribute("aria-expanded", "false");
    expect(profileStep).toHaveAttribute("aria-expanded", "true");
    expect(screen.queryByText("Upload GTFS feed(s)")).toBeNull();
    expect(screen.getByText("Mapping profile")).toBeInTheDocument();
    expect(screen.getByLabelText("Candidate radius (m)")).toBeInTheDocument();
    expect(screen.getByLabelText("Auto-match radius")).toBeInTheDocument();

    fireEvent.click(profileStep);

    expect(profileStep).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Mapping profile")).toBeNull();
  });

  it("keeps later workflow steps available before their prerequisites are ready", () => {
    render(<App />);

    fireEvent.click(
      screen.getByRole("button", {
        name: /3 Retrieve Get OSM data for comparison/
      })
    );
    expect(
      screen.getByText(/Import eligible stops first/i)
    ).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: /4 Review Inspect discrepancies/ })
    );
    expect(
      screen.getByText(/Import a feed and retrieve OSM candidates/i)
    ).toBeInTheDocument();
    expect(screen.queryByText(/Discrepancy queue/i)).toBeNull();

    fireEvent.click(
      screen.getByRole("button", {
        name: /5 Export Save results and contribute/
      })
    );
    expect(
      screen.getByText(/Complete import, retrieval, and review/i)
    ).toBeInTheDocument();
  });

  it("resizes the sidebar and review panel with keyboard controls", () => {
    render(<App />);

    const sidebarHandle = screen.getByRole("separator", {
      name: "Resize workflow sidebar width"
    });
    const reviewHandle = screen.getByRole("separator", {
      name: "Resize map and review panels"
    });

    expect(sidebarHandle).toHaveAttribute("aria-valuenow", "25");
    expect(reviewHandle).toHaveAttribute("aria-valuenow", "33");

    fireEvent.keyDown(sidebarHandle, { key: "ArrowRight" });
    fireEvent.keyDown(reviewHandle, { key: "ArrowUp", shiftKey: true });

    expect(sidebarHandle).toHaveAttribute("aria-valuenow", "26");
    expect(reviewHandle).toHaveAttribute("aria-valuenow", "38");

    fireEvent.keyDown(sidebarHandle, { key: "Home" });
    fireEvent.keyDown(reviewHandle, { key: "End" });

    expect(sidebarHandle).toHaveAttribute("aria-valuenow", "18");
    expect(reviewHandle).toHaveAttribute("aria-valuenow", "55");
  });

  it("uses the process label for selected feeds", () => {
    render(<App />);

    const fileInput = screen.getByLabelText(
      "Select or drop one or more GTFS feeds"
    );
    const importButton = screen.getByRole("button", {
      name: "Process selected feeds"
    });

    fireEvent.change(fileInput, {
      target: {
        files: [new File(["one"], "US-WA-KCM.zip", { type: "application/zip" })]
      }
    });

    expect(importButton).toHaveTextContent("Process selected feeds");

    fireEvent.change(fileInput, {
      target: {
        files: [
          new File(["one"], "US-WA-KCM.zip", { type: "application/zip" }),
          new File(["two"], "US-WA-ST.zip", { type: "application/zip" })
        ]
      }
    });

    expect(importButton).toHaveTextContent("Process selected feeds");
  });

  it("applies the matching feed profile when a known ID is selected", () => {
    render(<App />);

    fireEvent.change(
      screen.getByLabelText("Select or drop one or more GTFS feeds"),
      {
        target: {
          files: [
            new File(["one"], "US-WA-KCM.zip", { type: "application/zip" })
          ]
        }
      }
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: /2 Profile Configure matching and region/
      })
    );

    expect(
      screen.getByText(
        "King County Metro mapping profile applies to US-WA-KCM."
      )
    ).toBeInTheDocument();
  });

  it("uses an editable custom profile for an unknown feed ID", () => {
    render(<App />);

    fireEvent.change(
      screen.getByLabelText("Select or drop one or more GTFS feeds"),
      {
        target: {
          files: [
            new File(["one"], "US-WA-NEW.zip", { type: "application/zip" })
          ]
        }
      }
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: /2 Profile Configure matching and region/
      })
    );

    expect(
      screen.getByText("Custom feed mapping applies to US-WA-NEW.")
    ).toBeInTheDocument();
    expect(screen.queryByText(/Unsupported feeds will be skipped/i)).toBeNull();
  });
});
