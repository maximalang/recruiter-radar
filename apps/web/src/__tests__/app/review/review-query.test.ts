import { parseReviewPagePagination } from '../../../../app/review/review-query';

describe('Review page pagination query parsing', () => {
  it.each([
    ['abc', 50],
    ['-1', 50],
    ['0', 50],
    ['201', 50],
    ['10.5', 50],
    ['25', 25],
  ])('normalizes limit=%s to %i', (limit, expected) => {
    expect(parseReviewPagePagination({ limit }).limit).toBe(expected);
  });

  it.each([
    ['abc', 0],
    ['-1', 0],
    ['2.5', 0],
    ['12', 12],
  ])('normalizes offset=%s to %i', (offset, expected) => {
    expect(parseReviewPagePagination({ offset }).offset).toBe(expected);
  });

  it('uses page defaults when pagination parameters are absent', () => {
    expect(parseReviewPagePagination({})).toEqual({ limit: 50, offset: 0 });
  });
});
