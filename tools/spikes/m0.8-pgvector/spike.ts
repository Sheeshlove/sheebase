// M0.8: pgvector HNSW + FTS russian + RRF на 10 000 чанков с mock-эмбеддингами, замер времени.
// Запуск: SPIKE_DATABASE_URL=postgres://… pnpm --filter @shibase/spikes m0.8
// Схема и запрос — по docs/spec/70-search.md (10.3) и модели search_chunks (7.1).
import { createHash } from 'node:crypto';
import pg from 'pg';

const DB_URL = process.env.SPIKE_DATABASE_URL ?? 'postgres://shibase:shibase@localhost:5432/shibase_spike';
const N = 10_000;
const WORKSPACES = 10;
const DIM = 256;
const QUERIES = 200;

// Детерминированный генератор: синтетический словарь, тексты собственные (не чужой контент).
let seed = 42;
const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
const pick = <T>(xs: T[]) => xs[Math.floor(rnd() * xs.length)]!;
const TOPICS = [
  'прототип',
  'интервью',
  'бюджет',
  'презентация',
  'исследование',
  'дедлайн',
  'макет',
  'гипотеза',
  'опрос',
  'отчёт',
  'команда',
  'наставник',
  'заявка',
  'конкурент',
  'метрика',
  'сценарий',
  'база данных',
  'поиск',
  'доска',
  'задача',
];
const VERBS = [
  'подготовить',
  'проверить',
  'обсудить',
  'согласовать',
  'переписать',
  'собрать',
  'сравнить',
  'описать',
  'протестировать',
  'уточнить',
];
const TAILS = [
  'до пятницы',
  'к защите проекта',
  'для первой версии',
  'после встречи с наставником',
  'вместе с дизайнером',
  'по итогам опроса студентов',
  'в рамках учебного курса',
  'перед сдачей отчёта',
  'на следующей неделе',
  'по замечаниям преподавателя',
];
// словоформы, которых в текстах нет (в текстах — начальная форма)
const INFLECTED = [
  'прототипов',
  'бюджета',
  'презентацию',
  'исследований',
  'дедлайном',
  'макетами',
  'гипотезу',
  'опросах',
  'отчётов',
  'команде',
  'наставником',
  'заявки',
  'конкурентов',
  'метриками',
  'сценарию',
  'задачами',
  'доске',
];
const sentence = () => `${pick(VERBS)} ${pick(TOPICS)} и ${pick(TOPICS)} ${pick(TAILS)}`;
const cap = (s: string) => s[0]!.toUpperCase() + s.slice(1);

/** Mock-эмбеддинг: хеширование слов (первые 5 букв ≈ грубая основа) в 256 измерений + нормализация. */
function embed(text: string): number[] {
  const v = new Array<number>(DIM).fill(0);
  for (const word of text.toLowerCase().match(/[а-яёa-z0-9]+/g) ?? []) {
    const h = createHash('md5').update(word.slice(0, 5)).digest();
    v[h.readUInt16LE(0) % DIM]! += 1;
    v[h.readUInt16LE(2) % DIM]! += 0.5;
  }
  const norm = Math.hypot(...v) || 1;
  return v.map((x) => +(x / norm).toFixed(5));
}
const vec = (v: number[]) => `[${v.join(',')}]`;
const pct = (xs: number[], p: number) =>
  [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(xs.length * p))]!;
const summary = (xs: number[]) => ({
  p50: +pct(xs, 0.5).toFixed(2),
  p95: +pct(xs, 0.95).toFixed(2),
  max: +Math.max(...xs).toFixed(2),
});
const avg = (xs: number[]) => +(xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(2);
async function timed<T>(fn: () => Promise<T>): Promise<[T, number]> {
  const t = performance.now();
  const r = await fn();
  return [r, performance.now() - t];
}

const db = new pg.Client({ connectionString: DB_URL });
await db.connect();
const version = (
  await db.query(
    `select current_setting('server_version') v, (select extversion from pg_extension where extname='vector') pv`,
  )
).rows[0];

await db.query(`
  drop table if exists search_chunks;
  create table search_chunks (
    id bigserial primary key, workspace_id int not null, page_id int, title text, content text not null,
    tsv tsvector generated always as (setweight(to_tsvector('russian', coalesce(title,'')), 'A')
                                   || setweight(to_tsvector('russian', content), 'B')) stored,
    embedding vector(${DIM}));`);

const [, insertMs] = await timed(async () => {
  for (let i = 0; i < N; i += 500) {
    const rows: unknown[] = [];
    const ph: string[] = [];
    for (let j = i; j < i + 500; j++) {
      const title = cap(`${pick(TOPICS)}: ${pick(TOPICS)}`);
      const content =
        Array.from({ length: 4 + Math.floor(rnd() * 5) }, () => cap(sentence())).join('. ') + '.';
      const k = rows.length;
      ph.push(`($${k + 1},$${k + 2},$${k + 3},$${k + 4},$${k + 5})`);
      rows.push(j % WORKSPACES, Math.floor(j / 8), title, content, vec(embed(`${title} ${content}`)));
    }
    await db.query(
      `insert into search_chunks(workspace_id,page_id,title,content,embedding) values ${ph.join(',')}`,
      rows,
    );
  }
});
const [, hnswMs] = await timed(() =>
  db.query(`create index on search_chunks using hnsw (embedding vector_cosine_ops)`),
);
const [, ginMs] = await timed(() => db.query(`create index on search_chunks using gin (tsv)`));
await db.query(`create index on search_chunks (workspace_id, page_id); analyze search_chunks;`);
const sizes = (
  await db.query(
    `select pg_size_pretty(pg_table_size('search_chunks')) t, pg_size_pretty(pg_indexes_size('search_chunks')) i`,
  )
).rows[0];

// Параметры везде одни: $1 — текст запроса, $2 — workspace, $3 — вектор запроса.
const FTS = `select id, row_number() over (order by ts_rank_cd(tsv, q, 32) desc, id) r
  from search_chunks, websearch_to_tsquery('russian', $1::text) q where workspace_id = $2::int and tsv @@ q and $3::text is not null
  order by ts_rank_cd(tsv, q, 32) desc, id limit 50`;
const VEC = `select id, row_number() over (order by embedding <=> $3::vector) r
  from search_chunks where workspace_id = $2::int and $1::text is not null
  order by embedding <=> $3::vector limit 50`;
const HYBRID = `with fts as (${FTS}), vec as (${VEC})
  select id, coalesce(1.0/(60+fts.r),0) + coalesce(1.0/(60+vec.r),0) score
  from fts full outer join vec using (id) order by score desc limit 10`;
const EXACT = `select id from search_chunks where workspace_id = $2::int and $1::text is not null
  order by embedding <=> $3::vector limit 50`;

const t = {
  fts: [] as number[],
  vec: [] as number[],
  hybrid: [] as number[],
  vec1000: [] as number[],
  exact: [] as number[],
  hybridExact: [] as number[],
};
const vec1000Hits: number[] = [];
const recall1000: number[] = [];
const ftsHits: number[] = [];
const vecHits: number[] = [];
const recall: number[] = [];
let withResults = 0;
let morphologyOk = 0;
let morphologyTotal = 0;
for (let i = 0; i < QUERIES; i++) {
  const a = pick(TOPICS);
  const b = pick(TOPICS);
  // каждый второй запрос — слово в другой словоформе, чем в текстах: проверка русской морфологии FTS
  const inflected = i % 2 === 0;
  const q = inflected ? pick(INFLECTED) : `${a} ${b}`;
  const params = [q, i % WORKSPACES, vec(embed(q))];
  const overlap = (rows: { id: string }[], exact: { id: string }[]) => {
    const got = new Set(rows.map((r) => r.id));
    return exact.filter((r) => got.has(r.id)).length / exact.length;
  };
  await db.query('begin');
  await db.query('set local hnsw.ef_search = 100');
  const [f, fm] = await timed(() => db.query(FTS, params));
  const [v, vm] = await timed(() => db.query(VEC, params));
  const [h, hm] = await timed(() => db.query(HYBRID, params));
  await db.query('set local hnsw.ef_search = 1000'); // максимум pgvector
  const [v1000, v1000m] = await timed(() => db.query(VEC, params));
  // точный поиск: отбор по btree(workspace_id) + сортировка по расстоянию, без HNSW
  await db.query('set local enable_indexscan = off');
  const [exact, em] = await timed(() => db.query(EXACT, params));
  const [hx, hxm] = await timed(() => db.query(HYBRID, params));
  await db.query('commit');
  t.fts.push(fm);
  t.vec.push(vm);
  t.hybrid.push(hm);
  t.vec1000.push(v1000m);
  t.exact.push(em);
  t.hybridExact.push(hxm);
  ftsHits.push(f.rowCount ?? 0);
  vecHits.push(v.rowCount ?? 0);
  vec1000Hits.push(v1000.rowCount ?? 0);
  recall.push(overlap(v.rows, exact.rows));
  recall1000.push(overlap(v1000.rows, exact.rows));
  if (h.rowCount && hx.rowCount) withResults++;
  if (inflected) {
    morphologyTotal++;
    if (f.rowCount) morphologyOk++;
  }
}
await db.query('begin');
await db.query('set local hnsw.ef_search = 100');
const plan = (await db.query(`explain ${VEC}`, ['поиск', 0, vec(embed('поиск'))])).rows
  .map((r) => r['QUERY PLAN'])
  .join(' | ');
await db.query('commit');

console.log(
  JSON.stringify(
    {
      postgres: version.v,
      pgvector: version.pv,
      chunks: N,
      workspaces: WORKSPACES,
      dim: DIM,
      queries: QUERIES,
      insertMs: Math.round(insertMs),
      hnswBuildMs: Math.round(hnswMs),
      ginBuildMs: Math.round(ginMs),
      tableSize: sizes.t,
      indexSize: sizes.i,
      ftsMs: summary(t.fts),
      vectorMs: summary(t.vec),
      hybridRrfMs: summary(t.hybrid),
      ftsHitsAvg: avg(ftsHits),
      vectorHitsAvg: avg(vecHits),
      vectorHitsMin: Math.min(...vecHits),
      vectorRecallAt50WithWorkspaceFilter: avg(recall),
      vectorEf1000Ms: summary(t.vec1000),
      vectorEf1000HitsAvg: avg(vec1000Hits),
      vectorEf1000Recall: avg(recall1000),
      exactVectorMs: summary(t.exact),
      hybridRrfExactVectorMs: summary(t.hybridExact),
      queriesWithResults: `${withResults}/${QUERIES}`,
      ftsFindsInflectedForms: `${morphologyOk}/${morphologyTotal}`,
      vectorPlanUsesHnsw: /embedding_idx/.test(plan),
      vectorPlan: plan.slice(0, 260),
    },
    null,
    2,
  ),
);
await db.end();
