type IconProps = { title: string };

export function PencilIcon({ title }: IconProps) {
  return <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><title>{title}</title><path d="m4 16.5-.8 4.3 4.3-.8L18.7 8.8l-3.5-3.5L4 16.5Z"/><path d="m13.8 6.7 3.5 3.5"/></svg>;
}

export function TrashIcon({ title }: IconProps) {
  return <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><title>{title}</title><path d="M4 7h16M9 7V4h6v3m-9 0 1 13h10l1-13M10 11v5m4-5v5"/></svg>;
}
