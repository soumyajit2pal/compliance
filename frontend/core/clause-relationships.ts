export const clauseRelationshipTypes = [
  {
    id: 'AMENDS', name: 'Amends',
    definition: 'The newer clause changes part of the earlier clause.',
    example: 'Paragraph 4 changes paragraph 12’s reporting deadline from 15 to 30 days.',
  },
  {
    id: 'SUPERSEDES', name: 'Supersedes',
    definition: 'The newer clause replaces the earlier clause.',
    example: 'Paragraph 7 replaces the whole reporting process in paragraph 12 with a new process.',
  },
  {
    id: 'REFERS_TO', name: 'Refers to',
    definition: 'The newer clause cites the earlier clause.',
    example: 'Paragraph 6 uses the definition of customer in paragraph 2.',
  },
  {
    id: 'DEPENDS_ON', name: 'Depends on',
    definition: 'Applying the newer clause requires meeting a condition in the earlier clause.',
    example: 'Paragraph 9 requires the verification checks in paragraph 3 before opening an account.',
  },
  {
    id: 'REPEALS', name: 'Repeals',
    definition: 'The newer clause removes the earlier provision.',
    example: 'Paragraph 5 ends the monthly return requirement in paragraph 12.',
  },
];
