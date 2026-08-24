'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const {
  IngestError,
  assertNotHtml,
  assertCsvContentType,
  assertHeaderSignature,
  assertMinimumBytes,
  assertRowFloor,
  assertValidExtract,
} = require('../src/validate');

/**
 * The v1 error page, reproduced. This is what MyFloridaLicense actually served
 * to v1's dead URL, and what v1 saved as `inspect.csv` and three files in `data/`.
 */
const V1_ERROR_PAGE = `<!DOCTYPE html>
<html lang="en-US">
<head>
<meta charset="UTF-8">
<title>MyFloridaLicense.com &#8211; License efficiently. Regulate fairly.</title>
</head>
<body><p>Page not found</p></body>
</html>`;

const REAL_INSPECTION_HEADER =
  '"District","County Number","County Name"," License Type Code"," License Number",' +
  '"Business (DBA-Does Business As) Name","Location Address","Location City",' +
  '" Location Zip Code","Inspection Number","Visit Number","Inspection Class",' +
  '"Inspection Type","Inspection Disposition","Inspection Date"';

const REAL_INSPECTION_ROW =
  '"D2","60","Palm Beach","2010","6001234","FLANIGANS","330 SOUTHERN BLVD","WEST PALM BEACH",' +
  '"33405-2618","3710347","1","Food","Routine - Food","Warning Issued","07/31/2026"';

const REAL_CSV = `${REAL_INSPECTION_HEADER}\n${REAL_INSPECTION_ROW}\n`;

describe('FR-107 — HTML payloads abort the ingest', () => {
  test('rejects the exact error page v1 stored as CSV', () => {
    assert.throws(
      () => assertNotHtml(V1_ERROR_PAGE, { url: 'https://example.test/2fdinspi.csv' }),
      (error) => {
        assert.ok(error instanceof IngestError, 'must be an IngestError');
        assert.equal(error.stage, 'validate:html');
        assert.match(error.message, /markup document/i);
        return true;
      }
    );
  });

  test('rejects HTML regardless of leading whitespace or BOM', () => {
    for (const payload of [
      `\n\n  ${V1_ERROR_PAGE}`,
      `﻿${V1_ERROR_PAGE}`,
      '<html><body>redirecting…</body></html>',
      '<?xml version="1.0"?><error/>',
    ]) {
      assert.throws(() => assertNotHtml(payload), IngestError);
    }
  });

  test('rejects HTML supplied as a Buffer, as fetched bytes arrive', () => {
    assert.throws(() => assertNotHtml(Buffer.from(V1_ERROR_PAGE, 'utf8')), IngestError);
  });

  test('accepts a genuine CSV payload', () => {
    assert.doesNotThrow(() => assertNotHtml(REAL_CSV));
    assert.doesNotThrow(() => assertNotHtml(Buffer.from(REAL_CSV, 'utf8')));
  });

  test('does not mistake a CSV value containing angle brackets for markup', () => {
    assert.doesNotThrow(() => assertNotHtml('"name","note"\n"JOE<S DINER","<ok>"\n'));
  });
});

describe('FR-106 — content type must declare CSV', () => {
  test('rejects the HTML content type v1 only warned about', () => {
    assert.throws(
      () => assertCsvContentType('text/html; charset=UTF-8'),
      (error) => error instanceof IngestError && error.stage === 'validate:content-type'
    );
  });

  test('rejects a missing content type', () => {
    assert.throws(() => assertCsvContentType(undefined), IngestError);
    assert.throws(() => assertCsvContentType(''), IngestError);
  });

  test('accepts CSV content types with parameters and mixed case', () => {
    for (const value of ['text/csv', 'text/csv; charset=utf-8', 'TEXT/CSV', 'application/csv']) {
      assert.doesNotThrow(() => assertCsvContentType(value));
    }
  });
});

describe('FR-106 — header signature guards against silent schema drift', () => {
  const required = ['License Number', 'Inspection Disposition', 'Inspection Date'];

  test('accepts the real DBPR inspection header', () => {
    assert.doesNotThrow(() => assertHeaderSignature(REAL_CSV, required));
  });

  test('rejects a header missing a column parsed by position', () => {
    const drifted = '"District","County Name","License Number","Inspection Date"\n';
    assert.throws(
      () => assertHeaderSignature(drifted, required),
      (error) => {
        assert.equal(error.stage, 'validate:header');
        assert.match(error.message, /Inspection Disposition/);
        return true;
      }
    );
  });
});

describe('size and row floors', () => {
  test('rejects a payload below the byte floor', () => {
    assert.throws(() => assertMinimumBytes('a,b\n1,2\n', 50_000), IngestError);
  });

  test('accepts a payload above the byte floor', () => {
    assert.doesNotThrow(() => assertMinimumBytes(Buffer.alloc(60_000, 'x'), 50_000));
  });

  test('FR-104 — rejects a post-filter row count below the floor', () => {
    assert.throws(
      () => assertRowFloor(12, 3000, { source: 'Palm Beach establishments' }),
      (error) => {
        assert.match(error.message, /below the floor of 3000/);
        return true;
      }
    );
  });

  test('FR-104 — a zero-row result is a failure, not an empty success', () => {
    assert.throws(() => assertRowFloor(0, 3000, { source: 'establishments' }), IngestError);
  });

  test('accepts the measured Palm Beach baseline of 4,305', () => {
    assert.doesNotThrow(() => assertRowFloor(4305, 3000, { source: 'establishments' }));
  });
});

describe('assertValidExtract — the full gate', () => {
  const options = {
    contentType: 'text/csv',
    url: 'https://example.test/2fdinspi.csv',
    expectedColumns: ['License Number', 'Inspection Disposition'],
    minBytes: 10,
  };

  test('the v1 failure cannot pass the gate even with a CSV content type', () => {
    assert.throws(() => assertValidExtract(V1_ERROR_PAGE, options), IngestError);
  });

  test('a valid extract passes', () => {
    assert.doesNotThrow(() => assertValidExtract(REAL_CSV, options));
  });
});
