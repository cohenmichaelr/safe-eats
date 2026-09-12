'use strict';

/**
 * Food type, derived from the licensed business name — FR-407, DEC-019.
 *
 * WHAT THIS IS, AND WHAT IT IS NOT
 *
 * The state publishes no cuisine field. None of the 35 columns in the DBPR
 * licence extract describes what an establishment serves; the only "type" it
 * carries is the licence type, and the displayed population is already one
 * value of it (2010, permanent food service — DEC-009). So this is not a record
 * of what a restaurant serves. It is a match on words in the name the licence
 * was issued under, and every surface that uses it says so.
 *
 * That distinction is the whole design. "Greek" here means *the name contains
 * GREEK, GYRO, SOUVLAKI or TAVERNA* — a fact about the licence record, which we
 * can stand behind — and never *this kitchen serves Greek food*, which we
 * cannot. DEC-011 refuses to write our own gloss for a bare violation code for
 * the same reason: a claim about a named business has to be the state's, or
 * plainly ours and plainly labelled.
 *
 * WHY WORD MATCHING, NOT SUBSTRING
 *
 * `establishment_fts` is a trigram index (004), which is right for "wendys"
 * finding "WENDY'S" and wrong for this: as a substring, PHO matches PHOENIX and
 * THAI matches a dozen innocent words. Every pattern here is matched as a whole
 * word against a name whose punctuation has been turned into spaces, so PHO
 * reaches PHO 79 and not PHOENIX.
 *
 * WHY THE EXCLUSIONS EXIST
 *
 * Florida place names collide with cuisine words, and the collisions are not
 * rare enough to shrug at. INDIAN alone matched Indian River (a county), Indian
 * Shores, Indian Harbour, Indian Rocks and Indian Pass — 19 of 221 matches were
 * geography, not restaurants. Each `not` entry below is a measured collision.
 *
 * WHAT WAS MEASURED AND REJECTED
 *
 *   GRILL / GRILLE for American — 2,920 names carry it, and they are Chipotle
 *     Mexican Grill, Carrabba's Italian Grill, Kiku Sushi & Grill. "Grill" is
 *     how a Florida restaurant is named, not what it cooks.
 *   ISLAND for Caribbean — Springhill Suites Amelia Island, Coney Island Lunch.
 *     Florida is full of islands.
 *   CHOP for Chinese — Chop & Toss Salad Co.
 *   PIE / PIES for Pizza — 45 matches, and Peace Pie is an ice cream shop.
 *
 * COVERAGE IS PARTIAL AND THE UI SAYS SO
 *
 * About 28% of the 54,296 displayed establishments carry a word any of these
 * recognise. The rest — every restaurant named after a person, a street or a
 * mood — match nothing and appear under no food type. A filter that silently
 * hides 7 in 10 rows would be a trap, so the page states the coverage rather
 * than letting an empty-looking result read as "there are none near you".
 */

/**
 * @typedef {object} Cuisine
 * @property {string} label      what the menu calls it
 * @property {string[]} words    whole words that count as a match
 * @property {string[]} [not]    phrases that disqualify a match — place names
 */

/** @type {Record<string, Cuisine>} */
const CUISINES = Object.freeze({
  american: {
    label: 'American',
    words: ['AMERICAN', 'BURGER', 'BURGERS', 'DINER', 'STEAKHOUSE', 'CHEESESTEAK', 'HOT DOG', 'HOT DOGS'],
  },
  bbq: {
    label: 'Barbecue',
    words: ['BBQ', 'BARBECUE', 'BARBEQUE', 'SMOKEHOUSE', 'RIBS', 'BRISKET'],
  },
  bakery: {
    label: 'Bakery & donuts',
    words: ['BAKERY', 'PASTRY', 'PASTRIES', 'PANADERIA', 'DONUT', 'DONUTS', 'DOUGHNUT', 'DOUGHNUTS', 'CUPCAKE', 'CUPCAKES'],
  },
  caribbean: {
    label: 'Caribbean',
    words: ['CARIBBEAN', 'JAMAICAN', 'JERK', 'HAITIAN', 'BAHAMIAN', 'ROTI', 'KREYOL'],
  },
  chicken: {
    label: 'Chicken & wings',
    words: ['CHICKEN', 'WING', 'WINGS', 'ROTISSERIE'],
  },
  chinese: {
    label: 'Chinese',
    words: ['CHINA', 'CHINESE', 'WOK', 'PANDA', 'SZECHUAN', 'SICHUAN', 'HUNAN', 'DIM SUM', 'DUMPLING', 'DUMPLINGS'],
  },
  coffee: {
    label: 'Coffee',
    words: ['COFFEE', 'CAFFE', 'ESPRESSO', 'STARBUCKS', 'ROASTERS', 'ROASTERY'],
  },
  deli: {
    label: 'Deli & sandwiches',
    words: ['DELI', 'DELICATESSEN', 'SUB', 'SUBS', 'SANDWICH', 'SANDWICHES', 'HOAGIE', 'HOAGIES'],
  },
  dessert: {
    label: 'Ice cream & dessert',
    words: ['ICE CREAM', 'ICE CREAMS', 'CREAMERY', 'GELATO', 'YOGURT', 'CUSTARD', 'CANDY', 'CHOCOLATE', 'CHOCOLATES'],
  },
  greek: {
    label: 'Greek',
    words: ['GREEK', 'GYRO', 'GYROS', 'SOUVLAKI', 'TAVERNA', 'ACROPOLIS', 'MYKONOS', 'SANTORINI'],
  },
  indian: {
    label: 'Indian',
    words: ['INDIAN', 'CURRY', 'TANDOOR', 'TANDOORI', 'MASALA', 'BOMBAY', 'PUNJAB', 'NAAN', 'BIRYANI'],
    // Every one of these is a Florida place, and each was a real false positive
    // before it was listed here.
    not: [
      'INDIAN RIVER', 'INDIAN SHORES', 'INDIAN HARBOUR', 'INDIAN HARBOR',
      'INDIAN ROCKS', 'INDIAN CREEK', 'INDIAN PASS', 'INDIAN SPRING',
      'INDIAN SPRINGS', 'INDIAN HAMMOCK', 'INDIAN PINES', 'INDIAN HILLS',
      'INDIAN BAYOU', 'INDIAN TRAIL', 'INDIAN BREEZE', 'INDIAN STREET',
      'INDIAN LAKE', 'INDIAN MOUND',
    ],
  },
  italian: {
    label: 'Italian',
    words: ['ITALIAN', 'ITALIA', 'PASTA', 'TRATTORIA', 'RISTORANTE', 'OSTERIA', 'CUCINA', 'LASAGNA'],
    // Rita's Italian Ice is a shaved-ice chain, not an Italian restaurant.
    not: ['ITALIAN ICE'],
  },
  japanese: {
    label: 'Japanese & sushi',
    words: ['SUSHI', 'JAPANESE', 'HIBACHI', 'RAMEN', 'TERIYAKI', 'IZAKAYA', 'BENTO', 'POKE'],
  },
  korean: {
    label: 'Korean',
    words: ['KOREAN', 'KBBQ', 'SEOUL', 'BIBIMBAP', 'KIMCHI'],
  },
  latin: {
    label: 'Cuban & Latin',
    words: ['CUBAN', 'CUBANO', 'LATIN', 'PERUVIAN', 'COLOMBIAN', 'VENEZUELAN', 'AREPA', 'AREPAS', 'EMPANADA', 'EMPANADAS', 'HAVANA', 'PUPUSA', 'PUPUSERIA'],
  },
  mediterranean: {
    label: 'Mediterranean & Middle Eastern',
    words: ['MEDITERRANEAN', 'HUMMUS', 'FALAFEL', 'SHAWARMA', 'SHAWRMA', 'KABOB', 'KEBAB', 'KABAB', 'LEBANESE', 'TURKISH', 'PERSIAN'],
  },
  mexican: {
    label: 'Mexican',
    words: ['MEXICAN', 'TACO', 'TACOS', 'TAQUERIA', 'TAQUERIAS', 'BURRITO', 'BURRITOS', 'CANTINA', 'TORTILLA', 'TORTILLERIA', 'AZTECA', 'JALISCO'],
  },
  pizza: {
    label: 'Pizza',
    words: ['PIZZA', 'PIZZAS', 'PIZZERIA', 'PIZZERIAS'],
  },
  seafood: {
    label: 'Seafood',
    words: ['SEAFOOD', 'OYSTER', 'OYSTERS', 'CRAB', 'LOBSTER', 'SHRIMP', 'CLAM', 'CLAMS', 'FISH HOUSE', 'FISH CAMP'],
  },
  thai: {
    label: 'Thai',
    words: ['THAI', 'BANGKOK', 'SIAM'],
  },
  vietnamese: {
    label: 'Vietnamese',
    words: ['PHO', 'VIETNAMESE', 'SAIGON', 'BANH MI'],
  },
});

/**
 * The name reduced to space-delimited words, padded at both ends.
 *
 * Padding is what makes an `includes(' PIZZA ')` test a whole-word test:
 * without it the first and last words of a name could never match. `&`, `/`
 * and commas become spaces because "PIZZA/PASTA" and "SUSHI & THAI" are
 * ordinary ways to write a restaurant name, and a word is no less a word for
 * having a slash beside it. Apostrophes and periods are deleted rather than
 * spaced, matching `STRIP` in server.js, so SUB'S reads as SUBS.
 */
function words(name) {
  return (
    ' ' +
    String(name)
      .toUpperCase()
      .replace(/['.]/g, '')
      .replace(/[-/&,()+]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim() +
    ' '
  );
}

/** Patterns compiled once, in the padded form the test compares against. */
const COMPILED = new Map(
  Object.entries(CUISINES).map(([key, c]) => [
    key,
    { any: c.words.map((w) => ` ${w} `), none: (c.not ?? []).map((w) => ` ${w} `) },
  ])
);

/**
 * Does this name read as this food type?
 *
 * @param {string} name  the licensed business name, exactly as DBPR published it
 * @param {string} key   a key of CUISINES
 */
function matchesCuisine(name, key) {
  const c = COMPILED.get(key);
  if (!c || name == null) return false;

  const w = words(name);
  return c.any.some((p) => w.includes(p)) && !c.none.some((p) => w.includes(p));
}

/**
 * Register the matcher as a SQL function, so the filter runs inside the query.
 *
 * WHY A CUSTOM FUNCTION RATHER THAN SQL
 *
 * The obvious implementation is a chain of `LIKE '% GYRO %'` against the name
 * with its punctuation replaced inline. That was built, measured and thrown
 * away: SQLite re-evaluates the nine nested REPLACEs for every pattern, so cost
 * scaled with keyword count — 500ms for Greek's eight words against 54,296
 * rows, and over three seconds through the endpoint, which runs the predicate
 * twice (the page and its count).
 *
 * A two-stage filter — a cheap `LIKE '%GYRO%'` on the raw column, then the
 * exact test on the survivors — ran in 52ms and is WRONG. The prefilter is only
 * safe if it can never exclude a true match, and punctuation inside a name
 * breaks that: `GYRO KING SUB'S AND SALADS` is a real row in this database, and
 * a raw-substring prefilter for SUBS drops it. Being fast about the wrong
 * answer is the failure mode this project keeps a gate for.
 *
 * So the matcher stays exactly one function, written once in JS, and SQLite
 * calls it per row: 67-88ms statewide, and — verified against the pure-SQL
 * predicate over all 21 types on the full extract — the identical result set.
 *
 * `deterministic` lets SQLite cache and reorder the call; the function reads
 * only its arguments, so that is true.
 */
function registerCuisineMatcher(db) {
  db.function('cuisine_match', { deterministic: true }, (name, key) =>
    matchesCuisine(name, key) ? 1 : 0
  );
}

/**
 * SQL predicate for one food type, plus its bound parameters.
 *
 * @param {string} key       a key of CUISINES
 * @param {string} nameExpr  the column holding the name as published
 * @returns {{sql: string, params: string[]}}
 */
function cuisinePredicate(key, nameExpr = 'e.name') {
  if (!CUISINES[key]) throw new Error(`Unknown cuisine: ${key}`);
  return { sql: `cuisine_match(${nameExpr}, ?) = 1`, params: [key] };
}

/** Menu options, alphabetical by label — what /api/meta publishes. */
const cuisineOptions = () =>
  Object.entries(CUISINES)
    .map(([key, { label }]) => ({ key, label }))
    .sort((a, b) => a.label.localeCompare(b.label));

module.exports = { CUISINES, words, matchesCuisine, registerCuisineMatcher, cuisinePredicate, cuisineOptions };
