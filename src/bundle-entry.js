import MarkdownIt from 'markdown-it';
import { full as emoji } from 'markdown-it-emoji';
import footnote from 'markdown-it-footnote';
import taskLists from 'markdown-it-task-lists';
import mark from 'markdown-it-mark';
import ins from 'markdown-it-ins';
import sub from 'markdown-it-sub';
import sup from 'markdown-it-sup';
import anchor from 'markdown-it-anchor';
import katex from '@traptitech/markdown-it-katex';
import hljs from 'highlight.js';

const md = new MarkdownIt({
  html: true,
  linkify: true,
  typographer: true,
  breaks: true,
  highlight: function (str, lang) {
    if (lang && hljs.getLanguage(lang)) {
      try {
        return '<pre class="hljs"><code>' + hljs.highlight(str, { language: lang, ignoreIllegals: true }).value + '</code></pre>';
      } catch (e) {}
    }
    return '<pre class="hljs"><code>' + md.utils.escapeHtml(str) + '</code></pre>';
  },
})
  .use(emoji)
  .use(footnote)
  .use(taskLists)
  .use(mark)
  .use(ins)
  .use(sub)
  .use(sup)
  .use(anchor, { permalink: false })
  .use(katex, { throwOnError: false, errorColor: '#cc0000' });

window.__md = md;
window.__hljs = hljs;
