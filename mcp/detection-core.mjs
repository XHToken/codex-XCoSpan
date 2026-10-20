// Pure UTF-16 detectors. Findings contain coordinates, never source values.
import { collectMatches } from './routing.mjs';

export const STRICT_TYPES = new Set(['secret', 'government_id', 'bank_card']);
export const CONTEXT_TYPES = ['person', 'organization', 'address', 'email', 'phone', 'account', 'tax_id', 'amount', 'date', 'project_code', 'business_confidential', 'health_information', 'private_communication', 'file_path'];
const weights = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2];
const idValid = (v) => '10X98765432'[[...v.slice(0, 17)].reduce((n, ch, i) => n + Number(ch) * weights[i], 0) % 11] === v.at(-1).toUpperCase();
const cardValid = (v) => {
  const digits = v.replace(/[ -]/g, '');
  if (/^(\d)\1+$/.test(digits)) return false;
  return [...digits].reverse().reduce((sum, d, i) => { let n = Number(d); if (i % 2) n = n * 2 > 9 ? n * 2 - 9 : n * 2; return sum + n; }, 0) % 10 === 0;
};

export function boundary(text, offset) {
  return Number.isInteger(offset) && offset >= 0 && offset <= text.length
    && !(offset > 0 && offset < text.length && /[\uD800-\uDBFF]/.test(text[offset - 1]) && /[\uDC00-\uDFFF]/.test(text[offset]));
}

export function scanRules(text, config, customPatterns = []) {
  const findings = collectMatches(text).map(({ type, start, end }) => ({ type, start, end, source: 'rules' }));
  const add = (type, regex, group = 0, validator = () => true, source = 'rules') => {
    for (const m of text.matchAll(regex)) {
      if (group >= m.length) throw new Error("invalid_capture_group");
      const value = m[group];
      if (!value || !validator(value)) continue;
      const [start, end] = m.indices[group];
      if (boundary(text, start) && boundary(text, end)) findings.push({ type, start, end, source });
      if (findings.length > 20000) throw new Error('finding_limit');
    }
  };
  add('secret', /(?<![\w-])(?:sk-[A-Za-z0-9_-]{16,}|(?:AKIA|ASIA)[A-Z0-9]{16})(?![\w-])/dg);
  add('secret', /(?:api[_-]?key|access[_-]?token|client[_-]?secret|password|passwd|密码|口令|访问令牌|密钥)\s*[:=：]\s*["']?([^\s,，;；。|"']{4,256})/dgi, 1);
  add('secret', /\bBearer\s+([A-Za-z0-9._~+/-]{12,}={0,2})/dgi, 1);
  add('secret', /(?<![\w-])eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}(?![\w-])/dg);
  add('secret', /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/dg);
  add('secret', /\b(?:https?|postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis):\/\/[^\s/:@]+:([^\s/@]+)@/dgi, 1);
  add('government_id', /(?<!\d)\d{17}[0-9Xx](?!\w)/dg, 0, idValid);
  add('government_id', /(?:身份证号?|公民身份号码|证件号码)\s*[:：]?\s*(\d{17}[0-9Xx]|\d{15})(?!\d)/dg, 1);
  add('bank_card', /(?<!\d)(?:\d[ -]?){12,18}\d(?!\d)/dg, 0, cardValid);
  add('account', /(?:银行账号|银行账户|收款账号|结算账户|对公账户|登录账号|用户名)\s*[:=：]\s*["']?([\p{L}\p{N}@._ -]{2,64})/dgu, 1);
  add('person', /(?:联系人|负责人|申请人|客户姓名|员工姓名|患者姓名)\s*[:：]\s*([\p{Script=Han}·]{2,5})(?=[，,。；;\s]|$)/dgu, 1);
  add('organization', /([\p{Script=Han}A-Za-z0-9（）()]{2,50}(?:有限责任公司|股份有限公司|有限公司))/dgu, 1);
  add('amount', /(?:人民币|RMB|￥|¥)\s*\d[\d,.]*\s*(?:亿|万)?元?|\d[\d,.]*\s*(?:亿|万)?元/dg);
  add('date', /(?<!\d)(?:19|20)\d{2}(?:年\d{1,2}月\d{1,2}日|[-/]\d{1,2}[-/]\d{1,2})(?!\d)/dg);
  for (const rule of [...config.rules, ...customPatterns.map((item) => ({ type: item.name, pattern: item.pattern, flags: item.flags || '' }))]) {
    add(rule.type, new RegExp(rule.pattern, [...new Set(`${rule.flags || ''}gd`)].join('')), rule.group || 0, undefined, 'custom_rule');
  }
  for (const entry of config.dictionary) {
    const regex = new RegExp(entry.term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), entry.case_sensitive ? 'dg' : 'dgi');
    for (const m of text.matchAll(regex)) {
      const start = m.index, end = start + m[0].length;
      if (entry.whole_word !== false && ((/[A-Za-z0-9_]/.test(m[0][0]) && /[A-Za-z0-9_]/.test(text[start - 1] || ''))
          || (/[A-Za-z0-9_]/.test(m[0].at(-1)) && /[A-Za-z0-9_]/.test(text[end] || '')))) continue;
      findings.push({ type: entry.type, start, end, source: 'dictionary' });
      if (findings.length > 20000) throw new Error('finding_limit');
    }
  }
  return findings;
}

export function resolveFindings(text, raw, config) {
  const expanded = [...raw];
  const seeds = new Set();
  for (const item of raw) {
    if (!['person', 'organization', 'project_code'].includes(item.type)) continue;
    const value = text.slice(item.start, item.end), key = `${item.type}:${value}`;
    if (value.length < 2 || seeds.has(key)) continue;
    seeds.add(key);
    for (let at = text.indexOf(value); at >= 0; at = text.indexOf(value, at + value.length)) {
      const end = at + value.length;
      if ((/[A-Za-z0-9_]/.test(value[0]) && /[A-Za-z0-9_]/.test(text[at - 1] || ''))
          || (/[A-Za-z0-9_]/.test(value.at(-1)) && /[A-Za-z0-9_]/.test(text[end] || ''))
          || (item.type === 'person' && /^(?:路|街|巷|道|镇|村|区|县|市|省|公司|集团|学校|医院|大学|中心)/.test(text.slice(end)))) continue;
      expanded.push({ ...item, start: at, end });
      if (expanded.length > 20000) throw new Error('finding_limit');
    }
  }
  const bySpan = new Map();
  for (const item of expanded) {
    if (!boundary(text, item.start) || !boundary(text, item.end) || item.end <= item.start) throw new Error('invalid_offsets');
    const protection = STRICT_TYPES.has(item.type) || config.categories[item.type] === 'mask'
      || (item.source === 'dictionary' && config.dictionary.some((entry) => entry.type === item.type && entry.action === 'mask'
        && (entry.case_sensitive ? entry.term === text.slice(item.start, item.end) : entry.term.toLowerCase() === text.slice(item.start, item.end).toLowerCase()))) ? 'required' : 'contextual';
    const key = `${item.type}:${item.start}:${item.end}`;
    const prior = bySpan.get(key);
    bySpan.set(key, { type: item.type, start: item.start, end: item.end, protection: prior?.protection === 'required' ? 'required' : protection,
      sources: [...new Set([...(prior?.sources || []), item.source])] });
  }
  if (bySpan.size > 20000) throw new Error('finding_limit');
  return [...bySpan.values()].sort((a, b) => a.start - b.start || b.end - a.end );
}
