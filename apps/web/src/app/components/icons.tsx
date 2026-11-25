/** Ícones de linha (24×24) usados no menu. */
const paths: Record<string, string> = {
  home: 'M3 11.5 12 4l9 7.5M5.5 10v9.5h5v-5h3v5h5V10',
  games: 'M6 9h12a3 3 0 0 1 3 3v3.5a2.5 2.5 0 0 1-4.6 1.4L15 15H9l-1.4 1.9A2.5 2.5 0 0 1 3 15.5V12a3 3 0 0 1 3-3Zm2 2.5v3m-1.5-1.5h3M15.5 12.5h.01M17.5 14h.01',
  overlay: 'M3 5h18v12H3zM8 21h8M12 17v4M14 8h4v4h-4z',
  link: 'M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1',
  test: 'M9 3h6M10 3v6l-5 9a2 2 0 0 0 1.7 3h10.6a2 2 0 0 0 1.7-3l-5-9V3M7.5 15h9',
  plan: 'M12 3 4 7v5c0 4.5 3.4 8.3 8 9 4.6-.7 8-4.5 8-9V7l-8-4Zm-3 9 2 2 4-4',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 9a7 7 0 0 1 14 0',
  loop: 'M17 2l4 4-4 4M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4M21 13v2a3 3 0 0 1-3 3H3',
  bolt: 'M13 2 4 14h7l-1 8 9-12h-7l1-8Z',
  logout: 'M15 4h4v16h-4M10 8l-4 4 4 4M6 12h11',
  arrow: 'M5 12h14M13 6l6 6-6 6',
};

export function Icon({ name, size = 20 }: { name: keyof typeof paths; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={paths[name]} />
    </svg>
  );
}
