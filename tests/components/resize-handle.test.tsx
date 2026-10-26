import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ResizeHandle } from "../../src/components/ResizeHandle";

afterEach(() => cleanup());

function pointerEvent(
  type: string,
  pointerId: number,
  coordinates: { clientX?: number; clientY?: number; button?: number } = {}
): MouseEvent {
  return Object.assign(
    new MouseEvent(type, { bubbles: true, cancelable: true, ...coordinates }),
    { pointerId }
  );
}

describe("ResizeHandle", () => {
  it("supports arrow, shifted arrow, Home and End keys within its bounds", () => {
    const onChange = vi.fn();
    render(
      <ResizeHandle
        orientation="vertical"
        value={25}
        min={20}
        max={28}
        label="Resize sidebar"
        onChange={onChange}
      />
    );
    const handle = screen.getByRole("separator", { name: "Resize sidebar" });

    expect(handle).toHaveAttribute("aria-orientation", "vertical");
    expect(handle).toHaveAttribute("aria-valuenow", "25");
    expect(handle).toHaveAttribute("aria-valuetext", "25% of viewport width");
    for (const [key, shiftKey, expected] of [
      ["ArrowLeft", false, 24],
      ["ArrowRight", true, 28],
      ["Home", false, 20],
      ["End", false, 28]
    ] as const) {
      fireEvent.keyDown(handle, { key, shiftKey });
      expect(onChange).toHaveBeenLastCalledWith(expected);
    }
    fireEvent.keyDown(handle, { key: "ArrowDown" });
    expect(onChange).toHaveBeenCalledTimes(4);
  });

  it("supports vertical movement for the horizontal separator", () => {
    const onChange = vi.fn();
    render(
      <ResizeHandle
        orientation="horizontal"
        value={40}
        min={20}
        max={60}
        label="Resize panels"
        onChange={onChange}
      />
    );
    const handle = screen.getByRole("separator", { name: "Resize panels" });
    fireEvent.keyDown(handle, { key: "ArrowDown" });
    expect(onChange).toHaveBeenLastCalledWith(39);
    fireEvent.keyDown(handle, { key: "ArrowUp", shiftKey: true });
    expect(onChange).toHaveBeenLastCalledWith(45);
  });

  it("focuses the handle and ends dragging when pointer capture is lost", () => {
    const onChange = vi.fn();
    render(
      <ResizeHandle
        orientation="vertical"
        value={25}
        min={20}
        max={50}
        label="Resize sidebar"
        onChange={onChange}
      />
    );
    const handle = screen.getByRole("separator", { name: "Resize sidebar" });
    fireEvent(handle, pointerEvent("pointerdown", 1));

    expect(handle).toHaveFocus();
    expect(document.body).toHaveClass("is-resizing-vertical");
    fireEvent(
      handle,
      pointerEvent("pointermove", 1, { clientX: globalThis.innerWidth })
    );
    expect(onChange).toHaveBeenLastCalledWith(50);

    fireEvent(handle, pointerEvent("lostpointercapture", 1));
    expect(document.body).not.toHaveClass("is-resizing-vertical");
    fireEvent(handle, pointerEvent("pointermove", 1, { clientX: 0 }));
    expect(onChange).toHaveBeenCalledOnce();
  });

  it("ignores a second pointer and cleans up a drag on unmount", () => {
    const onChange = vi.fn();
    const { unmount } = render(
      <ResizeHandle
        orientation="horizontal"
        value={40}
        min={20}
        max={60}
        label="Resize panels"
        onChange={onChange}
      />
    );
    const handle = screen.getByRole("separator", { name: "Resize panels" });
    fireEvent(handle, pointerEvent("pointerdown", 1));
    fireEvent(handle, pointerEvent("pointerdown", 2));
    fireEvent(handle, pointerEvent("pointermove", 2, { clientY: 0 }));
    expect(onChange).not.toHaveBeenCalled();
    fireEvent(handle, pointerEvent("pointermove", 1, { clientY: 0 }));
    expect(onChange).toHaveBeenLastCalledWith(60);
    expect(document.body).toHaveClass("is-resizing-horizontal");

    unmount();
    expect(document.body).not.toHaveClass("is-resizing-horizontal");
  });
});
