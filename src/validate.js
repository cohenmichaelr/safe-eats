'use strict';

/**
 * Source payload validation — FR-106, FR-107.
 *
 * This module exists because of AUD-SE-001 F1/F2: v1 fetched a dead URL, received
 * the MyFloridaLicense WordPress homepage, detected it, logged `console.warn`, and
 * saved it as `.csv` anyway. The import step then skipped the HTML file and exited
 * zero, so the pipeline reported success while serving data from 2022 for three years.
 *
 * Every function here THROWS. Nothing warns. That distinction is the entire point.
 */

class IngestError extends Error {
  constructor(message, { url, stage } = {}) {
    super(message);
    this.name = 'IngestError';
    this.url = url;
    this.stage = stage;
  }
}

/** Strip a UTF-8 BOM and leading whitespace before inspecting the first bytes. */
function leadingText(payload, length = 512) {
  const text = typeof payload === 'string' ? payload : payload.toString('utf8', 0, length * 4);
  return text.replace(/^﻿/, '').trimStart().slice(0, length);
}

/**
 * FR-107 — abort if the payload is an HTML document.
 *
 * Checked before content type, because it is the failure that actually occurred:
 * a redirect to a marketing page can be served with almost any header.
 */
function assertNotHtml(payload, { url } = {}) {
  const head = leadingText(payload, 256);
  const lower = head.toLowerCase();

  if (lower.startsWith('<!doctype') || lower.startsWith('<html') || lower.startsWith('<?xml')) {
    throw new IngestError(
      `Source returned a markup document, not CSV. This is the exact v1 failure (AUD F1). ` +
        `First bytes: ${JSON.stringify(head.slice(0, 120))}`,
      { url, stage: 'validate:html' }
    );
  }
}

/** FR-106 — the response must declare itself as CSV. */
function assertCsvContentType(contentType, { url } = {}) {
  const value = (contentType || '').toLowerCase();
  if (!value.includes('text/csv') && !value.includes('application/csv')) {
    throw new IngestError(
      `Expected a CSV content type, received ${JSON.stringify(contentType || '(none)')}.`,
      { url, stage: 'validate:content-type' }
    );
  }
}

/**
 * FR-106 — the header row must match the columns we parse by position.
 *
 * A silent upstream column reordering would otherwise load plausible-looking
 * garbage: addresses into the name field, dispositions into the date field.
 */
function assertHeaderSignature(payload, expectedColumns, { url } = {}) {
  const firstLine = leadingText(payload, 4096).split(/\r?\n/, 1)[0] || '';
  const normalized = firstLine.toLowerCase().replace(/"/g, '').replace(/\s+/g, ' ');

  const missing = expectedColumns.filter(
    (column) => !normalized.includes(column.toLowerCase().replace(/\s+/g, ' '))
  );

  if (missing.length > 0) {
    throw new IngestError(
      `Source header is missing expected column(s): ${missing.join(', ')}. ` +
        `The upstream schema may have changed — verify before ingesting.`,
      { url, stage: 'validate:header' }
    );
  }
}

/** A payload that parses correctly but is nearly empty is still a failure. */
function assertMinimumBytes(payload, minBytes, { url } = {}) {
  const size = Buffer.isBuffer(payload) ? payload.length : Buffer.byteLength(payload, 'utf8');
  if (size < minBytes) {
    throw new IngestError(
      `Payload is ${size} bytes, below the ${minBytes}-byte floor — almost certainly an error page or truncated response.`,
      { url, stage: 'validate:size' }
    );
  }
}

/**
 * FR-104 — replaces the trailing-average model of FR-110 with an absolute floor.
 *
 * Measured baseline is 4,305 Palm Beach establishments; a legitimate drop below
 * 3,000 does not occur. One comparison instead of a four-run history.
 */
function assertRowFloor(rowCount, floor, { source, stage = 'validate:row-floor' } = {}) {
  if (rowCount < floor) {
    throw new IngestError(
      `${source || 'Source'} yielded ${rowCount} rows, below the floor of ${floor}. ` +
        `Refusing to replace good data with a suspect extract.`,
      { stage }
    );
  }
}

/** Full gate for a fetched extract. Order matters: cheapest and most likely first. */
function assertValidExtract(payload, { contentType, url, expectedColumns, minBytes = 50_000 }) {
  assertNotHtml(payload, { url });
  assertCsvContentType(contentType, { url });
  assertMinimumBytes(payload, minBytes, { url });
  if (expectedColumns?.length) assertHeaderSignature(payload, expectedColumns, { url });
}

module.exports = {
  IngestError,
  assertNotHtml,
  assertCsvContentType,
  assertHeaderSignature,
  assertMinimumBytes,
  assertRowFloor,
  assertValidExtract,
};
