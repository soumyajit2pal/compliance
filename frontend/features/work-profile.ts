import { esc, field, input, select } from '../ui/components.ts';
import { icon } from '../ui/icons.ts';

/** Profile confirmation uses the existing onboarding endpoint and employee department gate. */
export function workProfilePage(user, department, units, roles = []) {
  const verified = department?.status === 'VERIFIED';
  const readyAfterConfirmation = verified && roles.length > 0;
  const name = user.full_name || user.username;
  const initials = name.trim().split(/\s+/).slice(0, 2).map(part => [...part][0]).join('').toUpperCase();
  const current = department?.current || {};
  return `<section class="profile-setup" aria-labelledby="work-profile-title">
    <header class="profile-setup-heading">
      <p class="profile-setup-eyebrow">Account setup</p>
      <h1 id="work-profile-title">Confirm your work profile</h1>
      <p>Confirm your work email and Home organisation to continue setting up your access.</p>
    </header>
    <ol class="profile-setup-steps" aria-label="Account setup progress">
      <li aria-current="step"><span class="profile-step-number">1</span><span><strong>Your profile</strong><small>Complete your details</small></span></li>
      <li><span class="profile-step-number">2</span><span><strong>${readyAfterConfirmation ? 'Access checks' : 'Admin review'}</strong><small>${readyAfterConfirmation ? 'Already complete' : 'Department and role approval'}</small></span></li>
      <li><span class="profile-step-number">3</span><span><strong>Workspace</strong><small>Start with approved access</small></span></li>
    </ol>
    <div class="profile-setup-layout">
      <section class="profile-form-card" aria-labelledby="profile-form-title">
        <div class="profile-account">
          <span class="profile-account-avatar" aria-hidden="true">${esc(initials)}</span>
          <div><strong>${esc(name)}</strong><span>${esc(user.username)}</span></div>
          <span class="profile-signed-in">${icon('check')}Signed in${user.login_type === 'LDAP' ? ' with LDAP' : ''}</span>
        </div>
        <form id="onboard" class="profile-confirmation-form">
          <header><h2 id="profile-form-title">Complete your profile</h2><p>Both fields are required.</p></header>
          ${field('Work email', input('email', user.email || '', 'email', 'required autocomplete="email" maxlength="254" placeholder="Enter your work email"'),
            'Check or enter your bank work email address.')}
          ${field('Home organisation', select('org_unit_id', units, user.org_unit_id, 'name', 'required', 'Choose your department…'),
            'Choose your department in the portal. Roles and organisation scope are assigned separately.')}
          <div class="profile-next-step">${icon(readyAfterConfirmation ? 'checkSquare' : 'clock')}<div><strong>${readyAfterConfirmation ? 'Ready after confirmation' : 'What happens next'}</strong><p>${readyAfterConfirmation
            ? 'Your department and role checks are complete. Confirm your profile to open the workspace.'
            : verified
              ? 'Your approved department details are available. An administrator must complete any remaining role and access checks.'
              : 'Current LDAP/API employee details are sent automatically for administrator review when available. Confirming your profile does not approve a department or grant role access.'}</p></div></div>
          <p class="inline-error" id="form-error" role="alert" aria-live="polite"></p>
          <footer class="profile-form-actions">
            <button class="btn profile-sign-out" type="button" data-action="logout">Sign out</button>
            <button class="btn primary" type="submit">Confirm work profile${icon('arrow')}</button>
          </footer>
        </form>
      </section>
      ${department ? `<aside class="profile-directory-card" aria-labelledby="profile-directory-title">
        <header><span class="profile-directory-icon">${icon('org')}</span><div><h2 id="profile-directory-title">Your department details</h2><p>${department.managed?('LDAP department and employee API details'):'Retained historical directory details'}</p></div></header>
        <dl class="profile-directory-values">
          ${[['LDAP department code',current.ldap_department_code],['API department code',current.department_code],['API department name',current.department_name]].map(([label,value]) =>
            `<div><dt>${esc(label)}</dt><dd${label === 'Department code' || label === 'Info' ? ' class="profile-directory-code"' : ''}>${esc(value || 'Not returned')}</dd></div>`).join('')}
        </dl>
        <div class="profile-directory-status ${verified ? 'verified' : ''}">${icon(verified ? 'shield' : 'clock')}<div><strong>${verified ? 'Employee profile approved' : 'Awaiting verification'}</strong><p>${verified ? 'These are your approved department details.' : 'A complete LDAP/API employee profile needs independent approval before business access is enabled.'}</p></div></div>
        <p class="profile-directory-help">${icon('lock')}<span>Employee department details are read-only. If anything is incorrect, contact your administrator.</span></p>
      </aside>` : ''}
    </div>
  </section>`;
}
