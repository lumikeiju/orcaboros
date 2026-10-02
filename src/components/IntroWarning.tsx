import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactElement
} from "react";

type IntroWarningProps = {
  onContinue?: () => void;
};

export function IntroWarning({
  onContinue
}: IntroWarningProps): ReactElement | null {
  const [isOpen, setIsOpen] = useState(true);
  const continueButtonRef = useRef<HTMLButtonElement>(null);
  const continueCallbackCalledRef = useRef(false);

  useEffect(() => {
    if (isOpen) {
      continueButtonRef.current?.focus();
    } else if (!continueCallbackCalledRef.current) {
      continueCallbackCalledRef.current = true;
      onContinue?.();
    }
  }, [isOpen, onContinue]);

  function keepFocusInDialog(event: KeyboardEvent<HTMLElement>): void {
    if (event.key !== "Tab") {
      return;
    }

    const focusableElements = event.currentTarget.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'
    );
    const firstElement = focusableElements.item(0);
    const lastElement = focusableElements.item(focusableElements.length - 1);

    if (firstElement === null || lastElement === null) {
      event.preventDefault();
      return;
    }

    if (event.shiftKey && document.activeElement === firstElement) {
      event.preventDefault();
      lastElement.focus();
    } else if (!event.shiftKey && document.activeElement === lastElement) {
      event.preventDefault();
      firstElement.focus();
    }
  }

  if (!isOpen) {
    return null;
  }

  return (
    <div className="intro-warning-backdrop">
      <section
        className="intro-warning-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="intro-warning-heading"
        aria-describedby="intro-warning-copy"
        onKeyDown={keepFocusInDialog}
      >
        <header className="intro-warning-header">
          <p className="eyebrow">Important Notice</p>
          <h2 id="intro-warning-heading">Before you use Orcaboros</h2>
        </header>
        <div id="intro-warning-copy" className="intro-warning-copy">
          <p>Orcaboros is beta software. Its outputs may be incorrect.</p>
          <ul>
            <li>
              <strong>Review every proposed change individually.</strong> Check
              additions, modifications, and removals against the GTFS source and
              current OpenStreetMap data before making any edits.
            </li>
            <li>
              Using this tool does not exempt you from the OSM{" "}
              <a
                href="https://wiki.openstreetmap.org/wiki/Automated_Edits_code_of_conduct"
                target="_blank"
                rel="noreferrer"
              >
                Automated Edits Code of Conduct
              </a>
              .
            </li>
            <li>
              You are responsible for checking that each GTFS feed's license
              permits contributing data derived from it to OSM.
            </li>
          </ul>
        </div>
        <button
          ref={continueButtonRef}
          className="intro-warning-continue"
          type="button"
          onClick={() => setIsOpen(false)}
        >
          I have read these warnings and understand that misuse of this tool may
          lead to reverts of my edits and moderation actions against my OSM
          account.
        </button>
      </section>
    </div>
  );
}
