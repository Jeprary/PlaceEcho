type FetchLike = typeof fetch;

export function apiEndpoint(baseUrl: string, path: string): string {
  return `${baseUrl.trim().replace(/\/$/, "")}${path}`;
}

/** Prefix relative PlaceEcho API requests without rewriting external assets. */
export function createApiFetch(
  baseUrl: string,
  fetchImpl: FetchLike = fetch,
): FetchLike {
  return (input, init) => {
    const resolvedInput =
      typeof input === "string" && input.startsWith("/api/")
        ? apiEndpoint(baseUrl, input)
        : input;
    return fetchImpl(resolvedInput, init);
  };
}
