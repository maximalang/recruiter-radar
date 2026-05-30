export function extractProviderRecords(body, sourceId) {
  if (Array.isArray(body)) {
    return body;
  }

  if (body && typeof body === 'object' && !Array.isArray(body)) {
    if (Array.isArray(body.records)) {
      return body.records;
    }

    throw new Error(
      `${sourceId} provider response must contain a records array when the root value is an object.`,
    );
  }

  throw new Error(`${sourceId} provider response must be a JSON array or an object with records array.`);
}

export function assertProviderNormalization({
  sourceId,
  recordsReceived,
  normalizedRecords,
  skippedRecords,
}) {
  if (recordsReceived > 0 && normalizedRecords.length === 0) {
    throw new Error(
      `${sourceId} provider returned ${recordsReceived} records but 0 normalized records`
        + ` (${skippedRecords} skipped). Check provider response mapping before running in production.`,
    );
  }
}
