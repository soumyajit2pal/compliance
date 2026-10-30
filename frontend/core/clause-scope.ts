import { selectSourceEdition } from './source-editions.ts';

/** Resolve browsing filters separately from the clause opened in the detail pane. */
export function selectClauseScope(instruments, editions, query: URLSearchParams, today: string) {
  const legacyVersion = !query.has('edition') ? query.get('version') : null;
  const legacyEdition = editions.find((edition) => edition.id === legacyVersion);
  const requestedInstrument = query.get('instrument') || legacyEdition?.instrument_id || 'all';
  const instrument = instruments.find((row) => row.id === requestedInstrument);
  const invalidInstrument = requestedInstrument !== 'all' && !instrument;
  const instrumentId = instrument?.id || 'all';
  const scopedEditions = editions.filter((row) => instrumentId === 'all' || row.instrument_id === instrumentId);
  const requestedEdition = query.get('edition') || legacyVersion || 'all';
  const specific = instrument && scopedEditions.find((row) => row.id === requestedEdition);
  const invalidEdition = !['all', 'current'].includes(requestedEdition) && !specific;
  const editionFilter = invalidEdition ? 'all' : requestedEdition;
  const byInstrument = new Map<string, any[]>();
  for (const edition of editions) {
    if (!byInstrument.has(edition.instrument_id)) byInstrument.set(edition.instrument_id, []);
    byInstrument.get(edition.instrument_id).push(edition);
  }
  const currentIds = new Set<string>();
  for (const row of instruments) {
    const effective = selectSourceEdition(byInstrument.get(row.id) || [], row.current_version_id, null, today).approvedEffective;
    if (effective) currentIds.add(effective.id);
  }
  const visibleEditions = scopedEditions.filter((row) => editionFilter === 'all' ||
    (editionFilter === 'current' ? currentIds.has(row.id) : row.id === editionFilter));
  return { instrument, instrumentId, editionFilter, scopedEditions, visibleEditions, currentIds,
    invalidInstrument, invalidEdition, specific: editionFilter === specific?.id ? specific : null };
}
