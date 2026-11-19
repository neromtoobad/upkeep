// Some packages only make sense upgraded together: react with react-dom,
// a library with its @types, every @mui/* package on one version. Splitting
// them gives an install that fails for a reason unrelated to the app, which
// would send the culprit search down the wrong path. So candidates are grouped
// into units, and a unit is the smallest thing Upkeep bumps, tests and lands.

/** @typedef {import('./outdated.mjs').Candidate} Candidate */

/**
 * @typedef {object} Unit
 * @property {string} id        stable id: member names joined with "+"
 * @property {Candidate[]} packages
 * @property {boolean} breaking true when any member may break callers
 */

// Unscoped packages released in lockstep under one version number.
const FAMILIES = [
  /^(react|react-dom|react-is|react-test-renderer|react-server-dom-[a-z-]+)$/,
  /^(jest|babel-jest|jest-cli|jest-circus|jest-environment-[a-z-]+|@jest\/[a-z-]+)$/,
  /^(vue|vue-template-compiler|@vue\/(compiler-[a-z-]+|server-renderer|runtime-[a-z-]+|reactivity|shared))$/,
  /^(storybook|@storybook\/[a-z0-9-]+)$/,
];

function scopeOf(name) {
  return name.startsWith('@') ? name.slice(0, name.indexOf('/')) : null;
}

function familyOf(name) {
  const index = FAMILIES.findIndex((pattern) => pattern.test(name));
  return index === -1 ? null : `family:${index}`;
}

/** "@types/react" → "react", "@types/babel__core" → "@babel/core" */
export function typedPackage(name) {
  if (!name.startsWith('@types/')) return null;
  const rest = name.slice('@types/'.length);
  return rest.includes('__') ? `@${rest.replace('__', '/')}` : rest;
}

/**
 * @param {Candidate[]} candidates
 * @returns {Unit[]} units sorted by id
 */
export function groupLockstep(candidates) {
  const parent = new Map(candidates.map((c) => [c.name, c.name]));
  const find = (name) => {
    let root = name;
    while (parent.get(root) !== root) root = parent.get(root);
    parent.set(name, root);
    return root;
  };
  const union = (a, b) => {
    const [ra, rb] = [find(a), find(b)];
    if (ra !== rb) parent.set(ra < rb ? rb : ra, ra < rb ? ra : rb);
  };

  // Same scope or same family, and moving to the same version: one release train.
  const trains = new Map();
  for (const candidate of candidates) {
    for (const group of [scopeOf(candidate.name), familyOf(candidate.name)]) {
      if (!group || group === '@types') continue;
      const key = `${group}@${candidate.to}`;
      if (trains.has(key)) union(trains.get(key), candidate.name);
      else trains.set(key, candidate.name);
    }
  }

  // Types follow the package they describe.
  for (const candidate of candidates) {
    const described = typedPackage(candidate.name);
    if (described && parent.has(described)) union(described, candidate.name);
  }

  const members = new Map();
  for (const candidate of candidates) {
    const root = find(candidate.name);
    if (!members.has(root)) members.set(root, []);
    members.get(root).push(candidate);
  }

  return [...members.values()]
    .map((packages) => {
      packages.sort((a, b) => (a.name < b.name ? -1 : 1));
      return {
        id: packages.map((p) => p.name).join('+'),
        packages,
        breaking: packages.some((p) => p.breaking),
      };
    })
    .sort((a, b) => (a.id < b.id ? -1 : 1));
}
