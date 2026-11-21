#!/usr/bin/env node
// Validates the extension manifest and the EVO Afterdark theme files.
// Usage: npm test

'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const errors = [];

// Each EVO variant and the original Evro Dark theme whose TextMate rules it keeps.
const expectedThemes = {
  'EVO | Neon': 'themes/EvroDark.json',
  'EVO | Void': 'themes/EvroDarkerFlat.json',
};

// Semantic token categories that must be styled, and the selectors that cover them.
const semanticCategories = {
  keywords: ['keyword'],
  types: ['type', 'class', 'interface', 'enum'],
  methods: ['method'],
  functions: ['function'],
  properties: ['property'],
  constants: ['variable.readonly', 'enumMember'],
  strings: ['string'],
  comments: ['comment'],
  diagnostics: ['*.deprecated'],
};

// Workbench colors for the surfaces the themes must style.
const ansi = ['Black', 'Red', 'Green', 'Yellow', 'Blue', 'Magenta', 'Cyan', 'White'];
const requiredColors = [
  'editor.background', 'editor.foreground', 'editor.selectionBackground', 'editorCursor.foreground',
  'tab.activeBackground', 'tab.activeForeground', 'tab.inactiveBackground', 'tab.activeBorderTop',
  'sideBar.background', 'sideBar.foreground', 'list.activeSelectionBackground', 'list.hoverBackground',
  'quickInput.background', 'quickInputList.focusBackground', 'pickerGroup.foreground',
  'panel.background', 'panel.border', 'panelTitle.activeBorder',
  'terminal.background', 'terminal.foreground', 'terminalCursor.foreground',
  ...ansi.flatMap((c) => [`terminal.ansi${c}`, `terminal.ansiBright${c}`]),
  'gitDecoration.addedResourceForeground', 'gitDecoration.modifiedResourceForeground',
  'gitDecoration.deletedResourceForeground', 'gitDecoration.untrackedResourceForeground',
  'diffEditor.insertedTextBackground', 'diffEditor.removedTextBackground',
  'editorGutter.addedBackground', 'editorGutter.modifiedBackground', 'editorGutter.deletedBackground',
  'editorError.foreground', 'editorWarning.foreground', 'editorInfo.foreground',
  'chat.requestBackground', 'chat.slashCommandForeground', 'inlineChat.background',
];

const hexColor = /^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

function fail(message) {
  errors.push(message);
}

function readJson(relativePath) {
  const file = path.join(root, relativePath);
  if (!fs.existsSync(file)) {
    fail(`${relativePath}: file not found`);
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    fail(`${relativePath}: invalid JSON (${error.message})`);
    return null;
  }
}

function checkColor(where, value) {
  if (typeof value !== 'string' || !hexColor.test(value)) {
    fail(`${where}: invalid color ${JSON.stringify(value)}`);
  }
}

function validateTheme(label, themePath) {
  const theme = readJson(themePath);
  const source = readJson(expectedThemes[label]);
  if (!theme || !source) return;

  if (theme.name !== label) fail(`${themePath}: name is ${JSON.stringify(theme.name)}, expected ${JSON.stringify(label)}`);

  // Workbench colors
  const colors = theme.colors || {};
  for (const [key, value] of Object.entries(colors)) checkColor(`${themePath} colors.${key}`, value);
  for (const key of requiredColors) {
    if (!(key in colors)) fail(`${themePath}: missing workbench color ${key}`);
  }

  // TextMate rules: same count, order, names, scopes and font styles as the Evro source.
  const rules = Array.isArray(theme.tokenColors) ? theme.tokenColors : [];
  const sourceRules = source.tokenColors;
  if (rules.length !== sourceRules.length) {
    fail(`${themePath}: ${rules.length} tokenColors rules, expected ${sourceRules.length} from ${expectedThemes[label]}`);
  }
  rules.forEach((rule, i) => {
    const original = sourceRules[i] || {};
    const settings = rule.settings || {};
    if (JSON.stringify(rule.scope) !== JSON.stringify(original.scope)) fail(`${themePath}: tokenColors[${i}] scope differs from ${expectedThemes[label]}`);
    if (rule.name !== original.name) fail(`${themePath}: tokenColors[${i}] name differs from ${expectedThemes[label]}`);
    if (settings.fontStyle !== (original.settings || {}).fontStyle) fail(`${themePath}: tokenColors[${i}] fontStyle differs from ${expectedThemes[label]}`);
    if ('foreground' in settings) checkColor(`${themePath} tokenColors[${i}].foreground`, settings.foreground);
    if ('background' in settings) checkColor(`${themePath} tokenColors[${i}].background`, settings.background);
  });

  // Semantic tokens
  if (theme.semanticHighlighting !== true) fail(`${themePath}: semanticHighlighting must be true`);
  const semantic = theme.semanticTokenColors || {};
  for (const [selector, value] of Object.entries(semantic)) {
    if (typeof value === 'string') checkColor(`${themePath} semanticTokenColors.${selector}`, value);
    else if (value && typeof value === 'object') {
      if ('foreground' in value) checkColor(`${themePath} semanticTokenColors.${selector}.foreground`, value.foreground);
    } else fail(`${themePath}: semanticTokenColors.${selector} has an invalid value`);
  }
  const missing = [];
  for (const [category, selectors] of Object.entries(semanticCategories)) {
    for (const selector of selectors) if (!(selector in semantic)) missing.push(`${category} (${selector})`);
  }
  if (missing.length) fail(`${themePath}: semanticTokenColors missing ${missing.join(', ')}`);

  console.log(
    `${label} (${themePath}): ${rules.length}/${sourceRules.length} tokenColors rules kept from ${expectedThemes[label]}, ` +
      `${Object.keys(colors).length} workbench colors, ${Object.keys(semantic).length} semantic selectors ` +
      `covering ${Object.keys(semanticCategories).join(', ')}`,
  );
}

const manifest = readJson('package.json');
if (manifest) {
  if (manifest.icon && !fs.existsSync(path.join(root, manifest.icon))) fail(`package.json: icon ${manifest.icon} not found`);
  const themes = ((manifest.contributes || {}).themes) || [];
  const labels = themes.map((t) => t.label);
  if (JSON.stringify(labels) !== JSON.stringify(Object.keys(expectedThemes))) {
    fail(`package.json: contributes.themes labels are ${JSON.stringify(labels)}, expected ${JSON.stringify(Object.keys(expectedThemes))}`);
  }
  for (const theme of themes) {
    if (theme.uiTheme !== 'vs-dark') fail(`package.json: theme ${theme.label} uiTheme is ${theme.uiTheme}, expected vs-dark`);
    const resolved = path.resolve(root, theme.path || '');
    if (!theme.path || !resolved.startsWith(root + path.sep) || !fs.existsSync(resolved)) {
      fail(`package.json: theme ${theme.label} path ${theme.path} does not resolve to a file in the extension`);
      continue;
    }
    console.log(`package.json: "${theme.label}" -> ${theme.path} resolves`);
    if (theme.label in expectedThemes) validateTheme(theme.label, path.relative(root, resolved));
  }
}

if (errors.length) {
  console.error(`\n${errors.length} validation error(s):`);
  for (const message of errors) console.error(`  - ${message}`);
  process.exit(1);
}
console.log('\nAll theme validation checks passed.');
