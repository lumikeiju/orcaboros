import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  SelectedArchive,
  SourcePicker
} from "../../src/components/SourcePicker";
import { STOCK_SOURCE_FEED_DEFINITIONS } from "../../src/domain/source-feed";

afterEach(() => cleanup());

describe("SourcePicker", () => {
  it("does not label allowed custom feed IDs as unsupported", () => {
    render(
      <SourcePicker
        definitions={STOCK_SOURCE_FEED_DEFINITIONS}
        selected={[
          { file: new File([], "CUSTOM.zip"), sourceFeedId: "CUSTOM" }
        ]}
        allowUnknown
        onSelected={vi.fn()}
      />
    );
    expect(screen.queryByText(/Unsupported GTFS ZIPs/)).toBeNull();
    expect(
      screen.getByLabelText("GTFS Feed ID for CUSTOM.zip")
    ).toHaveAttribute("aria-invalid", "false");
  });

  it("blocks file changes and drops while processing", () => {
    const onSelected = vi.fn();
    const { container } = render(
      <SourcePicker
        definitions={STOCK_SOURCE_FEED_DEFINITIONS}
        selected={[]}
        disabled
        onSelected={onSelected}
      />
    );
    expect(screen.getByLabelText("Choose or drop GTFS ZIPs")).toBeDisabled();
    const target = container.querySelector(".file-drop-zone");
    if (target === null) {
      throw new Error("Missing drop target");
    }
    fireEvent.drop(target, {
      dataTransfer: { files: [new File([], "CUSTOM.zip")] }
    });
    expect(onSelected).not.toHaveBeenCalled();
  });

  it("shows derived IDs before import and does not make a network request", () => {
    const onSelected = vi.fn();
    render(
      <SourcePicker
        definitions={STOCK_SOURCE_FEED_DEFINITIONS}
        selected={[]}
        onSelected={onSelected}
      />
    );
    const file = new File(["not a real archive"], "US-WA-KCM.zip", {
      type: "application/zip"
    });
    fireEvent.change(screen.getByLabelText("Choose or drop GTFS ZIPs"), {
      target: { files: [file] }
    });
    expect(onSelected).toHaveBeenCalledWith(
      [{ file, sourceFeedId: "US-WA-KCM" }],
      []
    );
    expect(screen.getByLabelText("Choose or drop GTFS ZIPs")).toHaveValue("");
  });

  it("accepts multiple ZIP archives dropped together", () => {
    const onSelected = vi.fn();
    const { container } = render(
      <SourcePicker
        definitions={STOCK_SOURCE_FEED_DEFINITIONS}
        selected={[]}
        onSelected={onSelected}
      />
    );
    const firstFile = new File(["first"], "US-WA-KCM.zip", {
      type: "application/zip"
    });
    const secondFile = new File(["second"], "US-WA-ST.zip", {
      type: "application/zip"
    });
    const dropTarget = container.querySelector(".file-drop-zone");

    if (dropTarget === null) {
      throw new Error("The archive drop target was not rendered");
    }
    fireEvent.drop(dropTarget, {
      dataTransfer: { files: [firstFile, secondFile] }
    });

    expect(onSelected).toHaveBeenCalledWith(
      [
        { file: firstFile, sourceFeedId: "US-WA-KCM" },
        { file: secondFile, sourceFeedId: "US-WA-ST" }
      ],
      []
    );
  });

  it("appends ZIP archives selected one at a time", () => {
    let selected: readonly SelectedArchive[] = [];
    const onSelected = vi.fn((next: readonly SelectedArchive[]) => {
      selected = next;
    });
    const view = render(
      <SourcePicker
        definitions={STOCK_SOURCE_FEED_DEFINITIONS}
        selected={selected}
        onSelected={onSelected}
      />
    );
    const fileInput = view.container.querySelector("#gtfs-files");
    if (!(fileInput instanceof HTMLInputElement)) {
      throw new Error("The GTFS file input was not rendered");
    }
    const firstFile = new File(["first"], "US-WA-KCM.zip", {
      type: "application/zip"
    });
    const secondFile = new File(["second"], "US-WA-ST.zip", {
      type: "application/zip"
    });

    fireEvent.change(fileInput, { target: { files: [firstFile] } });
    view.rerender(
      <SourcePicker
        definitions={STOCK_SOURCE_FEED_DEFINITIONS}
        selected={selected}
        onSelected={onSelected}
      />
    );
    fireEvent.change(fileInput, { target: { files: [secondFile] } });

    expect(onSelected).toHaveBeenLastCalledWith(
      [
        { file: firstFile, sourceFeedId: "US-WA-KCM" },
        { file: secondFile, sourceFeedId: "US-WA-ST" }
      ],
      []
    );
  });

  it("keeps unsupported ZIPs visible with a warning instead of blocking selection", () => {
    let selected: readonly SelectedArchive[] = [];
    const onSelected = vi.fn((next: readonly SelectedArchive[]) => {
      selected = next;
    });
    const view = render(
      <SourcePicker
        definitions={STOCK_SOURCE_FEED_DEFINITIONS}
        selected={selected}
        onSelected={onSelected}
      />
    );
    const file = new File(["consolidated"], "US-WA-PSC.zip", {
      type: "application/zip"
    });

    fireEvent.change(
      view.container.querySelector("#gtfs-files") as HTMLInputElement,
      { target: { files: [file] } }
    );

    expect(onSelected).toHaveBeenCalledWith(
      [{ file, sourceFeedId: "US-WA-PSC" }],
      []
    );
    view.rerender(
      <SourcePicker
        definitions={STOCK_SOURCE_FEED_DEFINITIONS}
        selected={selected}
        onSelected={onSelected}
      />
    );
    const warning = screen.getByRole("img", {
      name: "US-WA-PSC is not supported by this profile"
    });
    expect(warning.closest(".source-table-actions")).not.toBeNull();
  });

  it("keeps the filename-derived ID as the default and allows editing", () => {
    let selected: readonly SelectedArchive[] = [];
    const onSelected = vi.fn((next: readonly SelectedArchive[]) => {
      selected = next;
    });
    const view = render(
      <SourcePicker
        definitions={STOCK_SOURCE_FEED_DEFINITIONS}
        selected={selected}
        onSelected={onSelected}
      />
    );
    const file = new File(["archive"], "US-WA-KCM.zip", {
      type: "application/zip"
    });
    const fileInput = view.container.querySelector("#gtfs-files");
    if (!(fileInput instanceof HTMLInputElement)) {
      throw new Error("The GTFS file input was not rendered");
    }
    fireEvent.change(fileInput, { target: { files: [file] } });
    view.rerender(
      <SourcePicker
        definitions={STOCK_SOURCE_FEED_DEFINITIONS}
        selected={selected}
        onSelected={onSelected}
      />
    );
    const feedInput = view.container.querySelector("#gtfs-feed-id-0");

    if (!(feedInput instanceof HTMLInputElement)) {
      throw new Error("The GTFS feed ID input was not rendered");
    }
    expect(feedInput).toHaveValue("US-WA-KCM");

    fireEvent.change(feedInput, { target: { value: "US-WA-ST" } });

    expect(onSelected).toHaveBeenLastCalledWith(
      [{ file, sourceFeedId: "US-WA-ST" }],
      []
    );
  });

  it("removes only the archive from the clicked row", () => {
    const firstFile = new File(["first"], "US-WA-KCM.zip", {
      type: "application/zip"
    });
    const secondFile = new File(["second"], "US-WA-ST.zip", {
      type: "application/zip"
    });
    let selected: readonly SelectedArchive[] = [
      { file: firstFile, sourceFeedId: "US-WA-KCM" },
      { file: secondFile, sourceFeedId: "US-WA-ST" }
    ];
    const onSelected = vi.fn((next: readonly SelectedArchive[]) => {
      selected = next;
    });
    const view = render(
      <SourcePicker
        definitions={STOCK_SOURCE_FEED_DEFINITIONS}
        selected={selected}
        onSelected={onSelected}
      />
    );
    const removeButton = view.container.querySelector(
      'button[aria-label="Remove US-WA-KCM.zip"]'
    );

    if (!(removeButton instanceof HTMLButtonElement)) {
      throw new Error("The archive remove button was not rendered");
    }
    fireEvent.click(removeButton);

    expect(onSelected).toHaveBeenLastCalledWith(
      [{ file: secondFile, sourceFeedId: "US-WA-ST" }],
      []
    );
    view.rerender(
      <SourcePicker
        definitions={STOCK_SOURCE_FEED_DEFINITIONS}
        selected={selected}
        onSelected={onSelected}
      />
    );
    expect(
      view.container.querySelector('button[aria-label="Remove US-WA-KCM.zip"]')
    ).toBeNull();
    expect(
      view.container.querySelector('button[aria-label="Remove US-WA-ST.zip"]')
    ).not.toBeNull();
  });
});
