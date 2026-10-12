export function Flame() {
  return (
    <svg viewBox="0 0 32 40" fill="none" aria-hidden="true">
      <path d="M18 2C19 13 30 15 29 25C28 33 23 38 15 38C7 38 2 32 3 24C4 17 10 14 11 8C15 11 15 16 15 16C19 12 18 2 18 2Z" fill="currentColor" />
      <path d="M17 21C18 26 22 27 21 31C20 35 16 36 13 34C9 32 11 28 13 26C13 30 17 29 17 21Z" fill="var(--flame-core)" />
    </svg>
  )
}

const paths = {
  server: 'M4 4h16v6H4z M4 14h16v6H4z M7 7h.01 M7 17h.01 M11 7h6 M11 17h6',
  shield: 'M12 3 3 7v5c0 5 9 9 9 9s9-4 9-9V7z M8 12l3 3 5-6',
  arrow: 'M4 12h16 M14 6l6 6-6 6',
  chevron: 'm9 6 6 6-6 6',
  globe: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0 M3 12h18 M12 3c-5 5-5 13 0 18 M12 3c5 5 5 13 0 18',
  code: 'm8 7-5 5 5 5 M16 7l5 5-5 5 M14 4l-4 16',
  home: 'm3 10 9-7 9 7 M5 9v12h5v-7h4v7h5V9',
  device: 'M3 4h18v13H3z M8 21h8 M12 17v4',
  plus: 'M12 5v14 M5 12h14',
  check: 'm5 12 4 4L19 6',
  alert: 'M12 3 2 21h20z M12 9v5 M12 17h.01',
  settings: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8 M9 3h6l1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1z',
  message: 'M4 4h16v13H8l-4 4z',
  users: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M9 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8 M20 21v-2a4 4 0 0 0-3-4 M16 3a4 4 0 0 1 0 8',
  search: 'M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14 M15 15l6 6',
  refresh: 'M20 8a8 8 0 1 0 1 7 M20 3v5h-5',
}

export function Icon({ name }: { name: keyof typeof paths }) {
  return (
    <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={paths[name]} />
    </svg>
  )
}
