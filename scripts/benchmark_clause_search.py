"""Measure first-page wording SQL with disposable local Oracle UAT data."""
import argparse
from concurrent.futures import ThreadPoolExecutor
import json
from math import ceil
from pathlib import Path
from statistics import median
import sys
from threading import Event
from time import perf_counter
from uuid import uuid4

import sqlalchemy as sa
from sqlalchemy.engine import make_url

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from backend.app.clause_search import wording_branches
from backend.app.config import load_settings


def page(table, query, *, indexed, phrase=False):
    columns = (table.c.heading, table.c.clause_text, table.c.internal_interpretation)
    scope = (table.c.instrument_version_id < 'V000001600', table.c.approval_status == 'APPROVED')
    base = sa.select(table.c.id).where(*scope)
    if indexed:
        candidates = sa.union_all(*wording_branches(base, columns, query, phrase=phrase))
        match = table.c.id.in_(candidates)
    else:
        match = sa.or_(*(sa.func.instr(sa.func.lower(column), query) > 0 for column in columns))
    return base.where(match).order_by(table.c.instrument_version_id, table.c.sequence_number, table.c.id).limit(26)


def samples(db, statement, repeats):
    timings = []
    rows = []
    for _ in range(repeats):
        start = perf_counter()
        rows = db.execute(statement).scalars().all()
        timings.append(1000 * (perf_counter() - start))
    return timings, rows


def summarize(timings):
    ordered = sorted(timings)
    return {'samples': len(timings), 'p50_ms': round(median(timings), 2),
            'p95_ms': round(ordered[ceil(len(ordered) * 0.95) - 1], 2)}


def benchmark(engine, count, repeats):
    tag = 'CQS_' + uuid4().hex[:10].upper()
    table = sa.table(tag, sa.column('id', sa.Integer), sa.column('code'), sa.column('instrument_version_id'),
                     sa.column('sequence_number'), sa.column('heading'), sa.column('approval_status'),
                     sa.column('clause_text'), sa.column('internal_interpretation'))
    built = False
    report = {'dataset': 'Isolated synthetic Oracle UAT table, 2,000 synthetic editions, 80% within query scope',
              'rows': count, 'cases': {}}
    try:
        print(f'Generating {count:,} synthetic paragraphs.', file=sys.stderr, flush=True)
        with engine.begin() as db:
            db.exec_driver_sql(f"""
CREATE TABLE {tag} AS
SELECT n AS id, 'QA-' || TO_CHAR(n) AS code,
       CAST('V' || LPAD(MOD(n, 2000), 9, '0') AS VARCHAR2(36)) AS instrument_version_id,
       TRUNC(n/2000) AS sequence_number,
       CAST('Control guidance for source ' || TO_CHAR(MOD(n, 173)) AS VARCHAR2(500)) AS heading,
       CAST(CASE WHEN MOD(n, 17) = 0 THEN 'DRAFT' ELSE 'APPROVED' END AS VARCHAR2(40)) AS approval_status,
       TO_CLOB(CASE WHEN MOD(n, 5003) = 0 THEN 'sealed exception attestation ' END ||
           RPAD(CASE MOD(n, 7)
               WHEN 0 THEN 'The branch shall verify customer identity before account opening. '
               WHEN 1 THEN 'The officer shall retain customer due diligence records for independent review. '
               WHEN 2 THEN 'Audit sampling shall document exceptions and corrective measures. '
               WHEN 3 THEN 'The operational unit shall review customer complaints and response times. '
               WHEN 4 THEN 'The treasury control shall document interest rate exposure and daily approvals. '
               WHEN 5 THEN 'Credit risk monitoring requires the authorised committee to review material changes. '
               ELSE 'The bank shall reconcile retained records and confirm the applicable approval. ' END,
               520 + MOD(n, 701), ' Evidence, dates, ownership, operational safeguards and reconciliation are required. ') ||
           ' ' || TO_CHAR(n)) AS clause_text,
       TO_CLOB(CASE WHEN MOD(n, 11) = 0 THEN 'Retained evidence review is required every quarter.'
                    WHEN MOD(n, 3) = 0 THEN 'Record the source edition and effective date in the tracking register.' END) AS internal_interpretation
FROM (SELECT LEVEL n FROM dual CONNECT BY LEVEL <= {count})
""")
            built = True
            db.exec_driver_sql(f'ALTER TABLE {tag} ADD PRIMARY KEY (id)')
            db.exec_driver_sql(f'CREATE INDEX {tag}_ED ON {tag} (instrument_version_id)')
        cases = {'common_keyword': ('customer', False), 'rare_phrase': ('sealed exception attestation', True),
                 'interpretation_phrase': ('retained evidence review', True), 'missing_term': ('zxnomatchq', False)}
        with engine.connect() as db:
            for name, (query, phrase) in cases.items():
                duration, rows = samples(db, page(table, query, indexed=False), repeats)
                report['cases'][name] = {'scan': summarize(duration), 'returned_rows': min(len(rows), 25)}
        print('Creating Oracle Text indexes on the synthetic table.', file=sys.stderr, flush=True)
        with engine.begin() as db:
            start = perf_counter()
            for suffix, column in [('H', 'heading'), ('W', 'clause_text'), ('I', 'internal_interpretation')]:
                db.exec_driver_sql(f"""CREATE INDEX {tag}_{suffix} ON {tag} ({column})
INDEXTYPE IS CTXSYS.CONTEXT FILTER BY instrument_version_id
PARAMETERS ('FILTER CTXSYS.NULL_FILTER STOPLIST CTXSYS.EMPTY_STOPLIST MAINTENANCE MANUAL SYNC (ON COMMIT) TRANSACTIONAL')""")
            report['index_build_seconds'] = round(perf_counter() - start, 2)
        with engine.connect() as db:
            for name, (query, phrase) in cases.items():
                statement = page(table, query, indexed=True, phrase=phrase)
                db.execute(statement).all()
                duration, rows = samples(db, statement, repeats)
                report['cases'][name]['indexed'] = summarize(duration)
                assert min(len(rows), 25) == report['cases'][name]['returned_rows'], name
                if name == 'rare_phrase':
                    sql = str(statement.compile(dialect=db.dialect, compile_kwargs={'literal_binds': True}))
                    db.exec_driver_sql(f"EXPLAIN PLAN SET STATEMENT_ID = '{tag}' FOR {sql}")
                    report['rare_phrase_domain_index_steps'] = db.execute(sa.text(
                        "SELECT COUNT(*) FROM plan_table WHERE statement_id=:tag AND operation='DOMAIN INDEX'"
                    ), {'tag': tag}).scalar_one()

        start_import = Event()
        importing = Event()
        reads_done = Event()

        def import_batches():
            start_import.wait()
            importing.set()
            windows = []
            while len(windows) < 4 or not reads_done.is_set():
                batch = len(windows)
                start = perf_counter()
                with engine.begin() as db:
                    db.exec_driver_sql(f"""INSERT INTO {tag}
SELECT :first_id + LEVEL, 'QA-IMPORT-' || LEVEL, 'V000000001', :first_id + LEVEL,
       'Imported provision', 'APPROVED', TO_CLOB('fresh import visibility marker'),
       TO_CLOB('initial imported interpretation')
FROM dual CONNECT BY LEVEL <= 250""", {'first_id': count + batch * 250})
                windows.append((start, perf_counter()))
                reads_done.wait(0.15)
            with engine.begin() as db:
                db.exec_driver_sql(f"""UPDATE {tag}
SET internal_interpretation=TO_CLOB('interpretation only freshness marker')
WHERE id=:id""", {'id': count + 1})
            return windows

        print('Measuring search while repeatedly importing 250-row batches.', file=sys.stderr, flush=True)
        with ThreadPoolExecutor(max_workers=1) as pool, engine.connect() as db:
            writer = pool.submit(import_batches)
            start_import.set()
            importing.wait()
            common = page(table, 'customer', indexed=True)
            reads = []
            try:
                for _ in range(repeats):
                    if writer.done():
                        writer.result()
                    start = perf_counter()
                    db.execute(common).all()
                    reads.append((start, perf_counter()))
            finally:
                reads_done.set()
            writes = writer.result()
            overlapping = [1000 * (end - start) for start, end in reads
                           if any(write_start < end and write_end > start for write_start, write_end in writes)]
            assert overlapping, 'Search did not overlap an import transaction.'
            report['concurrent_import'] = {
                'keyword': summarize(overlapping), 'total_searches': len(reads), 'rows_per_batch': 250,
                'insert_and_commit': summarize([1000 * (end - start) for start, end in writes]),
            }
            imported = db.execute(page(table, 'fresh import visibility marker', indexed=True, phrase=True)).scalars().all()
            edited = db.execute(page(table, 'interpretation only freshness marker', indexed=True, phrase=True)).scalars().all()
            assert imported and edited == [count + 1]
            report['freshness'] = {'import_visible_after_commit': True, 'interpretation_edit_visible_after_commit': True}
        return report
    finally:
        if built:
            with engine.begin() as db:
                db.exec_driver_sql(f'DROP TABLE {tag} PURGE')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--rows', type=int, default=500_000, metavar='1000–500000')
    parser.add_argument('--repeats', type=int, default=20, choices=range(3, 51), metavar='3–50')
    args = parser.parse_args()
    if not 1_000 <= args.rows <= 500_000:
        parser.error('--rows must be between 1,000 and 500,000.')
    settings = load_settings()
    url = make_url(settings.database_url)
    if settings.app_env != 'uat' or url.host not in {'localhost', '127.0.0.1', '::1'} or url.port != 1523 or url.query.get('service_name', '').upper() != 'FREEPDB1':
        raise RuntimeError('Use the local Oracle UAT profile on port 1523.')
    engine = sa.create_engine(settings.database_url, hide_parameters=True)
    try:
        print(json.dumps(benchmark(engine, args.rows, args.repeats), indent=2))
    finally:
        engine.dispose()


if __name__ == '__main__':
    main()
