import { test } from 'node:test';
import assert from 'node:assert/strict';
import { peerLinks } from '../src/plan/peer-links.mjs';
import { groupLockstep } from '../src/plan/group-lockstep.mjs';

const candidate = (name, from, to) => ({ name, from, to, breaking: true });
const peers = ({ current = {}, next = {} }) => ({ current: new Map(Object.entries(current)), next: new Map(Object.entries(next)) });

// The demo shop's real situation on 19 Nov 2026.
const SHOP = [
  candidate('react', '17.0.2', '19.2.0'),
  candidate('react-dom', '17.0.2', '19.2.0'),
  candidate('react-hook-form', '6.15.8', '7.92.0'),
  candidate('react-markdown', '5.0.3', '10.1.0'),
  candidate('date-fns', '1.30.1', '4.4.0'),
  candidate('vite', '4.0.0', '8.3.8'),
  candidate('@vitejs/plugin-react', '3.0.0', '5.1.0'),
];
const SHOP_PEERS = peers({
  current: {
    'react-dom': { react: '17.0.2' },
    'react-hook-form': { react: '^16.8.0 || ^17' },
    'react-markdown': { react: '>=16', '@types/react': '>=16' },
    '@vitejs/plugin-react': { vite: '^4.0.0' },
  },
  next: {
    'react-dom': { react: '^19.2.0' },
    'react-hook-form': { react: '^16.8.0 || ^17 || ^18 || ^19' },
    'react-markdown': { react: '>=18', '@types/react': '>=18' },
    '@vitejs/plugin-react': { vite: '^4.2.0 || ^5.0.0 || ^6.0.0 || ^7.0.0 || ^8.0.0' },
  },
});

test('links a package to the peer its new version needs', () => {
  const { pairs, reasons } = peerLinks([candidate('react', '17.0.2', '19.2.0'), candidate('react-markdown', '5.0.3', '10.1.0')], peers({ next: { 'react-markdown': { react: '>=18' } } }));
  assert.deepEqual(pairs, [['react-markdown', 'react']]);
  assert.deepEqual(reasons, ['react-markdown 10.1.0 needs react >=18; react is at 17.0.2']);
});

test('links a peer to a package whose installed version will not accept the new peer', () => {
  const { pairs, reasons } = peerLinks(
    [candidate('react', '17.0.2', '19.2.0'), candidate('react-hook-form', '6.15.8', '7.92.0')],
    peers({ current: { 'react-hook-form': { react: '^16.8.0 || ^17' } }, next: { 'react-hook-form': { react: '^16.8.0 || ^17 || ^18 || ^19' } } }),
  );
  assert.deepEqual(pairs, [['react-hook-form', 'react']]);
  assert.deepEqual(reasons, ['react-hook-form 6.15.8 only accepts react ^16.8.0 || ^17; react is moving to 19.2.0']);
});

test('no link when the upgrade can stand alone', () => {
  // react-hook-form 7 accepts the React that is installed, and React is not moving past what 6 accepts.
  const alone = peerLinks([candidate('react', '17.0.2', '17.0.3'), candidate('react-hook-form', '6.15.8', '7.92.0')], peers({ current: { 'react-hook-form': { react: '^16.8.0 || ^17' } }, next: { 'react-hook-form': { react: '^16.8.0 || ^17 || ^18 || ^19' } } }));
  assert.deepEqual(alone.pairs, []);
});

test('no link when moving together would not help either', () => {
  // The new plugin still rejects the new host: nothing to gain by pairing them. The install check will say so.
  const stuck = peerLinks([candidate('eslint', '8.57.0', '10.0.0'), candidate('eslint-plugin-x', '1.0.0', '1.1.0')], peers({ current: { 'eslint-plugin-x': { eslint: '^8' } }, next: { 'eslint-plugin-x': { eslint: '^8' } } }));
  assert.deepEqual(stuck.pairs, []);
});

test('a peer that is not being upgraded and an unreadable range are ignored', () => {
  const { pairs } = peerLinks([candidate('react-markdown', '5.0.3', '10.1.0'), candidate('thing', '1.0.0', '2.0.0')], peers({ next: { 'react-markdown': { react: '>=18' }, thing: { 'react-markdown': 'workspace:*' } } }));
  assert.deepEqual(pairs, []);
});

test('the demo shop: React, its form and markdown libraries are one unit; Vite and its plugin another', () => {
  const { pairs } = peerLinks(SHOP, SHOP_PEERS);
  const units = groupLockstep(SHOP, pairs);
  assert.deepEqual(units.map((unit) => unit.id), ['@vitejs/plugin-react+vite', 'date-fns', 'react+react-dom+react-hook-form+react-markdown']);
});

test('groupLockstep ignores a link to something that is not a candidate', () => {
  const units = groupLockstep([candidate('a', '1.0.0', '2.0.0')], [['a', 'not-here']]);
  assert.deepEqual(units.map((unit) => unit.id), ['a']);
});
