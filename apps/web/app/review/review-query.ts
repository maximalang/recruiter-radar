export function parseReviewPagePagination(params: {
  limit?: string;
  offset?: string;
}): { limit: number; offset: number } {
  const parsedLimit = Number(params.limit ?? 50);
  const parsedOffset = Number(params.offset ?? 0);

  return {
    limit: Number.isInteger(parsedLimit) && parsedLimit >= 1 && parsedLimit <= 200
      ? parsedLimit
      : 50,
    offset: Number.isInteger(parsedOffset) && parsedOffset >= 0
      ? parsedOffset
      : 0,
  };
}
