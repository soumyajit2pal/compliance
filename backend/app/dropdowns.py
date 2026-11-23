"""Published dropdown configuration and answers owned by the parent record transaction."""
import json
import re
from pathlib import Path
from typing import Annotated, Literal
import sqlalchemy as sa
from fastapi import Depends, HTTPException
from pydantic import Field, ValidationError
from . import models as m, master_data
from .business_dropdowns import BUSINESS_FIELDS
from .events import audit, new_id
from .schemas import Input

# Keep the original catalogue response fields available for older portal clients.
_built_in_uses = json.loads(Path(__file__).with_name('dropdown_catalogue.json').read_text())
BUSINESS_USES = {key: _built_in_uses[key] for key in BUSINESS_FIELDS}

Key = Annotated[str, Field(pattern=r'^[a-z][a-z0-9_]{0,39}$')]
Code = Annotated[str, Field(pattern=r'^[A-Z0-9][A-Z0-9_/-]{0,39}$')]
Label = Annotated[str, Field(min_length=1, max_length=160)]


class Choice(Input):
    code: Code
    label: Label
    active: bool = True


class ChoiceList(Input):
    label: Label
    options: list[Choice] = Field(min_length=1, max_length=500)


class CustomField(Input):
    label: Label
    form: str
    source: Key
    required: bool = False
    active: bool = True


class Presentation(Input):
    help: str = Field(default='', max_length=300)
    order: Literal['source', 'ascending', 'descending'] = 'source'
    aliases: dict[Annotated[str,Field(min_length=1,max_length=80)], Label] = Field(default_factory=dict,max_length=80)


class Change(Input):
    revision: int = Field(ge=1)
    kind: Literal['lists','fields','presentation']
    key: str = Field(min_length=1,max_length=80)
    value: dict
    reason: str = Field(min_length=5,max_length=1000)


def forms():
    return {'instrument':'Regulatory instrument', 'obligation':'Obligation', 'controls':'Check or procedure',
            'control-mappings':'Obligation link', 'action':'Compliance work assignment',
            **{'master.'+key: definition[0] for key, definition in master_data.DEFINITIONS.items() if key != 'role'}}


def configuration(db, lock=False):
    query = sa.select(m.dropdown_config).where(m.dropdown_config.c.id == 'portal')
    row = db.execute(query.with_for_update() if lock else query).mappings().one()
    return row['revision'], json.loads(row['definition'])


def configuration_revision(db):
    table = m.dropdown_config.c
    return db.execute(sa.select(table.revision).where(table.id == 'portal')).scalar_one()


def demo_presentation(db, configuration_reader=configuration):
    """The optional UAT sign-in picker also operates on pre-catalogue schemas."""
    try:
        return configuration_reader(db)[1]['presentation'].get('demo-user', {})
    except sa.exc.DBAPIError as exc:
        error = exc.orig.args[0] if exc.orig.args else None
        if getattr(error, 'code', None) == 942 or str(error) == 'no such table: cbd_dropdown_config':
            return {}
        raise


def reject(message):
    raise HTTPException(422, message)


def prepare(data, change):
    key, kind = change.key, change.kind
    old = data[kind].get(key)
    try:
        if kind != 'presentation' and (key=='constructor' or not re.fullmatch('[a-z][a-z0-9_]{0,39}', key)):
            reject('Use a permanent key starting with a lowercase letter.')
        schema = {'lists':ChoiceList,'fields':CustomField,'presentation':Presentation}[kind]
        value = schema.model_validate(change.value).model_dump()
    except ValidationError as exc:
        reject(' '.join(e['msg'] for e in exc.errors()))
    if kind == 'lists':
        codes = [option['code'] for option in value['options']]
        if len(codes) != len(set(codes)):
            reject('Each option must have a unique permanent code.')
        if old and set(o['code'] for o in old['options']) - set(codes):
            reject('Retire existing codes to preserve saved selections.')
        if not any(o['active'] for o in value['options']):
            reject('Keep at least one active option.')
    elif kind == 'fields':
        if value['form'] not in forms() or value['source'] not in data['lists']:
            reject('Choose a supported form and published choice list.')
        if value['active'] and sum(f['active'] and f['form']==value['form'] for k,f in data['fields'].items() if k!=key) >= 120:
            reject('This form already has 120 active fields.')
        if old and (value['form'], value['source']) != (old['form'], old['source']):
            reject('An existing field retains its original form and choice list.')
    elif key not in BUSINESS_FIELDS:
        reject('Choose a business dropdown from the catalogue.')
    if kind == 'presentation':
        # Keep previously published annotations for the original nature codes editable.
        allowed = BUSINESS_FIELDS[key].fixed or tuple(data['presentation'].get(key, {}).get('aliases', {}))
        if set(value['aliases']) - set(allowed):
            reject('Choose a listed value. Change business option names in Manage options.')
    return old, value


def change_config(db, actor, change, publish):
    actor.require({'ADMIN'})
    revision, data = configuration(db, lock=publish)
    if change.revision != revision:
        raise HTTPException(409,'Configuration changed. Refresh the catalogue and review your changes again.')
    old, new = prepare(data, change)
    if publish and old != new:
        data[change.kind][change.key] = new
        db.execute(m.dropdown_config.update().where(m.dropdown_config.c.id=='portal').values(
            revision=revision+1, definition=json.dumps(data)))
        audit(db, actor, 'dropdown_config', 'portal', 'DROPDOWN_PUBLISHED',
              old={'revision':revision,'value':old}, new={'revision':revision+1,'kind':change.kind,'key':change.key,'value':new},
              reason=change.reason)
        revision += 1
    return {'revision':revision,'previous':old,'proposed':new}


def read_answers(db, form, identifier):
    if not identifier: return {}
    t = m.dropdown_answer
    value = db.execute(sa.select(t.c.answers).where(t.c.form_key==form,t.c.record_id==identifier)).scalar_one_or_none()
    return json.loads(value) if value else {}


def validate_answers(config, form, submitted, retained=None, *, require_complete=True):
    definitions = {k:f for k,f in config['fields'].items() if f['form']==form}
    submitted = submitted or {}
    answers = dict(retained or {})
    if set(submitted) - set(definitions): reject('Unknown custom field on this form.')
    for key, field in definitions.items():
        previous = answers.get(key, {})
        if key in submitted:
            code = submitted[key]
            if not field['active']: reject('This field has been retired. Refresh the form.')
            if not code: answers.pop(key, None)
            elif code != previous.get('code'):
                option = next((o for o in config['lists'][field['source']]['options'] if o['code']==code and o['active']), None)
                if not option: reject('Choose an active option for '+field['label']+'.')
                answers[key] = {'code':code,'label':option['label'],'field_label':field['label']}
        if require_complete and field['active'] and field['required'] and key not in answers: reject('Choose a value for '+field['label']+'.')
    return answers


def save_answers(db, actor, form, identifier, submitted, reason=None, copy_from=None, *, require_complete=True):
    """Call only after the parent action has authorised the operation and locked or inserted its row."""
    _, config = configuration(db)
    if not submitted and not any(field['form']==form for field in config['fields'].values()): return
    original = read_answers(db, form, identifier)
    answers = validate_answers(config, form, submitted, read_answers(db, form, copy_from) if copy_from else original,
        require_complete=require_complete)
    if answers == original: return
    t = m.dropdown_answer
    params = dict(form_key=form,record_id=identifier)
    row = db.execute(sa.select(t.c.id).where(t.c.form_key==form,t.c.record_id==identifier)).scalar_one_or_none()
    if row: db.execute(t.update().where(t.c.id==row).values(answers=json.dumps(answers)))
    else: db.execute(t.insert().values(id=new_id(),**params,answers=json.dumps(answers)))
    audit(db,actor,form,identifier,'CUSTOM_FIELDS_SAVED',old=original,new=answers,reason=reason)


def install(app, get_db, current, configuration_reader=configuration):
    @app.get('/api/admin/dropdowns')
    def catalogue(db=Depends(get_db),actor=Depends(current)):
        actor.require({'ADMIN'})
        revision, data = configuration_reader(db)
        t=m.audit_log.c
        recent=[]
        for event in db.execute(sa.select(t.event_at,t.actor_name,t.reason,t.new_value).where(
                t.entity_type=='dropdown_config',t.entity_id=='portal',t.action=='DROPDOWN_PUBLISHED'
                ).order_by(t.event_at.desc(),t.id.desc()).limit(30)).mappings():
            item=json.loads(event['new_value'])
            key,kind=item['key'],item['kind']
            if kind=='presentation' and key not in BUSINESS_FIELDS:
                continue
            label=BUSINESS_FIELDS[key].label if kind=='presentation' else item['value']['label']
            recent.append({**{k:event[k] for k in ('event_at','actor_name','reason')},
                           'revision':item['revision'],'kind':kind,'key':key,'label':label})
        presentation={k:v for k,v in data['presentation'].items() if k in BUSINESS_FIELDS}
        return {'revision':revision,'lists':data['lists'],'fields':data['fields'],'presentation':presentation,
                'business_fields':{key:field._asdict() for key,field in BUSINESS_FIELDS.items()},
                'uses':BUSINESS_USES,
                'sources':{key:field.source for key,field in BUSINESS_FIELDS.items() if field.source},
                'codes':{key:field.fixed for key,field in BUSINESS_FIELDS.items() if field.fixed},
                'forms':forms(),'recent':recent}

    @app.post('/api/admin/dropdowns/preview')
    def preview(change:Change,db=Depends(get_db),actor=Depends(current)):
        return change_config(db,actor,change,False)

    @app.post('/api/admin/dropdowns/publish')
    def publish(change:Change,db=Depends(get_db),actor=Depends(current)):
        return change_config(db,actor,change,True)

    @app.get('/api/admin/masters/{key}/{identifier}/custom-fields')
    def master_answers(key:str,identifier:str,db=Depends(get_db),actor=Depends(current)):
        actor.require({'ADMIN'})
        if 'master.'+key not in forms(): reject('Unknown form.')
        from .repository import one
        one(db,getattr(m,key),identifier)
        return read_answers(db,'master.'+key,identifier)
