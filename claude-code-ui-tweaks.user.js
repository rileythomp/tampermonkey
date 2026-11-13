// ==UserScript==
// @name         Claude Code project – UI tweaks
// @namespace    riley.claude.tweaks
// @version      0.28
// @description  Personal UI changes for the Claude Code project page
// @match        https://claude.ai/code/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  // Contents of this file:
  //   Settings          values that you can change
  //   Shared selectors  for the artifacts-beside-prs tweak
  //   Theme values      colors and tokens for slack-theme
  //   Thread drag       CSS and code for thread-drag-sections
  //   Tweaks            the list of tweaks (id, enabled, css, init)
  //   Loader            adds the CSS and runs init() of each enabled tweak
  // Each tweak adds a <style id="tm-tweak-<id>">. Names that start with
  // "tm-" (classes, ids, data-tm-*, localStorage keys) belong to this script.

  // ---- Settings ---------------------------------------------------------
  // Names for the message headers (slack-messages tweak).
  const ME = 'Riley';
  const BOT = 'Claude';
  // Avatar picture for BOT (the Claude symbol, from Wikimedia Commons).
  // Set it to '' to show the first letter of BOT.
  const BOT_AVATAR =
    'https://upload.wikimedia.org/wikipedia/commons/thumb/b/b0/Claude_AI_symbol.svg/120px-Claude_AI_symbol.svg.png';
  // Avatar picture for ME (the GitHub profile picture).
  // Set it to '' to show the first letter of ME.
  const ME_AVATAR = 'https://avatars.githubusercontent.com/u/35535783?s=96&v=4';
  // true: no bold text. All text has the regular weight (no-bold tweak),
  // but the sender names of the messages stay bold.
  // false: headers and markdown bold are bold again.
  const NO_BOLD = true;
  // Section labels for the thread-drag-sections tweak, in display order.
  // These are the drop targets, together with the sections of the page
  // (the script also remembers each section that the page showed before).
  // The page does not show a section that has no threads; such a label
  // gets a header from the script when you move a thread into it.
  const THREAD_SECTIONS = [
    'Pinned',
    'Waiting on you',
    'Working',
    'Landing',
    'Ready for review',
    'Idle',
    'Resolved',
  ];
  // A section with moved threads shows this number of threads. "Show more"
  // shows the others. The page uses the same number.
  const THREAD_PAGE = 5;

  // ---- Shared selectors -------------------------------------------------
  // NOTE: do not put :has() inside :has(). CSS does not permit it, and the
  // browser then discards the full rule.
  // One line in a thread card ("nest item").
  const ITEM = '[class~="group/nest-item"]';
  // The artifacts chip: a small round link with a count.
  const CHIP = 'a.df-link-card.rounded-full.tabular-nums';
  // The block that holds the PR line and the chip line.
  // It matches only when a different item comes before the chip item.
  // Cards that have only the chip keep the initial layout.
  const BOX = `span.col-span-full.row-start-2.flex-col:has(> ${ITEM} + ${ITEM} > ${CHIP})`;
  // The item that holds the chip (use only outside :has()).
  const CHIP_ITEM = `${ITEM}:has(> ${CHIP})`;

  // ---- Theme values ------------------------------------------------------
  // The Claude UI gets its colors, fonts and radii from CSS variables
  // (--cds-* tokens, and the older --bg-*, --text-*, --brand-* HSL triplets).
  // The theme tweak sets these variables. It does not change the layout.
  // All colors of the theme are in CHROME_LIGHT, CHROME_DARK and COLORS,
  // and in the token maps SL_LIGHT and SL_DARK (message area). To make a
  // different theme, change these values.
  //
  // Current theme: Slack "Sea Glass". The values are from the Slack web
  // client (2026-11-13), for light mode and for dark mode.
  //   Sidebar and bars: CHROME_LIGHT, CHROME_DARK.
  //   Content: the standard Slack light and dark message area.
  const CHROME_LIGHT = {
    bg: '#f6fdfd', // sidebar
    hover: 'rgba(13, 106, 123, 0.13)', // row with the pointer on it
    active: '#611f69', // selected row
    activeText: '#f9edff',
    text: '#033640',
    text2: '#033640', // rows that are not selected (used at 80%)
    badge: '#83388a',
    frame: '#a9edef', // window frame of Slack, used for the top bars
    frameHsl: '182 69% 80%',
    frameText: '#033640',
  };
  const CHROME_DARK = {
    bg: '#0c2329',
    hover: 'rgba(248, 248, 248, 0.08)',
    active: '#7d3986',
    activeText: '#efe1f5',
    text: '#f8f8f8',
    text2: '#b2e3e4',
    badge: '#7d3986',
    frame: '#053c48',
    frameHsl: '191 87% 15%',
    frameText: '#f8f8f8',
  };
  const COLORS = {
    // Brand color (in place of the Claude clay color), light and dark mode.
    brand: '#611f69',
    brandHsl: '294 54% 27%',
    brandHover: '#83388a',
    brandHoverHsl: '295 42% 38%',
    brandDark: '#7d3986',
    brandDarkHsl: '293 40% 37%',
    brandDarkHover: '#bc80ce',
    brandDarkHoverHsl: '286 44% 65%',
    green: '#007a5a', // primary button
    greenHover: '#148567',
    link: '#1264a3',
    linkHover: '#0b4c8c',
    linkDark: '#1d9bd1',
    red: '#e01e5a',
    redHover: '#c41a4f',
    yellow: '#ecb22e',
    ink: (a) => `rgba(29, 28, 29, ${a})`, // light mode text #1d1c1d
    inkInv: (a) => `rgba(209, 210, 211, ${a})`, // dark mode text #d1d2d3
    // Inline code in dark mode.
    codeDark: '#e8912d',
    codeDarkInk: (a) => `rgba(232, 232, 232, ${a})`,
    // Background of the drag picture if the page gives no color.
    fallbackBg: '#1a1d21',
    // Avatar squares of the messages.
    avatarText: '#f9edff',
    avatarMe: '#611f69',
    avatarBot: '#0d6a7b',
    avatarBotImageBg: '#f0eee6',
  };
  // Some components read a second set of tokens (--cds-fizzy-lake-color-*)
  // and --muted-as-secondary. This function gives them the same colors.
  const layer2 = (c) => ({
    '--muted-as-secondary': c.secondary,
    '--cds-fizzy-lake-color-secondary': c.secondary,
    '--cds-fizzy-lake-color-plain-secondary': c.secondary,
    '--cds-fizzy-lake-color-plain-muted': c.muted,
    '--cds-fizzy-lake-color-solid-primary': c.primary,
    '--cds-fizzy-lake-color-solid-secondary': c.secondary,
    '--cds-fizzy-lake-color-solid-muted': c.muted,
    '--cds-fizzy-lake-color-control-ink': c.primary,
    '--cds-fizzy-lake-color-placeholder': c.muted,
    '--cds-fizzy-lake-color-icon-only-disabled': c.muted,
    '--cds-fizzy-lake-color-card-hover': c.hover,
    '--cds-fizzy-lake-color-selected-hover': c.selected,
    '--cds-fizzy-lake-color-composer-ring': c.line,
    '--cds-fizzy-lake-color-sidebar': c.sidebar,
    '--cds-segmented-control-track': c.hover,
    '--cds-segmented-control-thumb': c.thumb,
  });
  const mix = (c, pct) => `color-mix(in srgb, ${c} ${pct}%, transparent)`;
  const FONT = 'Lato, "Helvetica Neue", Helvetica, Arial, system-ui, sans-serif';

  // Tokens that are the same in light and dark mode.
  const SL_COMMON = {
    // Fonts. Slack uses Lato. Lato has only weights 400, 700 and 900.
    '--cds-font-sans': FONT,
    '--cds-font-sans-display': FONT,
    '--cds-font-voice': FONT,
    '--cds-font-weight-control': '700',
    '--cds-font-weight-header': '900',
    '--cds-font-weight-semibold': '700',
    '--cds-font-weight-bold': '900',
    // Radii: Slack uses 4px to 8px.
    '--cds-radius': '0.5rem',
    '--cds-radius--lg': '0.5rem',
    '--cds-radius--sm': '0.375rem',
    '--cds-radius--xs': '0.25rem',
    '--cds-radius-composer': '0.5rem',
    // Brand: the theme color in place of the Claude clay color.
    '--cds-fill-brand': COLORS.brand,
    '--cds-fill-brand-hover': COLORS.brandHover,
    '--cds-on-brand': '#fff',
    '--accent-brand': COLORS.brandHsl,
    '--brand-000': COLORS.brandHsl,
    '--brand-100': COLORS.brandHsl,
    '--brand-200': COLORS.brandHoverHsl,
    '--cds-hsl-clay': COLORS.brandHoverHsl,
    '--cds-hsl-clay-emphasized': COLORS.brandHsl,
    // Primary buttons: the Slack green button.
    '--cds-fill-primary': COLORS.green,
    '--cds-fill-primary-hover': COLORS.greenHover,
    '--cds-on-primary': '#fff',
    // Accent: the Slack link blue.
    '--cds-fill-accent': COLORS.link,
    '--cds-fill-accent-hover': COLORS.linkHover,
    '--cds-on-accent': '#fff',
    '--cds-role-accent-450': COLORS.link,
    '--cds-role-accent-fill': COLORS.link,
    '--cds-role-accent-fill-hover': COLORS.linkHover,
    '--cds-role-accent-on': '#fff',
    // Status colors
    '--cds-fill-danger': COLORS.red,
    '--cds-fill-danger-hover': COLORS.redHover,
    '--cds-role-danger-450': COLORS.red,
    '--cds-role-danger-fill': COLORS.red,
    '--cds-role-danger-fill-hover': COLORS.redHover,
    '--cds-fill-success': COLORS.green,
    '--cds-fill-success-hover': COLORS.greenHover,
    '--cds-role-success-450': COLORS.green,
    '--cds-role-success-fill': COLORS.green,
    '--cds-role-success-fill-hover': COLORS.greenHover,
    '--cds-role-success-on': '#fff',
    '--cds-fill-warning': COLORS.yellow,
    '--cds-role-warning-fill': COLORS.yellow,
  };

  const SL_LIGHT = {
    ...layer2({
      primary: '#1d1c1d',
      secondary: '#616061',
      muted: '#868686',
      hover: COLORS.ink(0.06),
      selected: COLORS.ink(0.13),
      line: COLORS.ink(0.3),
      sidebar: CHROME_LIGHT.bg,
      thumb: '#fff',
    }),
    '--cds-page-bg': '#fff',
    '--cds-surface-0': '#f8f8f8',
    '--cds-surface-1': '#fff',
    '--cds-surface-2': '#fff',
    '--cds-surface-3': '#fff',
    '--cds-surface-panel': '#fff',
    '--cds-surface-popover': '#fff',
    '--cds-text-primary': '#1d1c1d',
    '--cds-text-secondary': '#616061',
    '--cds-text-stays-secondary': '#616061',
    '--cds-text-muted': COLORS.ink(0.5),
    '--cds-text-disabled': COLORS.ink(0.3),
    '--cds-text-accent': COLORS.link,
    '--cds-text-user-message-personal': COLORS.link,
    '--cds-text-danger': COLORS.red,
    '--cds-text-success': COLORS.green,
    '--cds-border': COLORS.ink(0.1),
    '--cds-border-line': COLORS.ink(0.13),
    '--cds-border-line-muted': COLORS.ink(0.1),
    '--cds-border-strong': COLORS.ink(0.3),
    '--cds-border-stronger': COLORS.ink(0.5),
    '--cds-border-accent': mix(COLORS.link, 40),
    '--cds-ring-color': COLORS.ink(0.13),
    '--cds-bg-accent': mix(COLORS.linkDark, 12),
    '--cds-bg-accent-layer': mix(COLORS.linkDark, 6),
    '--cds-bg-accent-muted': mix(COLORS.linkDark, 10),
    '--cds-bg-neutral': COLORS.ink(0.04),
    '--cds-bg-neutral-hover': COLORS.ink(0.08),
    '--cds-bg-user-message': COLORS.ink(0.04),
    '--cds-bg-user-message-personal': mix(COLORS.linkDark, 10),
    '--cds-bg-danger': mix(COLORS.red, 10),
    '--cds-bg-success': mix(COLORS.green, 12),
    '--cds-bg-warning': mix(COLORS.yellow, 16),
    '--cds-fill-card': COLORS.ink(0.03),
    '--cds-fill-card-hover': COLORS.ink(0.06),
    '--cds-fill-ghost-hover': COLORS.ink(0.06),
    '--cds-fill-ghost-selected': COLORS.ink(0.1),
    '--cds-fill-secondary': COLORS.ink(0.04),
    '--cds-fill-secondary-hover': COLORS.ink(0.08),
    '--cds-fill-control': COLORS.ink(0.1),
    '--cds-fill-control-hover': COLORS.ink(0.2),
    '--cds-fill-field': '#fff',
    '--cds-fill-field-ring': COLORS.ink(0.3),
    '--cds-focus-shadow': `0 0 0 1px ${COLORS.link}, 0 0 0 4px ${mix(COLORS.linkDark, 30)}`,
    '--cds-shadow-sm': '0 1px 3px 0 rgba(0, 0, 0, 0.08)',
    '--cds-shadow-md': '0 4px 12px 0 rgba(0, 0, 0, 0.12)',
    '--cds-shadow-lg': '0 0 0 1px rgba(29, 28, 29, 0.13), 0 18px 48px 0 rgba(0, 0, 0, 0.35)',
    '--cds-shadow-popover': '0 0 0 1px rgba(29, 28, 29, 0.13), 0 4px 12px 0 rgba(0, 0, 0, 0.12)',
    '--cds-role-tooltip-bg': '#1d1c1d',
    // Older HSL triplets (used as hsl(var(--x) / alpha))
    '--accent-000': '206 80% 30%',
    '--accent-100': '206 80% 35%',
    '--accent-200': '206 80% 35%',
    '--accent-900': '198 76% 90%',
    '--bg-000': '0 0% 100%',
    '--bg-100': '0 0% 97%',
    '--bg-200': '0 0% 95%',
    '--bg-300': '0 0% 93%',
    '--bg-400': '0 0% 90%',
    '--bg-500': '0 0% 90%',
    '--text-000': '300 2% 11%',
    '--text-100': '300 2% 11%',
    '--text-200': '300 1% 38%',
    '--text-300': '300 1% 38%',
    '--text-400': '300 1% 48%',
    '--text-500': '300 1% 48%',
    '--border-100': '300 2% 11%',
    '--border-200': '300 2% 11%',
    '--border-300': '300 2% 11%',
    '--border-400': '300 2% 11%',
  };

  const SL_DARK = {
    '--cds-fill-brand': COLORS.brandDark,
    '--cds-fill-brand-hover': COLORS.brandDarkHover,
    '--accent-brand': COLORS.brandDarkHsl,
    '--brand-000': COLORS.brandDarkHsl,
    '--brand-100': COLORS.brandDarkHsl,
    '--brand-200': COLORS.brandDarkHoverHsl,
    '--cds-hsl-clay': COLORS.brandDarkHoverHsl,
    '--cds-hsl-clay-emphasized': COLORS.brandDarkHsl,
    ...layer2({
      primary: '#d1d2d3',
      secondary: '#ababad',
      muted: '#868889',
      hover: COLORS.inkInv(0.06),
      selected: COLORS.inkInv(0.13),
      line: COLORS.inkInv(0.3),
      sidebar: CHROME_DARK.bg,
      thumb: '#35373b',
    }),
    '--cds-page-bg': '#1a1d21',
    '--cds-surface-0': '#121416',
    '--cds-surface-1': '#1a1d21',
    '--cds-surface-2': '#222529',
    '--cds-surface-3': '#222529',
    '--cds-surface-panel': '#222529',
    '--cds-surface-popover': '#222529',
    '--cds-text-primary': '#d1d2d3',
    '--cds-text-secondary': '#ababad',
    '--cds-text-stays-secondary': '#ababad',
    '--cds-text-muted': COLORS.inkInv(0.5),
    '--cds-text-disabled': COLORS.inkInv(0.3),
    '--cds-text-accent': COLORS.linkDark,
    '--cds-text-user-message-personal': COLORS.linkDark,
    '--cds-text-danger': '#e96379',
    '--cds-text-success': '#2bac76',
    '--cds-text-warning': COLORS.yellow,
    '--cds-border': COLORS.inkInv(0.1),
    '--cds-border-line': COLORS.inkInv(0.13),
    '--cds-border-line-muted': COLORS.inkInv(0.1),
    '--cds-border-strong': COLORS.inkInv(0.3),
    '--cds-border-stronger': COLORS.inkInv(0.5),
    '--cds-border-accent': mix(COLORS.linkDark, 50),
    '--cds-ring-color': COLORS.inkInv(0.13),
    '--cds-bg-accent': mix(COLORS.linkDark, 20),
    '--cds-bg-accent-layer': mix(COLORS.linkDark, 10),
    '--cds-bg-accent-muted': mix(COLORS.linkDark, 15),
    '--cds-bg-neutral': COLORS.inkInv(0.04),
    '--cds-bg-neutral-hover': COLORS.inkInv(0.08),
    '--cds-bg-user-message': COLORS.inkInv(0.06),
    '--cds-bg-user-message-personal': mix(COLORS.linkDark, 15),
    '--cds-bg-danger': mix(COLORS.red, 20),
    '--cds-bg-success': mix(COLORS.green, 25),
    '--cds-bg-warning': mix(COLORS.yellow, 20),
    '--cds-fill-card': COLORS.inkInv(0.03),
    '--cds-fill-card-hover': COLORS.inkInv(0.06),
    '--cds-fill-ghost-hover': COLORS.inkInv(0.06),
    '--cds-fill-ghost-selected': COLORS.inkInv(0.1),
    '--cds-fill-secondary': COLORS.inkInv(0.06),
    '--cds-fill-secondary-hover': COLORS.inkInv(0.1),
    '--cds-fill-control': COLORS.inkInv(0.1),
    '--cds-fill-control-hover': COLORS.inkInv(0.2),
    '--cds-fill-field': '#222529',
    '--cds-fill-field-ring': COLORS.inkInv(0.3),
    '--cds-fill-accent': COLORS.linkDark,
    '--cds-role-accent-450': COLORS.linkDark,
    '--cds-role-accent-fill': COLORS.linkDark,
    '--cds-focus-shadow': `0 0 0 1px ${COLORS.linkDark}, 0 0 0 4px ${mix(COLORS.linkDark, 30)}`,
    '--cds-shadow-sm': '0 1px 3px 0 rgba(0, 0, 0, 0.3)',
    '--cds-shadow-md': '0 4px 12px 0 rgba(0, 0, 0, 0.36)',
    '--cds-shadow-lg': '0 0 0 1px rgba(209, 210, 211, 0.13), 0 18px 48px 0 rgba(0, 0, 0, 0.75)',
    '--cds-shadow-popover': '0 0 0 1px rgba(209, 210, 211, 0.13), 0 4px 12px 0 rgba(0, 0, 0, 0.36)',
    '--cds-role-tooltip-bg': '#000',
    '--accent-000': '198 76% 60%',
    '--accent-100': '198 76% 47%',
    '--accent-200': '198 76% 47%',
    '--accent-900': '206 80% 25%',
    '--bg-000': '214 12% 12%',
    '--bg-100': '214 10% 9%',
    '--bg-200': '214 10% 7%',
    '--bg-300': '214 10% 6%',
    '--bg-400': '214 10% 5%',
    '--bg-500': '214 10% 5%',
    '--text-000': '210 2% 82%',
    '--text-100': '210 2% 82%',
    '--text-200': '240 1% 67%',
    '--text-300': '240 1% 67%',
    '--text-400': '240 1% 55%',
    '--text-500': '240 1% 55%',
    '--border-100': '210 2% 82%',
    '--border-200': '210 2% 82%',
    '--border-300': '210 2% 82%',
    '--border-400': '210 2% 82%',
  };

  // Tokens for the left sidebar, from one set of chrome colors.
  const sidebarVars = (h) => ({
    ...layer2({
      primary: h.text,
      secondary: mix(h.text2, 80),
      muted: mix(h.text2, 60),
      hover: h.hover,
      selected: h.active,
      line: mix(h.text, 30),
      sidebar: h.bg,
      thumb: mix(h.text, 20),
    }),
    '--df-sidebar-bg': h.bg,
    '--df-web-sidebar-bg': h.bg,
    '--df-hover': h.hover,
    '--df-selected': h.active,
    '--df-sidebar-icon-rest': mix(h.text2, 75),
    '--cds-page-bg': h.bg,
    '--cds-surface-0': h.bg,
    '--cds-surface-1': h.bg,
    '--cds-text-primary': h.text,
    '--cds-text-secondary': mix(h.text2, 80),
    '--cds-text-stays-secondary': mix(h.text2, 80),
    '--cds-text-muted': mix(h.text2, 60),
    '--cds-text-disabled': mix(h.text2, 40),
    '--cds-text-accent': h.text,
    '--cds-border': mix(h.text, 10),
    '--cds-border-line': mix(h.text, 13),
    '--cds-border-line-muted': mix(h.text, 10),
    '--cds-border-strong': mix(h.text, 30),
    '--cds-ring-color': mix(h.text, 13),
    '--cds-fill-ghost-hover': h.hover,
    '--cds-fill-ghost-selected': h.active,
    '--cds-fill-card': mix(h.text, 5),
    '--cds-fill-card-hover': h.hover,
    '--cds-fill-secondary': mix(h.text, 10),
    '--cds-fill-secondary-hover': mix(h.text, 16),
    '--cds-fill-control': mix(h.text, 13),
    '--cds-fill-control-hover': mix(h.text, 22),
    '--cds-bg-neutral': mix(h.text, 8),
    '--cds-bg-neutral-hover': mix(h.text, 14),
    '--cds-fill-danger': h.badge,
    '--cds-role-danger-fill': h.badge,
  });

  // Tokens for the selected row of the sidebar: text on the active color.
  const selectedVars = (h) => ({
    ...layer2({
      primary: h.activeText,
      secondary: mix(h.activeText, 80),
      muted: mix(h.activeText, 60),
      hover: h.active,
      selected: h.active,
      line: mix(h.activeText, 30),
      sidebar: h.bg,
      thumb: mix(h.activeText, 20),
    }),
    '--df-hover': h.active,
    '--df-sidebar-icon-rest': h.activeText,
    '--cds-text-primary': h.activeText,
    '--cds-text-secondary': mix(h.activeText, 80),
    '--cds-text-stays-secondary': mix(h.activeText, 80),
    '--cds-text-muted': mix(h.activeText, 60),
    '--cds-text-accent': h.activeText,
  });

  // Tokens for the bars at the top of the two panes. Slack colors its
  // window frame with the theme, so the bars use the sidebar tokens on
  // the frame color.
  const barVars = (h) => ({
    ...sidebarVars({
      ...h,
      bg: h.frame,
      text: h.frameText,
      text2: h.frameText,
      hover: mix(h.frameText, 12),
      active: mix(h.frameText, 20),
    }),
    '--cds-surface-2': h.frame,
    '--cds-surface-3': h.frame,
    '--cds-surface-panel': h.frame,
    '--bg-000': h.frameHsl,
    '--bg-100': h.frameHsl,
  });

  const decls = (vars) =>
    Object.entries(vars)
      .map(([k, v]) => `  ${k}: ${v} !important;`)
      .join('\n');

  // The UI root has class .cds-root (on <html>, and on many inner scopes).
  // Each one has data-mode="light|dark|system" for the color mode.
  // :not(#tm-x) only makes a selector stronger. More copies = stronger:
  // light 1, dark 2, sidebar light 3, sidebar dark 4, selected row 5 and 6.
  const strong = (n) => ':not(#tm-x)'.repeat(n);
  const inMode = (m) => `:is([data-mode="${m}"], [data-mode="${m}"] *):not([data-mode="light"])`;
  const ROOT = `.cds-root${strong(1)}`;
  const DARK_ROOT = `.cds-root${inMode('dark')}${strong(2)},
.cds-dark-scope[data-mode="dark"]${strong(2)}`;
  const SYSTEM_ROOT = `.cds-root${inMode('system')}${strong(2)}`;
  // The left sidebar, and the .cds-root scopes in it.
  const SIDEBAR = 'aside.dframe-sidebar';
  const sidebarSel = (pre, n) =>
    `${pre}${SIDEBAR}${strong(n)},\n${pre}${SIDEBAR} .cds-root${strong(n)}`;
  // The selected row of the sidebar.
  const SELECTED = `${SIDEBAR} [data-row][data-selected]`;
  const selectedSel = (pre, n) => `${pre}${SELECTED}${strong(n)}`;
  // The bar at the top of the coordinator pane and of the threads pane.
  const BARS = ['.epitaxy-titlebar', '[data-pane-corner-row]'];
  const barSel = (pre, n) =>
    BARS.map((b) => `${pre}${b}${strong(n)},\n${pre}${b} .cds-root${strong(n)}`).join(',\n');

  // Messages. Each row of a transcript has data-perf-row="human" or
  // "assistant". [data-row-chrome] is the box of one message in the row.
  const HUMAN = '[data-perf-row="human"]';
  const ASSISTANT = '[data-perf-row="assistant"]';
  const MSG = '[data-row-chrome]';
  // The page also has empty assistant rows (no message box in them).
  const EMPTY = `${ASSISTANT}:not(:has(${MSG}))`;
  // An assistant row that comes after a different assistant message (an
  // empty row can be between them). It shows no avatar and no name.
  const BOT_NEXT = `:is(${ASSISTANT}:has(${MSG}) + ${ASSISTANT}, ${ASSISTANT}:has(${MSG}) + ${EMPTY} + ${ASSISTANT})`;
  // A row where the sender changes.
  const SENDER_CHANGE = [
    `${HUMAN} + ${ASSISTANT}`,
    `${ASSISTANT} + ${HUMAN}`,
    `${HUMAN} + ${EMPTY} + ${ASSISTANT}`,
  ];
  // The column that holds the message content (1 or 2 levels down).
  const nameSel = (row) =>
    `${row} ${MSG} > .flex-col::before, ${row} ${MSG} > div > .flex-col::before`;
  // The column itself (the name is its ::before).
  const colSel = (row) => `${row} ${MSG} > .flex-col, ${row} ${MSG} > div > .flex-col`;
  // The time of a message. The page shows it below the first block of the
  // message, and only on hover. Not all messages have one.
  const TIME = '[data-floating-time]';
  // In the coordinator pane, your messages have a different time element:
  // a line below the message that holds only the time.
  const TIME_LINE = '[data-hover-line][data-solo-line]';
  const cssStr = (t) => `'${String(t).replace(/['\\]/g, '\\$&')}'`;

  // ---- Thread drag (the thread-drag-sections tweak) -----------------------
  // Drag a thread card to a different section of the Threads page.
  // The move is only visual and only in this browser (localStorage): the
  // real state of the thread does not change.
  //
  // How it works:
  // - The script does not move the cards of the page (React owns them).
  //   For each moved thread it hides the real card with CSS and shows a
  //   copy of the card at the top of the target section.
  // - The copy is kept in localStorage. Thus it stays when the page removes
  //   the real card (the page removes the cards of a collapsed section and
  //   the cards below "Show more").
  // - The counts in the headers come from the saved moves, not from the
  //   cards that are on the page.
  // - In a section with moves, the script clicks "Show more" of the page
  //   and applies its own limit (THREAD_PAGE) and its own "Show more".
  // - All output is made again by render() after each change of the page.
  const THREAD_DRAG_CSS = `
.tm-dnd-head {
  grid-column: 1 / -1;
  margin: 6px 0 0 -20px;
  padding: 6px 0 2px;
  font-size: 14px;
  line-height: 20px;
  color: var(--cds-text-secondary);
  cursor: pointer;
  user-select: none;
}
.tm-dnd-in {
  grid-column: 1 / -1;
}
.tm-dnd-in [data-tm-card] {
  cursor: pointer;
}
[data-tm-card]:hover {
  background: var(--cds-bg-neutral);
}
/* The picture below the pointer during the drag of a copy. */
.tm-dnd-ghost {
  position: fixed;
  top: -2000px;
  left: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  column-gap: 8px;
  padding: 4px 8px 4px 40px;
  border-radius: 8px;
  background: var(--cds-surface-0, ${COLORS.fallbackBg});
  color: var(--cds-text-primary);
  pointer-events: none;
}
.tm-dnd-ghost > * {
  grid-column: 1 / -1;
}
/* A copy whose real card is not on the page: its menu cannot open. */
[data-tm-card].tm-stale button {
  display: none !important;
}
.tm-dnd-more {
  grid-column: 1 / -1;
  display: flex;
  justify-content: center;
  padding-top: 4px;
}
.tm-dnd-more button {
  all: unset;
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 6px;
  font-size: 12px;
  color: var(--cds-text-secondary);
}
.tm-dnd-more button:hover {
  background: var(--cds-bg-neutral);
  color: var(--cds-text-primary);
}
.tm-dnd-reset {
  grid-column: 1 / -1;
  order: 999999;
  margin-top: 12px;
  font-size: 12px;
  color: var(--cds-text-muted);
}
.tm-dnd-reset button {
  all: unset;
  cursor: pointer;
  text-decoration: underline;
  color: var(--cds-text-accent);
}
/* The bar with the drop targets. It shows only during a drag. */
.tm-dnd-bar {
  position: fixed;
  z-index: 99999;
  display: none;
  flex-wrap: wrap;
  gap: 8px;
  padding: 10px;
  border-radius: 8px;
  background: var(--cds-surface-popover);
  box-shadow: var(--cds-shadow-lg);
  font-size: 13px;
  color: var(--cds-text-primary);
}
.tm-dnd-bar.on {
  display: flex;
}
.tm-dnd-chip {
  padding: 6px 12px;
  border-radius: 6px;
  border: 1px dashed var(--cds-border-stronger);
}
.tm-dnd-chip.over {
  border-style: solid;
  border-color: ${CHROME_LIGHT.active};
  background: ${CHROME_LIGHT.active};
  color: ${CHROME_LIGHT.activeText};
}
`;

  function initThreadDrag() {
    // localStorage keys.
    //   moves:  { thread id: { to, home, proj, html } }
    //             to:   label of the section that shows the thread
    //             home: label of the real section of the thread
    //             proj: project id
    //             html: copy of the card
    //           Versions before 0.14 kept only { thread id: label }.
    //   folded: labels of the collapsed headers that the script added
    //   ui:     { dropClass, labels }, see dropClass and seenLabels below
    const KEYS = {
      moves: 'tm-thread-sections',
      folded: 'tm-thread-sections-folded',
      ui: 'tm-thread-sections-ui',
    };
    // Hooks in the DOM of the Threads page.
    const SEL = {
      section: '[data-home-section]', // one section; the parent is the grid
      card: '[data-home-card]', // one thread card; the value is the thread id
      copy: '[data-tm-card]', // a copy of a card, made by the script
      drop: '[data-home-drop]', // the element that holds the cards
      folded: 'h4 [aria-expanded="false"]', // header button of a collapsed section
      count: 'h4 button > span > span', // header parts; one is the number
      pageMore: '[data-home-group] > div:not(:first-child) > button[aria-controls]',
      menuOpen: '[data-home-card] [aria-expanded="true"]',
    };
    const RESET = '\u0000reset'; // drop target "Real section (reset)"
    const SAFE = /^[\w-]+$/; // ids and keys that are safe in a CSS selector

    // ---- Storage ----
    const parse = (text) => {
      try {
        return JSON.parse(text) || {};
      } catch (e) {
        return {};
      }
    };
    const store = (key, value) => {
      try {
        localStorage.setItem(key, JSON.stringify(value));
      } catch (e) {
        // Storage is not available: the state stays until a reload.
      }
    };
    const readMoves = (text) => {
      const result = {};
      for (const [id, v] of Object.entries(parse(text))) {
        if (!SAFE.test(id)) continue;
        if (typeof v === 'string') result[id] = { to: v === 'Done' ? 'Resolved' : v };
        else if (v && typeof v.to === 'string') result[id] = v;
      }
      return result;
    };

    // ---- State ----
    let moved = readMoves(localStorage.getItem(KEYS.moves));
    const saveMoves = () => store(KEYS.moves, moved);
    const foldedList = parse(localStorage.getItem(KEYS.folded));
    const folded = new Set(Array.isArray(foldedList) ? foldedList : []);
    // Labels of the sections where "Show more" of the script was used.
    const showAll = new Set();
    // Section key -> time of the last click on "Show more" of the page.
    const clickedAt = new Map();
    // Class of the element that holds the cards of a section. The script
    // uses it for its own card holders, so they have the same layout.
    const ui = parse(localStorage.getItem(KEYS.ui));
    let dropClass = ui.dropClass || '';
    // Labels of the sections that the page showed at some time. The page
    // does not show an empty section, but it must stay a drop target.
    const seenLabels = new Set(Array.isArray(ui.labels) ? ui.labels : []);
    const saveUi = () => store(KEYS.ui, { dropClass, labels: [...seenLabels] });
    let drag = null; // { id, home, html } during a drag
    let queued = false; // a render is scheduled
    let pinnedAt = 0; // time of the last openMenu()

    // ---- Elements of the script ----
    // Children of the grid, one for each section label (data-label):
    //   .tm-dnd-head  header of a section that the page does not show
    //   .tm-dnd-in    holder for the copies of the cards moved into a section
    //   .tm-dnd-more  "Show more" of the script
    //   .tm-dnd-reset the reset line
    // Other elements:
    //   #tm-dnd-rules generated CSS (hide cards, order, counts)
    //   #tm-dnd-pin   temporary CSS while the menu of a moved card is open
    //   .tm-dnd-bar   drop targets, shown during a drag
    //   .tm-dnd-ghost drag picture for a copy
    const make = (tag, className, props) =>
      Object.assign(document.createElement(tag), { className }, props);
    const rules = make('style', '', { id: 'tm-dnd-rules' });
    const pin = make('style', '', { id: 'tm-dnd-pin' });
    const bar = make('div', 'tm-dnd-bar');
    // Write a property only when the value is different, so that the
    // MutationObserver (see start) does not loop.
    const setIf = (obj, key, value) => {
      if (obj[key] !== value) obj[key] = value;
    };

    // ---- Reads from the page ----
    const proj = () => (location.pathname.match(/\/project\/([\w-]+)/) || [])[1] || '';
    const getGrid = () => {
      const s = document.querySelector(SEL.section);
      return s && s.parentElement;
    };
    // "Waiting on you · 1" -> "Waiting on you"
    const labelOf = (sec) => {
      const h = sec.querySelector('h4');
      return h ? h.textContent.split('·')[0].trim() : sec.dataset.homeSection;
    };
    const homeOf = (card) => labelOf(card.closest(SEL.section));
    const realCard = (id) => document.querySelector(`[data-home-card="${id}"]`);
    // The element that shows the number in a section header.
    const countEl = (sec) =>
      [...sec.querySelectorAll(SEL.count)].find((el) => /^\d+$/.test(el.textContent.trim()));
    // label -> section element, in the order of the page.
    const realSections = (grid) => {
      const real = new Map();
      for (const sec of grid.children) {
        if (sec.matches(SEL.section)) real.set(labelOf(sec), sec);
      }
      return real;
    };

    // ---- Copies of cards ----
    function makeCopy(id, html, stale) {
      const t = document.createElement('template');
      t.innerHTML = html;
      const el = t.content.firstElementChild;
      if (!el) return null;
      // The HTML comes from localStorage: remove all that can run code.
      for (const bad of t.content.querySelectorAll('script, iframe, object, embed')) {
        bad.remove();
      }
      for (const n of [el, ...el.querySelectorAll('*')]) {
        for (const a of [...n.attributes]) {
          if (/^on/i.test(a.name) || /^\s*javascript:/i.test(a.value)) {
            n.removeAttribute(a.name);
          }
        }
        n.removeAttribute('id');
      }
      el.removeAttribute('data-home-card');
      el.dataset.tmCard = id;
      el.draggable = true;
      // Stale: the real card is not on the page, so the menu cannot open.
      el.classList.toggle('tm-stale', stale);
      return el;
    }

    // The menu of a card opens next to its button. The real card is
    // hidden, so put it (invisible) at the position of the copy while
    // the menu is open. render() removes the rule when the menu closes.
    function openMenu(id, copy, button) {
      const r = copy.getBoundingClientRect();
      const place = (left, top) => {
        pin.textContent =
          `[data-home-card="${id}"]:not(#tm-x):not(#tm-y){display:grid !important;` +
          `position:fixed !important;left:${left}px;top:${top}px;width:${r.width}px;` +
          'opacity:0 !important;pointer-events:none !important}';
      };
      if (!pin.isConnected) document.head.appendChild(pin);
      place(r.left, r.top);
      // "position: fixed" can be relative to a parent element. Measure
      // the result and correct the difference.
      const q = realCard(id).getBoundingClientRect();
      place(2 * r.left - q.left, 2 * r.top - q.top);
      pinnedAt = Date.now();
      button.click();
      setTimeout(schedule, 500);
    }
    function unpinClosedMenu() {
      if (!pin.textContent || Date.now() - pinnedAt <= 400) return;
      if (!document.querySelector(SEL.menuOpen)) pin.textContent = '';
    }

    // A click on a copy goes to the same element of the real card.
    // If the real card is not on the page, the link of the copy opens
    // the thread (with a page load).
    function onCopyClick(e) {
      const copy = e.target.closest(SEL.copy);
      if (!copy || e.metaKey || e.ctrlKey || e.shiftKey || e.button) return;
      const id = copy.dataset.tmCard;
      const real = realCard(id);
      if (!real) {
        if (e.target.closest('a')) return;
        const a = copy.querySelector('a[href]');
        if (a) location.assign(a.href);
        return;
      }
      // Find the same element in the real card: same path of child indexes.
      const path = [];
      for (let n = e.target; n !== copy; n = n.parentElement) {
        path.unshift([...n.parentElement.children].indexOf(n));
      }
      let t = real;
      for (const i of path) t = t && t.children[i];
      if (!t) return;
      e.preventDefault();
      e.stopPropagation();
      const button = t.closest('button');
      if (button && real.contains(button)) openMenu(id, copy, button);
      else t.click();
    }

    // ---- Render, step 1: update the saved moves from the page ----
    // Returns the ids of the moved threads whose real card is on the page.
    function syncMoves(grid, p) {
      const present = new Set();
      let dirty = false;
      for (const card of grid.querySelectorAll(SEL.card)) {
        const id = card.dataset.homeCard;
        const rec = moved[id];
        if (!rec) continue;
        const home = homeOf(card);
        if (rec.to === home) {
          // The thread is now really in that section.
          delete moved[id];
          dirty = true;
          continue;
        }
        present.add(id);
        const html = card.outerHTML;
        if (rec.home !== home || rec.proj !== p || rec.html !== html) {
          Object.assign(rec, { home, proj: p, html });
          dirty = true;
        }
      }
      if (dirty) saveMoves();
      return present;
    }

    // ---- Render, step 2: calculate what to show ----
    // Returns { css, recs, movedIn, heads, holders, mores }:
    //   css:     text for #tm-dnd-rules
    //   recs:    the moves of this project, [[id, rec]]
    //   movedIn: label -> [[id, rec]]
    //   heads:   label -> { text, order }    headers of the script
    //   holders: label -> { order, cap }     card holders (cap: most copies)
    //   mores:   label -> { order }          "Show more" of the script
    // "order" is the CSS order in the grid. Each section gets a block of
    // 1000: header +0, moved threads +1, cards of the page +2, "Show more" +3.
    function plan(grid, p, present) {
      const real = realSections(grid);
      // The moves of this project. They do not depend on which cards are
      // on the page now, so the counts stay correct.
      const recs = Object.entries(moved).filter(([, r]) => r.proj === p && r.home && r.html);
      // Moves from a version before 0.14 have no copy of the card. The
      // script completes them when it finds the card on the page.
      const pending = Object.values(moved).some((r) => !r.html);
      const movedIn = new Map();
      const movedOut = new Map(); // label -> number
      for (const [id, rec] of recs) {
        if (!movedIn.has(rec.to)) movedIn.set(rec.to, []);
        movedIn.get(rec.to).push([id, rec]);
        movedOut.set(rec.home, (movedOut.get(rec.home) || 0) + 1);
      }

      // Section order: the real sections stay in the order of the page.
      // A label that the page does not show goes next to its neighbor in
      // THREAD_SECTIONS.
      const order = [...real.keys()];
      const extra = [...movedIn.keys()].filter((l) => !real.has(l));
      extra.sort((a, b) => THREAD_SECTIONS.indexOf(a) - THREAD_SECTIONS.indexOf(b));
      for (const label of extra) {
        const i = THREAD_SECTIONS.indexOf(label);
        let at = -1;
        for (let j = i - 1; i >= 0 && j >= 0 && at < 0; j--) {
          const k = order.indexOf(THREAD_SECTIONS[j]);
          if (k >= 0) at = k + 1;
        }
        for (let j = i + 1; i >= 0 && j < THREAD_SECTIONS.length && at < 0; j++) {
          at = order.indexOf(THREAD_SECTIONS[j]);
        }
        if (at < 0) order.push(label);
        else order.splice(at, 0, label);
      }
      const base = (label) => (order.indexOf(label) + 1) * 1000;

      const out = []; // CSS rules
      const heads = new Map();
      const holders = new Map();
      const mores = new Map();
      const result = { css: '', recs, movedIn, heads, holders, mores };
      if (!recs.length && !pending) return result;

      const hide = (id) => out.push(`[data-home-card="${id}"]{display:none !important}`);
      for (const [id] of recs) hide(id);
      const addHolder = (label, b) => holders.set(label, { order: b + 1, cap: Infinity });
      // "Show more": a section shows THREAD_PAGE threads (the moved
      // threads first). The button shows all of them.
      // own: the cards of the page in the section that are not moved away.
      const limit = (label, ins, own, b) => {
        if (ins + own.length <= THREAD_PAGE || showAll.has(label)) return;
        own.slice(Math.max(0, THREAD_PAGE - ins)).forEach((c) => hide(c.dataset.homeCard));
        if (holders.has(label)) holders.get(label).cap = THREAD_PAGE;
        mores.set(label, { order: b + 3 });
      };

      // Sections of the page.
      for (const [label, sec] of real) {
        const key = sec.dataset.homeSection;
        if (!SAFE.test(key)) continue;
        const S = `[data-home-section="${key}"]`;
        const b = base(label);
        const ins = (movedIn.get(label) || []).length;
        const outs = movedOut.get(label) || 0;
        const num = countEl(sec);
        const shown = num ? Math.max(0, Number(num.textContent) + ins - outs) : 1;
        if (!shown) {
          // All the threads of this section moved away.
          out.push(`${S}{display:none !important}`);
          continue;
        }
        const open = !sec.querySelector(SEL.folded);
        if (!open) showAll.delete(label);
        const oneGroup = sec.querySelectorAll('[data-home-group]').length === 1;
        if (ins && open && oneGroup) {
          // Put the card holder between the header and the cards: make
          // the wrappers of the section "display: contents", then the
          // parts of the section are items of the grid and "order" works.
          out.push(
            `${S},${S} [data-home-sort],${S} [data-home-group]{display:contents !important}`,
            `${S} > *,${S} [data-home-sort] > *,${S} [data-home-group] > *{order:${b + 2}}`,
            `${S} [data-home-group] > div:first-child{order:${b}}`,
          );
        } else {
          out.push(`${S}{order:${b}}`);
        }
        if (ins && open) addHolder(label, b);
        if (open && (ins || outs || pending)) {
          // The page shows only some cards and a "Show more" button.
          // Click that button, so that all the cards are on the page.
          // Then the script applies the limit to the moved threads and
          // the cards together.
          const more = sec.querySelector(SEL.pageMore);
          if (more) {
            if (Date.now() - (clickedAt.get(key) || 0) > 1000) {
              clickedAt.set(key, Date.now());
              more.click();
            }
          } else {
            const own = [...sec.querySelectorAll(SEL.card)].filter(
              (c) => !(moved[c.dataset.homeCard] && present.has(c.dataset.homeCard)),
            );
            limit(label, ins, own, b);
          }
        }
        // Correct the count in the header ("Working · 1"). The page owns
        // that text, so the rule hides it and shows the new number with
        // ::after. line-height 0: the hidden text must not add a line.
        if (ins !== outs && num) {
          const nth = (el) => [...el.parentElement.children].indexOf(el) + 1;
          const sel =
            `${S} h4 button > span:nth-child(${nth(num.parentElement)})` +
            ` > span:nth-child(${nth(num)})`;
          const cs = getComputedStyle(num.parentElement);
          out.push(
            `${sel}{font-size:0 !important;line-height:0 !important}`,
            `${sel}::after{content:"${shown}";display:block;` +
              `font-size:${cs.fontSize};line-height:${cs.lineHeight}}`,
          );
        }
      }

      // Sections that the page does not show get a header from the script.
      for (const label of extra) {
        const b = base(label);
        const n = movedIn.get(label).length;
        const closed = folded.has(label);
        heads.set(label, { text: `${label} · ${n} ${closed ? '›' : '⌄'}`, order: b });
        if (closed) {
          showAll.delete(label);
          continue;
        }
        addHolder(label, b);
        limit(label, n, [], b);
      }
      result.css = out.join('\n');
      return result;
    }

    // ---- Render, step 3: update the elements of the script ----
    // Make the children of the grid with class cls agree with "want"
    // (label -> data): remove, create (create(label) gives the element)
    // and update (update(el, data)).
    function syncChildren(grid, cls, want, create, update) {
      const have = new Map();
      for (const el of grid.querySelectorAll(`:scope > .${cls}`)) {
        if (want.has(el.dataset.label) && !have.has(el.dataset.label))
          have.set(el.dataset.label, el);
        else el.remove();
      }
      for (const [label, data] of want) {
        let el = have.get(label);
        if (!el) {
          el = create(label);
          el.classList.add(cls);
          el.dataset.label = label;
          grid.appendChild(el);
        }
        update(el, data);
      }
    }
    const setOrder = (el, order) => setIf(el.style, 'order', String(order));

    function renderHeads(grid, heads) {
      // Use the font weight of the headers of the page.
      const ref = heads.size && grid.querySelector(`${SEL.section} h4 button > span`);
      const weight = ref ? getComputedStyle(ref).fontWeight : '';
      syncChildren(
        grid,
        'tm-dnd-head',
        heads,
        (label) => {
          const el = make('div', '', { title: 'Collapse or expand' });
          el.addEventListener('click', () => {
            if (!folded.delete(label)) folded.add(label);
            store(KEYS.folded, [...folded]);
            render();
          });
          return el;
        },
        (el, w) => {
          setIf(el, 'textContent', w.text);
          setOrder(el, w.order);
          if (weight) setIf(el.style, 'fontWeight', weight);
        },
      );
    }

    function renderHolders(grid, holders, movedIn, present) {
      const className = `${dropClass || 'grid grid-cols-subgrid *:col-span-full'} tm-dnd-in`;
      syncChildren(
        grid,
        'tm-dnd-in',
        holders,
        () => {
          const el = make('div', '');
          el.addEventListener('click', onCopyClick);
          return el;
        },
        (el, { order, cap }) => {
          setIf(el, 'className', className);
          setOrder(el, order);
          // sig: a copy is made again when the card or "stale" changes.
          const want = movedIn
            .get(el.dataset.label)
            .slice(0, cap)
            .map(([id, rec]) => ({ id, rec, sig: (present.has(id) ? '1' : '0') + rec.html }));
          const have = [...el.children];
          const same =
            have.length === want.length &&
            want.every((w, i) => have[i].dataset.tmCard === w.id && have[i].tmSig === w.sig);
          if (same) return;
          const copies = [];
          for (const w of want) {
            const c = makeCopy(w.id, w.rec.html, !present.has(w.id));
            if (!c) continue;
            c.tmSig = w.sig;
            copies.push(c);
          }
          el.replaceChildren(...copies);
        },
      );
    }

    function renderMores(grid, mores) {
      syncChildren(
        grid,
        'tm-dnd-more',
        mores,
        (label) => {
          const el = make('div', '');
          const button = make('button', '', { type: 'button', textContent: 'Show more' });
          button.addEventListener('click', () => {
            showAll.add(label);
            render();
          });
          el.append(button);
          return el;
        },
        (el, { order }) => setOrder(el, order),
      );
    }

    function renderReset(grid, count) {
      const want = new Map(count ? [['reset', `${count} moved in this browser only. `]] : []);
      syncChildren(
        grid,
        'tm-dnd-reset',
        want,
        () => {
          const el = make('div', '');
          const button = make('button', '', { type: 'button', textContent: 'Reset' });
          button.addEventListener('click', () => {
            const here = proj();
            for (const [id, rec] of Object.entries(moved)) {
              if (rec.proj === here) delete moved[id];
            }
            saveMoves();
            render();
          });
          el.append(document.createTextNode(''), button);
          return el;
        },
        (el, msg) => setIf(el.firstChild, 'nodeValue', msg),
      );
    }

    function render() {
      queued = false;
      if (!rules.isConnected) document.head.appendChild(rules);
      unpinClosedMenu();
      const grid = getGrid();
      if (!grid) {
        // Not the Threads page. The elements of the script went away
        // with the grid.
        setIf(rules, 'textContent', '');
        return;
      }
      const drop = grid.querySelector(SEL.drop);
      let uiChanged = false;
      if (drop && drop.className !== dropClass) {
        dropClass = drop.className;
        uiChanged = true;
      }
      for (const label of realSections(grid).keys()) {
        if (label && !seenLabels.has(label)) {
          seenLabels.add(label);
          uiChanged = true;
        }
      }
      if (uiChanged) saveUi();
      const present = syncMoves(grid, proj());
      const p = plan(grid, proj(), present);
      setIf(rules, 'textContent', p.css);
      renderHeads(grid, p.heads);
      renderHolders(grid, p.holders, p.movedIn, present);
      renderMores(grid, p.mores);
      renderReset(grid, p.recs.length);
    }
    function schedule() {
      if (queued) return;
      queued = true;
      requestAnimationFrame(render);
    }

    // ---- Drag and drop ----
    // The section label below the pointer, or null.
    const targetLabel = (el) => {
      if (!(el instanceof Element)) return null;
      const own = el.closest('.tm-dnd-chip, .tm-dnd-head, .tm-dnd-in, .tm-dnd-more');
      if (own) return own.dataset.label;
      const sec = el.closest(SEL.section);
      return sec ? labelOf(sec) : null;
    };
    function showBar() {
      const grid = getGrid();
      if (!grid || !drag) return;
      // All the sections: also the ones that the page does not show now.
      const labels = [
        ...new Set([...THREAD_SECTIONS, ...seenLabels, ...realSections(grid).keys()]),
      ];
      const chips = labels.map((l) => [l, l]);
      if (moved[drag.id]) chips.push([RESET, 'Real section (reset)']);
      bar.replaceChildren(
        ...chips.map(([label, text]) => {
          const chip = make('div', 'tm-dnd-chip', { textContent: text });
          chip.dataset.label = label;
          return chip;
        }),
      );
      const r = grid.getBoundingClientRect();
      bar.style.left = `${Math.max(8, r.left)}px`;
      bar.style.bottom = '24px';
      bar.style.maxWidth = `${Math.max(240, r.width)}px`;
      if (!bar.isConnected) document.body.appendChild(bar);
      bar.classList.add('on');
    }
    const endDrag = () => {
      drag = null;
      bar.classList.remove('on');
    };
    // For a copy, the browser can use the full Threads pane as the drag
    // picture. Give it a picture of only this card.
    function setDragPicture(e, copy) {
      const dt = e.dataTransfer;
      if (!dt || !dt.setDragImage) return;
      const r = copy.getBoundingClientRect();
      const ghost = make('div', 'tm-dnd-ghost');
      ghost.style.width = `${r.width}px`;
      const pic = copy.cloneNode(true);
      pic.removeAttribute('data-tm-card');
      ghost.append(pic);
      document.body.append(ghost);
      // 40 and 4: the padding of .tm-dnd-ghost.
      dt.setDragImage(ghost, e.clientX - r.left + 40, e.clientY - r.top + 4);
      dt.effectAllowed = 'move';
      setTimeout(() => ghost.remove(), 0);
    }

    // The cards are draggable already (the page has its own drag and
    // drop). These listeners run first (capture on window). On a drop on
    // a section or on the bar, they stop the event, so the page does not
    // also act on the drop.
    const handlers = {
      dragstart(e) {
        const el = e.target instanceof Element && e.target.closest(`${SEL.card}, ${SEL.copy}`);
        if (!el) return;
        const id = el.dataset.homeCard || el.dataset.tmCard;
        if (!SAFE.test(id)) return;
        const rec = moved[id];
        if (el.dataset.homeCard) {
          drag = { id, home: homeOf(el), html: el.outerHTML };
        } else if (rec) {
          drag = { id, home: rec.home, html: rec.html };
          setDragPicture(e, el);
        } else {
          return;
        }
        // Not in the same tick: a DOM change in dragstart can stop the drag.
        setTimeout(showBar, 0);
      },
      dragover(e) {
        if (!drag) return;
        const label = targetLabel(e.target);
        for (const c of bar.children) c.classList.toggle('over', c.dataset.label === label);
        if (!label) return;
        e.preventDefault(); // permit the drop here
        e.stopPropagation();
      },
      drop(e) {
        if (!drag) return;
        const label = targetLabel(e.target);
        if (!label) return;
        e.preventDefault();
        e.stopPropagation();
        if (label === RESET || label === drag.home) delete moved[drag.id];
        else moved[drag.id] = { to: label, home: drag.home, proj: proj(), html: drag.html };
        saveMoves();
        endDrag();
        render();
      },
      dragend: endDrag,
    };
    for (const [type, fn] of Object.entries(handlers)) {
      window.addEventListener(type, fn, true);
    }
    // Keep the same state in other tabs.
    window.addEventListener('storage', (e) => {
      if (e.key !== KEYS.moves) return;
      moved = readMoves(e.newValue);
      schedule();
    });
    // The page draws the list again and again: render after each change.
    // render() must not change the DOM when nothing is different (setIf),
    // or this observer loops.
    const start = () => {
      new MutationObserver(schedule).observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['aria-expanded'],
      });
      render();
    };
    if (document.body) start();
    else document.addEventListener('DOMContentLoaded', start);
  }

  // ---- Tweaks -----------------------------------------------------------
  // To add a change: add an entry with an id, an enabled flag, and css.
  // An optional init() function is for changes that need JavaScript.
  const TWEAKS = [
    {
      id: 'artifacts-beside-prs',
      enabled: true,
      css: `
        ${BOX} {
          flex-direction: row !important;
          flex-wrap: wrap;
          align-items: center;
          column-gap: 0.75rem;
        }
        ${BOX} > ${ITEM}:not(:has(> ${CHIP})) {
          flex: 0 1 auto;
          min-width: 0;
        }
        ${BOX} > ${CHIP_ITEM} {
          flex: 0 0 auto;
        }
        /* Hide the tree connector of the chip item */
        ${BOX} > ${CHIP_ITEM} > :not(a):not(.sr-only) {
          display: none !important;
        }
        /* The item before the chip is now the last line:
           hide the vertical line that goes down from its connector */
        ${BOX} > ${ITEM}:has(+ ${ITEM} > ${CHIP}) > span:first-child::after {
          display: none !important;
        }
      `,
    },
    {
      // Slack look and feel with the theme colors (see "Theme values"):
      // colors, Lato font, radii, shadows. Light, dark and "system" mode.
      id: 'slack-theme',
      enabled: true,
      css: `
${ROOT} {
${decls({ ...SL_COMMON, ...SL_LIGHT })}
}
${DARK_ROOT} {
${decls(SL_DARK)}
}
${sidebarSel('', 3)} {
${decls(sidebarVars(CHROME_LIGHT))}
}
${sidebarSel('[data-mode="dark"] ', 4)} {
${decls(sidebarVars(CHROME_DARK))}
}
${selectedSel('', 5)} {
${decls(selectedVars(CHROME_LIGHT))}
  color: ${CHROME_LIGHT.activeText} !important;
}
${selectedSel('[data-mode="dark"] ', 6)} {
${decls(selectedVars(CHROME_DARK))}
  color: ${CHROME_DARK.activeText} !important;
}
${barSel('', 3)} {
${decls(barVars(CHROME_LIGHT))}
}
${barSel('[data-mode="dark"] ', 4)} {
${decls(barVars(CHROME_DARK))}
}
@media (prefers-color-scheme: dark) {
  ${SYSTEM_ROOT} {
${decls(SL_DARK)}
  }
  ${sidebarSel('[data-mode="system"] ', 4)} {
${decls(sidebarVars(CHROME_DARK))}
  }
  ${selectedSel('[data-mode="system"] ', 6)} {
${decls(selectedVars(CHROME_DARK))}
    color: ${CHROME_DARK.activeText} !important;
  }
  ${barSel('[data-mode="system"] ', 4)} {
${decls(barVars(CHROME_DARK))}
  }
}
${SIDEBAR} {
  background-color: var(--df-web-sidebar-bg) !important;
  color: var(--cds-text-primary) !important;
}
/* Regular weight (not bold) for the sidebar rows (New, Search, Projects,
   ...), for the model selector, and for the options in dropdown menus
   and lists (submenus are also role="menu") */
${sidebarSel('', 5)},
[data-cds="ModelSelector"]${strong(5)},
[role="menu"]${strong(5)},
[role="listbox"]${strong(5)} {
  --cds-font-weight-control: 400 !important;
}
${BARS.join(', ')} {
  background-color: var(--cds-page-bg) !important;
  color: var(--cds-text-primary) !important;
}
/* Some text sets the Claude fonts directly, not through the tokens */
body, .font-ui, .font-sans, .font-display, .font-serif, .font-voice {
  font-family: ${FONT} !important;
}
`,
      // Load Lato from Google Fonts (the font that Slack uses).
      // If the load fails, the font stack falls back to Helvetica or Arial.
      init() {
        const link = document.createElement('link');
        link.id = 'tm-tweak-slack-theme-font';
        link.rel = 'stylesheet';
        link.href = 'https://fonts.googleapis.com/css2?family=Lato:wght@400;700;900&display=swap';
        (document.head || document.documentElement).appendChild(link);
      },
    },
    {
      // Slack layout for the coordinator pane and the threads pane:
      // flat messages with an avatar and a name (no bubbles), Slack inline
      // code, composer, reactions and thread rows. Colors come from the
      // theme tokens, so this works in light and dark mode.
      id: 'slack-messages',
      enabled: true,
      css: `
/* One message: space for the avatar, highlight on hover */
${HUMAN} ${MSG}, ${ASSISTANT} ${MSG} {
  border-radius: 6px !important;
  padding-left: 60px !important;
}
${HUMAN} ${MSG}:hover, ${ASSISTANT} ${MSG}:hover {
  background: var(--cds-bg-neutral);
}
/* Avatar: a square with the first letter of the name */
${HUMAN} ${MSG}::after, ${ASSISTANT} ${MSG}::after {
  position: absolute;
  left: 12px;
  top: 10px;
  width: 36px;
  height: 36px;
  border-radius: 8px;
  display: grid;
  place-items: center;
  font-weight: 900;
  font-size: 16px;
  line-height: 1;
  color: ${COLORS.avatarText};
}
${HUMAN} ${MSG}::after { content: ${cssStr(ME[0])}; background: ${COLORS.avatarMe}; }
${ASSISTANT} ${MSG}::after { content: ${cssStr(BOT[0])}; background: ${COLORS.avatarBot}; }
${
  BOT_AVATAR
    ? `${ASSISTANT} ${MSG}::after {
  content: '';
  background: ${COLORS.avatarBotImageBg} url(${cssStr(BOT_AVATAR)}) center / 68% no-repeat;
}`
    : ''
}
${
  ME_AVATAR
    ? `${HUMAN} ${MSG}::after {
  content: '';
  background: ${COLORS.avatarMe} url(${cssStr(ME_AVATAR)}) center / cover no-repeat;
}`
    : ''
}
/* A thin line where the sender changes, in the middle of the gap
   between the two messages (the gap is 12px + 8px here) */
${SENDER_CHANGE.join(', ')} {
  padding-top: 8px !important;
}
${SENDER_CHANGE.map((row) => `${row} ${MSG}::before`).join(', ')} {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  top: -11px;
  height: 1px;
  background: var(--cds-border-line);
  pointer-events: none;
}
/* Name above the message */
${nameSel(HUMAN)}, ${nameSel(ASSISTANT)} {
  display: block;
  font-weight: 900;
  font-size: 15px;
  line-height: 22px;
  color: var(--cds-text-primary);
}
${nameSel(HUMAN)} { content: ${cssStr(ME)}; }
${nameSel(ASSISTANT)} { content: ${cssStr(BOT)}; }
/* As in Slack: no avatar and no name when the sender is the same as in
   the row before */
${BOT_NEXT} ${MSG}::after, ${HUMAN} + ${HUMAN} ${MSG}::after {
  display: none;
}
${nameSel(`${BOT_NEXT}`)}, ${nameSel(`${HUMAN} + ${HUMAN}`)} {
  display: none;
}
/* Time. As in Slack: next to the name, always shown. The name widths
   (--tm-name-me, --tm-name-bot) come from init() below. */
${colSel(HUMAN)}, ${colSel(ASSISTANT)} {
  position: relative;
}
${HUMAN} ${MSG} div:has(> ${TIME}), ${ASSISTANT} ${MSG} div:has(> ${TIME}) {
  position: static !important;
}
${HUMAN} ${MSG} ${TIME}, ${ASSISTANT} ${MSG} ${TIME} {
  top: 6px !important;
  inset-inline: auto !important;
  left: calc(var(--tm-name-bot, 6ch) + 8px) !important;
  font-size: 12px !important;
  opacity: 1 !important;
}
${HUMAN} ${MSG} ${TIME} {
  left: calc(var(--tm-name-me, 5ch) + 8px) !important;
}
/* A message without a name: the time shows in the avatar column on hover */
${BOT_NEXT} ${MSG} ${TIME}, ${HUMAN} + ${HUMAN} ${MSG} ${TIME} {
  left: -56px !important;
  width: 48px;
  justify-content: center;
  font-size: 10px !important;
  opacity: 0 !important;
}
${BOT_NEXT} ${MSG}:hover ${TIME}, ${HUMAN} + ${HUMAN} ${MSG}:hover ${TIME} {
  opacity: 1 !important;
}
/* Coordinator pane, your messages: move the time line from below the
   message to the name. The line kept 28px of space below the message;
   the padding gives the usual 12px gap to the next message. */
${HUMAN} ${MSG} ${TIME_LINE} {
  position: absolute !important;
  top: 1px;
  left: calc(var(--tm-name-me, 5ch) + 8px);
  margin: 0 !important;
}
${HUMAN} ${MSG} ${TIME_LINE} > span:has(> time) {
  opacity: 1 !important;
  font-size: 12px !important;
}
${HUMAN}:has(${TIME_LINE}) {
  padding-bottom: 28px;
}
/* Without a name: in the avatar column, on hover */
${HUMAN} + ${HUMAN} ${MSG} ${TIME_LINE} {
  left: -56px;
  width: 48px;
  justify-content: center;
}
${HUMAN} + ${HUMAN} ${MSG} ${TIME_LINE} > span:has(> time) {
  opacity: 0 !important;
  font-size: 10px !important;
}
${HUMAN} + ${HUMAN} ${MSG}:hover ${TIME_LINE} > span:has(> time) {
  opacity: 1 !important;
}
/* Your messages: on the left, without a bubble */
${HUMAN} .epitaxy-user-turn, ${HUMAN} [data-cds="UserMessage"] {
  align-items: flex-start !important;
  margin-inline: 0 !important;
}
${HUMAN} [class~="group/bubble"] {
  background: transparent !important;
  padding: 0 !important;
  /* 100%, not none: with none, long text does not wrap in a narrow pane */
  max-width: 100% !important;
}
${HUMAN} .epitaxy-message-reactions {
  justify-content: flex-start !important;
}
.prose {
  line-height: 1.46668 !important;
}
/* Inline code: the Slack red on a light box. The second selector is
   inline code in the message box, while you type. */
code[data-epitaxy-inline-code],
.ProseMirror code:not(pre code) {
  color: ${COLORS.red} !important;
  background: ${COLORS.ink(0.04)} !important;
  border: 1px solid ${COLORS.ink(0.13)} !important;
  border-radius: 3px !important;
  padding: 2px 3px 1px !important;
  font-size: 12px !important;
}
[data-mode="dark"] code[data-epitaxy-inline-code],
[data-mode="dark"] .ProseMirror code:not(pre code) {
  color: ${COLORS.codeDark} !important;
  background: ${COLORS.codeDarkInk(0.04)} !important;
  border-color: ${COLORS.codeDarkInk(0.13)} !important;
}
/* Composer: a box with a 1px border */
[data-cds="ChatComposer"] > .bg-surface-3 {
  border-radius: 8px !important;
  box-shadow: 0 0 0 1px var(--cds-border-strong) !important;
}
[data-cds="ChatComposer"] > .bg-surface-3:focus-within {
  box-shadow: 0 0 0 1px var(--cds-border-stronger) !important;
}
/* Reactions: blue pills */
.epitaxy-message-reactions button {
  border-radius: 9999px !important;
  background: ${mix(COLORS.linkDark, 10)} !important;
  box-shadow: inset 0 0 0 1px ${COLORS.linkDark} !important;
}
/* Pane titles and thread rows */
[data-pane-title], [data-home-title] {
  font-weight: 900 !important;
}
[data-home-card]:hover {
  background: var(--cds-bg-neutral);
}
`,
      // Measure the names, so that the CSS can put the time after the name.
      init() {
        const measure = () => {
          const ctx = document.createElement('canvas').getContext('2d');
          if (!ctx) return;
          ctx.font = `900 15px ${FONT}`; // the font of the name
          const set = (name, text) =>
            document.documentElement.style.setProperty(
              name,
              `${Math.ceil(ctx.measureText(text).width)}px`,
            );
          set('--tm-name-me', ME);
          set('--tm-name-bot', BOT);
        };
        measure();
        // Measure again each time fonts load (Lato comes later).
        if (document.fonts) document.fonts.addEventListener('loadingdone', measure);
      },
    },
    {
      // Drag a thread card to a different section of the Threads page.
      // See "Thread drag" above.
      id: 'thread-drag-sections',
      enabled: true,
      css: THREAD_DRAG_CSS,
      init: initThreadDrag,
    },
    {
      // No bold text: regular weight (400) for all text, also for
      // headers, section labels, and markdown bold and headings.
      // Only the sender names of the messages (ME, BOT) stay bold.
      // The setting NO_BOLD (at the top) sets this tweak on or off.
      id: 'no-bold',
      enabled: NO_BOLD,
      css: `
*${strong(8)}, *${strong(8)}::before, *${strong(8)}::after {
  font-weight: 400 !important;
}
${[HUMAN, ASSISTANT].map((row) => nameSel(row).replaceAll('::before', `${strong(9)}::before`)).join(', ')} {
  font-weight: 900 !important;
}
`,
    },
  ];

  // ---- Loader -----------------------------------------------------------
  for (const t of TWEAKS) {
    if (!t.enabled) continue;
    if (t.css) {
      const style = document.createElement('style');
      style.id = `tm-tweak-${t.id}`;
      style.textContent = t.css;
      (document.head || document.documentElement).appendChild(style);
    }
    if (typeof t.init === 'function') t.init();
  }
})();
