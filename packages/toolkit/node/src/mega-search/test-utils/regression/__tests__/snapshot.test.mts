import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

import { createTempCorpus } from '../../temp-corpus.mjs';
import type { TempCorpus } from '../../temp-corpus.mjs';
import { parseSearchKey, searchKey } from '../snapshot-format.mjs';
import type { Snapshot } from '../snapshot-format.mjs';
import { takeSnapshot } from '../snapshot.mjs';

const CORPUS = {
  'orders/наказ 01.02.2024.txt':
    'Наказ № 15/2 від 01.02.2024. Призначити Петренка Івана Олеговича менеджером відділу продажу з 05.02.2024.',
  'orders/наказ 15.03.2024.txt':
    'Наказ № 16 від 15.03.2024. Надати щорічну відпустку Коваленко Марії Іванівні з 20.03.2024 на 14 днів.',
  'reports/звіт 10.04.2024.txt':
    'Звіт про виконання кошторису за перший квартал. Об’єкт прийнято, будь-яких зауважень немає.',
  'лист.txt':
    'Лист Шевченку Олександру щодо графіка роботи бухгалтерії та порядку подання заяв.',
};

describe('takeSnapshot()', () => {
  let corpus: TempCorpus;
  let cacheRoot: string;

  before(async () => {
    corpus = await createTempCorpus(CORPUS);
    cacheRoot = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), 'mega-search-snapshot-test-'),
    );
  });

  after(async () => {
    await corpus.cleanup();
    await fs.promises.rm(cacheRoot, { recursive: true, force: true });
  });

  const snapshotOf = (extraQueries: string[] = []) =>
    takeSnapshot({ corpusDir: corpus.root, cacheRoot, extraQueries });

  it('searches each sampled query under each option set', async () => {
    const snapshot = await snapshotOf();
    const keys = Object.keys(snapshot.results).map(parseSearchKey);
    const optionSets = new Set(keys.map((key) => key.optionSet));
    const groups = new Set(keys.map((key) => key.group));

    assert.equal(snapshot.meta.documents, 4);
    assert.equal(snapshot.meta.searches, keys.length);
    for (const group of ['word', 'twoWords', 'name', 'nameLowercase', 'typo']) {
      assert.ok(groups.has(group), group);
      const queries = new Set(
        keys.filter((key) => key.group === group).map((key) => key.query),
      );
      assert.equal(
        keys.filter((key) => key.group === group).length,
        queries.size * optionSets.size,
        group,
      );
    }
    assert.ok(optionSets.has('ui:default'));
    assert.ok(optionSets.has('api:default'));
  });

  it('records what consumers see: documents, scores, matches where the text has them', async () => {
    const snapshot = await snapshotOf(['Петренко Іван']);
    const record =
      snapshot.results[searchKey('extra', 'Петренко Іван', 'ui:default')];
    const [entry] = record.page;
    const [match, charStart] = entry.snippets[0].split('@');

    assert.equal(record.total, 1);
    assert.equal(entry.doc, path.join('orders', 'наказ 01.02.2024.txt'));
    assert.ok(entry.score > 0);
    assert.equal(match, 'Петренка Івана');
    assert.equal(
      CORPUS['orders/наказ 01.02.2024.txt'].slice(
        Number(charStart),
        Number(charStart) + match.length,
      ),
      match,
    );
  });

  it('asks the same and gets the same each run, leaving the corpus folder as it is', async () => {
    const withoutTimes = (snapshot: Snapshot) =>
      Object.fromEntries(
        Object.entries(snapshot.results).map(([key, record]) => [
          key,
          { ...record, ms: 0 },
        ]),
      );

    const first = await snapshotOf();
    const second = await snapshotOf();

    assert.deepEqual(withoutTimes(second), withoutTimes(first));
    assert.equal(corpus.exists('.cache'), false);
  });
});
