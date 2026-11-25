export const notificationRelationshipTypes = [
  {
    id: 'AMENDS', name: 'Amends',
    definition: 'The newer notification changes specific parts of the earlier notification. The rest continues to apply.',
    example: 'A circular changes the reporting deadline from 15 to 30 days and keeps the other reporting requirements.',
  },
  {
    id: 'CLARIFIES', name: 'Clarifies',
    definition: 'The newer notification explains how to read or apply an existing requirement.',
    example: 'A circular explains which transactions count towards an existing reporting threshold.',
  },
  {
    id: 'SUPERSEDES', name: 'Supersedes',
    definition: 'The newer notification replaces the earlier notification with a new set of requirements.',
    example: 'A new direction replaces the earlier direction with a complete revised reporting framework.',
  },
  {
    id: 'REPEALS', name: 'Repeals',
    definition: 'The newer notification formally withdraws the earlier notification.',
    example: 'A withdrawal notice ends the requirement to file the monthly return covered by the earlier circular.',
  },
];
