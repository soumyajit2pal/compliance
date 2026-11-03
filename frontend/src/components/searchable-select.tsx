import { useLayoutEffect, useRef, type SelectHTMLAttributes } from 'react';
import { enhanceSelect } from '../../ui/searchable-select.ts';

/** React owns the wrapper/native field; the same controller also serves legacy dialogs. */
export function SearchableSelectField(props: SelectHTMLAttributes<HTMLSelectElement>) {
  const wrapper = useRef<HTMLSpanElement>(null);
  const select = useRef<HTMLSelectElement>(null);
  const controller = useRef<ReturnType<typeof enhanceSelect>>(null);
  useLayoutEffect(() => {
    const control = enhanceSelect(select.current, wrapper.current);
    controller.current = control;
    return () => control?.destroy();
  }, []);
  useLayoutEffect(() => { controller.current?.refresh(); }, [props.value, props.disabled]);
  return <span className={('searchable-select ' + (props.className || '')).trim()} ref={wrapper}>
    <select {...props} ref={select} />
  </span>;
}
