# The monthly evidence digest

The app's citations (`data/evidence.json`, Batch F) are curated by hand and checked once a month in a Claude Code session on a developer machine. The phone never calls a literature site; this is the only place the searches run. The rules behind every field are PROGRAM-QUESTIONS 191 to 202. As of Nov 9: 96 entries, 158 saved searches, 18 gate rationales (every item), 23 seen papers.

## Run it

1. On a developer machine with network access to `www.ebi.ac.uk` and `eutils.ncbi.nlm.nih.gov`, run `npm run evidence`. It re-runs every saved search (newest first), lists the PMIDs that are neither entries nor in `seen`, then checks every entry against its MEDLINE record. `npm run evidence -- --verify` checks the entries only; `--search <id>` runs one saved search; `--json` prints the report for a session to read. It writes nothing.
2. Read the exit code: 0 is clean, 2 means something to act on, 1 means the data didn't parse or the network failed.

## Act on what it prints

3. **Changes and notices first.** A retracted paper comes out of `evidence.json`, and out of any gate rationale that cites it. For an erratum, an expression of concern or a newer version (a Cochrane update), read the notice; if the takeaway or the grade no longer holds, rewrite or drop the entry. Then record it in `data/evidence.notes.json` under `noticesChecked` (entry id, type, reference exactly as printed, date, what it changed in a few words), so it stops counting. A metadata change (title, journal, year, DOI, PMC id, authors) is copied from the fetched record.
4. **New candidates.** For each one worth adding:
   - fetch its record and match authors, title, year, journal and ids exactly; never add, alter or "improve" a citation from memory;
   - write the population in words, and either `sourceGrade` (the source's own GRADE, lower bound of a range) or `assessedAs` with `imprecise`; set `indirect` and write `gradeBasis` in words; the schema refuses a grade the rule disagrees with;
   - write a takeaway of one sentence and at most 40 words in our own words, never abstract text, and mark `read: "abstract-only"` unless the full text was read;
   - add the relevance note (our words, at most 80) to `evidence.notes.json`;
   - set `phases`, `patterns`, `appRules`, `foundBy` (a saved search), `verifiedOn` and `verifiedAgainst`;
   - add a gate rationale only if the item has none and the citation speaks to it, one sentence that claims nothing beyond its citations' takeaways.
   
   Add the ones you looked at and rejected to `seen`, with a note naming the first author and year.
5. Run `npm run evidence -- --verify`, then `npm run check`.
6. Open a PR for Shawn with the report's summary lines. Nothing reaches the app without his review.

## First jobs for the next session

- The research hand-off for Batch F arrived cut off; it was completed on Nov 9 (PROGRAM-QUESTIONS 202): 42 more entries, 85 more searches, and "Why this test" on g1-stance, the four g3 hops, g3-acl-rsi and g3-trust.
- Shawn's call on 202: if KOOS and training load become evidence topics, place the 17 verified papers waiting in `seen` (4 KOOS, 13 session RPE and acute:chronic load) and take each out of `seen`; nothing needs searching again.
- The 158 saved searches include broad ones (two with thousands of hits, capped at 200 a search); the first full run will list many candidates, so skim by title and add the rejects to `seen`.
- Three errata were found on Nov 9 and not yet read: Piussi 2024, Diermeier 2020 and Gomes 2023.
- Read the JOSPT 2017 knee ligament sprain guideline (PMID 29089004) with full-text access; it is the most direct source for Shawn's injury and sits in `seen` until then.
