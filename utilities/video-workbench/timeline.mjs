/** A shared source-time window for every signal; zero requested span means full clip. */
export function timeWindow(duration, requestedSpan = 0, start = 0) {
  const total = Math.max(0, duration || 0);
  const span = requestedSpan > 0 ? Math.min(total, requestedSpan) : total;
  const left = Math.max(0, Math.min(total - span, start));
  return { start: left, end: left + span, span };
}
export function timeAt(view, fraction) {
  return view.start + Math.max(0, Math.min(1, fraction)) * view.span;
}
export function followWindow(view, time, duration) {
  if (time >= view.start && time <= view.end) return view;
  return timeWindow(duration, view.span, time - view.span * 0.2);
}
