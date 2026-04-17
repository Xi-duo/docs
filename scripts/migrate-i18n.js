#!/usr/bin/env node
/* eslint-env node */
/* eslint-disable no-console, @typescript-eslint/no-var-requires */
/**
 * migrate-i18n.js
 *
 * 将 thunderbit-landing-page 的扁平化 i18n JSON 迁移到 Mintlify 的
 * 物理文件夹 + versions 多语言结构。
 *
 * 源格式（landing-page）:
 *   apps/main/src/lib/docs/i18n/<locale>.json
 *   {
 *     "info.title": "...",
 *     "distill.summary": "...",
 *     "distill.params.url": "..."
 *   }
 *
 * 目标格式（Mintlify）:
 *   <locale>/introduction.mdx
 *   <locale>/api-reference/endpoints/<endpoint>.mdx
 *
 * 用法:
 *   node scripts/migrate-i18n.js
 *   node scripts/migrate-i18n.js --dry-run
 *   node scripts/migrate-i18n.js --locale zh-Hans
 */

'use strict';

const fs = require('fs');
const path = require('path');

// ─── 配置区 ─────────────────────────────────────────────────────────
// 改这里的路径就能接上你本地的 landing-page 项目
const SOURCE_I18N_DIR = path.resolve(
  __dirname,
  '../../thunderbit-landing-page/apps/main/src/lib/docs/i18n'
);
const SOURCE_OPENAPI = path.resolve(
  __dirname,
  '../../thunderbit-landing-page/apps/main/public/openapi.json'
);
const TARGET_ROOT = path.resolve(__dirname, '..');

// 源 locale → Mintlify version 映射
// Mintlify 的 version slug 必须跟 mint.json 的 versions 数组对齐
const LOCALE_MAP = {
  en: 'en',
  'zh-Hans': 'zh',
  'zh-Hant': 'zh-tw',
  ja: 'ja',
  ko: 'ko',
  es: 'es',
  fr: 'fr',
  de: 'de',
  it: 'it',
  pt: 'pt',
  nl: 'nl',
};

// i18n key 前缀 → 目标 MDX 文件 + 端点 openapi 引用
// 顺序即生成顺序；添加新端点只需在这里加一行
const KEY_GROUPS = [
  {
    prefix: 'info',
    targetRelPath: 'introduction.mdx',
    kind: 'overview',
  },
  {
    prefix: 'distill',
    targetRelPath: 'api-reference/endpoints/distill.mdx',
    kind: 'endpoint',
    openapi: 'POST /distill',
  },
  {
    prefix: 'batchDistill',
    targetRelPath: 'api-reference/endpoints/batch-distill.mdx',
    kind: 'endpoint',
    openapi: 'POST /batch/distill',
  },
  {
    prefix: 'getBatchDistillStatus',
    targetRelPath: 'api-reference/endpoints/batch-distill-status.mdx',
    kind: 'endpoint',
    openapi: 'GET /batch/distill/{id}',
  },
  {
    prefix: 'extract',
    targetRelPath: 'api-reference/endpoints/extract.mdx',
    kind: 'endpoint',
    openapi: 'POST /extract',
  },
  {
    prefix: 'batchExtract',
    targetRelPath: 'api-reference/endpoints/extract-batch.mdx',
    kind: 'endpoint',
    openapi: 'POST /extract/batch',
  },
  {
    prefix: 'getBatchExtractStatus',
    targetRelPath: 'api-reference/endpoints/extract-batch-status.mdx',
    kind: 'endpoint',
    openapi: 'GET /extract/batch/{id}',
  },
  {
    prefix: 'errors',
    targetRelPath: 'api-reference/overview.mdx',
    kind: 'errorTable',
  },
];

// ─── CLI 参数 ───────────────────────────────────────────────────────
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const LOCALE_FILTER = (() => {
  const i = args.indexOf('--locale');
  return i >= 0 ? args[i + 1] : null;
})();

// ─── 主流程 ─────────────────────────────────────────────────────────
function main() {
  if (!fs.existsSync(SOURCE_I18N_DIR)) {
    console.error(`[migrate-i18n] source not found: ${SOURCE_I18N_DIR}`);
    process.exit(1);
  }

  const sourceLocales = fs
    .readdirSync(SOURCE_I18N_DIR)
    .filter(f => f.endsWith('.json'))
    .map(f => path.basename(f, '.json'));

  console.log(`[migrate-i18n] found ${sourceLocales.length} source locales`);

  for (const srcLocale of sourceLocales) {
    if (LOCALE_FILTER && LOCALE_FILTER !== srcLocale) continue;

    const version = LOCALE_MAP[srcLocale];
    if (!version) {
      console.warn(`[migrate-i18n] skip unmapped locale: ${srcLocale}`);
      continue;
    }

    const jsonPath = path.join(SOURCE_I18N_DIR, `${srcLocale}.json`);
    const strings = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    const grouped = groupByPrefix(strings);

    for (const group of KEY_GROUPS) {
      const bag = grouped[group.prefix];
      if (!bag || Object.keys(bag).length === 0) continue;

      const targetPath = path.join(TARGET_ROOT, version, group.targetRelPath);
      const mdx = renderMdx(group, bag, srcLocale);

      writeFile(targetPath, mdx);
    }
  }

  console.log('[migrate-i18n] done');
}

// ─── 分组：扁平 key 按顶级前缀聚合 ──────────────────────────────────
// { "distill.summary": "...", "distill.params.url": "..." }
// → { distill: { summary: "...", "params.url": "..." } }
function groupByPrefix(strings) {
  const out = {};
  for (const [key, value] of Object.entries(strings)) {
    const firstDot = key.indexOf('.');
    if (firstDot < 0) continue;
    const prefix = key.slice(0, firstDot);
    const rest = key.slice(firstDot + 1);
    if (!out[prefix]) out[prefix] = {};
    out[prefix][rest] = value;
  }
  return out;
}

// ─── 渲染：按 kind 分发 MDX 模板 ────────────────────────────────────
function renderMdx(group, bag, srcLocale) {
  switch (group.kind) {
    case 'endpoint':
      return renderEndpoint(group, bag);
    case 'overview':
      return renderOverview(bag, srcLocale);
    case 'errorTable':
      return renderErrorTable(bag);
    default:
      return '';
  }
}

function renderEndpoint(group, bag) {
  const title = bag.summary || group.openapi;
  return [
    '---',
    `title: ${JSON.stringify(title)}`,
    `openapi: ${JSON.stringify(group.openapi)}`,
    '---',
    '',
    // Mintlify 会从 openapi.json 自动渲染参数/响应表。
    // 下面的正文是可选的补充说明。如果源 json 有 description 就注入。
    bag.description ? `${bag.description.trim()}\n` : '',
  ].join('\n');
}

function renderOverview(bag, srcLocale) {
  return [
    '---',
    `title: ${JSON.stringify(bag.title || 'Introduction')}`,
    `description: ${JSON.stringify(bag.introductionTitle || 'Get Started')}`,
    '---',
    '',
    bag.description ? bag.description.trim() : '',
    '',
  ].join('\n');
}

function renderErrorTable(bag) {
  // errors.INVALID_URL / errors.UNAUTHORIZED / ... → Markdown 表格
  const rows = Object.entries(bag)
    .filter(([k]) => k !== 'description' && k !== 'message')
    .map(([code, msg]) => `| \`${code}\` | ${msg} |`)
    .join('\n');

  return [
    '---',
    'title: "API Overview"',
    '---',
    '',
    '## Error Codes',
    '',
    '| Code | Meaning |',
    '| ---- | ------- |',
    rows,
    '',
    bag.description ? `\n${bag.description.trim()}\n` : '',
  ].join('\n');
}

// ─── 写文件 ─────────────────────────────────────────────────────────
function writeFile(filePath, content) {
  if (DRY_RUN) {
    console.log(`[dry-run] would write ${filePath} (${content.length} bytes)`);
    return;
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
  console.log(`[write] ${path.relative(TARGET_ROOT, filePath)}`);
}

// ─── 辅助：同步 openapi.json 到 Mintlify 根目录 ──────────────────────
// 每次迁移都保证 openapi.json 是 landing-page 的最新版
function syncOpenapi() {
  if (!fs.existsSync(SOURCE_OPENAPI)) return;
  const target = path.join(TARGET_ROOT, 'openapi.json');
  if (DRY_RUN) {
    console.log('[dry-run] would copy openapi.json');
    return;
  }
  fs.copyFileSync(SOURCE_OPENAPI, target);
  console.log('[sync] openapi.json');
}

if (require.main === module) {
  syncOpenapi();
  main();
}

module.exports = { groupByPrefix, renderMdx, LOCALE_MAP, KEY_GROUPS };
