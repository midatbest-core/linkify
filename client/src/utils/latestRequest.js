export function beginLatestRequest(reference) {
  reference.current?.abort();
  const controller = new AbortController();
  reference.current = controller;
  return controller;
}

export function cancelLatestRequest(reference) {
  reference.current?.abort();
  reference.current = null;
}

export function isLatestRequest(reference, controller) {
  return reference.current === controller;
}

export function finishLatestRequest(reference, controller) {
  if (!isLatestRequest(reference, controller)) return false;
  reference.current = null;
  return true;
}
