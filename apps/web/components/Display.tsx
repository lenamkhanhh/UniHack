import React from 'react';

/**
 * Heading text ending in a red full stop (design system v8b). If the source string already ends
 * with ".", that period is the one coloured red, so the text content is unchanged. Otherwise a
 * decorative red "." is appended and hidden from assistive tech.
 */
export function Stop({ children }: { children: string }) {
  const text = children.trimEnd();
  if (text.endsWith('.')) {
    return (
      <>
        {text.slice(0, -1)}
        <span className="stop">.</span>
      </>
    );
  }
  return (
    <>
      {text}
      <span className="stop" aria-hidden="true">.</span>
    </>
  );
}

/** Mono uppercase micro-label with the 8px red square. */
export function Kicker({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <div className={`kick ${className}`}>{children}</div>;
}
