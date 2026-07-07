import { describe, it, expect } from 'vitest';
import { aliasesFor, titleMatches } from './ngx-news';

describe('aliasesFor', () => {
  it('uses the curated alias list for known tickers', () => {
    expect(aliasesFor('NSENG:MTNN', 'MTN Nigeria')).toContain('MTN');
    expect(aliasesFor('NSENG:UBA', 'United Bank for Africa')).toEqual(
      expect.arrayContaining(['UBA', 'United Bank for Africa'])
    );
  });

  it('derives a fallback alias from the name for unknown tickers, stripping suffixes', () => {
    const a = aliasesFor('NSENG:XYZCO', 'Example Foods Nigeria Plc');
    expect(a).toContain('Example Foods');
  });

  it('does not emit a bare short symbol that could match common words', () => {
    // symbol shorter than 4 chars is excluded to avoid false positives
    expect(aliasesFor('NSENG:AB', null)).toHaveLength(0);
  });
});

describe('titleMatches', () => {
  it('matches on whole-word, case-insensitively', () => {
    expect(titleMatches('Dangote Cement approves LSE listing', aliasesFor('NSENG:DANGCEM', 'Dangote Cement'))).toBe(true);
    expect(titleMatches('zenith bank hits N5trn market cap', aliasesFor('NSENG:ZENITHBANK', 'Zenith Bank'))).toBe(true);
  });

  it('does not confuse BUA Foods with BUA Cement', () => {
    const foods = aliasesFor('NSENG:BUAFOODS', 'BUA Foods');
    const cement = aliasesFor('NSENG:BUACEMENT', 'BUA Cement');
    const title = 'BUA Cement lifts dividend on record profit';
    expect(titleMatches(title, cement)).toBe(true);
    expect(titleMatches(title, foods)).toBe(false);
  });

  it('does not confuse Dangote Cement with Dangote Refinery', () => {
    const cement = aliasesFor('NSENG:DANGCEM', 'Dangote Cement');
    expect(titleMatches('Dangote Refinery ramps up petrol output', cement)).toBe(false);
  });

  it('does not over-match "Access" inside unrelated words or generic use', () => {
    const access = aliasesFor('NSENG:ACCESSCORP', 'Access Holdings');
    // curated alias is "Access Holdings"/"Access Corp", not bare "Access"
    expect(titleMatches('Customers report access issues at several banks', access)).toBe(false);
    expect(titleMatches('Access Holdings posts record profit', access)).toBe(true);
  });

  it('rejects a substring that is not a whole word', () => {
    // "Presco" must not match inside "Prescott"
    expect(titleMatches('Prescott Ltd expands', aliasesFor('NSENG:PRESCO', 'Presco'))).toBe(false);
  });
});
