export const isPendingEdition = (version) => ['DRAFT', 'IN_REVIEW', 'REVIEWED'].includes(version.approval_status);
export const sourceEditionStatus = (version) => version.cancelled_draft ? 'CANCELLED' : version.approval_status;

/** Pick a reading default without changing the instrument's current pointer. */
export function selectSourceEdition(versions, currentId, requestedId, today) {
  const ordered = [...versions].sort((a, b) =>
    String(b.effective_from || '').localeCompare(String(a.effective_from || '')) ||
    String(b.version_date || '').localeCompare(String(a.version_date || '')) ||
    String(b.version_number || '').localeCompare(String(a.version_number || ''), undefined, { numeric: true }) ||
    String(b.created_at || '').localeCompare(String(a.created_at || '')) || String(a.id).localeCompare(String(b.id)));
  const effective = (v) => v.approval_status === 'APPROVED' && v.effective_from &&
    v.effective_from.slice(0, 10) <= today && (!v.effective_to || v.effective_to.slice(0, 10) > today);
  const approved = ordered.filter((v) => v.approval_status === 'APPROVED');
  const current = ordered.find((v) => v.id === currentId && effective(v));
  const approvedEffective = current || ordered.find(effective);
  const drafts = ordered.filter((v) => v.approval_status === 'DRAFT');
  const pending = ordered.filter(isPendingEdition);
  const requested = ordered.find((v) => v.id === requestedId);
  return {
    selected: requested || approvedEffective || approved[0] || drafts[0] || ordered[0],
    approvedEffective, approved, drafts, pending,
    explicit: Boolean(requested), invalidRequest: Boolean(requestedId && !requested),
  };
}
