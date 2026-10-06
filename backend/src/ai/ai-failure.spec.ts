import { describeAiFailure, describeEmptyAnswer, isRefusedKey } from './ai-failure';

const httpErr = (status: number, message: string) =>
  Object.assign(new Error(`status ${status}`), { response: { status, data: { error: { message } } } });

describe('describeAiFailure', () => {
  it.each([
    [httpErr(401, 'invalid x-api-key'), 'המפתח נדחה'],
    [httpErr(400, 'Your credit balance is too low to access the Anthropic API.'), 'נגמר הקרדיט בחשבון'],
    [httpErr(429, 'You exceeded your current quota, please check your plan and billing details.'), 'נגמר הקרדיט בחשבון'],
    [httpErr(529, 'Overloaded'), 'עומס אצל הספק'],
    [new Error('timeout of 25000ms exceeded'), 'אין תשובה מהספק (timeout)'],
  ])('%#', (err, expected) => {
    expect(describeAiFailure(err)).toBe(expected);
  });

  it('names a retired model', () => {
    expect(describeAiFailure(httpErr(404, 'model: claude-old not found'))).toMatch(/^המודל לא נמצא/);
  });

  it('keeps an unknown error short', () => {
    expect(describeAiFailure(httpErr(500, 'x'.repeat(300))).length).toBeLessThanOrEqual(90);
  });
});

it('isRefusedKey: only a refused key, not a quota', () => {
  expect(isRefusedKey(httpErr(401, 'invalid x-api-key'))).toBe(true);
  expect(isRefusedKey(httpErr(400, 'Your credit balance is too low'))).toBe(false);
  expect(isRefusedKey(new Error('timeout'))).toBe(false);
});

it('describeEmptyAnswer', () => {
  expect(describeEmptyAnswer('refusal')).toBe('המודל סירב לכתוב על המוצר');
  expect(describeEmptyAnswer('SAFETY')).toBe('המודל סירב לכתוב על המוצר');
  expect(describeEmptyAnswer('end_turn')).toBe('תשובה ריקה (end_turn)');
  expect(describeEmptyAnswer()).toBe('תשובה ריקה');
});
