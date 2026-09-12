'use strict';

/**
 * Food type derived from the name — FR-407, DEC-019.
 *
 * Every case here is a real Florida establishment name, or the shape of one.
 * The rule this file defends is narrow and worth stating: a match means the
 * licensed NAME says so. Nothing in this module may grow into a claim about
 * what a kitchen serves, and the tests below are mostly about the ways a
 * careless implementation starts making one — PHOENIX read as Vietnamese,
 * Indian River read as Indian, and every grill in Florida read as American.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { CUISINES, words, matchesCuisine, cuisineOptions } = require('../src/cuisine');

test('food type is matched on whole words, never substrings', async (t) => {
  await t.test('PHO reaches a noodle shop and not PHOENIX', () => {
    assert.equal(matchesCuisine('PHO 79 NOODLE AND GRILL', 'vietnamese'), true);
    assert.equal(matchesCuisine('AB PHO AND DELI', 'vietnamese'), true);
    // The failure a trigram index or a LIKE '%pho%' would produce.
    assert.equal(matchesCuisine('PHOENIX GRILL', 'vietnamese'), false);
    assert.equal(matchesCuisine('SOPHIES CAFE', 'vietnamese'), false);
  });

  await t.test('a word at either end of the name still matches', () => {
    // The padding in `words()` exists for exactly this.
    assert.equal(matchesCuisine('PIZZA', 'pizza'), true);
    assert.equal(matchesCuisine('JOES PIZZA', 'pizza'), true);
    assert.equal(matchesCuisine('PIZZA HUT 2047', 'pizza'), true);
  });

  await t.test('separators are word boundaries, because names are written that way', () => {
    assert.equal(matchesCuisine('CHIANTIS PIZZA/PASTA', 'italian'), true);
    assert.equal(matchesCuisine('SUSHI & THAI', 'thai'), true);
    assert.equal(matchesCuisine('MARCOS PIZZA - STORE 8619', 'pizza'), true);
    assert.equal(matchesCuisine('BLUE STEEL PIZZA-MARINA VILLAGE', 'pizza'), true);
  });

  await t.test("an apostrophe inside a word does not hide it", () => {
    // GYRO KING SUB'S AND SALADS is a real row, and the reason the matcher is
    // not allowed to prefilter on the raw column: '%SUBS%' does not find it.
    assert.equal(matchesCuisine("GYRO KING SUB'S AND SALADS", 'deli'), true);
    assert.equal(matchesCuisine("GYRO KING SUB'S AND SALADS", 'greek'), true);
  });
});

test('Florida place names are not cuisines', async (t) => {
  await t.test('Indian River, Indian Shores and Indian Harbour are geography', () => {
    assert.equal(matchesCuisine('INDIAN RIVER COLONY CLUB', 'indian'), false);
    assert.equal(matchesCuisine('INDIAN RIVER ESTATES WEST', 'indian'), false);
    assert.equal(matchesCuisine("CADDY'S INDIAN SHORES", 'indian'), false);
    assert.equal(matchesCuisine('VOLA OF INDIAN HARBOUR LLC', 'indian'), false);
  });

  await t.test('an actual Indian restaurant still matches', () => {
    assert.equal(matchesCuisine('ZAIKA INDIAN CUISINE', 'indian'), true);
    assert.equal(matchesCuisine('TANDOORI HUT #1', 'indian'), true);
    assert.equal(matchesCuisine('CURRY AND KABAB', 'indian'), true);
  });

  await t.test("Rita's Italian Ice is not an Italian restaurant", () => {
    assert.equal(matchesCuisine('RITAS ITALIAN ICE', 'italian'), false);
    assert.equal(matchesCuisine('CARRABBAS ITALIAN GRILL #6026', 'italian'), true);
  });
});

test('the rejected keywords stay rejected', async (t) => {
  /*
   * GRILL is the second most common word in Florida restaurant names (2,920 of
   * them). Reading it as "American" filed Chipotle, Carrabba's and Kiku Sushi
   * under American cuisine, which is why it is not in the list.
   */
  await t.test('GRILL is not a cuisine', () => {
    assert.equal(matchesCuisine('CHIPOTLE MEXICAN GRILL', 'american'), false);
    assert.equal(matchesCuisine('CARRABBAS ITALIAN GRILL', 'american'), false);
    assert.equal(matchesCuisine('KIKU SUSHI & GRILL', 'american'), false);
    assert.equal(matchesCuisine('SPORTS GRILL', 'american'), false);

    // Each still matches what its name actually says.
    assert.equal(matchesCuisine('CHIPOTLE MEXICAN GRILL', 'mexican'), true);
    assert.equal(matchesCuisine('KIKU SUSHI & GRILL', 'japanese'), true);
  });

  await t.test('ISLAND is not Caribbean — Florida is full of islands', () => {
    assert.equal(matchesCuisine('SPRINGHILL SUITES AMELIA ISLAND', 'caribbean'), false);
    assert.equal(matchesCuisine('CONEY ISLAND LUNCH', 'caribbean'), false);
    assert.equal(matchesCuisine('DUTCH POT JAMAICAN REST', 'caribbean'), true);
  });

  await t.test('CHOP is not Chinese', () => {
    assert.equal(matchesCuisine('CHOP & TOSS SALAD CO.', 'chinese'), false);
    assert.equal(matchesCuisine('CHINA WOK', 'chinese'), true);
  });
});

test('a name may read as more than one food type', () => {
  // Overlap is honest: the name really does say both, and forcing a single
  // answer would mean picking one on the establishment's behalf.
  assert.equal(matchesCuisine('SURA SANG KOREAN BBQ', 'korean'), true);
  assert.equal(matchesCuisine('SURA SANG KOREAN BBQ', 'bbq'), true);
  assert.equal(matchesCuisine('BAITONG THAI AND SUSHI BAR', 'thai'), true);
  assert.equal(matchesCuisine('BAITONG THAI AND SUSHI BAR', 'japanese'), true);
});

test('the matcher is total — it never throws on real-world input', () => {
  for (const bad of [null, undefined, '', '   ', '###', 42]) {
    for (const key of Object.keys(CUISINES)) {
      assert.equal(typeof matchesCuisine(bad, key), 'boolean', `${key} on ${JSON.stringify(bad)}`);
    }
  }
  assert.equal(matchesCuisine('JOES PIZZA', 'klingon'), false, 'an unknown key matches nothing');
});

test('the published menu matches what the matcher implements', () => {
  const options = cuisineOptions();
  assert.equal(options.length, Object.keys(CUISINES).length);

  for (const { key, label } of options) {
    assert.ok(CUISINES[key], `${key} is offered but not defined`);
    assert.equal(label, CUISINES[key].label);
    assert.ok(CUISINES[key].words.length, `${key} has no words to match`);
  }

  const labels = options.map((o) => o.label);
  assert.deepEqual(labels, [...labels].sort((a, b) => a.localeCompare(b)), 'menu is alphabetical');
});

test('words() is the whole-word contract the matcher rests on', () => {
  assert.equal(words('PIZZA'), ' PIZZA ');
  assert.equal(words("Tony's Pizza-Pasta"), ' TONYS PIZZA PASTA ');
  assert.equal(words('A  B   C'), ' A B C ', 'runs of whitespace collapse');
  assert.equal(words('SUSHI & THAI'), ' SUSHI THAI ');
});
