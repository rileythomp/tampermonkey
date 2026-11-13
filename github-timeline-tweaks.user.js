// ==UserScript==
// @name         GitHub – timeline tweaks
// @namespace    riley.github.tweaks
// @version      0.10
// @description  Hide bot comments, collapse long commit runs, and give GitHub a Slack look (Sea Glass theme)
// @match        https://github.com/*
// @run-at       document-start
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @connect      fonts.googleapis.com
// @connect      fonts.gstatic.com
// ==/UserScript==

(function () {
  'use strict';

  // Layout of this file:
  //   Settings            values that you can change
  //   Shared selectors    the GitHub markup that the timeline code reads
  //   Helpers             storage, bot detection, readTimeline()
  //   Slack theme         colors, areas, the CSS of the two Slack tweaks,
  //                       the color mode, the Lato font
  //   Shared render loop  one render per frame after a page change
  //   Tweaks              the TWEAKS list: each entry has an id, an
  //                       enabled flag, css, and an optional init()
  //   Loader              adds the styles and starts the tweaks
  //
  // To test a CSS change: github.com is not available from a cloud
  // container. Put the new CSS in the <style id="tm-tweak-<id>"> element
  // of the page in the browser.

  // ---- Settings ---------------------------------------------------------
  // Bot comments: the state of the toggle is kept in localStorage.
  const BOTS_KEY = 'tm-gh-hide-bots';
  // Commit runs: a run is a sequence of commits with no visible item
  // between them. When a run has more than COMMITS_KEEP + COMMITS_MIN_HIDDEN - 1
  // commits, the script shows the first COMMITS_KEEP commits and hides the
  // remaining commits behind one control.
  // COMMITS_MIN_HIDDEN prevents a control that hides only 1 commit.
  const COMMITS_KEEP = 3;
  const COMMITS_MIN_HIDDEN = 2;
  // Slack theme: the color mode of GitHub when the theme is on.
  //   'github' the mode that is set in the GitHub settings (light, dark,
  //            or "sync with system"). This is the default.
  //   'dark'   always dark (Slack dark mode).
  //   'light'  always light.
  const SLACK_MODE = 'github';

  // ---- Shared selectors -------------------------------------------------
  // PR pages (Rails markup). Each timeline item has data-gid. The prefix of
  // the gid tells the item type:
  //   C_   one or more commits ("added 5 commits")
  //   IC_  a comment
  //   PRR_ a review
  // The "N hidden items / Load more" form is between items. It stops a run.
  const PR_ITEM = '.js-discussion .js-timeline-item';
  const PR_BREAK = '.js-discussion .ajax-pagination-form';
  // A commit row in a C_ item. The "added N commits" header row has no
  // details container.
  const PR_COMMIT_ROW = '.TimelineItem';
  const PR_COMMIT_ROW_BODY = '.js-details-container';
  // Issue pages (React markup).
  const ISSUE_LIST = 'ol[data-testid="issue-timeline-container"]';
  const ISSUE_COMMENT = '[data-testid^="timeline-row-border-IC_"]';

  // Classes that this script adds. The script removes them before each
  // render, so the result of each render is the same for the same page.
  const HIDDEN = 'tm-gh-hidden';
  const CTRL = 'tm-gh-ctrl';

  // ---- Helpers ----------------------------------------------------------
  const store = {
    get(key, fallback) {
      try {
        const v = localStorage.getItem(key);
        return v === null ? fallback : JSON.parse(v);
      } catch {
        return fallback;
      }
    },
    set(key, value) {
      try {
        localStorage.setItem(key, JSON.stringify(value));
      } catch {
        /* storage blocked: keep the value for this page only */
      }
    },
  };

  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

  // A bot author: an app link (/apps/name), a login with the [bot] suffix,
  // or a "Bot" label in the comment header.
  const isBotHref = (href) =>
    /^\/apps\//.test(href) || /(\[bot\]|%5Bbot%5D)$/i.test(href);
  function isBotAuthor(header, authorLink) {
    if (authorLink) {
      if (isBotHref(authorLink.getAttribute('href') || '')) return true;
      if (/\[bot\]$/i.test(authorLink.textContent.trim())) return true;
    }
    if (!header) return false;
    for (const el of header.querySelectorAll('.Label, span')) {
      if (el.children.length === 0 && /^bot$/i.test(el.textContent.trim())) {
        return true;
      }
    }
    return false;
  }

  // The timeline as a flat list, in page order.
  // Each entry: { el, kind } where kind is 'bot', 'commit', 'break' or
  // 'other'. A 'commit' entry also has rows (the commit rows, in order).
  function readTimeline() {
    const out = [];
    const list = document.querySelector(ISSUE_LIST);
    if (list) {
      for (const li of list.children) {
        const comment = li.querySelector(ISSUE_COMMENT);
        if (!comment) {
          out.push({ el: li, kind: 'other' });
          continue;
        }
        const header = comment.querySelector('[data-testid="comment-header"]');
        const author =
          (header || comment).querySelector('[data-testid="avatar-link"]') ||
          (header || comment).querySelector('a[href^="/"]');
        out.push({ el: li, kind: isBotAuthor(header, author) ? 'bot' : 'other' });
      }
      return out;
    }
    // querySelectorAll with a selector list gives page order.
    for (const el of document.querySelectorAll(`${PR_ITEM}, ${PR_BREAK}`)) {
      if (!el.matches(PR_ITEM)) {
        out.push({ el, kind: 'break' });
        continue;
      }
      const type = (el.dataset.gid || '').split('_')[0];
      if (type === 'C') {
        const rows = [...el.querySelectorAll(PR_COMMIT_ROW)].filter((r) =>
          r.querySelector(PR_COMMIT_ROW_BODY),
        );
        out.push({ el, kind: rows.length ? 'commit' : 'other', rows });
        continue;
      }
      if (type === 'IC' || type === 'PRR') {
        const header = el.querySelector('.timeline-comment-header');
        const author = el.querySelector('a.author');
        if (isBotAuthor(header, author)) {
          out.push({ el, kind: 'bot' });
          continue;
        }
      }
      out.push({ el, kind: 'other' });
    }
    return out;
  }

  // ---- Slack theme: values ----------------------------------------------
  // The Slack sidebar theme: Sea Glass. To use a different Slack theme,
  // change only THEME_LIGHT and THEME_DARK.
  // The values are from the Slack web client (2026-11-13). Slack makes a
  // theme from color palettes (Sea Glass: "aquarium" and "aubergine") and
  // puts the result in --dt_color-theme-* tokens. The token of each value:
  //   topBar        window background (palette shade 10)
  //   sidebar       surf-inv-sec on the window background (Slack uses a
  //                 transparent layer; this is the color that you see)
  //   selected      base-inv-hgl-1, the selected row
  //   selectedText  content-hgl-1
  //   text          content-inv-pry
  //   accent        the line below the active tab (base-hgl-1 in light,
  //                 base-hgl-2 in dark)
  const THEME_LIGHT = {
    topBar: '#A9EDEF',
    sidebar: '#F6FDFD',
    selected: '#611F69',
    selectedText: '#F9EDFF',
    text: '#033640',
    accent: '#611F69',
  };
  const THEME_DARK = {
    topBar: '#053C48',
    sidebar: '#0C2329',
    selected: '#7D3986',
    selectedText: '#EFE1F5',
    text: '#F8F8F8',
    accent: '#BC80CE',
  };
  // Colors of the Slack app that are the same for each sidebar theme.
  const APP = {
    green: '#007A5A',
    greenHover: '#148567',
    greenActive: '#006B4F',
    red: '#E01E5A',
    yellow: '#ECB22E',
    link: '#1264A3',
    linkDark: '#1D9BD1',
    codeDark: '#E8912D',
  };
  const FONT = 'Lato, "Helvetica Neue", Helvetica, Arial, system-ui, sans-serif';
  const mix = (c, pct) => `color-mix(in srgb, ${c} ${pct}%, transparent)`;
  // CSS custom properties as declarations. All have !important, because
  // the Primer theme files set the same tokens with more specific selectors.
  const decls = (o) =>
    Object.entries(o)
      .map(([k, v]) => `  ${k}: ${v} !important;`)
      .join('\n');

  // Content colors (Slack message pane). Primer tokens plus the older
  // --color-* tokens that some Rails pages still use.
  function contentVars(c) {
    return {
      '--bgColor-default': c.bg,
      '--bgColor-muted': c.raised,
      '--bgColor-inset': c.inset,
      '--bgColor-neutral-muted': c.ink(0.08),
      '--bgColor-accent-muted': mix(c.link, 14),
      '--bgColor-accent-emphasis': APP.link,
      '--bgColor-success-emphasis': APP.green,
      '--bgColor-success-muted': mix(APP.green, 16),
      '--bgColor-attention-muted': mix(APP.yellow, 16),
      '--bgColor-danger-muted': mix(APP.red, 14),
      '--fgColor-default': c.text,
      '--fgColor-muted': c.muted,
      '--fgColor-accent': c.link,
      '--fgColor-link': c.link,
      '--fgColor-success': c.success,
      '--fgColor-danger': APP.red,
      '--borderColor-default': c.ink(0.13),
      '--borderColor-muted': c.ink(0.08),
      '--borderColor-translucent': c.ink(0.13),
      '--borderColor-emphasis': c.ink(0.3),
      '--borderColor-accent-emphasis': c.link,
      '--borderColor-accent-muted': mix(c.link, 40),
      '--button-primary-bgColor-rest': APP.green,
      '--button-primary-bgColor-hover': APP.greenHover,
      '--button-primary-bgColor-active': APP.greenActive,
      '--button-primary-borderColor-rest': 'transparent',
      '--button-primary-borderColor-hover': 'transparent',
      '--button-primary-fgColor-rest': '#fff',
      '--button-default-bgColor-rest': c.bg,
      '--button-default-bgColor-hover': c.raised,
      '--button-default-bgColor-active': c.ink(0.1),
      '--button-default-borderColor-rest': c.ink(0.3),
      '--button-default-borderColor-hover': c.ink(0.3),
      '--control-bgColor-rest': c.bg,
      '--control-bgColor-hover': c.raised,
      '--control-borderColor-rest': c.ink(0.3),
      '--control-transparent-bgColor-hover': c.ink(0.08),
      '--control-transparent-bgColor-active': c.ink(0.12),
      '--control-transparent-bgColor-selected': c.ink(0.1),
      '--overlay-bgColor': c.overlay,
      '--overlay-borderColor': c.ink(0.13),
      '--focus-outlineColor': APP.linkDark,
      '--underlineNav-borderColor-active': c.accent,
      '--color-canvas-default': c.bg,
      '--color-canvas-subtle': c.raised,
      '--color-canvas-inset': c.inset,
      '--color-canvas-overlay': c.overlay,
      '--color-fg-default': c.text,
      '--color-fg-muted': c.muted,
      '--color-accent-fg': c.link,
      '--color-border-default': c.ink(0.13),
      '--color-border-muted': c.ink(0.08),
      '--color-btn-primary-bg': APP.green,
      '--color-btn-primary-hover-bg': APP.greenHover,
      // Script values: inline code and the name color.
      '--tm-slack-code': c.code,
      '--tm-slack-code-bg': c.ink(0.04),
      '--tm-slack-code-border': c.ink(0.13),
      '--tm-slack-name': c.name,
    };
  }
  const CONTENT_LIGHT = contentVars({
    bg: '#fff',
    raised: '#F8F8F8',
    inset: '#F4F4F4',
    overlay: '#fff',
    text: '#1D1C1D',
    name: '#1D1C1D',
    muted: '#616061',
    link: APP.link,
    success: APP.green,
    code: APP.red,
    accent: THEME_LIGHT.accent,
    ink: (a) => `rgba(29, 28, 29, ${a})`,
  });
  const CONTENT_DARK = contentVars({
    bg: '#1A1D21',
    raised: '#222529',
    inset: '#16181B',
    overlay: '#222529',
    text: '#D1D2D3',
    name: '#E8E8E8',
    muted: '#ABABAD',
    link: APP.linkDark,
    success: '#2BAC76',
    code: APP.codeDark,
    accent: THEME_DARK.accent,
    ink: (a) => `rgba(232, 232, 232, ${a})`,
  });

  // Sidebar and top bar colors (the Slack sidebar theme). Primer components
  // in these areas read the same tokens, so the tokens are set again in the
  // area.
  function chromeVars(t, bg) {
    return {
      '--bgColor-default': bg,
      '--bgColor-muted': bg,
      '--bgColor-inset': t.topBar,
      '--bgColor-neutral-muted': mix(t.text, 12),
      '--fgColor-default': t.text,
      '--fgColor-muted': mix(t.text, 70),
      '--fgColor-accent': t.text,
      '--fgColor-link': t.text,
      '--borderColor-default': mix(t.text, 20),
      '--borderColor-muted': mix(t.text, 12),
      '--borderColor-accent-emphasis': t.accent,
      '--underlineNav-borderColor-active': t.accent,
      '--button-default-bgColor-rest': 'transparent',
      '--button-default-bgColor-hover': mix(t.text, 10),
      '--button-default-bgColor-active': mix(t.text, 16),
      '--button-default-borderColor-rest': mix(t.text, 25),
      '--button-default-borderColor-hover': mix(t.text, 35),
      '--button-default-fgColor-rest': t.text,
      '--button-invisible-fgColor-rest': t.text,
      '--button-invisible-iconColor-rest': mix(t.text, 80),
      '--control-bgColor-rest': mix(t.text, 8),
      '--control-bgColor-hover': mix(t.text, 12),
      '--control-borderColor-rest': mix(t.text, 25),
      '--control-transparent-bgColor-hover': mix(t.text, 10),
      '--control-transparent-bgColor-active': t.selected,
      '--control-transparent-bgColor-selected': t.selected,
      '--color-fg-default': t.text,
      '--color-fg-muted': mix(t.text, 70),
      '--tm-selected-text': t.selectedText,
      'color': t.text,
    };
  }
  // The areas. Class names with a hash are matched by their stable part.
  // Each area is a list of selectors.
  const FILE_TREE_PANE = '[class*="PageLayout-Pane-"]:has([role="tree"])';
  const TOP_BAR = ['header.GlobalNav', 'header.AppHeader', '.AppHeader'];
  const SIDEBARS = [
    'aside[class*="Sidebar__"]', // PR and issue lists
    FILE_TREE_PANE, // file trees
    '.feed-left-sidebar', // home page
  ];
  // Selected row in a sidebar
  const SIDEBAR_SELECTED = [
    ...SIDEBARS.map((s) => `${s} [aria-current]:not([aria-current="false"])`),
    ...SIDEBARS.map((s) => `${s} [role="treeitem"][aria-current="true"] > div`),
  ];
  const sel = (list) => list.join(', ');

  // Mode selectors. The Primer theme files use the same attributes.
  const LIGHT = '[data-color-mode]';
  const DARK = '[data-color-mode="dark"]';
  const AUTO = '[data-color-mode="auto"]';
  // The selector of an area in a mode.
  const inMode = (mode, area) => sel(area.map((a) => `${mode} ${a}`));
  // The rules of one mode: content colors, then the colors of the top bar
  // and the sidebars.
  const modeCss = (mode, content, theme) => `
${mode} {
${decls(content)}
}
${inMode(mode, TOP_BAR)} {
${decls(chromeVars(theme, theme.topBar))}
}
${inMode(mode, SIDEBARS)} {
${decls(chromeVars(theme, theme.sidebar))}
}`;

  // ---- Slack theme: Lato font -------------------------------------------
  // Slack uses Lato. The GitHub CSP blocks fonts from other hosts (font-src),
  // so the script gets the font files with GM_xmlhttpRequest and gives the
  // bytes to a FontFace (the CSP does not apply to bytes). The files are
  // kept with GM_setValue, so the script gets them only one time.
  // If this fails, the font stack falls back to Helvetica or Arial.
  const LATO_CSS =
    'https://fonts.googleapis.com/css2?family=Lato:wght@400;700;900&display=swap';
  const LATO_KEY = 'tm-gh-lato-v1';
  function gmGet(url, responseType) {
    return new Promise((resolve, reject) => {
      if (typeof GM_xmlhttpRequest !== 'function') return reject(new Error('no GM'));
      GM_xmlhttpRequest({
        method: 'GET',
        url,
        responseType,
        onload: (r) => (r.status === 200 ? resolve(r.response) : reject(new Error(r.status))),
        onerror: reject,
        ontimeout: reject,
      });
    });
  }
  const toB64 = (buf) => {
    let s = '';
    const bytes = new Uint8Array(buf);
    for (let i = 0; i < bytes.length; i += 0x8000) {
      s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    }
    return btoa(s);
  };
  const fromB64 = (b64) => Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0)).buffer;
  async function loadLato() {
    try {
      let files = typeof GM_getValue === 'function' ? GM_getValue(LATO_KEY, null) : null;
      if (!files) {
        // The latin part of each weight.
        const css = await gmGet(LATO_CSS, 'text');
        files = {};
        for (const m of css.matchAll(/\/\* latin \*\/\s*@font-face\s*{([^}]*)}/g)) {
          const weight = /font-weight:\s*(\d+)/.exec(m[1]);
          const url = /url\((https:[^)]+\.woff2)\)/.exec(m[1]);
          if (weight && url) files[weight[1]] = toB64(await gmGet(url[1], 'arraybuffer'));
        }
        if (!Object.keys(files).length) return;
        if (typeof GM_setValue === 'function') GM_setValue(LATO_KEY, files);
      }
      for (const [weight, b64] of Object.entries(files)) {
        const face = new FontFace('Lato', fromB64(b64), { weight, style: 'normal' });
        await face.load();
        document.fonts.add(face);
      }
    } catch (e) {
      console.warn('[gh tweaks] Lato not loaded', e);
    }
  }

  // ---- Slack theme: CSS -------------------------------------------------
  // The light rules have no mode condition, so they are the base. The dark
  // rules follow them and win when GitHub is in dark mode. Fonts and radii
  // are the same in each mode.
  const SLACK_THEME_CSS = `
${LIGHT} {
  --fontStack-system: ${FONT} !important;
  --fontStack-sansSerif: ${FONT} !important;
  --fontStack-sansSerifDisplay: ${FONT} !important;
  --borderRadius-medium: 0.5rem !important;
}
${modeCss(LIGHT, CONTENT_LIGHT, THEME_LIGHT)}
${modeCss(DARK, CONTENT_DARK, THEME_DARK)}
@media (prefers-color-scheme: dark) {
${modeCss(AUTO, CONTENT_DARK, THEME_DARK)}
}
body, .markdown-body, button, input, select, textarea {
  font-family: ${FONT} !important;
}
body { background-color: var(--bgColor-default) !important; }
${sel(TOP_BAR)} {
  background-color: var(--bgColor-default) !important;
  border-bottom: 1px solid var(--borderColor-muted) !important;
}
${sel(SIDEBARS)} {
  background-color: var(--bgColor-default) !important;
  color: var(--fgColor-default) !important;
}
${FILE_TREE_PANE} {
  border-radius: 8px;
  padding-top: 8px;
}
/* Selected sidebar row: the "selected" colors of the sidebar theme */
${sel(SIDEBAR_SELECTED)} {
  background-color: var(--control-transparent-bgColor-selected) !important;
  color: var(--tm-selected-text) !important;
}
/* Regular weight (not bold) for nav tabs, sidebar rows, and the options
   in menus and lists */
.UnderlineNav-item, [class*="UnderlineNav-UnderlineItem"],
[class*="UnderlineNav-UnderlineItem"] [data-content],
.tabnav-tab, nav[class*="TabNav"] a, .SideNav-item, .menu-item,
.SelectMenu-item, .ActionListContent, [class*="ActionList-ActionListContent"],
[class*="ActionList-ItemLabel"], [role="menuitem"], [role="menuitemradio"],
[role="menuitemcheckbox"], [role="option"], [role="treeitem"] {
  font-weight: 400 !important;
}
/* Primary buttons: bold Lato, as in Slack */
.btn-primary, [data-variant="primary"] {
  font-weight: 700 !important;
}
`;

  // Slack messages: the markup of a comment.
  // PR pages (Rails markup)
  const PR_COMMENT = '.js-discussion .timeline-comment';
  const PR_DESCRIPTION = '.js-discussion .js-command-palette-pull-body .timeline-comment';
  const PR_AVATAR = '.js-discussion .TimelineItem-avatar';
  // Issue pages (React markup). A row is a comment or an event. Only a
  // comment row has a header. The issue description has its own markup.
  const ISSUE_ROW = '[data-testid^="timeline-row-border-"]';
  const ISSUE_HEADER = '[data-testid="comment-header"]';
  const ISSUE_BODY_BOX = '[data-testid="issue-body"] [class*="commentBorder"]';

  const SLACK_MESSAGES_CSS = `
/* Square avatars (Slack uses rounded squares) */
img.avatar-user, .avatar-user, .TimelineItem-avatar.circle,
img[data-testid="github-avatar"], img[class*="prc-Avatar-Avatar"],
.TimelineItem-avatar img {
  border-radius: 22% !important;
}

/* PR pages (Rails): a comment without a box and without an arrow */
${PR_COMMENT} {
  border: 0 !important;
  background: transparent !important;
  box-shadow: none !important;
  border-radius: 8px !important;
}
${PR_COMMENT}--caret::before,
${PR_COMMENT}--caret::after {
  display: none !important;
}
${PR_COMMENT}-header {
  background: transparent !important;
  border-bottom: 0 !important;
  min-height: 0 !important;
}
${PR_COMMENT} .comment-body {
  padding-top: 0 !important;
}
${PR_COMMENT}:hover {
  background: var(--bgColor-muted) !important;
}
/* The PR description: a thin border, and no highlight on hover */
${PR_DESCRIPTION} {
  border: 1px solid var(--borderColor-default) !important;
}
${PR_DESCRIPTION}:hover {
  background: transparent !important;
}
/* The avatar of a PR comment: 36px, with a 12px space before the text */
${PR_AVATAR} {
  left: -64px !important;
}
${PR_AVATAR} img {
  width: 36px !important;
  height: 36px !important;
}
/* Name: bold, as in Slack */
.js-discussion a.author, .review-comment a.author {
  font-weight: 900 !important;
  color: var(--tm-slack-name) !important;
}
/* No vertical timeline line */
.js-discussion .TimelineItem::before,
.js-discussion .TimelineItem-break,
.discussion-timeline-actions .TimelineItem::before {
  display: none !important;
}

/* Issue pages (React) */
${ISSUE_ROW},
${ISSUE_BODY_BOX} {
  border: 0 !important;
  background: transparent !important;
  box-shadow: none !important;
  border-radius: 6px !important;
}
${ISSUE_ROW}:hover,
${ISSUE_BODY_BOX}:hover {
  background: var(--bgColor-muted) !important;
}
${ISSUE_HEADER},
[data-testid="issue-body"] [class*="IssueBodyHeaderContainer"] {
  background: transparent !important;
  border-bottom: 0 !important;
}
${ISSUE_HEADER} [data-testid="avatar-link"],
[data-testid="issue-body-header-author"] {
  font-weight: 900 !important;
  color: var(--tm-slack-name) !important;
}
/* The avatar: 36px, in a column at the left of the message */
${ISSUE_ROW}:has(${ISSUE_HEADER}),
${ISSUE_BODY_BOX} {
  position: relative !important;
  padding-left: 48px !important;
}
${ISSUE_HEADER} [class*="AvatarContainer"],
[data-testid="issue-body"] [class*="avatarContainer"] {
  position: absolute !important;
  left: 8px !important;
  top: 8px !important;
}
${ISSUE_HEADER} img[data-testid="github-avatar"],
[data-testid="issue-body"] [class*="avatarContainer"] img {
  width: 36px !important;
  height: 36px !important;
}
/* The issue description: the same look as a PR description. The avatar
   is at the left of the box (12px space), the box has a thin border, and
   there is no highlight on hover. */
[data-testid="issue-body"] [class*="headerRow"] {
  padding-left: 48px !important;
}
${ISSUE_BODY_BOX} {
  border: 1px solid var(--borderColor-default) !important;
  border-radius: 8px !important;
  padding-left: 0 !important;
  overflow: visible !important;
}
${ISSUE_BODY_BOX}:hover {
  background: transparent !important;
}
[data-testid="issue-body"] [class*="avatarContainer"] {
  left: -48px !important;
  top: 0 !important;
}
[data-testid="timeline-divider-connector"] {
  visibility: hidden !important;
}

/* Inline code: Slack red (light) or orange (dark) in a small box */
.markdown-body :not(pre) > code, .comment-body :not(pre) > code,
.markdown-title code {
  color: var(--tm-slack-code) !important;
  background: var(--tm-slack-code-bg) !important;
  border: 1px solid var(--tm-slack-code-border) !important;
  border-radius: 3px !important;
  padding: 2px 3px 1px !important;
  font-size: 12px !important;
}
/* Code blocks */
.markdown-body pre, .markdown-body .highlight pre {
  background: var(--tm-slack-code-bg) !important;
  border: 1px solid var(--tm-slack-code-border) !important;
  border-radius: 4px !important;
}
/* Comment box: a box with a 1px border and 8px corners */
.CommentBox, .timeline-new-comment .previewable-comment-form {
  border-radius: 8px !important;
}
`;

  // No bold: the links that show a username. A mention in a comment
  // (@name) is not in this list.
  const NO_BOLD_ROOT = ':root:root:root:root:root';
  const USERNAMES = [
    'a.author', // PR pages: comments and events
    '[data-testid="avatar-link"]', // issue pages: comment author
    '[data-testid="issue-body-header-author"]', // issue pages: issue author
    '[data-testid="actor-link"]', // issue pages: events
    'a[data-hovercard-type="user"]:not(.user-mention)', // other Rails pages
    'a[data-hovercard-url*="/users/"]:not(.user-mention)', // other React pages
  ];

  // ---- Slack theme: color mode ------------------------------------------
  // When SLACK_MODE is 'dark' or 'light', the script sets that mode on the
  // page. GitHub loads the CSS file of a theme only when the theme is in
  // use, so the script also loads that file.
  function forceColorMode() {
    if (SLACK_MODE !== 'dark' && SLACK_MODE !== 'light') return;
    const html = document.documentElement;
    const theme = SLACK_MODE; // the 'dark' and 'light' Primer themes
    if (html.getAttribute('data-color-mode') !== SLACK_MODE) {
      html.setAttribute('data-color-mode', SLACK_MODE);
    }
    const attr = `data-${SLACK_MODE}-theme`;
    if (html.getAttribute(attr) !== theme) html.setAttribute(attr, theme);
    const link = document.querySelector(`link[data-color-theme="${theme}"]`);
    if (link && !link.getAttribute('href') && link.dataset.href) {
      link.setAttribute('href', link.dataset.href);
    }
  }

  // ---- Shared render loop -----------------------------------------------
  // GitHub changes the page a lot (Turbo navigation, lazy timeline items,
  // live updates). One MutationObserver schedules one render per frame.
  // The observer stops while a render changes the page, so a render does
  // not cause a new render.
  const renderers = [];
  let frame = 0;
  const observer = new MutationObserver(schedule);
  const watchPage = () =>
    observer.observe(document.documentElement, { childList: true, subtree: true });
  function renderAll() {
    frame = 0;
    observer.disconnect();
    try {
      ensureStyles();
      const timeline = readTimeline();
      for (const r of renderers) r(timeline);
    } finally {
      watchPage();
    }
  }
  function schedule() {
    if (!frame) frame = requestAnimationFrame(renderAll);
  }

  // ---- Tweaks -----------------------------------------------------------
  // To add a change: add an entry with an id, an enabled flag, and css.
  // An optional init() function is for changes that need JavaScript.
  // An init() can add a renderer: a function that gets the timeline list.
  // Renderers run in array order.
  const TWEAKS = [
    {
      id: 'base',
      enabled: true,
      css: `
        .${HIDDEN} { display: none !important; }
        .${CTRL} {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 12px;
          color: var(--fgColor-muted, #59636e);
        }
        .${CTRL} button {
          font: inherit;
          font-weight: 600;
          color: var(--fgColor-accent, #0969da);
          background: none;
          border: 0;
          padding: 0;
          cursor: pointer;
        }
        .${CTRL} button:hover { text-decoration: underline; }
      `,
    },
    {
      // A bar above the timeline: "3 bot comments hidden · Show".
      // The count is the number of bot comments that GitHub has loaded.
      // The bar is not shown when there are no bot comments.
      id: 'hide-bot-comments',
      enabled: true,
      css: `
        .tm-gh-bots {
          margin: 16px 0;
          padding: 6px 12px;
          border: 1px solid var(--borderColor-default, #d1d9e0);
          border-radius: 6px;
          background: var(--bgColor-muted, #f6f8fa);
        }
      `,
      init() {
        let hide = store.get(BOTS_KEY, true);
        let bar = null;

        function makeBar() {
          const el = document.createElement('div');
          el.className = `${CTRL} tm-gh-bots`;
          el.append(document.createElement('span'), document.createElement('button'));
          el.lastChild.type = 'button';
          el.lastChild.addEventListener('click', () => {
            hide = !hide;
            store.set(BOTS_KEY, hide);
            renderAll();
          });
          return el;
        }

        // Other tabs can change the setting.
        window.addEventListener('storage', (e) => {
          if (e.key !== BOTS_KEY) return;
          hide = store.get(BOTS_KEY, true);
          schedule();
        });

        renderers.push((timeline) => {
          const bots = timeline.filter((t) => t.kind === 'bot');
          for (const t of bots) t.el.classList.toggle(HIDDEN, hide);

          const anchor =
            document.querySelector(ISSUE_LIST) ||
            document.querySelector('.js-discussion');
          if (!anchor || bots.length === 0) {
            if (bar) bar.remove();
            return;
          }
          if (!bar) bar = makeBar();
          if (anchor.previousElementSibling !== bar) anchor.before(bar);
          const n = bots.length;
          bar.firstChild.textContent = hide
            ? `${plural(n, 'bot comment')} hidden`
            : `${plural(n, 'bot comment')} shown`;
          bar.lastChild.textContent = hide ? 'Show' : 'Hide';
        });
      },
    },
    {
      // Long runs of commits: show the first COMMITS_KEEP commits and put
      // the remaining commits behind a "Show N more commits" control.
      // The control stays in the same place when it expands the run, and
      // its label then is "Hide N commits", with the same N.
      // A bot comment that is hidden does not stop a run, because it is
      // not visible. When bot comments are shown, they stop the run again.
      id: 'collapse-commit-runs',
      enabled: true,
      css: `
        .tm-gh-commits {
          margin: 0 0 8px 50px;
          padding: 4px 0;
        }
      `,
      init() {
        // Runs that the user expanded. The key is the href of the first
        // hidden commit, so the state stays when GitHub draws the run again.
        const expanded = new Set();

        const keyOf = (row) => {
          const a = row.querySelector('a[href*="/commits/"], a[href*="/commit/"]');
          return a ? a.getAttribute('href') : row.textContent.trim().slice(0, 80);
        };

        renderers.push((timeline) => {
          // Remove the result of the last render.
          for (const c of document.querySelectorAll('.tm-gh-commits')) c.remove();
          for (const el of document.querySelectorAll(`.tm-gh-commit-hidden`)) {
            el.classList.remove(HIDDEN, 'tm-gh-commit-hidden');
          }

          // Make the runs. An item that is hidden is transparent.
          const runs = [];
          let run = null;
          for (const t of timeline) {
            if (t.el.classList.contains(HIDDEN)) continue;
            if (t.kind === 'commit') {
              if (!run) runs.push((run = []));
              run.push(t);
            } else {
              run = null;
            }
          }

          for (const items of runs) {
            const rows = items.flatMap((t) => t.rows);
            const hidden = rows.slice(COMMITS_KEEP);
            if (hidden.length < COMMITS_MIN_HIDDEN) continue;

            const key = keyOf(hidden[0]);
            const open = expanded.has(key);
            const n = hidden.length;

            const ctrl = document.createElement('div');
            ctrl.className = `${CTRL} tm-gh-commits`;
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.textContent = open
              ? `Hide ${plural(n, 'commit')}`
              : `Show ${n} more ${n === 1 ? 'commit' : 'commits'}`;
            btn.setAttribute('aria-expanded', String(open));
            btn.addEventListener('click', () => {
              if (expanded.has(key)) expanded.delete(key);
              else expanded.add(key);
              renderAll();
            });
            ctrl.append(btn);
            // Put the control after the last commit that stays visible.
            rows[COMMITS_KEEP - 1].after(ctrl);

            if (open) continue;
            for (const row of hidden) row.classList.add(HIDDEN, 'tm-gh-commit-hidden');
            // An item with all of its commits hidden: hide the full item,
            // also its "added N commits" header.
            for (const t of items) {
              if (t.rows.every((r) => r.classList.contains('tm-gh-commit-hidden'))) {
                t.el.classList.add(HIDDEN, 'tm-gh-commit-hidden');
              }
            }
          }
        });
      },
    },
    {
      // Slack look and feel with a Slack sidebar theme (Sea Glass): Slack
      // colors in the content, the sidebar theme in the top bar and the
      // sidebars, Lato font, Slack green buttons. See SLACK_MODE for the
      // color mode.
      id: 'slack-theme',
      enabled: true,
      css: SLACK_THEME_CSS,
      init() {
        forceColorMode();
        renderers.push(forceColorMode);
        // GitHub can set the mode again (settings page, Turbo navigation).
        new MutationObserver(forceColorMode).observe(document.documentElement, {
          attributes: true,
          attributeFilter: ['data-color-mode', 'data-dark-theme', 'data-light-theme'],
        });
        loadLato();
      },
    },
    {
      // Slack layout for PR and issue timelines: messages without a box,
      // a square avatar, a bold name, and a highlight on hover. Slack
      // inline code and code blocks. Colors come from the theme tokens.
      id: 'slack-messages',
      enabled: true,
      css: SLACK_MESSAGES_CSS,
    },
    {
      // No bold text: all text has the regular weight (400). This includes
      // titles, headings, tabs, buttons, labels and bold text in comments.
      // Only usernames stay bold (see USERNAMES).
      // Set enabled to false to get the bold text back.
      // The selector repeats :root to win against the weights that GitHub
      // and the other tweaks of this script set with !important.
      id: 'no-bold',
      enabled: true,
      css: `
${USERNAMES.map((n) => `${NO_BOLD_ROOT} ${n}, ${NO_BOLD_ROOT} ${n} *`).join(',\n')} {
  font-weight: 700 !important;
}
:root:root:root:root:root {
  --base-text-weight-medium: 400 !important;
  --base-text-weight-semibold: 400 !important;
}
:root:root:root:root:root *,
:root:root:root:root:root *::before,
:root:root:root:root:root *::after {
  font-weight: 400 !important;
}
`,
    },
  ];

  // ---- Loader -----------------------------------------------------------
  // Turbo navigation can replace <head>. Each render adds the styles again
  // if they are not in the page.
  function ensureStyles() {
    for (const t of TWEAKS) {
      if (!t.enabled || !t.css || document.getElementById(`tm-tweak-${t.id}`)) continue;
      const style = document.createElement('style');
      style.id = `tm-tweak-${t.id}`;
      style.textContent = t.css;
      (document.head || document.documentElement).appendChild(style);
    }
  }
  ensureStyles();
  for (const t of TWEAKS) {
    if (t.enabled && typeof t.init === 'function') t.init();
  }

  watchPage();
  // Turbo navigation can replace <body>. These events also start a render.
  for (const type of ['turbo:load', 'turbo:render', 'pjax:end', 'popstate']) {
    document.addEventListener(type, schedule);
    window.addEventListener(type, schedule);
  }
  schedule();
})();
