import { useLayoutEffect, useRef, type SelectHTMLAttributes } from 'react';
import { enhanceSelect } from '../../ui/searchable-select.ts';

/** React owns the wrapper/native field; the same controller also serves legacy dialogs. */
export function SearchableSelectField(props: SelectHTMLAttributes<HTMLSelectElement>) {
  const wrapper = useRef<HTMLSpanElement>(null);
  const select = useRef<HTMLSelectElement>(null);
  useLayoutEffect(() => {
    const control = enhanceSelect(select.current, wrapper.current);
    return () => control?.destroy();
  }, []);
  return <span className={('searchable-select ' + (props.className || '')).trim()} ref={wrapper}>
    <select {...props} ref={select} />
  </span>;
}
