import { fireEvent, render, screen } from "@testing-library/react";
import { type ReactElement, useState } from "react";
import { describe, expect, it } from "vitest";
import { ThemeToggle, type Theme } from "../../src/components/ThemeToggle";

function ThemeToggleHarness(): ReactElement {
  const [theme, setTheme] = useState<Theme>("dark");
  return <ThemeToggle theme={theme} onThemeChange={setTheme} />;
}

describe("ThemeToggle", () => {
  it("starts in dark mode and switches to light mode", () => {
    document.documentElement.removeAttribute("data-theme");
    render(<ThemeToggleHarness />);

    expect(document.documentElement).toHaveAttribute("data-theme", "dark");
    const toggle = screen.getByRole("button", {
      name: "Switch to light mode"
    });
    expect(toggle).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(toggle);

    expect(document.documentElement).toHaveAttribute("data-theme", "light");
    expect(
      screen.getByRole("button", { name: "Switch to dark mode" })
    ).toHaveAttribute("aria-pressed", "false");
  });
});
