import { describe, it, expect } from 'vitest';
import { isTriggerHit } from './notes';

describe('isTriggerHit', () => {
  it('above fires at or over the level', () => {
    expect(isTriggerHit(300, 300, 'above')).toBe(true);
    expect(isTriggerHit(301.2, 300, 'above')).toBe(true);
  });
  it('above does not fire under the level', () => {
    expect(isTriggerHit(299.99, 300, 'above')).toBe(false);
  });
  it('below fires at or under the level', () => {
    expect(isTriggerHit(300, 300, 'below')).toBe(true);
    expect(isTriggerHit(250, 300, 'below')).toBe(true);
  });
  it('below does not fire over the level', () => {
    expect(isTriggerHit(300.01, 300, 'below')).toBe(false);
  });
});
