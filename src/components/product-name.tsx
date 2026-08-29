import { findCoreName } from "@/lib/core-name";

/**
 * Renders the shop's long marketing title verbatim, lifting only the core
 * product name out of it visually.
 *
 * Returns a bare fragment on purpose: every call site already owns its box
 * (<p>, <a>, <h1>, <TableCell>), and several of those boxes are the
 * `line-clamp-*` host — wrapping here would move the clamp target. Children
 * stay inline so -webkit-box line counting still works.
 *
 * Fail-safe: with no span the output is identical to printing `name` directly.
 */
export function ProductName({
  name,
  dim = true,
}: {
  name: string;
  /** Mute everything but the core, creating figure/ground. false = bold only. */
  dim?: boolean;
}) {
  const span = findCoreName(name);

  // Never let a bad span break rendering — including slicing a surrogate pair
  // (emoji appear in real titles).
  if (
    !span ||
    !Number.isInteger(span.start) ||
    !Number.isInteger(span.end) ||
    span.start < 0 ||
    span.end > name.length ||
    span.start >= span.end ||
    isLowSurrogate(name, span.start) ||
    isLowSurrogate(name, span.end)
  ) {
    return <>{name}</>;
  }

  const rest = dim ? "text-muted-foreground" : undefined;

  return (
    <>
      {span.start > 0 && (
        <span className={rest}>{name.slice(0, span.start)}</span>
      )}
      {/* <b> is exactly the spec's example use: "product names in a review".
          Tailwind preflight makes b/strong 700; pin it to 600 for our scale. */}
      <b className="font-semibold">{name.slice(span.start, span.end)}</b>
      {span.end < name.length && (
        <span className={rest}>{name.slice(span.end)}</span>
      )}
    </>
  );
}

/** True when slicing at i would split a surrogate pair. */
function isLowSurrogate(s: string, i: number): boolean {
  const c = s.charCodeAt(i);
  return c >= 0xdc00 && c <= 0xdfff;
}
