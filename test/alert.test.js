'use strict';

/**
 * Refresh alerting — task 12, E7.
 *
 * The one thing that must not go wrong here is a failed refresh being reported
 * as a success. healthchecks.io reads up/down from the URL that was pinged, not
 * from the body, so posting every outcome to the same ping URL would mark the
 * check healthy while the pipeline was broken — v1's failure with a monitor
 * attached to it, which is worse than no monitor because it manufactures
 * confidence.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { alertTarget } = require('../scripts/refresh.js');

const HC = 'https://hc-ping.com/8f1c-uuid';
const SLACK = 'https://hooks.slack.com/services/T000/B000/xxxx';

test('alert routing', async (t) => {
  await t.test('a failed refresh pings the healthchecks failure endpoint', () => {
    assert.equal(alertTarget(HC, 'failed'), `${HC}/fail`);
  });

  await t.test('a stale refresh is a failure too', () => {
    // "Every step succeeded and the as-of date did not move" is the v1 outcome.
    // If that pinged success, the monitor would certify the exact condition it
    // exists to catch.
    assert.equal(alertTarget(HC, 'stale'), `${HC}/fail`);
  });

  await t.test('a successful refresh pings the plain URL', () => {
    assert.equal(alertTarget(HC, 'ok'), HC);
  });

  await t.test('needs-look pings success — the data pipeline did its job', () => {
    // The basemap wanting human eyes is not a pipeline failure. A monitor that
    // reports down for something that is not down gets muted, and then it is
    // not a monitor.
    assert.equal(alertTarget(HC, 'needs-look'), HC);
  });

  await t.test('a trailing slash does not produce a double slash', () => {
    assert.equal(alertTarget(`${HC}/`, 'failed'), `${HC}/fail`);
  });

  await t.test('chat webhooks get one URL for every outcome', () => {
    // Slack and Discord carry the outcome in the body; rewriting their path
    // would produce a 404 and lose the message entirely.
    for (const status of ['ok', 'failed', 'stale', 'needs-look']) {
      assert.equal(alertTarget(SLACK, status), SLACK, `slack should be untouched for ${status}`);
    }
  });

  await t.test('a self-hosted healthchecks instance can be declared', () => {
    const SELF = 'https://checks.example.org/ping/abc';
    assert.equal(alertTarget(SELF, 'failed'), SELF, 'not healthchecks by hostname');

    const prior = process.env.SAFE_EATS_ALERT_STYLE;
    process.env.SAFE_EATS_ALERT_STYLE = 'healthchecks';
    t.after(() => {
      if (prior === undefined) delete process.env.SAFE_EATS_ALERT_STYLE;
      else process.env.SAFE_EATS_ALERT_STYLE = prior;
    });

    assert.equal(alertTarget(SELF, 'failed'), `${SELF}/fail`);
    assert.equal(alertTarget(SELF, 'ok'), SELF);
  });

  await t.test('no webhook configured is not an error', () => {
    assert.equal(alertTarget(undefined, 'failed'), null);
    assert.equal(alertTarget('', 'ok'), null);
  });

  await t.test('an unparseable webhook is posted as given rather than mangled', () => {
    // Better to fail loudly against the value the operator actually set than to
    // quietly rewrite it into something else.
    assert.equal(alertTarget('not a url', 'failed'), 'not a url');
  });
});
