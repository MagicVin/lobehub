import { Readability } from '@mozilla/readability';
import { Window } from 'happy-dom';
import type { TranslatorConfigObject } from 'node-html-markdown';
import { NodeHtmlMarkdown } from 'node-html-markdown';

import type { FilterOptions } from '../type';

/** Truncate HTML to 1 MB before DOM parsing to prevent CPU spikes on large pages */
export const MAX_HTML_SIZE = 1024 * 1024;
const MIN_USEFUL_CONTENT_LENGTH = 100;

const cleanObj = <T extends object>(
  obj: T,
): {
  [K in keyof T as T[K] extends null ? never : K]: T[K];
} => Object.fromEntries(Object.entries(obj).filter(([, value]) => value !== null)) as any;

const getTag = (html: string, tagName: 'body' | 'html') => {
  const lowerHtml = html.toLowerCase();
  const openTagStart = lowerHtml.indexOf(`<${tagName}`);

  if (openTagStart === -1) return `<${tagName}>`;

  const openTagEnd = html.indexOf('>', openTagStart);

  if (openTagEnd === -1) return `<${tagName}>`;

  return html.slice(openTagStart, openTagEnd + 1);
};

const getTitle = (html: string) => {
  const lowerHtml = html.toLowerCase();
  const start = lowerHtml.indexOf('<title');

  if (start === -1) return '';

  const openEnd = html.indexOf('>', start);
  if (openEnd === -1) return '';

  const closeStart = lowerHtml.indexOf('</title>', openEnd + 1);
  if (closeStart === -1) return '';

  return html.slice(start, closeStart + '</title>'.length);
};

const getMeta = (html: string) => {
  const lowerHtml = html.toLowerCase();
  const needles = [
    'name="description"',
    "name='description'",
    'property="og:title"',
    "property='og:title'",
    'property="og:description"',
    "property='og:description'",
  ];

  for (const needle of needles) {
    const needleIndex = lowerHtml.indexOf(needle);

    if (needleIndex === -1) continue;

    const metaStart = lowerHtml.lastIndexOf('<meta', needleIndex);
    if (metaStart === -1) continue;

    const metaEnd = html.indexOf('>', metaStart);
    if (metaEnd === -1 || needleIndex > metaEnd) continue;

    return html.slice(metaStart, metaEnd + 1);
  }

  return '';
};

const trimHtmlForParsing = (rawHtml: string) => {
  if (rawHtml.length <= MAX_HTML_SIZE) return rawHtml;

  const lowerHtml = rawHtml.toLowerCase();
  const bodyStartTagStart = lowerHtml.indexOf('<body');

  if (bodyStartTagStart === -1) return rawHtml.slice(0, MAX_HTML_SIZE);

  const bodyStartTagEnd = rawHtml.indexOf('>', bodyStartTagStart);
  if (bodyStartTagEnd === -1) return rawHtml.slice(0, MAX_HTML_SIZE);

  const bodyStart = bodyStartTagEnd + 1;
  const bodyHtml = rawHtml.slice(bodyStart, bodyStart + MAX_HTML_SIZE);

  return `${getTag(rawHtml, 'html')}<head>${getTitle(rawHtml)}${getMeta(rawHtml)}</head>${getTag(
    rawHtml,
    'body',
  )}${bodyHtml}</body></html>`;
};

interface HtmlToMarkdownOutput {
  author?: string;
  content: string;
  description?: string;
  dir?: string;
  lang?: string;
  length?: number;
  publishedTime?: string;
  siteName?: string;
  title?: string;
}

export const htmlToMarkdown = (
  rawHtml: string,
  { url, filterOptions }: { filterOptions: FilterOptions; url: string },
): HtmlToMarkdownOutput => {
  const html = trimHtmlForParsing(rawHtml);
  const window = new Window({
    settings: { disableCSSFileLoading: true, disableJavaScriptEvaluation: true },
    url,
  });

  try {
    const document = window.document;
    document.body.innerHTML = html;

    let parsedContent: ReturnType<Readability<string>['parse']> = null;
    try {
      // @ts-expect-error reason: Readability expects a Document type
      parsedContent = new Readability(document).parse();
    } catch {
      // happy-dom may throw on pages with invalid CSS selectors — fall back to raw HTML
    }

    const useReadability = filterOptions.enableReadability ?? true;

    const customTranslators = (
      filterOptions.pureText
        ? {
            a: {
              postprocess: (_: string, content: string) => content,
            },
            img: {
              ignore: true,
            },
          }
        : {}
    ) as TranslatorConfigObject;

    const nodeHtmlMarkdown = new NodeHtmlMarkdown({}, customTranslators);

    let htmlNode = html;

    if (useReadability && parsedContent?.content) {
      htmlNode = parsedContent?.content;
    }

    let content = nodeHtmlMarkdown.translate(htmlNode);

    if (useReadability && content.trim().length <= MIN_USEFUL_CONTENT_LENGTH) {
      content = nodeHtmlMarkdown.translate(html);
    }

    const result = {
      author: parsedContent?.byline,
      content,
      description: parsedContent?.excerpt,
      dir: parsedContent?.dir,
      lang: parsedContent?.lang,
      length: parsedContent?.length,
      publishedTime: parsedContent?.publishedTime,
      siteName: parsedContent?.siteName,
      title: parsedContent?.title ?? document.title,
    };

    return cleanObj(result) as HtmlToMarkdownOutput;
  } finally {
    // Release the happy-dom Window so its DOM tree is GC-able immediately, instead
    // of waiting for the function scope to drop. JS evaluation is disabled so the
    // returned promise resolves synchronously in practice — fire and forget.
    void window.happyDOM.close();
  }
};
