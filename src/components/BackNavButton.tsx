"use client";

type BackNavButtonProps = {
  className?: string;
  ariaLabel?: string;
  fallbackHref?: string;
  children?: React.ReactNode;
};

export default function BackNavButton({
  className = "",
  ariaLabel = "Go back",
  fallbackHref = "/students",
  children = "←",
}: BackNavButtonProps) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      className={className}
      onClick={() => {
        if (window.history.length > 1) {
          window.history.back();
          return;
        }
        window.location.assign(fallbackHref);
      }}
    >
      {children}
    </button>
  );
}
