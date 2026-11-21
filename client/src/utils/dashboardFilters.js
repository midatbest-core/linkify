export function scheduleDashboardFilters({ query, tag, apply, delay = 250 }) {
  const timer = setTimeout(() => apply({ search: query, filterTag: tag }), delay);
  return () => clearTimeout(timer);
}
