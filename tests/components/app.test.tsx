import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { App } from "../../src/App";
import packageMetadata from "../../package.json";

afterEach(() => cleanup());

function openUploadStep(): void {
  fireEvent.click(
    screen.getByRole("button", {
      name: /1 Upload Upload GTFS ZIPs/
    })
  );
}

describe("App workflow sidebar", () => {
  it("displays the version from package metadata", () => {
    render(<App />);

    expect(screen.getByText(`v${packageMetadata.version}`)).toBeInTheDocument();
  });

  it("provides a keyboard skip link to the workspace", () => {
    render(<App />);

    expect(
      screen.getByRole("link", { name: "Skip to workspace" })
    ).toHaveAttribute("href", "#workspace-main");
    expect(
      screen.getByRole("region", { name: "Conflation workspace" })
    ).toHaveAttribute("tabindex", "-1");
  });

  it("shows the intro warning when the app loads", () => {
    render(<App />);

    expect(
      screen.getByRole("alertdialog", { name: "Before you use Orcaboros" })
    ).toBeInTheDocument();
  });

  it("starts with workflow panels collapsed and opens one at a time", () => {
    render(<App />);

    const importStep = screen.getByRole("button", {
      name: /1 Upload Upload GTFS ZIPs/
    });
    const profileStep = screen.getByRole("button", {
      name: /2 Profile Review field mappings \(optional\)/
    });

    expect(importStep).toHaveAttribute("aria-expanded", "false");
    expect(importStep).toHaveAttribute("aria-controls", "upload-step-panel");
    expect(importStep).toHaveAttribute("aria-current", "step");
    expect(
      screen.queryByRole("heading", { name: "Upload GTFS ZIPs" })
    ).toBeNull();

    fireEvent.click(importStep);

    expect(importStep).toHaveAttribute("aria-expanded", "true");
    const uploadHeading = screen.getByRole("heading", {
      name: "Upload GTFS ZIPs"
    });
    expect(uploadHeading.parentElement).toBe(
      document.getElementById("upload-step-panel")
    );

    fireEvent.click(profileStep);

    expect(importStep).toHaveAttribute("aria-expanded", "false");
    expect(profileStep).toHaveAttribute("aria-expanded", "true");
    expect(
      screen.queryByRole("heading", { name: "Upload GTFS ZIPs" })
    ).toBeNull();
    const profileHeading = screen.getByRole("heading", {
      name: "Mapping profile"
    });
    expect(profileHeading.parentElement).toBe(
      document.getElementById("profile-step-panel")
    );
    expect(screen.getByLabelText("Candidate radius (m)")).toBeInTheDocument();
    expect(screen.getByLabelText("Auto-match radius")).toBeInTheDocument();

    fireEvent.click(profileStep);

    expect(profileStep).toHaveAttribute("aria-expanded", "false");
    expect(
      screen.queryByRole("heading", { name: "Mapping profile" })
    ).toBeNull();
  });

  it("keeps later workflow steps available before their prerequisites are ready", () => {
    render(<App />);

    fireEvent.click(
      screen.getByRole("button", {
        name: /3 Retrieve Retrieve nearby OSM data/
      })
    );
    expect(
      screen.getByText(/Import eligible stops first/i)
    ).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: /4 Review Review each feature/ })
    );
    expect(
      screen.getByText(/Import a feed and retrieve OSM candidates/i)
    ).toBeInTheDocument();
    expect(screen.queryByText(/Discrepancy queue/i)).toBeNull();

    fireEvent.click(
      screen.getByRole("button", {
        name: /5 Export Download for JOSM/
      })
    );
    expect(
      screen.getByText(/Complete import, retrieval, and review/i)
    ).toBeInTheDocument();
  });

  it("shows step readiness without disabling out-of-order navigation", () => {
    render(<App />);

    expect(screen.getByText("Start here")).toBeInTheDocument();
    expect(screen.getByText("Optional")).toBeInTheDocument();
    expect(screen.getAllByText("Waiting")).toHaveLength(3);

    openUploadStep();
    fireEvent.change(screen.getByLabelText("Choose or drop GTFS ZIPs"), {
      target: {
        files: [new File(["one"], "US-WA-KCM.zip", { type: "application/zip" })]
      }
    });

    expect(screen.getByText("Ready")).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: /3 Retrieve Retrieve nearby OSM data/
      })
    ).not.toBeDisabled();
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
    expect(reviewHandle).toHaveAttribute("aria-valuenow", "77");
  });

  it("shows the reset confirmation and restores focus when cancelled", () => {
    render(<App />);

    fireEvent.click(
      screen.getByRole("button", {
        name: /I have read these warnings/
      })
    );
    openUploadStep();
    const resetButton = screen.getByRole("button", {
      name: "Reset current session"
    });
    fireEvent.click(resetButton);

    expect(
      screen.getByRole("group", { name: /Reset this session\?/ })
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Keep current session" })
    );

    expect(
      screen.queryByRole("group", { name: /Reset this session\?/ })
    ).not.toBeInTheDocument();
    expect(resetButton).toHaveFocus();
  });

  it("uses the process label for selected feeds", () => {
    render(<App />);
    openUploadStep();

    const fileInput = screen.getByLabelText("Choose or drop GTFS ZIPs");
    const importButton = screen.getByRole("button", {
      name: "Process selected GTFS ZIPs"
    });

    fireEvent.change(fileInput, {
      target: {
        files: [new File(["one"], "US-WA-KCM.zip", { type: "application/zip" })]
      }
    });

    expect(importButton).toHaveTextContent("Process selected GTFS ZIPs");

    fireEvent.change(fileInput, {
      target: {
        files: [
          new File(["one"], "US-WA-KCM.zip", { type: "application/zip" }),
          new File(["two"], "US-WA-ST.zip", { type: "application/zip" })
        ]
      }
    });

    expect(importButton).toHaveTextContent("Process selected GTFS ZIPs");
  });

  it("applies the matching feed profile when a known ID is selected", () => {
    render(<App />);
    openUploadStep();

    fireEvent.change(screen.getByLabelText("Choose or drop GTFS ZIPs"), {
      target: {
        files: [new File(["one"], "US-WA-KCM.zip", { type: "application/zip" })]
      }
    });
    fireEvent.click(
      screen.getByRole("button", {
        name: /2 Profile Review field mappings \(optional\)/
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
    openUploadStep();

    fireEvent.change(screen.getByLabelText("Choose or drop GTFS ZIPs"), {
      target: {
        files: [new File(["one"], "US-WA-NEW.zip", { type: "application/zip" })]
      }
    });
    fireEvent.click(
      screen.getByRole("button", {
        name: /2 Profile Review field mappings \(optional\)/
      })
    );

    expect(
      screen.getByText("Custom feed mapping applies to US-WA-NEW.")
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/Unsupported GTFS ZIPs will be skipped/i)
    ).toBeNull();
  });
});
