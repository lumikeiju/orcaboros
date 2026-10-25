import { type ReactElement, useEffect } from "react";

export type Theme = "dark" | "light";

type ThemeToggleProps = {
  theme: Theme;
  onThemeChange: (theme: Theme) => void;
};

export function ThemeToggle({
  theme,
  onThemeChange
}: ThemeToggleProps): ReactElement {
  const nextTheme = theme === "dark" ? "light" : "dark";

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  return (
    <button
      type="button"
      className="theme-toggle glass-button glass-button--secondary"
      aria-label={`Switch to ${nextTheme} mode`}
      aria-pressed={theme === "dark"}
      onClick={() => onThemeChange(nextTheme)}
    >
      <span aria-hidden="true">{theme === "dark" ? "☀" : "☾"}</span>
      <span>{nextTheme === "light" ? "Light mode" : "Dark mode"}</span>
    </button>
  );
}
