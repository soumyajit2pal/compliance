import { state } from '../core/state.ts';
import { esc, title, field, input, select, ref } from '../ui/components.ts';
import { modal, close } from '../ui/dialog.ts';
import { detailFields, note, table } from '../ui/widgets.ts';
import { canNavigate } from '../ui/layout.ts';
export function workspaceHandlers() {
  return {
    actions: {
      'print-guide': () => window.print(),
      'workspace-search': () => {
        const areas = [
          ['repository', 'Regulatory library'],
          ['tasks', 'My work'],
          ['users', 'Users & access'],
          ['masters', 'Master data'],
          ['help', 'Help & workflow guide'],
        ].filter(([id]) => canNavigate(id));
        modal(
          'Find something in your workspace',
          `<div class="form-grid">${field(
            'Look in',
            select(
              'area',
              areas.map(([id, name]) => ({ id, name })),
              areas[0]?.[0],
              'name',
              'required',
            ),
          )}${field('Search for', input('q', '', 'search', 'required placeholder="Title, official reference, name or keyword"'))}</div>`,
          'workspace-search',
          'Search',
          'Search only the records your role permits you to see.',
        );
      },
      profile: () =>
        modal(
          'My role & access',
          detailFields([
            ['Name', esc(state.identity.user.full_name)],
            ['Username', esc(state.identity.user.username)],
            ['Home organisation', esc(ref('organisational_unit', state.identity.user.org_unit_id))],
            ['Sign-in method', esc(title(state.identity.user.login_type))],
          ]) +
            `<div class="mt24">${table(
              ['Role', 'Authority applies to'],
              state.identity.grants.map((g) => [
                esc(title(g.role_code)),
                g.global_scope_flag
                  ? 'Global'
                  : esc(ref('organisational_unit', g.scope_org_unit_id)) +
                    ' and authorised descendants',
              ]),
              { summary: false },
            )}</div>` +
            `<div class="mt24">${note('Home department, role scope and named assignment work together. Admin alone cannot review or approve regulatory content.')}</div><div class="mt24"><a class="btn" href="#help?tab=roles" data-action="close">Read responsibilities</a></div>`,
          '',
          '',
          'Roles come from your approved account assignments.',
        ),
    },
    forms: {
      'workspace-search': async (form) => {
        const area = form.elements.area.value,
          q = form.elements.q.value;
        close();
        location.hash = area + '?q=' + encodeURIComponent(q);
      },
      'view-filter': async (form) => {
        const [path, qs = ''] = location.hash.slice(1).split('?');
        const q = new URLSearchParams(qs);
        for (const [key, value] of new FormData(form)) {
          if (typeof value === 'string' && value) q.set(key, value);
          else q.delete(key);
        }
        location.hash = path + '?' + q.toString();
      },
    },
  };
}
