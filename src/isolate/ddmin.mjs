// Delta debugging (Zeller & Hildebrandt's ddmin). Given a set of upgrades that
// breaks the app when applied together, find a smallest subset that still
// breaks it: remove any one member and the failure goes away. With one guilty
// package among n this takes about 2·log2(n) checks instead of n, and it also
// finds pairs that only break in combination, which one-at-a-time never does.
//
// A check here is expensive (install, build, boot, a real browser walk), so
// every result is cached and the search stops at a budget.

/**
 * @template T
 * @param {T[]} items the full failing set; the caller has already seen it fail
 * @param {(subset: T[]) => Promise<'pass'|'fail'|'unresolved'>} test
 *   'fail' means it fails the same way the full set did; 'unresolved' means it
 *   could not be judged or failed some other way.
 * @param {{maxTests?: number, key?: (item: T) => string}} [options]
 * @returns {Promise<{minimal: T[], tests: number, exhausted: boolean,
 *   trace: {subset: string[], outcome: string}[]}>}
 */
export async function ddmin(items, test, options = {}) {
  const key = options.key ?? ((item) => String(item?.id ?? item));
  const maxTests = options.maxTests ?? Infinity;
  const order = new Map(items.map((item, index) => [key(item), index]));
  const cacheKey = (subset) =>
    subset
      .map(key)
      .sort((a, b) => order.get(a) - order.get(b))
      .join('\u0000');

  const cache = new Map([[cacheKey(items), 'fail']]);
  const trace = [];
  let tests = 0;
  let exhausted = false;

  const outcomeOf = async (subset) => {
    if (subset.length === 0) return 'pass';
    const id = cacheKey(subset);
    if (cache.has(id)) return cache.get(id);
    if (tests >= maxTests) {
      exhausted = true;
      return 'unresolved';
    }
    tests += 1;
    const outcome = await test(subset);
    if (outcome !== 'pass' && outcome !== 'fail' && outcome !== 'unresolved') {
      throw new Error(`ddmin test returned "${outcome}", expected pass, fail or unresolved`);
    }
    cache.set(id, outcome);
    trace.push({ subset: subset.map(key), outcome });
    return outcome;
  };

  let current = [...items];
  let granularity = 2;

  while (current.length >= 2 && !exhausted) {
    const chunks = split(current, granularity);
    let reduced = false;

    for (const chunk of chunks) {
      if ((await outcomeOf(chunk)) === 'fail') {
        current = chunk;
        granularity = 2;
        reduced = true;
        break;
      }
    }
    if (reduced) continue;

    // With two chunks each complement is the other chunk, already tested.
    if (granularity > 2) {
      for (const chunk of chunks) {
        const drop = new Set(chunk);
        const complement = current.filter((item) => !drop.has(item));
        if ((await outcomeOf(complement)) === 'fail') {
          current = complement;
          granularity = Math.max(granularity - 1, 2);
          reduced = true;
          break;
        }
      }
      if (reduced) continue;
    }

    if (granularity >= current.length) break;
    granularity = Math.min(current.length, granularity * 2);
  }

  return { minimal: current, tests, exhausted, trace };
}

/** Split into n chunks whose sizes differ by at most one, keeping order. */
export function split(items, n) {
  const chunks = [];
  let start = 0;
  for (let i = 0; i < n; i += 1) {
    const size = Math.floor((items.length - start) / (n - i));
    if (size > 0) chunks.push(items.slice(start, start + size));
    start += size;
  }
  return chunks;
}
