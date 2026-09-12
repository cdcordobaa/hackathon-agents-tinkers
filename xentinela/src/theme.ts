/**
 * Dark-first palette. Colour carries exactly one meaning in this app: risk.
 * Teal is the resting state, amber is a soft signal, red is a verdict — nothing
 * decorative is ever allowed to borrow those three.
 */
export const color = {
  bg: '#0A0E0D',
  surface: '#121817',
  surfaceAlt: '#1A2220',
  border: 'rgba(255,255,255,0.07)',
  borderStrong: 'rgba(255,255,255,0.16)',

  text: '#EDF2F0',
  textSecondary: '#97A5A1',
  textMuted: '#6A7874',

  // Soft lock: present, legible, inert. No badge, no lock glyph — just grey.
  muted: '#3F4B48',
  mutedSurface: 'rgba(255,255,255,0.03)',

  accent: '#3ED6A5',
  accentTint: 'rgba(62,214,165,0.13)',
  warning: '#F0B44C',
  warningTint: 'rgba(240,180,76,0.13)',
  danger: '#FF6F60',
  dangerTint: 'rgba(255,111,96,0.13)',

  telegram: '#4EA8DE',
} as const;

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;

export const radius = { sm: 8, md: 12, lg: 16, pill: 999 } as const;

export const type = {
  display: { fontSize: 28, fontWeight: '600' as const, letterSpacing: -0.4 },
  title: { fontSize: 20, fontWeight: '600' as const, letterSpacing: -0.2 },
  heading: { fontSize: 17, fontWeight: '600' as const },
  body: { fontSize: 15, fontWeight: '400' as const },
  bodyStrong: { fontSize: 15, fontWeight: '600' as const },
  label: { fontSize: 13, fontWeight: '400' as const },
  caption: { fontSize: 12, fontWeight: '400' as const },
  eyebrow: { fontSize: 11, fontWeight: '600' as const, letterSpacing: 1.2 },
} as const;

export const verdictColor = {
  safe: color.accent,
  flagged: color.warning,
  blocked: color.danger,
} as const;

export const verdictTint = {
  safe: color.accentTint,
  flagged: color.warningTint,
  blocked: color.dangerTint,
} as const;
