import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reproduces } from '../src/check/verdict.mjs';

const kane = (...failing) => ({ outcome: 'fail', stage: 'kane', failing });

test('the same flows failing again reproduces the failure', () => {
  assert.equal(reproduces(kane('checkout_test.md'), kane('checkout_test.md')), true);
});

test('failing part of what failed before reproduces it', () => {
  assert.equal(reproduces(kane('cart_test.md', 'checkout_test.md'), kane('cart_test.md')), true);
});

test('failing a flow that was fine before is a different problem', () => {
  assert.equal(reproduces(kane('checkout_test.md'), kane('browse_test.md')), false);
  assert.equal(reproduces(kane('checkout_test.md'), kane('checkout_test.md', 'browse_test.md')), false);
});

test('failing at another stage is a different problem', () => {
  assert.equal(reproduces(kane('checkout_test.md'), { outcome: 'fail', stage: 'install' }), false);
  assert.equal(reproduces({ outcome: 'fail', stage: 'build' }, kane('checkout_test.md')), false);
});

test('before the browser, the same stage is enough', () => {
  assert.equal(reproduces({ outcome: 'fail', stage: 'build' }, { outcome: 'fail', stage: 'build' }), true);
});

test('a pass or an unavailable check never reproduces a failure', () => {
  assert.equal(reproduces(kane('checkout_test.md'), { outcome: 'pass' }), false);
  assert.equal(reproduces(kane('checkout_test.md'), { outcome: 'error' }), false);
  assert.equal(reproduces(kane('checkout_test.md'), { outcome: 'fail', stage: 'kane', failing: [] }), false);
});
