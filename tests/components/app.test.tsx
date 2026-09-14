import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { App } from "../../src/App";

afterEach(() => cleanup());

describe("App workflow sidebar", () => {
  it("opens one workflow panel beneath its step and closes the previous panel", () => {
    render(<App />);

    const importStep = screen.getByRole("button", {
      name: /1 Import Load your GTFS feed\(s\)/
    });
    const profileStep = screen.getByRole("button", {
      name: /2 Profile Configure matching and region/
    });

    expect(importStep).toHaveAttribute("aria-expanded", "true");
    expect(importStep).toHaveAttribute("aria-controls", "upload-step-panel");
    expect(screen.getByText("1. Select local GTFS feeds")).toBeInTheDocument();

    fireEvent.click(profileStep);

    expect(importStep).toHaveAttribute("aria-expanded", "false");
    expect(profileStep).toHaveAttribute("aria-expanded", "true");
    expect(screen.queryByText("1. Select local GTFS feeds")).toBeNull();
    expect(screen.getByText("Mapping profile")).toBeInTheDocument();
    expect(screen.getByLabelText("Candidate radius (m)")).toBeInTheDocument();

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

    fireEvent.click(
      screen.getByRole("button", {
        name: /5 Export Save results and contribute/
      })
    );
    expect(
      screen.getByText(/Complete import, retrieval, and review/i)
    ).toBeInTheDocument();
  });

  it("uses a singular import label for one selected feed", () => {
    render(<App />);

    const fileInput = screen.getByLabelText(
      "Select or drop one or more ZIP archives"
    );
    const importButton = screen.getByRole("button", {
      name: "Import selected feeds"
    });

    fireEvent.change(fileInput, {
      target: {
        files: [new File(["one"], "US-WA-KCM.zip", { type: "application/zip" })]
      }
    });

    expect(importButton).toHaveTextContent("Import selected feed");
    expect(importButton).not.toHaveTextContent("Import selected feeds");

    fireEvent.change(fileInput, {
      target: {
        files: [
          new File(["one"], "US-WA-KCM.zip", { type: "application/zip" }),
          new File(["two"], "US-WA-ST.zip", { type: "application/zip" })
        ]
      }
    });

    expect(importButton).toHaveTextContent("Import selected feeds");
  });

  it("applies the matching feed profile when a known ID is selected", () => {
    render(<App />);

    fireEvent.change(
      screen.getByLabelText("Select or drop one or more ZIP archives"),
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
      screen.getByLabelText("Select or drop one or more ZIP archives"),
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
