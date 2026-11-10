/*
 * The one invite-code fixture table (PROGRAM-QUESTIONS 213). The phone checks a code's shape with its
 * own copy of the server's normalising (src can't import api/ at runtime), so both tests import this
 * table: api/_code.test.ts pins `normaliseCode` to `norm`, and src/screens/Account.helpers.test.ts pins
 * `codeProblem` to `client` and to `norm`. Changing either side without the other fails a test.
 * Test data only: the underscore keeps Vercel from deploying it as a function, and nothing but those
 * two tests imports it.
 */

export interface CodeFixture {
  input: string
  /** The server's reading (normaliseCode), or null when it reads no code. */
  norm: string | null
  /** What the phone says before sending (codeProblem), or null when it sends. */
  client: string | null
}

export const CODE_FIXTURES: readonly CodeFixture[] = [
  { input: '7K3M-Q9X2-T4HB-8RD7', norm: '7K3MQ9X2T4HB8RD7', client: null },
  { input: '7k3m q9x2 t4hb 8rd7', norm: '7K3MQ9X2T4HB8RD7', client: null },
  { input: ' 7k3m_q9x2_t4hb_8rd7 ', norm: '7K3MQ9X2T4HB8RD7', client: null },
  { input: '1A2B-3C4D-5E6F-7G8X', norm: '1A2B3C4D5E6F7G8X', client: null },
  { input: 'lA2B-3C4D-5E6F-7G8X', norm: '1A2B3C4D5E6F7G8X', client: null },
  { input: 'IA2B-3C4D-5E6F-7G8X', norm: '1A2B3C4D5E6F7G8X', client: null },
  { input: 'OOOO-oooo-0000-0000', norm: '0000000000000000', client: null },
  { input: '', norm: null, client: 'Type the code first.' },
  { input: '  - ', norm: null, client: 'Type the code first.' },
  { input: '7K3M-Q9X2-T4HB', norm: null, client: 'A code is 16 letters and numbers; that was 12.' },
  { input: '7K3M-Q9X2-T4HB-8RD7-0', norm: null, client: 'A code is 16 letters and numbers; that was 17.' },
  { input: 'UK3M-Q9X2-T4HB-8RD7', norm: null, client: 'A code has only letters and numbers, and never the letter U.' },
  { input: '7K3M.Q9X2.T4HB.8RD7', norm: null, client: 'A code has only letters and numbers, and never the letter U.' },
  { input: '7K3M-Q9X2-T4HB-8RD7U', norm: null, client: 'A code has only letters and numbers, and never the letter U.' },
]
