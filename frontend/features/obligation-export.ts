import { state } from '../core/state.ts';
import { canExportObligations as allowed } from '../ui/obligation-export.ts';
import { throwApiError } from '../core/api.ts';
import { obligationView } from '../core/obligation-workspace.ts';
import { dialog } from '../core/dom.ts';
import { esc, field, message } from '../ui/components.ts';
import { modal, close } from '../ui/dialog.ts';

const registerFilters = ['q','domain','department','status','criticality','owner','exception','instrument','clause','tab'];
const childFilters = ['q','department','assessment','legal_entity','assessment_approval','role','owner','assignment_approval','approval','response','mine','history','gap'];

export function obligationExportHandlers() {
  return {actions:{
    'obl-export':({id}) => {
      if (!allowed()) throw new Error('Your role does not permit obligation exports.');
      const [path,text=''] = location.hash.slice(1).split('?');
      if (id ? path !== 'obligations/'+id : path !== 'obligations') throw new Error('Open the obligation view before exporting.');
      const query = new URLSearchParams(text), view = id ? 'register' : obligationView(query);
      const filters = new URLSearchParams();
      if (!id) for (const key of view === 'register' ? registerFilters : childFilters) if (query.get(key)) filters.set(key,query.get(key));
      filters.set('view',view);
      if (id) filters.set('obligation_id',id);
      state.view.obligationExport = {hash:location.hash,userId:state.identity.user.id,query:filters.toString()};
      const scope = id ? 'This obligation revision' : (view==='register' ? query.get('tab')==='reports' ? 'Register · Exceptions' : 'Register · All obligations' : view==='applicability' ? 'Applicability' : 'Accountability');
      modal(id ? 'Export obligation' : 'Export obligations',
        `<div class="obligation-export-scope"><strong>${esc(scope)}</strong><p>${id?'Includes this revision and its recorded details.':'Includes all authorised records matching the applied filters, across every page. Apply any filter changes before exporting.'}</p></div>`+
        field('File format','<select name="format" aria-label="File format"><option value="xlsx" selected>Excel workbook (.xlsx)</option><option value="csv">CSV (.csv)</option></select>')+
        `<p class="field-hint">${view==='register'?'Excel includes grouped applicability and accountability reports, plus flat obligation, assessment, owner, source and process sheets. CSV contains the obligation register.':'Excel opens on a Grouped report with shared obligation details merged across separate '+(view==='applicability'?'assessment and unassessed-department':'owner and missing-owner')+' rows. A flat data sheet and CSV remain available for sorting and filtering.'}${view==='register'?' Repeated departments are merged within each obligation revision, with separate assessment and owner rows.':view==='applicability'?' Applicability also merges repeated departments, with one row per assessment.':' Accountability also merges repeated departments, with one row per owner.'} These are reporting files, not import templates.</p>`,
        'obl-export-form','Download');
    },
  },forms:{
    'obl-export-form':async (form:HTMLFormElement) => {
      const target = state.view.obligationExport;
      if (!target || !allowed() || target.hash !== location.hash || target.userId !== state.identity?.user.id) throw new Error('This obligation view changed. Close Export and open it again.');
      const format = (form.elements.namedItem('format') as HTMLSelectElement).value;
      if (!['xlsx','csv'].includes(format)) throw new Error('Choose Excel or CSV.');
      const query = new URLSearchParams(target.query);query.set('format',format);
      const controller = new AbortController(), cancel = () => controller.abort();
      dialog.addEventListener('close',cancel);window.addEventListener('hashchange',cancel);
      try {
        const path='/obligations/export?'+query;
        const response=await fetch('/api'+path,{signal:controller.signal,cache:'no-store'});
        if (!response.ok) {
          let data;try {data=await response.json();} catch {data={detail:'The export service returned an unexpected response.'};}
          throwApiError(response.status,data,path);
        }
        const expected=format==='xlsx'?'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':'text/csv';
        if (response.headers.get('Content-Type')?.split(';')[0]!==expected) throw new Error('The service did not return an export file. Please try again.');
        const filename=/filename="([A-Za-z0-9._-]+)"/.exec(response.headers.get('Content-Disposition')||'')?.[1];
        if (!filename || !filename.endsWith('.'+format)) throw new Error('The export filename is unavailable. Please try again.');
        const blob=await response.blob();
        if (!blob.size) throw new Error('The export file is empty. Please try again.');
        if (controller.signal.aborted || !dialog.open || target.hash!==location.hash || target.userId!==state.identity?.user.id) return;
        const url=URL.createObjectURL(blob), anchor=document.createElement('a');
        anchor.href=url;anchor.download=filename;document.body.append(anchor);anchor.click();anchor.remove();
        window.setTimeout(()=>URL.revokeObjectURL(url),1000);
        close();message('Export download started.');
      } catch (error) {
        if (controller.signal.aborted) return;
        throw error;
      } finally {
        dialog.removeEventListener('close',cancel);window.removeEventListener('hashchange',cancel);
      }
    },
  }};
}
