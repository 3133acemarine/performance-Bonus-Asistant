'use strict';
/* 성과상여금 도우미 - 앱 본체
 * 모든 자료는 메모리(S)에만 둔다. localStorage·IndexedDB·fetch 사용 금지 (PRD 7.3, 10.5).
 */
const APP_VERSION = '__APP_VERSION__';
const GRADES = ['S', 'A', 'B', 'C'];
const GRADE_ORDER = { S: 4, A: 3, B: 2, C: 1 };

const CODES = {
  E01: '필수 항목 누락',
  E02: '명단에는 있으나 평가결과 없음',
  E03: '평가결과에는 있으나 명단에 없음',
  E04: '군번 중복',
  E05: '날짜 형식 오류',
  E06: '생년월일 형식 오류',
  W01: '실근무기간 미달 (지급 제외)',
  W02: '휴직 기간 있음 (근무기간 차감)',
  W03: '여러 부대에 등장 (전입·전출)',
  W04: '완전 동점자',
  W05: '1인 그룹',
  V01: '그룹별 등급 인원 규칙 불일치'
};

/* 표준 항목과 열 이름 자동 연결 키워드 */
const FIELDS = [
  { key: 'gun', label: '군번', kw: ['군번', '사번', '개인번호', '직원번호', '번호', 'id'] },
  { key: 'name', label: '성명', kw: ['성명', '이름', 'name'] },
  { key: 'birth', label: '생년월일', kw: ['생년월일', '생일', 'birth'] },
  { key: 'unit', label: '소속 부대', kw: ['소속부대', '부대명', '부대', '소속', '부서'] },
  { key: 'rank', label: '계급', kw: ['계급', '직급', 'rank'] },
  { key: 'job', label: '직군', kw: ['직군', '직렬', '직종'] },
  { key: 'start', label: '근무 시작일', kw: ['근무시작일', '근무시작', '근무개시일', '시작일', '부임일'] },
  { key: 'end', label: '근무 종료일', kw: ['근무종료일', '근무종료', '종료일'] },
  { key: 'leaveStart', label: '휴직 시작일', kw: ['휴직시작일', '휴직시작', '휴직개시일'] },
  { key: 'leaveEnd', label: '휴직 종료일', kw: ['휴직종료일', '휴직종료', '복직일'] },
  { key: 'transferIn', label: '전입일', kw: ['전입일자', '전입일', '전입'] },
  { key: 'transferOut', label: '전출일', kw: ['전출일자', '전출일', '전출'] },
  { key: 'quant', label: '정량평가 점수', kw: ['정량평가점수', '정량평가', '정량점수', '정량'] },
  { key: 'qual', label: '정성평가 점수', kw: ['정성평가점수', '정성평가', '정성점수', '정성'] },
  { key: 'total', label: '총점', kw: ['총점', '종합점수', '점수합계', '합계'] },
  { key: 'grade', label: '등급(작년 결과)', kw: ['지급등급', '평가등급', '등급'] },
  { key: 'prevGrade', label: '작년 등급(참고)', kw: ['작년등급', '전년등급', '전년도등급'] }
];
const FIELD_LABEL = Object.fromEntries(FIELDS.map(f => [f.key, f.label]));
/* 계급 표시 순서 (높은 계급부터). 목록에 없는 계급은 뒤에 가나다순 */
const RANK_ORDER = ['대장', '중장', '소장', '준장', '대령', '중령', '소령', '대위', '중위', '소위', '준위', '원사', '상사', '중사', '하사', '병장', '상병', '일병', '이병'];
function rankCmp(a, b) {
  const ia = RANK_ORDER.indexOf(a), ib = RANK_ORDER.indexOf(b);
  return (ia < 0 ? 1e3 : ia) - (ib < 0 ? 1e3 : ib) || String(a).localeCompare(String(b), 'ko');
}
const KIND_LABEL ={ roster: '명단', eval: '평가결과', combined: '명단+평가 (표준 양식)', prev: '작년 결과', skip: '사용 안 함' };

function defaultSettings() {
  const y = new Date().getFullYear() - 1;
  return {
    pStart: `${y}-01-01`, pEnd: `${y}-12-31`,
    ratio: { S: 20, A: 40, B: 30 },
    rate: { S: 172.5, A: 125, B: 85, C: 0 },
    exclMonths: 2, exclMethod: 'calendar', daysPerMonth: 30,
    rounding: 'floor1',
    base: {}
  };
}

/* ---------------- 상태 (메모리 전용) ---------------- */
let fileSeq = 0;
const S = {
  screen: 'home', role: null, files: [], settings: defaultSettings(),
  tieOrder: {}, overrides: {}, ackWarn: false,
  issueFilter: { level: 'all', code: '', q: '' },
  resFilter: { q: '', unit: '', grade: '', status: '' },
  contact: { dept: '', phone: '' },
  openMap: {}, model: null, job: null, updateRequested: false, installEvt: null
};

/* ---------------- 유틸 ---------------- */
const $ = (sel, root = document) => root.querySelector(sel);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const won = n => (n == null || isNaN(n)) ? '' : Number(n).toLocaleString('ko-KR');
const str = v => v == null ? '' : String(v).replace(/\s+/g, ' ').trim();
const normGun = v => v == null ? '' : String(v).replace(/\s+/g, '').trim();
const normH = h => String(h == null ? '' : h).toLowerCase().replace(/[\s()\[\]{}_\-·.:/*※]/g, '');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const r6 = x => Math.round(x * 1e6) / 1e6;

const DAY = 86400000;
function dnum(y, m, d) {
  if (!(y > 1900 && y < 2200 && m >= 1 && m <= 12 && d >= 1 && d <= 31)) return null;
  const t = Date.UTC(y, m - 1, d), dt = new Date(t);
  if (dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return Math.round(t / DAY);
}
function dstr(n) { return n == null ? '' : new Date(n * DAY).toISOString().slice(0, 10); }
function addMonths(n, k) {
  const d = new Date(n * DAY);
  let y = d.getUTCFullYear(), m = d.getUTCMonth() + k;
  y += Math.floor(m / 12); m = ((m % 12) + 12) % 12;
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return Math.round(Date.UTC(y, m, Math.min(d.getUTCDate(), last)) / DAY);
}
function todayStr() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
function stamp() { return todayStr().replace(/-/g, ''); }

/* 날짜: 엑셀 일련번호, Date, 'YYYY-MM-DD', 'YYYY.MM.DD', 'YYYYMMDD', 'YYYY년 M월 D일' 지원 */
function parseDate(v) {
  if (v == null) return { empty: true };
  if (v instanceof Date) return isNaN(v) ? { error: true } : { value: dnum(v.getFullYear(), v.getMonth() + 1, v.getDate()) };
  if (typeof v === 'number') {
    if (Number.isInteger(v) && v >= 19000101 && v <= 21991231) return parseDate(String(v));
    if (v > 60 && v < 120000) return { value: Math.floor(v) - 25569 };
    return { error: true };
  }
  const s = String(v).trim();
  if (!s) return { empty: true };
  const m = s.match(/^(\d{4})\s*[-./년]\s*(\d{1,2})\s*[-./월]\s*(\d{1,2})\s*일?\.?$/) || s.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m) { const n = dnum(+m[1], +m[2], +m[3]); return n == null ? { error: true } : { value: n }; }
  return { error: true };
}
/* 휴직처럼 여러 건을 한 칸에 쓴 경우: 쉼표·세미콜론·줄바꿈·| 로 구분 */
function parseDateList(v) {
  if (v == null || (typeof v === 'string' && !v.trim())) return { list: [], bad: [] };
  if (typeof v !== 'string') { const d = parseDate(v); return d.error ? { list: [], bad: [String(v)] } : { list: [d.value], bad: [] }; }
  const parts = v.split(/[,;\n|]+/).map(x => x.trim()).filter(Boolean);
  const list = [], bad = [];
  for (const p of parts) { const d = parseDate(p); if (d.error) bad.push(p); else if (!d.empty) list.push(d.value); }
  return { list, bad };
}
/* 생년월일 → YYMMDD 6자리 */
function parseBirth(v) {
  if (v == null || String(v).trim() === '') return { empty: true };
  let s;
  if (v instanceof Date) s = `${String(v.getFullYear()).slice(2)}${String(v.getMonth() + 1).padStart(2, '0')}${String(v.getDate()).padStart(2, '0')}`;
  else if (typeof v === 'number' && Number.isInteger(v)) s = v >= 19000101 ? String(v).slice(2) : String(v).padStart(6, '0');
  else {
    s = String(v).trim();
    const m = s.match(/^(\d{2,4})[-./](\d{1,2})[-./](\d{1,2})$/);
    if (m) s = m[1].slice(-2) + m[2].padStart(2, '0') + m[3].padStart(2, '0');
    else if (/^\d{8}$/.test(s)) s = s.slice(2);
  }
  if (!/^\d{6}$/.test(s)) return { error: true, raw: String(v) };
  const mm = +s.slice(2, 4), dd = +s.slice(4, 6);
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return { error: true, raw: String(v) };
  return { value: s };
}
function parseNum(v) {
  if (v == null || String(v).trim() === '') return { empty: true };
  if (typeof v === 'number') return isFinite(v) ? { value: r6(v) } : { error: true };
  const n = Number(String(v).replace(/[,\s점]/g, ''));
  return isFinite(n) ? { value: r6(n) } : { error: true };
}

/* ---------------- 파일 읽기와 열 매핑 ---------------- */
function autoMap(headers) {
  const cands = [];
  headers.forEach((h, ci) => {
    const nh = normH(h);
    if (!nh) return;
    for (const f of FIELDS) for (const k of f.kw) {
      const nk = normH(k);
      if (nh.includes(nk)) cands.push({ f: f.key, ci, score: nk.length * 10 + (nh === nk ? 5 : 0) - (nh.length - nk.length) * 0.1 });
    }
  });
  cands.sort((a, b) => b.score - a.score);
  const map = {}, used = new Set();
  for (const c of cands) {
    if (map[c.f] != null || used.has(c.ci)) continue;
    map[c.f] = c.ci; used.add(c.ci);
  }
  return map;
}
function colName(i) { let s = ''; i++; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; }

function loadSheet(f, sheetName) {
  const ws = f.wb.Sheets[sheetName];
  const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null, blankrows: true });
  let best = { row: 0, score: -1, map: {} };
  for (let i = 0; i < Math.min(15, aoa.length); i++) {
    const m = autoMap((aoa[i] || []).map(x => x == null ? '' : String(x)));
    const sc = Object.keys(m).length;
    if (sc > best.score) best = { row: i, score: sc, map: m };
  }
  const width = aoa.reduce((w, r) => Math.max(w, r ? r.length : 0), 0);
  const hr = aoa[best.row] || [];
  f.sheetName = sheetName;
  f.headerRow = best.row;
  f.headers = Array.from({ length: width }, (_, i) => (hr[i] != null && String(hr[i]).trim()) ? String(hr[i]).trim() : `(${colName(i)}열)`);
  f.rows = aoa.slice(best.row + 1)
    .map((r, i) => ({ r: r || [], n: best.row + 2 + i }))
    .filter(x => x.r.some(v => v != null && String(v).trim() !== ''));
  f.map = best.map;
  return best.score;
}
function detectKind(map) {
  const hasRoster = map.birth != null || map.start != null || map.rank != null;
  const hasScore = map.quant != null || map.qual != null || map.total != null;
  if (map.grade != null && map.gun != null) return 'prev';
  if (hasRoster && hasScore) return 'combined';
  if (hasScore) return 'eval';
  return 'roster';
}
function guessUnit(fileName) {
  const stem = fileName.replace(/\.[^.]+$/, '');
  const toks = stem.split(/[_\-\s()]+/).filter(Boolean);
  for (const t of toks) {
    if (/명단|대상자|평가|결과|양식|성과|상여|지급|\d{4}년/.test(t)) continue;
    if (/(부대|사단|여단|연대|대대|단|대|서|과|실|국|청|처|본부)$/.test(t)) return t;
  }
  return '';
}
function readInfo(wb) {
  const ws = wb.Sheets['정보'];
  if (!ws) return {};
  const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null });
  const o = {};
  for (const r of aoa) if (r && r[0]) o[String(r[0]).trim()] = r[1];
  return o;
}

async function addFiles(list, forceKind) {
  let added = 0;
  for (const file of list) {
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(new Uint8Array(buf), { type: 'array', cellDates: false });
      const f = { id: ++fileSeq, name: file.name, wb, sheetNames: wb.SheetNames.filter(n => n !== '정보') };
      if (!f.sheetNames.length) f.sheetNames = wb.SheetNames.slice();
      let bestName = f.sheetNames[0], bestScore = -1;
      for (const n of f.sheetNames) { const sc = loadSheet(f, n); if (sc > bestScore) { bestScore = sc; bestName = n; } }
      loadSheet(f, bestName);
      f.kind = forceKind || detectKind(f.map);
      f.unitOverride = guessUnit(file.name);
      f.info = readInfo(wb);
      S.files.push(f);
      added++;
    } catch (e) {
      toast(`${file.name}: 엑셀 파일로 읽을 수 없습니다 (${e.message})`);
    }
  }
  if (added) { S.ackWarn = false; recompute(); render(); toast(`파일 ${added}개를 불러왔습니다.`); }
}

/* ---------------- 산정 엔진 ---------------- */
function rateBp(x) { return Math.round(Number(x) * 100); }  // % → 1/100 % 단위 정수
/* 8.4 등급별 인원 배분: 사사오입, 정수 연산, S→A→B 순, C는 나머지 */
function allocate(n, ratio) {
  const cnt = {}; let left = n;
  for (const g of ['S', 'A', 'B']) {
    const c = Math.floor((n * rateBp(ratio[g]) + 5000) / 10000);
    cnt[g] = Math.max(0, Math.min(c, left));
    left -= cnt[g];
  }
  cnt.C = left;
  return cnt;
}
function calcAmount(base, rate, mode) {
  const p = base * rateBp(rate);  // 원 × 1/10000
  switch (mode) {
    case 'round1': return Math.floor((p + 5000) / 10000);
    case 'floor10': return Math.floor(p / 100000) * 10;
    case 'floor100': return Math.floor(p / 1000000) * 100;
    case 'floor1000': return Math.floor(p / 10000000) * 1000;
    default: return Math.floor(p / 10000);
  }
}
const ROUNDING_LABEL = { floor1: '원 미만 절사', round1: '원 미만 반올림', floor10: '10원 미만 절사', floor100: '100원 미만 절사', floor1000: '1,000원 미만 절사' };

function buildModel() {
  const st = S.settings;
  const issues = [];
  const add = (code, o) => issues.push(Object.assign({ code, level: code[0] === 'W' ? 'W' : 'E' }, o));
  const pS = parseDate(st.pStart).value, pE = parseDate(st.pEnd).value;
  const periodOk = pS != null && pE != null && pS <= pE;

  /* 1) 행 추출 */
  const raws = [], evalRows = [], prevMap = new Map();
  for (const f of S.files) {
    if (f.kind === 'skip' || !f.rows) continue;
    const m = f.map;
    for (const { r, n } of f.rows) {
      const g = k => (m[k] != null ? r[m[k]] : null);
      const src = `${f.name} ${n}행`;
      if (f.kind === 'prev') {
        const gun = normGun(g('gun')), grade = str(g('grade')).toUpperCase().replace('등급', '');
        if (gun && grade) prevMap.set(gun, grade);
        continue;
      }
      if (f.kind === 'roster' || f.kind === 'combined') {
        const birth = parseBirth(g('birth'));
        const dateErr = [];
        const d = {};
        for (const k of ['start', 'end', 'transferIn', 'transferOut']) {
          const pd = parseDate(g(k));
          if (pd.error) dateErr.push(`${FIELD_LABEL[k]} "${str(g(k))}"`);
          d[k] = pd.value == null ? null : pd.value;
        }
        const ls = parseDateList(g('leaveStart')), le = parseDateList(g('leaveEnd'));
        ls.bad.forEach(b => dateErr.push(`휴직 시작일 "${b}"`));
        le.bad.forEach(b => dateErr.push(`휴직 종료일 "${b}"`));
        const leaves = [];
        if (le.list.length && le.list.length !== ls.list.length) dateErr.push('휴직 시작일과 종료일의 개수가 다름');
        else ls.list.forEach((s, i) => leaves.push([s, le.list.length ? le.list[i] : null]));
        const rec = {
          gun: normGun(g('gun')), name: str(g('name')), unit: str(g('unit')) || f.unitOverride || '',
          rank: str(g('rank')), job: str(g('job')),
          birthRaw: str(g('birth')), birth: birth.value || '', birthErr: !!birth.error,
          start: d.start, end: d.end, tin: d.transferIn, tout: d.transferOut,
          leaves, dateErr, src, file: f.name
        };
        rec.filled = ['name', 'birthRaw', 'rank', 'start'].filter(k => rec[k] != null && rec[k] !== '').length;
        raws.push(rec);
      }
      if (f.kind === 'eval' || f.kind === 'combined') {
        const q = parseNum(g('quant')), ql = parseNum(g('qual')), t = parseNum(g('total'));
        if (f.kind === 'combined' && q.empty && ql.empty && t.empty) continue;
        evalRows.push({ gun: normGun(g('gun')), name: str(g('name')), unit: str(g('unit')) || (f.kind === 'combined' ? f.unitOverride : ''), q, ql, t, src });
      }
    }
  }

  /* 2) 명단: 같은 부대·같은 군번 행 정리 (휴직 추가 행은 합치고, 그 외는 E04) */
  const byKey = new Map();
  for (const r of raws) {
    if (!r.gun) { add('E01', { gun: '', name: r.name, unit: r.unit, msg: '군번이 비어 있음', src: r.src }); continue; }
    const k = r.unit + '\u0000' + r.gun;
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push(r);
  }
  const recs = [];
  for (const list of byKey.values()) {
    list.sort((a, b) => b.filled - a.filled);
    const p = list[0];
    p.extraSrc = [];
    for (const o of list.slice(1)) {
      const sameName = !o.name || o.name === p.name;
      const leaveOnly = o.leaves.length > 0 && (o.start == null || o.start === p.start) && (!o.rank || o.rank === p.rank);
      const newLeave = o.leaves.some(l => !p.leaves.some(x => x[0] === l[0] && x[1] === l[1]));
      if (sameName && leaveOnly && newLeave) { p.leaves.push(...o.leaves); p.extraSrc.push(o.src); }
      else add('E04', { gun: p.gun, name: o.name && o.name !== p.name ? `${p.name} / ${o.name}` : p.name, unit: p.unit, msg: `같은 부대에 같은 군번이 2건 이상 (${p.src}, ${o.src})`, src: o.src });
    }
    recs.push(p);
  }
  for (const r of recs) {
    const miss = [];
    if (!r.name) miss.push('성명');
    if (!r.birthRaw) miss.push('생년월일');
    if (!r.unit) miss.push('소속 부대');
    if (!r.rank) miss.push('계급');
    if (r.start == null && r.tin == null && !r.dateErr.some(x => x.startsWith('근무 시작일'))) miss.push('근무 시작일');
    if (miss.length) add('E01', { gun: r.gun, name: r.name, unit: r.unit, msg: `필수 항목 누락: ${miss.join(', ')}`, src: r.src });
    if (r.birthErr) add('E06', { gun: r.gun, name: r.name, unit: r.unit, msg: `생년월일 "${r.birthRaw}" → YYMMDD 6자리 숫자가 아님`, src: r.src });
    const de = r.dateErr.slice();
    const s0 = r.start != null ? r.start : r.tin;
    const e0 = r.end != null ? r.end : (r.tout != null ? r.tout - 1 : null);
    if (s0 != null && e0 != null && s0 > e0) de.push(`근무 시작일(${dstr(s0)})이 종료일(${dstr(e0)})보다 늦음`);
    r.leaves.forEach(([a, b]) => { if (b != null && a > b) de.push(`휴직 시작일(${dstr(a)})이 종료일(${dstr(b)})보다 늦음`); });
    if (de.length) add('E05', { gun: r.gun, name: r.name, unit: r.unit, msg: de.join(' / '), src: r.src });
  }

  /* 3) 평가결과 정리 */
  const evalMap = new Map();
  for (const e of evalRows) {
    if (!e.gun) { add('E01', { gun: '', name: e.name, unit: e.unit, msg: '평가결과 행에 군번이 비어 있음', src: e.src }); continue; }
    const miss = [];
    if (e.q.empty) miss.push('정량평가 점수'); else if (e.q.error) miss.push('정량평가 점수(숫자 아님)');
    if (e.ql.empty) miss.push('정성평가 점수'); else if (e.ql.error) miss.push('정성평가 점수(숫자 아님)');
    if (e.t.error) miss.push('총점(숫자 아님)');
    const ev = { gun: e.gun, name: e.name, unit: e.unit, src: e.src, quant: e.q.value, qual: e.ql.value, total: null, totalCalc: false, bad: miss.length > 0 };
    if (!ev.bad) { if (e.t.value != null) ev.total = e.t.value; else { ev.total = r6(ev.quant + ev.qual); ev.totalCalc = true; } }
    if (miss.length) add('E01', { gun: e.gun, name: e.name, unit: e.unit, msg: `평가 점수 누락·오류: ${miss.join(', ')}`, src: e.src });
    const prev = evalMap.get(e.gun);
    if (prev) {
      if (prev.quant !== ev.quant || prev.qual !== ev.qual || prev.total !== ev.total)
        add('E04', { gun: e.gun, name: e.name || prev.name, unit: e.unit || prev.unit, msg: `평가결과에 같은 군번이 다른 점수로 중복 (${prev.src}, ${e.src})`, src: e.src });
      continue;
    }
    evalMap.set(e.gun, ev);
  }

  /* 4) 사람 단위로 묶기, 명단-평가 대조 */
  const personMap = new Map();
  for (const r of recs) {
    if (!personMap.has(r.gun)) personMap.set(r.gun, { gun: r.gun, recs: [] });
    personMap.get(r.gun).recs.push(r);
  }
  const rosterUnits = new Set(recs.map(r => r.unit));
  for (const p of personMap.values()) {
    p.ev = evalMap.get(p.gun) || null;
    const r0 = p.recs[0];
    if (!p.ev) add('E02', { gun: p.gun, name: r0.name, unit: p.recs.map(r => r.unit).join(', '), msg: '명단에는 있으나 평가결과가 없음', src: r0.src });
  }
  for (const e of evalMap.values()) {
    if (personMap.has(e.gun)) continue;
    if (S.role === 'unit' && !(e.unit && rosterUnits.has(e.unit))) continue;  // 부대 담당자는 자기 부대 평가만 대조
    add('E03', { gun: e.gun, name: e.name, unit: e.unit, msg: '평가결과에는 있으나 명단에 없음', src: e.src });
  }

  /* 5) 실근무기간 (8.1), 소속 그룹 (8.2) */
  const persons = [...personMap.values()];
  for (const p of persons) {
    const r0 = p.recs[0];
    p.name = r0.name; p.birth = p.recs.find(r => r.birth)?.birth || ''; p.job = p.recs.find(r => r.job)?.job || '';
    p.effTotal = 0; p.firstStart = null;
    for (const r of p.recs) {
      const s = r.start != null ? r.start : r.tin;
      const e = r.end != null ? r.end : (r.tout != null ? r.tout - 1 : pE);
      const c = { cs: null, ce: null, days: 0, leaveDays: 0, leaveSegs: [], eff: 0, onEnd: false };
      if (periodOk && s != null && e != null) {
        c.cs = Math.max(s, pS); c.ce = Math.min(e, pE);
        c.days = c.ce >= c.cs ? c.ce - c.cs + 1 : 0;
        if (c.days > 0) {
          const segs = r.leaves.map(([a, b]) => [Math.max(a, c.cs), Math.min(b == null ? c.ce : b, c.ce)]).filter(x => x[1] >= x[0]).sort((a, b) => a[0] - b[0]);
          const merged = [];
          for (const sg of segs) { const last = merged[merged.length - 1]; if (last && sg[0] <= last[1] + 1) last[1] = Math.max(last[1], sg[1]); else merged.push(sg.slice()); }
          c.leaveSegs = merged;
          c.leaveDays = merged.reduce((t, x) => t + x[1] - x[0] + 1, 0);
          c.onEnd = c.ce === pE;
        }
        c.eff = Math.max(0, c.days - c.leaveDays);
      }
      r.calc = c;
      p.effTotal += c.eff;
      if (c.days > 0 && (p.firstStart == null || c.cs < p.firstStart)) p.firstStart = c.cs;
      if (r.leaves.length) add('W02', { gun: p.gun, name: p.name, unit: r.unit, msg: `휴직 ${r.leaves.map(([a, b]) => `${dstr(a)}~${b == null ? '(종료일 없음)' : dstr(b)}`).join(', ')} → 평가 기간 내 ${c.leaveDays}일 차감`, src: r.src, action: `실근무기간에서 휴직 ${c.leaveDays}일 차감` });
    }
    // 지급 제외 기준
    const mo = Number(st.exclMonths) || 0;
    p.threshold = st.exclMethod === 'days' ? mo * (Number(st.daysPerMonth) || 30) : (p.firstStart != null ? addMonths(p.firstStart, mo) - p.firstStart : mo * 30);
    p.excluded = p.effTotal < p.threshold || p.effTotal <= 0;
    // 배정 부대
    const sorted = p.recs.slice().sort((a, b) => (b.calc.eff - a.calc.eff) || ((b.calc.onEnd ? 1 : 0) - (a.calc.onEnd ? 1 : 0)) || ((b.calc.cs || 0) - (a.calc.cs || 0)));
    p.assigned = sorted[0];
    p.unit = p.assigned.unit; p.rank = p.assigned.rank;
    if (p.recs.length > 1) {
      const a = sorted[0], b = sorted[1];
      const list = p.recs.map(r => `${r.unit} ${r.calc.eff}일`).join(', ');
      p.assignReason = a.calc.eff === b.calc.eff
        ? `${list} → 근무기간이 같아 평가 기간 마지막 날 소속인 ${a.unit}로 배정`
        : `${list} → 실근무기간이 더 긴 ${a.unit}로 배정`;
      const names = [...new Set(p.recs.map(r => r.name))];
      add('W03', { gun: p.gun, name: p.name, unit: p.recs.map(r => r.unit).join(' → '), msg: p.assignReason + (names.length > 1 ? ` (성명 불일치: ${names.join(', ')})` : ''), src: p.recs.map(r => r.src).join(' / '), action: `${a.unit} 그룹으로 배정, 합산 ${p.effTotal}일` });
    } else p.assignReason = '단일 부대 근무';
    const thrText = st.exclMethod === 'days' ? `${p.threshold}일(${mo}개월×${st.daysPerMonth}일)` : `만 ${mo}개월(${p.threshold}일)`;
    p.thrText = thrText;
    if (p.excluded) add('W01', { gun: p.gun, name: p.name, unit: p.unit, msg: `실근무기간 ${p.effTotal}일 < 기준 ${thrText}`, src: p.assigned.src, action: '지급 제외 (순위·인원 배분 대상 아님)' });
    p.prevGrade = prevMap.get(p.gun) || '';
  }

  /* 6) 그룹 내 순위 (8.3), 등급 배분 (8.4), 지급액 (8.5) */
  const groups = new Map();
  for (const p of persons) {
    p.groupKey = `${p.unit}|${p.rank}`;
    if (!groups.has(p.groupKey)) groups.set(p.groupKey, { key: p.groupKey, unit: p.unit, rank: p.rank, members: [], excluded: [], pending: [] });
    const g = groups.get(p.groupKey);
    if (p.excluded) g.excluded.push(p);
    else if (!p.ev || p.ev.bad) g.pending.push(p);
    else g.members.push(p);
  }
  const ties = [];
  for (const g of groups.values()) {
    const ms = g.members;
    ms.sort((a, b) => (b.ev.total - a.ev.total) || (b.ev.quant - a.ev.quant) || (b.ev.qual - a.ev.qual)
      || ((S.tieOrder[a.gun] ?? 1e9) - (S.tieOrder[b.gun] ?? 1e9)) || (a.gun < b.gun ? -1 : a.gun > b.gun ? 1 : 0));
    // 완전 동점 묶음
    g.ties = [];
    for (let i = 0; i < ms.length;) {
      let j = i + 1;
      while (j < ms.length && ms[j].ev.total === ms[i].ev.total && ms[j].ev.quant === ms[i].ev.quant && ms[j].ev.qual === ms[i].ev.qual) j++;
      if (j - i > 1) {
        const block = ms.slice(i, j);
        g.ties.push(block); ties.push({ group: g, block });
        block.forEach(p => { p.tieBlock = block; });
      }
      i = j;
    }
    const n = ms.length;
    g.n = n;
    g.rule = allocate(n, st.ratio);
    const bounds = {}; let acc = 0;
    for (const gr of GRADES) { bounds[gr] = [acc + 1, acc + g.rule[gr]]; acc += g.rule[gr]; }
    g.bounds = bounds;
    ms.forEach((p, i) => {
      p.rankNo = i + 1;
      p.ruleGrade = GRADES.find(gr => p.rankNo >= bounds[gr][0] && p.rankNo <= bounds[gr][1]);
    });
    if (n === 1 && g.rank) add('W05', { gun: ms[0].gun, name: ms[0].name, unit: g.unit, msg: `${g.unit} × ${g.rank} 그룹 인원 1명 → 규칙상 C등급(지급률 ${st.rate.C}%)`, src: ms[0].assigned.src, action: '규칙대로 C등급 산정 — 지침 확인 필요' });
  }
  for (const { group, block } of ties) {
    for (const p of block) add('W04', { gun: p.gun, name: p.name, unit: group.unit, msg: `${group.unit} × ${group.rank}: 총점 ${p.ev.total}, 정량 ${p.ev.quant}, 정성 ${p.ev.qual} 완전 동점 ${block.length}명 → 담당자가 순위 지정 (현재 ${p.rankNo}위)`, src: p.ev.src, action: `담당자 지정 순위 ${p.rankNo}위 적용` });
  }
  // 등급 확정, 수동 수정, 지급액
  for (const p of persons) {
    p.manual = false; p.grade = null; p.amount = null; p.base = null; p.rate = null; p.change = '';
    if (p.excluded) { p.amount = 0; }
    else if (p.ruleGrade) {
      const ov = S.overrides[p.gun];
      p.grade = ov && ov !== p.ruleGrade ? ov : p.ruleGrade;
      p.manual = p.grade !== p.ruleGrade;
      const b = st.base[p.rank];
      p.base = (b === '' || b == null || isNaN(b)) ? null : Number(b);
      p.rate = st.rate[p.grade];
      p.amount = p.base == null ? null : calcAmount(p.base, p.rate, st.rounding);
    }
    if (p.prevGrade && GRADE_ORDER[p.prevGrade] && p.grade) {
      const d = GRADE_ORDER[p.grade] - GRADE_ORDER[p.prevGrade];
      p.change = d > 0 ? 'up' : d < 0 ? 'down' : 'same';
    } else if (p.prevGrade) p.change = p.grade ? 'other' : 'excl';
  }
  // 산정 검증 (V01)
  for (const g of groups.values()) {
    g.final = { S: 0, A: 0, B: 0, C: 0 };
    g.members.forEach(p => { if (p.grade) g.final[p.grade]++; });
    g.amount = g.members.reduce((t, p) => t + (p.amount || 0), 0);
    g.missingBase = g.members.some(p => p.base == null);
    g.ok = GRADES.every(gr => g.final[gr] === g.rule[gr]) && GRADES.reduce((t, gr) => t + g.final[gr], 0) === g.n;
    if (!g.ok) add('V01', { gun: '', name: '', unit: g.unit, msg: `${g.unit} × ${g.rank}: 규칙 ${GRADES.map(x => x + g.rule[x]).join('/')} ≠ 현재 ${GRADES.map(x => x + g.final[x]).join('/')} (수동 수정)`, action: '수동 수정 내용 확인 필요' });
  }

  const order = { E01: 1, E02: 2, E03: 3, E04: 4, E05: 5, E06: 6, V01: 7, W01: 8, W02: 9, W03: 10, W04: 11, W05: 12 };
  issues.sort((a, b) => order[a.code] - order[b.code] || String(a.unit).localeCompare(String(b.unit), 'ko') || String(a.gun).localeCompare(String(b.gun)));
  persons.sort((a, b) => a.unit.localeCompare(b.unit, 'ko') || rankCmp(a.rank, b.rank) || ((a.rankNo || 1e9) - (b.rankNo || 1e9)) || a.gun.localeCompare(b.gun));
  const groupList = [...groups.values()].sort((a, b) => a.unit.localeCompare(b.unit, 'ko') || rankCmp(a.rank, b.rank));
  const ranks = [...new Set(persons.map(p => p.rank).filter(Boolean))].sort(rankCmp);
  return {
    issues, persons, groups: groupList, ranks, recs, evalMap, prevMap, periodOk, pS, pE,
    errCount: issues.filter(i => i.level === 'E' && i.code !== 'V01').length,
    vCount: issues.filter(i => i.code === 'V01').length,
    warnCount: issues.filter(i => i.level === 'W').length,
    units: [...new Set(persons.map(p => p.unit))].sort((a, b) => a.localeCompare(b, 'ko'))
  };
}
function recompute() { S.model = buildModel(); }

/* ---------------- 단계 진행 조건 ---------------- */
function settingsErrors() {
  const st = S.settings, m = S.model, errs = [];
  const a = parseDate(st.pStart).value, b = parseDate(st.pEnd).value;
  if (a == null || b == null) errs.push('평가 기간 날짜를 입력하세요.');
  else if (a > b) errs.push('평가 기간 시작일이 종료일보다 늦습니다.');
  const sum = ['S', 'A', 'B'].reduce((t, g) => t + Number(st.ratio[g] || 0), 0);
  if (['S', 'A', 'B'].some(g => !(Number(st.ratio[g]) >= 0))) errs.push('등급 비율은 0 이상 숫자여야 합니다.');
  if (sum > 100) errs.push(`S+A+B 비율 합계(${sum}%)가 100%를 넘습니다.`);
  if (GRADES.some(g => !(Number(st.rate[g]) >= 0))) errs.push('지급률은 0 이상 숫자여야 합니다.');
  if (!(Number(st.exclMonths) >= 0)) errs.push('지급 제외 기준 개월 수를 확인하세요.');
  const missing = (m ? m.ranks : []).filter(r => { const v = st.base[r]; return v === '' || v == null || isNaN(v) || Number(v) < 0; });
  if (missing.length) errs.push(`계급별 기준액 미입력: ${missing.join(', ')}`);
  return errs;
}
function step1Ok() {
  const m = S.model;
  if (!m || !m.persons.length) return false;
  if (m.errCount > 0) return false;
  if (m.warnCount > 0 && !S.ackWarn) return false;
  return true;
}
function maxStep() {
  if (S.role !== 'hq') return 1;
  if (!step1Ok()) return 1;
  if (settingsErrors().length) return 2;
  if (S.model.vCount > 0) return 3;
  return 4;
}
function go(step) {
  if (step > maxStep()) return;
  S.screen = step;
  render();
  window.scrollTo(0, 0);
}

/* ---------------- 화면 그리기 ---------------- */
function render() {
  const active = document.activeElement;
  const focusId = active && active.id ? active.id : null;
  const selStart = focusId && active.selectionStart != null ? active.selectionStart : null;
  renderTop();
  const main = $('#main');
  if (S.screen === 'home') main.innerHTML = viewHome();
  else if (S.screen === 1) main.innerHTML = view1();
  else if (S.screen === 2) main.innerHTML = view2();
  else if (S.screen === 3) main.innerHTML = view3();
  else if (S.screen === 4) main.innerHTML = view4();
  afterRender();
  if (focusId) {
    const el = document.getElementById(focusId);
    if (el) { el.focus(); try { if (selStart != null) el.setSelectionRange(selStart, selStart); } catch (e) { /* 일부 입력 형식은 지원 안 함 */ } }
  }
}
function renderTop() {
  const steps = S.role === 'hq'
    ? ['자료 불러오기·점검', '기준 설정', '산정 결과·검증', '내보내기']
    : S.role === 'unit' ? ['자료 불러오기·점검'] : [];
  const mx = S.role ? maxStep() : 0;
  $('#stepper').innerHTML = steps.map((t, i) => {
    const n = i + 1;
    const cls = ['step', n <= mx ? 'enabled' : '', S.screen === n ? 'active' : '', n < mx && S.screen !== n ? 'done' : ''].join(' ');
    return (i ? '<span class="step-arrow">›</span>' : '') + `<button class="${cls}" data-act="go" data-step="${n}"><span class="n">${n}</span>${t}</button>`;
  }).join('');
  $('#roleBadge').textContent = S.role === 'hq' ? '본부 담당자' : S.role === 'unit' ? '부대 담당자' : '';
  $('#roleBadge').className = 'badge role';
}

function viewHome() {
  const standalone = window.matchMedia('(display-mode: standalone)').matches;
  return `
  <div class="hero">
    <h1>성과상여금 취합·산정·근거표 도우미</h1>
    <p class="muted">부대(서)별 엑셀을 모아 자동 점검하고, 부대 × 계급 그룹별 등급과 지급액을 산정한 뒤 개인별 산정근거표(암호 PDF)와 보고용 엑셀을 만듭니다.</p>
  </div>
  <div class="roles">
    <div class="role-card" data-act="role" data-role="unit" tabindex="0">
      <h2>부대 담당자</h2>
      <div>자기 부대 자료를 제출 전에 점검합니다.</div>
      <ul><li>명단·평가 엑셀 불러오기 (열 이름이 달라도 자동 연결)</li><li>근무기간 미달, 휴직, 명단-평가 불일치 등 자동 점검</li><li>본부 제출용 <b>표준 양식 엑셀</b> 저장</li></ul>
    </div>
    <div class="role-card" data-act="role" data-role="hq" tabindex="0">
      <h2>본부 담당자</h2>
      <div>부대별 자료를 취합해 산정하고 근거표를 만듭니다.</div>
      <ul><li>20개 부대 표준 양식 일괄 취합·점검</li><li>기준 설정 → 등급·지급액 자동 산정과 검증, 작년 대비</li><li><b>보고용 엑셀</b>, 개인별 <b>산정근거표 PDF(생년월일 암호)</b> 일괄 생성</li></ul>
    </div>
  </div>
  <div class="home-extra">
    <div class="card">
      <div class="row">
        ${S.installEvt && !standalone ? '<button class="btn primary" data-act="install">⬇ 앱 설치</button>' : ''}
        <button class="btn" data-act="samples">가상 샘플 자료 받기 (테스트용 ZIP)</button>
        <span class="spacer"></span>
        <span class="muted small">${standalone ? '설치된 앱으로 실행 중입니다.' : (location.protocol === 'file:' ? '파일을 직접 열어 설치 없이 실행 중입니다. (설치·오프라인·업데이트 알림 기능 제외)' : '브라우저 주소창의 설치 아이콘이나 [앱 설치] 버튼으로 설치하면 오프라인에서도 쓸 수 있습니다.')}</span>
      </div>
    </div>
    <div class="note warn">⚠ 기본 기준값(등급 비율, 지급률, 지급 제외 기준 등)은 모두 <b>예시</b>입니다. 실제 사용 전 반드시 해당 연도 법령·지침과 대조하세요.</div>
    <div class="note info">개인정보 보호: 불러온 엑셀과 산정 결과는 이 PC의 브라우저 메모리에만 있고 서버로 전송되거나 저장되지 않습니다. 앱을 닫거나 새로고침하면 사라지므로 결과는 내보낸 파일로 보관하세요.</div>
  </div>`;
}

/* ---- 화면 1: 자료 불러오기·점검 ---- */
function view1() {
  const m = S.model;
  const files = S.files;
  const unitRole = S.role === 'unit';
  const versions = [...new Set(files.map(f => f.info && f.info['앱 버전']).filter(Boolean))];
  const verMismatch = versions.filter(v => String(v) !== APP_VERSION);
  return `
  <div class="card">
    <div class="card-head"><h3>1. 자료 불러오기</h3>
      <div class="row small">
        평가 기간 <input type="date" id="p1Start" data-chg="period" data-k="pStart" value="${esc(S.settings.pStart)}"> ~
        <input type="date" id="p1End" data-chg="period" data-k="pEnd" value="${esc(S.settings.pEnd)}">
      </div>
    </div>
    <div class="drop" id="drop" data-act="pick">
      <div style="font-size:28px">📂</div>
      <div><b>엑셀 파일을 여기에 끌어다 놓거나 클릭해서 선택</b>하세요. 여러 개를 한 번에 넣을 수 있습니다. (.xlsx, .xls, .csv)</div>
      <div class="muted small">${unitRole ? '부대 명단과 평가자료 엑셀을 넣으세요.' : '부대별 표준 양식(또는 명단·평가결과), 작년 결과 파일을 넣으세요.'}</div>
    </div>
    <input type="file" id="fileInput" multiple accept=".xlsx,.xls,.csv" hidden>
    ${files.length ? fileTable() : ''}
    ${verMismatch.length ? `<div class="note warn">다른 앱 버전으로 만든 표준 양식이 있습니다: ${verMismatch.map(esc).join(', ')} (현재 ${APP_VERSION}). 같은 규칙인지 확인하세요.</div>` : ''}
  </div>
  ${files.length ? checkPanel() : ''}`;
}
function fileTable() {
  return `
  <div class="table-wrap" style="margin-top:12px;max-height:none">
  <table>
    <thead><tr><th>파일</th><th>시트</th><th class="num">행 수</th><th>종류</th><th>부대(열이 없을 때)</th><th>연결된 항목</th><th></th></tr></thead>
    <tbody>
    ${S.files.map(f => {
      const mapped = Object.keys(f.map).map(k => FIELD_LABEL[k]).join(', ');
      const needUnit = f.map.unit == null && f.kind !== 'prev' && f.kind !== 'skip';
      const ver = f.info && f.info['앱 버전'] ? `<div class="muted small">표준 양식 v${esc(f.info['앱 버전'])}</div>` : '';
      return `<tr>
        <td><b>${esc(f.name)}</b>${ver}</td>
        <td>${f.sheetNames.length > 1 ? `<select id="sheet${f.id}" data-chg="sheet" data-id="${f.id}">${f.sheetNames.map(n => `<option ${n === f.sheetName ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select>` : esc(f.sheetName)}</td>
        <td class="num">${f.rows.length}</td>
        <td><select id="kind${f.id}" data-chg="kind" data-id="${f.id}">${Object.entries(KIND_LABEL).map(([k, v]) => `<option value="${k}" ${k === f.kind ? 'selected' : ''}>${v}</option>`).join('')}</select></td>
        <td>${needUnit ? `<input type="text" id="unit${f.id}" data-chg="unitOverride" data-id="${f.id}" value="${esc(f.unitOverride)}" placeholder="예: 제01부대" class="${f.unitOverride ? '' : 'invalid'}" style="width:120px">` : '<span class="muted small">열에서 읽음</span>'}</td>
        <td class="small">${esc(mapped) || '<span class="lv E">없음</span>'} <button class="linkbtn small" data-act="toggleMap" data-id="${f.id}">${S.openMap[f.id] ? '닫기' : '열 연결 수정'}</button></td>
        <td><button class="btn sm danger" data-act="removeFile" data-id="${f.id}">빼기</button></td>
      </tr>
      ${S.openMap[f.id] ? `<tr><td colspan="7">${mappingTable(f)}</td></tr>` : ''}`;
    }).join('')}
    </tbody>
  </table></div>
  <div class="row" style="margin-top:8px"><button class="btn sm" data-act="clearFiles">모든 파일 빼기</button></div>`;
}
function mappingTable(f) {
  const inv = {};
  for (const [k, ci] of Object.entries(f.map)) inv[ci] = k;
  const sample = ci => f.rows.slice(0, 3).map(x => x.r[ci]).filter(v => v != null && v !== '').map(v => esc(String(v))).join(' · ');
  return `<div class="mapping"><table>
    <thead><tr><th>원본 열 이름</th><th>예시 값</th><th>표준 항목</th></tr></thead>
    <tbody>${f.headers.map((h, ci) => `<tr>
      <td>${esc(h)}</td><td class="muted small">${sample(ci)}</td>
      <td><select id="map${f.id}_${ci}" data-chg="map" data-id="${f.id}" data-ci="${ci}">
        <option value="">(사용 안 함)</option>
        ${FIELDS.map(fl => `<option value="${fl.key}" ${inv[ci] === fl.key ? 'selected' : ''}>${fl.label}</option>`).join('')}
      </select></td></tr>`).join('')}
    </tbody></table>
    <p class="muted small">제목 행은 ${f.headerRow + 1}행으로 인식했습니다. 한 항목은 한 열에만 연결됩니다. 휴직이 여러 건이면 한 칸에 쉼표(,)로 구분해 적거나 같은 군번·성명으로 행을 추가하세요.</p></div>`;
}
function checkPanel() {
  const m = S.model;
  const f = S.issueFilter;
  const counts = {};
  m.issues.forEach(i => { counts[i.code] = (counts[i.code] || 0) + 1; });
  const unitRole = S.role === 'unit';
  const groupsCnt = m.groups.length;
  return `
  <div class="card">
    <div class="card-head"><h3>2. 자동 점검 결과</h3></div>
    <div class="stats">
      <div class="stat"><div class="v">${m.persons.length}</div><div class="k">대상자(명)</div></div>
      <div class="stat"><div class="v">${m.units.length}</div><div class="k">부대</div></div>
      <div class="stat"><div class="v">${groupsCnt}</div><div class="k">부대×계급 그룹</div></div>
      <div class="stat"><div class="v">${m.evalMap.size}</div><div class="k">평가결과(명)</div></div>
      <div class="stat err"><div class="v">${m.errCount}</div><div class="k">오류 (E)</div></div>
      <div class="stat warn"><div class="v">${m.warnCount}</div><div class="k">경고 (W)</div></div>
    </div>
    ${!m.persons.length ? '<div class="note warn">명단 자료가 없습니다. 파일 종류가 "명단" 또는 "명단+평가"인 파일을 넣으세요.</div>' : ''}
    ${!m.periodOk ? '<div class="note err">평가 기간을 확인하세요.</div>' : ''}
    <div class="row" style="margin-bottom:8px">
      <div class="chips">
        <button class="chip ${f.level === 'all' && !f.code ? 'on' : ''}" data-act="ifilter" data-level="all">전체 ${m.issues.length}</button>
        <button class="chip ${f.level === 'E' && !f.code ? 'on' : ''}" data-act="ifilter" data-level="E">오류만 ${m.errCount + m.vCount}</button>
        <button class="chip ${f.level === 'W' && !f.code ? 'on' : ''}" data-act="ifilter" data-level="W">경고만 ${m.warnCount}</button>
        ${Object.keys(CODES).filter(c => counts[c]).map(c => `<button class="chip ${f.code === c ? 'on' : ''}" data-act="ifilter" data-code="${c}">${c} ${CODES[c]} ${counts[c]}</button>`).join('')}
      </div>
      <span class="spacer"></span>
      <input type="search" id="issueQ" data-inp="issueQ" placeholder="군번·성명·부대 검색" value="${esc(f.q)}" style="width:200px">
    </div>
    <div class="table-wrap" id="issueTable">${issueTable()}</div>
    <div class="footer-actions">
      ${m.errCount ? `<div class="note err" style="margin:0">오류 ${m.errCount}건이 남아 있습니다. 원본 엑셀을 고친 뒤 [빼기] 후 다시 불러오세요.</div>` : (m.persons.length ? '<div class="note ok" style="margin:0">오류가 없습니다.</div>' : '')}
      ${m.warnCount ? `<label class="chk"><input type="checkbox" id="ackWarn" data-chg="ackWarn" ${S.ackWarn ? 'checked' : ''}> 경고 ${m.warnCount}건을 확인했습니다</label>` : ''}
      <span class="spacer"></span>
      <button class="btn" data-act="exportStandard" ${m.persons.length ? '' : 'disabled'}>표준 양식 엑셀 저장</button>
      ${unitRole ? '' : `<button class="btn primary" data-act="go" data-step="2" ${step1Ok() ? '' : 'disabled'}>다음: 기준 설정 →</button>`}
    </div>
  </div>`;
}
function matchQ(q, ...vals) { if (!q) return true; q = q.toLowerCase(); return vals.some(v => String(v || '').toLowerCase().includes(q)); }
function issueTable() {
  const m = S.model, f = S.issueFilter;
  const list = m.issues.filter(i => (f.code ? i.code === f.code : (f.level === 'all' || i.level === f.level)) && matchQ(f.q, i.gun, i.name, i.unit));
  if (!list.length) return '<div class="muted" style="padding:14px">표시할 점검 결과가 없습니다.</div>';
  const shown = list.slice(0, 1000);
  return `<table><thead><tr><th>수준</th><th>코드</th><th>점검 내용</th><th>군번</th><th>성명</th><th>부대</th><th>상세</th><th>위치</th></tr></thead><tbody>
    ${shown.map(i => `<tr class="${i.level === 'E' ? 'err' : 'warn'}"><td><span class="lv ${i.level}">${i.level === 'E' ? '오류' : '경고'}</span></td><td>${i.code}</td><td class="nowrap">${CODES[i.code]}</td><td class="nowrap">${esc(i.gun)}</td><td class="nowrap">${esc(i.name)}</td><td>${esc(i.unit)}</td><td>${esc(i.msg)}</td><td class="muted small">${esc(i.src || '')}</td></tr>`).join('')}
  </tbody></table>${list.length > shown.length ? `<div class="muted small" style="padding:8px">… 외 ${list.length - shown.length}건 (검색으로 좁혀 보세요)</div>` : ''}`;
}

/* ---- 화면 2: 기준 설정 ---- */
function view2() {
  const st = S.settings, m = S.model;
  const errs = settingsErrors();
  const cRatio = 100 - ['S', 'A', 'B'].reduce((t, g) => t + Number(st.ratio[g] || 0), 0);
  const rankCnt = r => m.persons.filter(p => p.rank === r).length;
  const rankElig = r => m.persons.filter(p => p.rank === r && !p.excluded).length;
  return `
  <div class="note warn">⚠ 아래 기본값은 모두 <b>예시</b>입니다. 실제 사용 전 반드시 해당 연도 법령·지침과 대조하세요.</div>
  <div class="grid2">
    <div class="card">
      <h3>평가 기간 · 지급 제외 기준</h3>
      <table>
        <tr><th>평가 기간</th><td><input type="date" id="pStart" data-chg="period" data-k="pStart" value="${esc(st.pStart)}"> ~ <input type="date" id="pEnd" data-chg="period" data-k="pEnd" value="${esc(st.pEnd)}"></td></tr>
        <tr><th>지급 제외 기준</th><td>실근무기간 <input type="number" id="exclMonths" data-chg="setting" data-k="exclMonths" value="${esc(st.exclMonths)}" min="0" step="1" style="width:60px"> 개월 미만</td></tr>
        <tr><th>개월 계산 방식</th><td>
          <select id="exclMethod" data-chg="setting" data-k="exclMethod">
            <option value="calendar" ${st.exclMethod === 'calendar' ? 'selected' : ''}>시작일 기준 만 N개월 (달력 기준)</option>
            <option value="days" ${st.exclMethod === 'days' ? 'selected' : ''}>일수 환산 (1개월 = N일)</option>
          </select>
          ${st.exclMethod === 'days' ? `<input type="number" id="daysPerMonth" data-chg="setting" data-k="daysPerMonth" value="${esc(st.daysPerMonth)}" style="width:60px"> 일` : ''}
          <div class="muted small">실근무기간 = 평가 기간 내 근무일 − 휴직일. 전입·전출자는 부대별 기간을 합산해 판단합니다.</div>
        </td></tr>
        <tr><th>원 단위 처리</th><td><select id="rounding" data-chg="setting" data-k="rounding">${Object.entries(ROUNDING_LABEL).map(([k, v]) => `<option value="${k}" ${st.rounding === k ? 'selected' : ''}>${v}</option>`).join('')}</select></td></tr>
      </table>
    </div>
    <div class="card">
      <h3>등급 비율 · 지급률</h3>
      <table>
        <thead><tr><th>등급</th><th class="num">인원 비율(%)</th><th class="num">지급률(%)</th></tr></thead>
        <tbody>
        ${GRADES.map(g => `<tr><td><span class="grade ${g}">${g}</span></td>
          <td class="num">${g === 'C' ? `<b>${r6(cRatio)}</b> <span class="muted small">(나머지)</span>` : `<input type="number" id="ratio${g}" data-chg="ratio" data-g="${g}" value="${esc(st.ratio[g])}" min="0" max="100" step="0.1" style="width:80px">`}</td>
          <td class="num"><input type="number" id="rate${g}" data-chg="rate" data-g="${g}" value="${esc(st.rate[g])}" min="0" step="0.1" style="width:90px"></td></tr>`).join('')}
        </tbody>
      </table>
      <p class="muted small">그룹 인원 n명일 때 S = 반올림(n×S%), A = 반올림(n×A%), B = 반올림(n×B%), C = 나머지. 반올림은 사사오입이며 앞 등급 누적이 n을 넘지 않게 줄입니다.</p>
    </div>
  </div>
  <div class="card">
    <div class="card-head"><h3>계급별 기준액</h3>
      <button class="btn sm" data-act="sampleBase" title="테스트용 예시 금액을 비어 있는 칸에 넣습니다">빈 칸에 예시 금액 넣기 (테스트용)</button></div>
    <table>
      <thead><tr><th>계급 (자료에서 자동 추출)</th><th class="num">인원</th><th class="num">지급 대상</th><th class="num">기준액(원)</th>${GRADES.map(g => `<th class="num">${g} 지급액</th>`).join('')}</tr></thead>
      <tbody>
      ${m.ranks.map((r, i) => {
        const v = st.base[r];
        const ok = !(v === '' || v == null || isNaN(v));
        return `<tr><td>${esc(r)}</td><td class="num">${rankCnt(r)}</td><td class="num">${rankElig(r)}</td>
          <td class="num"><input type="number" id="base${i}" data-chg="base" data-rank="${esc(r)}" value="${ok ? esc(v) : ''}" min="0" step="1000" style="width:140px" class="${ok ? '' : 'invalid'}"></td>
          ${GRADES.map(g => `<td class="num">${ok ? won(calcAmount(Number(v), st.rate[g], st.rounding)) : ''}</td>`).join('')}</tr>`;
      }).join('')}
      </tbody>
    </table>
  </div>
  ${errs.length ? `<div class="note err">${errs.map(esc).join('<br>')}</div>` : '<div class="note ok">기준값이 모두 입력되었습니다.</div>'}
  <div class="footer-actions">
    <button class="btn" data-act="go" data-step="1">← 이전</button>
    <button class="btn primary" data-act="go" data-step="3" ${errs.length ? 'disabled' : ''}>산정하기 →</button>
  </div>`;
}

/* ---- 화면 3: 산정 결과·검증 ---- */
function view3() {
  const m = S.model, st = S.settings;
  const totalAmt = m.groups.reduce((t, g) => t + g.amount, 0);
  const elig = m.persons.filter(p => !p.excluded).length;
  const manualCnt = m.persons.filter(p => p.manual).length;
  const tieGroups = m.groups.filter(g => g.ties.length);
  const hasPrev = m.prevMap.size > 0;
  const prevFiles = S.files.filter(f => f.kind === 'prev');
  const changed = m.persons.filter(p => p.change === 'up' || p.change === 'down').length;
  return `
  <div class="stats">
    <div class="stat"><div class="v">${m.persons.length}</div><div class="k">대상자</div></div>
    <div class="stat"><div class="v">${elig}</div><div class="k">지급 대상</div></div>
    <div class="stat"><div class="v">${m.persons.length - elig}</div><div class="k">지급 제외</div></div>
    ${GRADES.map(g => `<div class="stat"><div class="v">${m.persons.filter(p => p.grade === g).length}</div><div class="k">${g}등급</div></div>`).join('')}
    <div class="stat"><div class="v">${won(totalAmt)}</div><div class="k">총 지급액(원)</div></div>
  </div>
  <div class="card">
    <div class="card-head"><h3>산정 검증</h3></div>
    ${m.vCount ? `<div class="note err">${m.issues.filter(i => i.code === 'V01').map(i => 'V01 ' + esc(i.msg)).join('<br>')}<br>수동 수정한 등급을 되돌리거나 그룹 안에서 인원을 맞추세요. 오류가 있으면 내보내기로 넘어갈 수 없습니다.</div>`
      : `<div class="note ok">✔ ${m.groups.length}개 그룹 모두 등급별 인원이 규칙(8.4)과 일치하고, 등급 인원 합계가 그룹 인원과 같습니다. 그룹 지급액 합계 ${won(totalAmt)}원 = 개인 지급액 합계 ${won(m.persons.reduce((t, p) => t + (p.amount || 0), 0))}원.${manualCnt ? ` (수동 수정 ${manualCnt}명)` : ''}</div>`}
  </div>
  ${tieGroups.length ? `<div class="card">
    <div class="card-head"><h3>완전 동점자 순위 지정 (W04)</h3><span class="muted small">총점·정량·정성이 모두 같습니다. 위·아래 버튼으로 순위를 정하세요. 기본은 군번 순입니다.</span></div>
    ${tieGroups.map(g => g.ties.map(block => `<div style="margin-bottom:10px"><b>${esc(g.unit)} × ${esc(g.rank)}</b> <span class="muted small">총점 ${block[0].ev.total} / 정량 ${block[0].ev.quant} / 정성 ${block[0].ev.qual}</span>
      <table style="width:auto;margin-top:4px"><tbody>${block.map((p, i) => `<tr><td>${p.rankNo}위</td><td>${esc(p.name)}</td><td>${esc(p.gun)}</td><td><span class="grade ${p.grade}">${p.grade}</span></td>
      <td><button class="btn sm" data-act="tieMove" data-gun="${esc(p.gun)}" data-dir="-1" ${i === 0 ? 'disabled' : ''}>▲</button> <button class="btn sm" data-act="tieMove" data-gun="${esc(p.gun)}" data-dir="1" ${i === block.length - 1 ? 'disabled' : ''}>▼</button></td></tr>`).join('')}</tbody></table></div>`).join('')).join('')}
  </div>` : ''}
  <div class="card">
    <div class="card-head"><h3>그룹별 요약 (부대 × 계급)</h3></div>
    <div class="table-wrap" style="max-height:360px">${groupTable()}</div>
  </div>
  <div class="card">
    <div class="card-head"><h3>작년 대비</h3>
      <div class="row"><button class="btn sm" data-act="pickPrev">작년 결과 엑셀 불러오기</button><input type="file" id="prevInput" accept=".xlsx,.xls,.csv" hidden></div></div>
    ${prevFiles.length ? prevFiles.map(f => `<div class="small">📄 ${esc(f.name)} — 군번 열: <b>${f.map.gun != null ? esc(f.headers[f.map.gun]) : '없음'}</b>, 등급 열: <b>${f.map.grade != null ? esc(f.headers[f.map.grade]) : '없음'}</b>
      <button class="linkbtn small" data-act="toggleMap" data-id="${f.id}">${S.openMap[f.id] ? '닫기' : '열 연결 수정'}</button> <button class="linkbtn small" data-act="removeFile" data-id="${f.id}">빼기</button>
      ${S.openMap[f.id] ? mappingTable(f) : ''}</div>`).join('') : '<p class="muted small">작년 보고용 엑셀(또는 군번·등급 열이 있는 결과 파일)을 넣으면 같은 사람의 등급 변화가 표시됩니다.</p>'}
    ${hasPrev ? `<p>작년 자료 ${m.prevMap.size}명 중 올해 대상자와 일치 ${m.persons.filter(p => p.prevGrade).length}명, 등급 변화 ${changed}명 (상승 ${m.persons.filter(p => p.change === 'up').length} · 하락 ${m.persons.filter(p => p.change === 'down').length})</p>` : ''}
  </div>
  <div class="card">
    <div class="card-head"><h3>개인별 산정 결과</h3>
      <div class="row">
        <input type="search" id="resQ" data-inp="resQ" placeholder="군번·성명·부대 검색" value="${esc(S.resFilter.q)}" style="width:180px">
        <select id="resUnit" data-chg="resFilter" data-k="unit"><option value="">전체 부대</option>${m.units.map(u => `<option ${S.resFilter.unit === u ? 'selected' : ''}>${esc(u)}</option>`).join('')}</select>
        <select id="resGrade" data-chg="resFilter" data-k="grade"><option value="">전체 등급</option>${GRADES.map(g => `<option ${S.resFilter.grade === g ? 'selected' : ''}>${g}</option>`).join('')}</select>
        <select id="resStatus" data-chg="resFilter" data-k="status">
          ${[['', '전체'], ['elig', '지급 대상'], ['excl', '지급 제외'], ['changed', '작년 대비 변화'], ['manual', '수동 수정'], ['tie', '동점자'], ['multi', '전입·전출']].map(([k, v]) => `<option value="${k}" ${S.resFilter.status === k ? 'selected' : ''}>${v}</option>`).join('')}
        </select>
      </div>
    </div>
    <div class="table-wrap" id="resTable">${resultTable()}</div>
    <p class="muted small">등급 칸에서 등급을 직접 바꿀 수 있습니다(수동 수정). 수정으로 그룹 인원이 규칙과 달라지면 V01 오류가 됩니다.</p>
  </div>
  <div class="footer-actions">
    <button class="btn" data-act="go" data-step="2">← 기준 설정</button>
    <button class="btn primary" data-act="go" data-step="4" ${m.vCount ? 'disabled' : ''}>다음: 내보내기 →</button>
  </div>`;
}
function groupTable() {
  const m = S.model;
  let tot = { n: 0, ex: 0, S: 0, A: 0, B: 0, C: 0, amt: 0 };
  const rows = m.groups.map(g => {
    tot.n += g.n; tot.ex += g.excluded.length; GRADES.forEach(x => { tot[x] += g.final[x]; }); tot.amt += g.amount;
    return `<tr class="${g.ok ? '' : 'err'}"><td>${esc(g.unit)}</td><td>${esc(g.rank)}</td><td class="num">${g.n + g.excluded.length + g.pending.length}</td><td class="num">${g.excluded.length || ''}</td><td class="num">${g.n}</td>
      ${GRADES.map(x => `<td class="num">${g.final[x]}${g.final[x] !== g.rule[x] ? ` <span class="lv E">규칙 ${g.rule[x]}</span>` : ''}</td>`).join('')}
      <td class="num">${won(g.amount)}</td><td>${g.ok ? '<span class="lv ok">일치</span>' : '<span class="lv E">V01</span>'}${g.n === 1 ? ' <span class="lv W">W05</span>' : ''}${g.ties.length ? ' <span class="lv W">W04</span>' : ''}</td></tr>`;
  }).join('');
  return `<table><thead><tr><th>부대</th><th>계급</th><th class="num">전체</th><th class="num">지급 제외</th><th class="num">대상(n)</th>${GRADES.map(g => `<th class="num">${g}</th>`).join('')}<th class="num">총 지급액(원)</th><th>검증</th></tr></thead>
    <tbody>${rows}<tr class="total"><td colspan="2">합계</td><td class="num">${tot.n + tot.ex}</td><td class="num">${tot.ex}</td><td class="num">${tot.n}</td>${GRADES.map(x => `<td class="num">${tot[x]}</td>`).join('')}<td class="num">${won(tot.amt)}</td><td></td></tr></tbody></table>`;
}
function filteredPersons() {
  const f = S.resFilter;
  return S.model.persons.filter(p => matchQ(f.q, p.gun, p.name, p.unit)
    && (!f.unit || p.unit === f.unit) && (!f.grade || p.grade === f.grade)
    && (!f.status || (f.status === 'elig' && !p.excluded) || (f.status === 'excl' && p.excluded) || (f.status === 'changed' && (p.change === 'up' || p.change === 'down'))
      || (f.status === 'manual' && p.manual) || (f.status === 'tie' && p.tieBlock) || (f.status === 'multi' && p.recs.length > 1)));
}
function changeMark(p) {
  if (!p.prevGrade) return '';
  return p.change === 'up' ? '<span class="up">▲ 상승</span>' : p.change === 'down' ? '<span class="down">▼ 하락</span>' : p.change === 'same' ? '<span class="muted">유지</span>' : '<span class="muted">-</span>';
}
function resultTable() {
  const list = filteredPersons();
  if (!list.length) return '<div class="muted" style="padding:14px">조건에 맞는 대상자가 없습니다.</div>';
  return `<table><thead><tr><th>군번</th><th>성명</th><th>배정 부대</th><th>계급</th><th class="num">실근무(일)</th><th class="num">정량</th><th class="num">정성</th><th class="num">총점</th><th class="num">순위</th><th>등급</th><th class="num">지급액(원)</th><th>작년</th><th>변화</th><th>비고</th></tr></thead><tbody>
  ${list.map(p => {
    const g = S.model.groups.find(x => x.key === p.groupKey);
    const note = [p.excluded ? '지급 제외' : '', p.recs.length > 1 ? '전입·전출' : '', p.tieBlock ? '동점' : '', p.manual ? `수동(규칙 ${p.ruleGrade})` : '', g && g.n === 1 && !p.excluded ? '1인 그룹' : ''].filter(Boolean).join(', ');
    return `<tr class="${p.excluded ? 'excl' : p.manual ? 'warn' : ''}">
      <td class="nowrap">${esc(p.gun)}</td><td class="nowrap">${esc(p.name)}</td><td>${esc(p.unit)}</td><td>${esc(p.rank)}</td>
      <td class="num">${p.effTotal}</td><td class="num">${p.ev ? p.ev.quant : ''}</td><td class="num">${p.ev ? p.ev.qual : ''}</td><td class="num">${p.ev ? p.ev.total : ''}</td>
      <td class="num">${p.rankNo && !p.excluded ? `${p.rankNo}/${g.n}` : '-'}</td>
      <td>${p.excluded ? '<span class="muted">제외</span>' : `<select id="ov_${esc(p.gun)}" data-chg="override" data-gun="${esc(p.gun)}">${GRADES.map(x => `<option ${x === p.grade ? 'selected' : ''}>${x}</option>`).join('')}</select>`}</td>
      <td class="num">${won(p.amount)}</td><td>${esc(p.prevGrade)}</td><td>${changeMark(p)}</td><td class="small">${esc(note)}</td></tr>`;
  }).join('')}</tbody></table>`;
}

/* ---- 화면 4: 내보내기 ---- */
function view4() {
  const m = S.model, job = S.job;
  const pct = job ? Math.round(job.done / job.total * 100) : 0;
  return `
  <div class="grid2">
    <div class="card">
      <h3>보고용 엑셀</h3>
      <p class="muted">총괄 요약, 개인별 산정 결과, 검증 결과, 작년 대비 4개 시트를 만듭니다.</p>
      <button class="btn primary lg" data-act="exportReport">보고용 엑셀 내려받기</button>
    </div>
    <div class="card">
      <h3>문의처 (산정근거표에 표시)</h3>
      <table>
        <tr><th>담당 부서</th><td><input type="text" id="cDept" data-chg="contact" data-k="dept" value="${esc(S.contact.dept)}" placeholder="예: 인사과 급여담당" style="width:100%"></td></tr>
        <tr><th>연락처</th><td><input type="text" id="cPhone" data-chg="contact" data-k="phone" value="${esc(S.contact.phone)}" placeholder="예: 내선 1234" style="width:100%"></td></tr>
      </table>
    </div>
  </div>
  <div class="card">
    <h3>개인별 산정근거표 PDF 일괄 생성</h3>
    <p>대상자 <b>${m.persons.length}명</b>(지급 제외자 포함) 전원의 산정근거표를 만들어 ZIP 하나로 내려받습니다. 각 PDF는 <b>본인 생년월일 6자리</b>로 암호가 걸립니다.</p>
    <p class="muted small">파일명: 성과상여금_산정근거표_{소속}_{성명}_{군번 끝 4자리}.pdf · 암호화 방식은 브라우저 PDF 라이브러리가 지원하는 수준(RC4)이며, 생년월일 암호는 추측하기 쉬우므로 발송 시 수신자를 반드시 확인하세요.</p>
    <div class="row" style="margin:12px 0">
      <button class="btn primary lg" data-act="genPdfs" ${job && job.running ? 'disabled' : ''}>산정근거표 PDF 일괄 생성 (ZIP)</button>
      ${job && job.running ? '<button class="btn" data-act="cancelPdfs">중지</button>' : ''}
      <span class="spacer"></span>
      <input type="search" id="previewQ" placeholder="미리볼 군번 또는 성명" style="width:180px">
      <button class="btn" data-act="previewPdf">미리보기 (암호 없음)</button>
    </div>
    <div id="pdfProgress" ${job ? '' : 'hidden'}>
      <div class="progress"><div style="width:${pct}%"></div></div>
      <div class="small muted" id="pdfProgressText" style="margin-top:4px">${job ? esc(job.text) : ''}</div>
    </div>
  </div>
  <div class="footer-actions">
    <button class="btn" data-act="go" data-step="3">← 산정 결과</button>
  </div>`;
}

function afterRender() {
  const drop = $('#drop');
  if (drop) {
    drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('over'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('over'));
    drop.addEventListener('drop', e => { e.preventDefault(); drop.classList.remove('over'); addFiles([...e.dataTransfer.files]); });
  }
  const fi = $('#fileInput');
  if (fi) fi.addEventListener('change', () => { addFiles([...fi.files]); fi.value = ''; });
  const pi = $('#prevInput');
  if (pi) pi.addEventListener('change', () => { addFiles([...pi.files], 'prev'); pi.value = ''; });
}

/* ---------------- 이벤트 ---------------- */
function fileById(id) { return S.files.find(f => f.id === Number(id)); }
const ACTIONS = {
  home() {
    if (S.screen === 'home') return;
    if (S.files.length && !confirm('처음 화면으로 돌아가면 불러온 자료와 산정 결과가 모두 지워집니다. 계속할까요?')) return;
    resetAll(); render();
  },
  role(el) { S.role = el.dataset.role; S.screen = 1; recompute(); render(); },
  go(el) { go(Number(el.dataset.step)); },
  pick() { $('#fileInput').click(); },
  pickPrev() { $('#prevInput').click(); },
  removeFile(el) { S.files = S.files.filter(f => f.id !== Number(el.dataset.id)); S.ackWarn = false; recompute(); if (S.screen > maxStep()) S.screen = maxStep(); render(); },
  clearFiles() { if (!confirm('불러온 파일을 모두 뺄까요?')) return; S.files = []; S.ackWarn = false; recompute(); render(); },
  toggleMap(el) { S.openMap[el.dataset.id] = !S.openMap[el.dataset.id]; render(); },
  ifilter(el) { S.issueFilter.level = el.dataset.level || 'all'; S.issueFilter.code = el.dataset.code || ''; render(); },
  tieMove(el) {
    const p = S.model.persons.find(x => x.gun === el.dataset.gun);
    if (!p || !p.tieBlock) return;
    const block = p.tieBlock.slice();
    const i = block.indexOf(p), j = i + Number(el.dataset.dir);
    if (j < 0 || j >= block.length) return;
    [block[i], block[j]] = [block[j], block[i]];
    block.forEach((x, k) => { S.tieOrder[x.gun] = k; });
    recompute(); render();
  },
  sampleBase() {
    const ex = { '대령': 6000000, '중령': 5400000, '소령': 4800000, '대위': 4000000, '중위': 3400000, '소위': 3000000, '원사': 4200000, '상사': 3600000, '중사': 3000000, '하사': 2600000 };
    S.model.ranks.forEach((r, i) => { if (S.settings.base[r] == null || S.settings.base[r] === '') S.settings.base[r] = ex[r] || 3000000 - i * 100000; });
    recompute(); render();
  },
  exportStandard() { exportStandard(); },
  exportReport() { exportReport(); },
  genPdfs() { generatePdfs(); },
  cancelPdfs() { if (S.job) S.job.cancel = true; },
  previewPdf() { previewPdf(); },
  samples() { downloadSamples(); },
  install() { if (S.installEvt) { S.installEvt.prompt(); S.installEvt.userChoice.finally(() => { S.installEvt = null; render(); }); } },
  applyUpdate() {
    if (S.files.length && !confirm('새로고침하면 불러온 자료와 산정 결과가 모두 사라집니다. 필요한 파일을 저장했나요?')) return;
    S.updateRequested = true;
    if (S.waitingWorker) S.waitingWorker.postMessage({ type: 'SKIP_WAITING' });
    else location.reload();
  }
};
const CHANGES = {
  period(el) { S.settings[el.dataset.k] = el.value; recompute(); },
  setting(el) { S.settings[el.dataset.k] = el.type === 'number' ? (el.value === '' ? '' : Number(el.value)) : el.value; recompute(); },
  ratio(el) { S.settings.ratio[el.dataset.g] = el.value === '' ? '' : Number(el.value); recompute(); },
  rate(el) { S.settings.rate[el.dataset.g] = el.value === '' ? '' : Number(el.value); recompute(); },
  base(el) { S.settings.base[el.dataset.rank] = el.value === '' ? '' : Math.floor(Number(el.value)); recompute(); },
  kind(el) { fileById(el.dataset.id).kind = el.value; S.ackWarn = false; recompute(); },
  sheet(el) { const f = fileById(el.dataset.id); loadSheet(f, el.value); f.kind = detectKind(f.map); recompute(); },
  unitOverride(el) { fileById(el.dataset.id).unitOverride = el.value.trim(); recompute(); },
  map(el) {
    const f = fileById(el.dataset.id), ci = Number(el.dataset.ci);
    for (const k of Object.keys(f.map)) if (f.map[k] === ci || k === el.value) delete f.map[k];
    if (el.value) f.map[el.value] = ci;
    S.ackWarn = false; recompute();
  },
  ackWarn(el) { S.ackWarn = el.checked; },
  resFilter(el) { S.resFilter[el.dataset.k] = el.value; },
  override(el) {
    const p = S.model.persons.find(x => x.gun === el.dataset.gun);
    if (p && el.value === p.ruleGrade) delete S.overrides[el.dataset.gun]; else S.overrides[el.dataset.gun] = el.value;
    recompute();
  },
  contact(el) { S.contact[el.dataset.k] = el.value; }
};
document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (!el || el.disabled) return;
  const fn = ACTIONS[el.dataset.act];
  if (fn) fn(el, e);
});
document.addEventListener('keydown', e => {
  if (e.key === 'Enter' && e.target.matches('.role-card')) e.target.click();
  if (e.key === 'Enter' && e.target.id === 'previewQ') previewPdf();
});
document.addEventListener('change', e => {
  const el = e.target.closest('[data-chg]');
  if (!el) return;
  const fn = CHANGES[el.dataset.chg];
  if (fn) { fn(el); setTimeout(render, 0); }
});
document.addEventListener('input', e => {
  const el = e.target;
  if (el.dataset.inp === 'issueQ') { S.issueFilter.q = el.value; $('#issueTable').innerHTML = issueTable(); }
  if (el.dataset.inp === 'resQ') { S.resFilter.q = el.value; $('#resTable').innerHTML = resultTable(); }
});
// 앱 밖으로 파일을 떨어뜨려 브라우저가 파일을 열어 버리는 것 방지
window.addEventListener('dragover', e => e.preventDefault());
window.addEventListener('drop', e => e.preventDefault());
window.addEventListener('beforeunload', e => { if (S.files.length) { e.preventDefault(); e.returnValue = ''; } });

function resetAll() {
  S.screen = 'home'; S.role = null; S.files = []; S.settings = defaultSettings(); S.tieOrder = {}; S.overrides = {};
  S.ackWarn = false; S.openMap = {}; S.contact = { dept: '', phone: '' }; S.job = null;
  S.issueFilter = { level: 'all', code: '', q: '' }; S.resFilter = { q: '', unit: '', grade: '', status: '' };
  recompute();
}
let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 3500);
}
function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
function saveWorkbook(wb, name) {
  const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  download(new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), name);
}
function sheetFrom(aoa, widths) {
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  if (widths) ws['!cols'] = widths.map(w => ({ wch: w }));
  return ws;
}
const safeName = s => String(s || '').replace(/[\\/:*?"<>|\s]+/g, '_');

/* ---------------- 내보내기: 표준 양식 ---------------- */
function exportStandard() {
  const m = S.model;
  if (m.errCount && !confirm(`오류 ${m.errCount}건이 남아 있습니다. 그래도 표준 양식으로 저장할까요?`)) return;
  const head = ['군번', '성명', '생년월일', '소속 부대', '계급', '직군', '근무 시작일', '근무 종료일', '휴직 시작일', '휴직 종료일', '전입일', '전출일', '정량평가 점수', '정성평가 점수', '총점'];
  const rows = [head];
  const recs = m.recs.slice().sort((a, b) => a.unit.localeCompare(b.unit, 'ko') || a.gun.localeCompare(b.gun));
  for (const r of recs) {
    const ev = m.evalMap.get(r.gun);
    rows.push([r.gun, r.name, r.birth || r.birthRaw, r.unit, r.rank, r.job, dstr(r.start), dstr(r.end),
      r.leaves.map(l => dstr(l[0])).join(', '), r.leaves.map(l => dstr(l[1])).join(', '), dstr(r.tin), dstr(r.tout),
      ev ? ev.quant : '', ev ? ev.qual : '', ev ? ev.total : '']);
  }
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheetFrom(rows, [14, 10, 10, 14, 8, 8, 12, 12, 24, 24, 12, 12, 12, 12, 8]), '표준양식');
  XLSX.utils.book_append_sheet(wb, sheetFrom([['항목', '값'], ['앱 버전', APP_VERSION], ['생성 일시', new Date().toLocaleString('ko-KR')], ['부대', m.units.join(', ')],
    ['평가 기간', `${S.settings.pStart} ~ ${S.settings.pEnd}`], ['인원', m.persons.length], ['오류 수', m.errCount], ['경고 수', m.warnCount]], [12, 50]), '정보');
  const unitName = m.units.length === 1 ? m.units[0] : (m.units.length ? `${m.units[0]}외${m.units.length - 1}` : '자료');
  saveWorkbook(wb, `성과상여금_표준양식_${safeName(unitName)}.xlsx`);
}

/* ---------------- 내보내기: 보고용 엑셀 ---------------- */
function exportReport() {
  const m = S.model, st = S.settings;
  const wb = XLSX.utils.book_new();
  // 1. 총괄 요약
  const sum = [['성과상여금 산정 총괄 요약'], [`평가 기간 ${st.pStart} ~ ${st.pEnd} · 앱 버전 ${APP_VERSION} · 작성 ${new Date().toLocaleString('ko-KR')}`],
    [`등급 비율 S ${st.ratio.S}% / A ${st.ratio.A}% / B ${st.ratio.B}% / C 나머지 · 지급률 ${GRADES.map(g => `${g} ${st.rate[g]}%`).join(' / ')} · ${ROUNDING_LABEL[st.rounding]} · 지급 제외: 실근무 ${st.exclMonths}개월 미만`], [],
    ['부대', '계급', '대상 인원', '지급 제외 인원', '등급 산정 인원', 'S', 'A', 'B', 'C', '계급 기준액', '총 지급액']];
  const tot = { all: 0, ex: 0, n: 0, S: 0, A: 0, B: 0, C: 0, amt: 0 };
  for (const g of m.groups) {
    const all = g.n + g.excluded.length + g.pending.length;
    sum.push([g.unit, g.rank, all, g.excluded.length, g.n, g.final.S, g.final.A, g.final.B, g.final.C, Number(st.base[g.rank]) || 0, g.amount]);
    tot.all += all; tot.ex += g.excluded.length; tot.n += g.n; GRADES.forEach(x => { tot[x] += g.final[x]; }); tot.amt += g.amount;
  }
  sum.push(['합계', '', tot.all, tot.ex, tot.n, tot.S, tot.A, tot.B, tot.C, '', tot.amt]);
  XLSX.utils.book_append_sheet(wb, sheetFrom(sum, [14, 8, 10, 12, 12, 6, 6, 6, 6, 14, 16]), '총괄 요약');
  // 2. 개인별 산정 결과
  const per = [['군번', '성명', '생년월일', '소속 부대', '계급', '직군', '근무 시작일', '근무 종료일', '휴직 시작일', '휴직 종료일', '전입일', '전출일', '정량평가 점수', '정성평가 점수', '총점',
    '실근무기간(일)', '지급 대상 여부', '그룹', '그룹 인원', '순위', '등급', '지급률(%)', '기준액', '지급액', '작년 등급', '등급 변화', '근무 이력·배정 사유', '비고']];
  for (const p of m.persons) {
    const r = p.assigned, g = m.groups.find(x => x.key === p.groupKey);
    per.push([p.gun, p.name, p.birth, p.unit, p.rank, p.job, dstr(r.start), dstr(r.end), r.leaves.map(l => dstr(l[0])).join(', '), r.leaves.map(l => dstr(l[1])).join(', '),
      dstr(r.tin), dstr(r.tout), p.ev ? p.ev.quant : '', p.ev ? p.ev.qual : '', p.ev ? p.ev.total : '',
      p.effTotal, p.excluded ? '지급 제외' : '지급 대상', `${p.unit} × ${p.rank}`, g ? g.n : '', p.excluded ? '' : p.rankNo, p.grade || '', p.excluded ? '' : p.rate,
      p.excluded ? '' : (p.base == null ? '' : p.base), p.amount == null ? '' : p.amount, p.prevGrade,
      p.change === 'up' ? '상승' : p.change === 'down' ? '하락' : p.change === 'same' ? '유지' : '',
      p.recs.length > 1 ? p.assignReason : '', [p.manual ? `수동 수정(규칙 ${p.ruleGrade})` : '', p.tieBlock ? '완전 동점(담당자 지정)' : '', g && g.n === 1 && !p.excluded ? '1인 그룹' : ''].filter(Boolean).join(', ')]);
  }
  XLSX.utils.book_append_sheet(wb, sheetFrom(per, [14, 9, 9, 12, 7, 7, 11, 11, 22, 22, 11, 11, 9, 9, 7, 10, 10, 16, 8, 6, 6, 9, 11, 12, 8, 8, 40, 20]), '개인별 산정 결과');
  // 3. 검증 결과
  const ver = [['코드', '수준', '점검 내용', '군번', '성명', '부대', '상세', '처리 내용', '위치']];
  for (const i of m.issues) ver.push([i.code, i.level === 'E' ? '오류' : '경고', CODES[i.code], i.gun, i.name, i.unit, i.msg, i.action || '원본 수정 필요', i.src || '']);
  ver.push([]);
  ver.push(['산정 검증', '', `${m.groups.length}개 그룹`, '', '', '', m.vCount ? `규칙 불일치 ${m.vCount}개 그룹` : '모든 그룹의 등급별 인원이 규칙과 일치, 등급 인원 합계 = 그룹 인원', '', '']);
  ver.push(['지급액 검증', '', '그룹 합계 = 개인 합계', '', '', '', `${won(m.groups.reduce((t, g) => t + g.amount, 0))}원 = ${won(m.persons.reduce((t, p) => t + (p.amount || 0), 0))}원`, '', '']);
  XLSX.utils.book_append_sheet(wb, sheetFrom(ver, [6, 6, 26, 14, 9, 14, 60, 34, 28]), '검증 결과');
  // 4. 작년 대비
  const cmp = [['군번', '성명', '소속 부대', '계급', '작년 등급', '올해 등급', '변화']];
  const changed = m.persons.filter(p => p.prevGrade && p.prevGrade !== (p.grade || '제외'));
  if (!m.prevMap.size) cmp.push(['작년 결과 자료를 불러오지 않았습니다.']);
  else if (!changed.length) cmp.push(['등급이 바뀐 사람이 없습니다.']);
  for (const p of changed) cmp.push([p.gun, p.name, p.unit, p.rank, p.prevGrade, p.grade || '지급 제외', p.change === 'up' ? '상승' : p.change === 'down' ? '하락' : '변경']);
  XLSX.utils.book_append_sheet(wb, sheetFrom(cmp, [14, 9, 12, 8, 9, 9, 8]), '작년 대비');
  saveWorkbook(wb, `성과상여금_보고용_${stamp()}_v${APP_VERSION}.xlsx`);
}

/* ---------------- 산정근거표 PDF ---------------- */
const PDF_FONT = 'NanumGothic';
function newPdf(password, ownerPw) {
  const opts = { unit: 'mm', format: 'a4', compress: true };
  if (password) opts.encryption = { userPassword: password, ownerPassword: ownerPw, userPermissions: ['print'] };
  const doc = new window.jspdf.jsPDF(opts);
  doc.addFileToVFS('NanumGothic.ttf', window.__NANUM_FONT);
  doc.addFont('NanumGothic.ttf', PDF_FONT, 'normal');
  doc.setFont(PDF_FONT, 'normal');
  doc.setProperties({ title: '성과상여금 산정근거표', creator: `성과상여금 도우미 v${APP_VERSION}` });
  return doc;
}
function drawPerson(doc, p) {
  const st = S.settings, m = S.model;
  const g = m.groups.find(x => x.key === p.groupKey);
  const L = 15, W = 180;
  let y = 16;
  const C = { line: [190, 196, 206], head: [232, 238, 252], label: [245, 246, 249], text: [25, 30, 40], blue: [29, 78, 216], gray: [105, 112, 125], hl: [255, 247, 214] };
  const color = c => doc.setTextColor(c[0], c[1], c[2]);
  const T = (t, x, yy, o) => doc.text(t, x, yy, Object.assign({ renderingMode: 'fill' }, o || {}));
  const B = (t, x, yy, o, c) => { const cc = c || C.text; doc.setDrawColor(cc[0], cc[1], cc[2]); doc.setLineWidth(0.18); doc.text(t, x, yy, Object.assign({ renderingMode: 'fillThenStroke' }, o || {})); };

  doc.setFontSize(17); color(C.text); B('성과상여금 산정근거표', 105, y, { align: 'center' }); y += 6.5;
  doc.setFontSize(9); color(C.gray);
  T(`평가 기간 ${st.pStart} ~ ${st.pEnd}  ·  작성일 ${todayStr()}  ·  앱 버전 v${APP_VERSION}`, 105, y, { align: 'center' }); y += 3.5;

  const section = t => {
    y += 1.8;
    if (y + 14 > 287) { doc.addPage(); y = 15; }
    doc.setFillColor(...C.head); doc.rect(L, y, W, 6.2, 'F');
    doc.setFontSize(10); color(C.blue); B(t, L + 2.5, y + 4.4, null, C.blue);
    y += 7.2;
  };
  const table = (rows, widths) => {
    doc.setFontSize(8.8); doc.setLineWidth(0.2);
    for (const row of rows) {
      const cells = row.map(c => (c !== null && typeof c === 'object') ? c : { t: c });
      const lines = cells.map((c, i) => doc.splitTextToSize(String(c.t == null ? '' : c.t), widths[i] - 3));
      const h = Math.max(...lines.map(l => l.length)) * 3.6 + 2.3;
      if (y + h > 287) { doc.addPage(); y = 15; }
      let x = L;
      cells.forEach((c, i) => {
        doc.setDrawColor(...C.line);
        const fill = c.label ? C.label : c.fill;
        if (fill) { doc.setFillColor(...fill); doc.rect(x, y, widths[i], h, 'FD'); } else doc.rect(x, y, widths[i], h);
        color(c.label ? C.gray : (c.color || C.text));
        const tx = c.align === 'right' ? x + widths[i] - 1.5 : c.align === 'center' ? x + widths[i] / 2 : x + 1.5;
        if (c.bold) B(lines[i], tx, y + 4.0, { align: c.align || 'left' }, c.color || C.text);
        else T(lines[i], tx, y + 4.0, { align: c.align || 'left' });
        x += widths[i];
      });
      y += h;
    }
  };
  const lb = t => ({ t, label: true });
  const KW = [30, 60, 30, 60];

  // 1. 기본 정보
  section('1. 기본 정보');
  table([[lb('성명'), { t: p.name, bold: true }, lb('군번'), p.gun], [lb('소속 부대'), p.unit, lb('계급'), p.rank], [lb('직군'), p.job || '-', lb('평가 그룹'), `${p.unit} × ${p.rank}`]], KW);

  // 2. 근무기간 산정
  section('2. 근무기간 산정');
  table([[lb('부대'), lb('근무 구간 (평가 기간 내)'), lb('근무일수'), lb('휴직 기간'), lb('휴직일수'), lb('실근무일수')]].concat(
    p.recs.map(r => {
      const c = r.calc;
      return [r.unit, c.days ? `${dstr(c.cs)} ~ ${dstr(c.ce)}` : '평가 기간 내 근무 없음', { t: `${c.days}일`, align: 'right' },
        c.leaveSegs.length ? c.leaveSegs.map(s => `${dstr(s[0])} ~ ${dstr(s[1])}`).join('\n') : '-', { t: `${c.leaveDays}일`, align: 'right' }, { t: `${c.eff}일`, align: 'right' }];
    })), [28, 46, 20, 46, 20, 20]);
  const moves = p.recs.filter(r => r.tin != null || r.tout != null).map(r => `${r.unit}${r.tin != null ? ` 전입 ${dstr(r.tin)}` : ''}${r.tout != null ? ` 전출 ${dstr(r.tout)}` : ''}`);
  if (moves.length) table([[lb('전입·전출'), moves.join(' / ')]], [28, 152]);
  table([[lb('실근무기간 합계'), { t: `${p.effTotal}일`, bold: true }, lb('지급 제외 기준'), `${p.thrText} 미만`, lb('지급 대상 여부'), { t: p.excluded ? '지급 제외 (기준 미달)' : '지급 대상', bold: true, color: p.excluded ? [185, 28, 28] : [4, 120, 87] }]], [28, 20, 26, 40, 26, 40]);

  // 3. 소속 그룹
  section('3. 소속 그룹');
  table([[lb('평가 그룹'), `${p.unit} × ${p.rank} (소속 부대 × 계급)`, lb('그룹 인원'), g ? `${g.n}명 (등급 산정 대상)${g.excluded.length ? ` · 지급 제외 ${g.excluded.length}명 별도` : ''}` : '-']], KW);
  table([[lb('배정 사유'), p.recs.length > 1 ? `전입·전출: ${p.assignReason}` : '단일 부대 근무 (해당 부대 그룹에 배정)']], [30, 150]);

  // 4. 평가 결과
  section('4. 평가 결과');
  table([[lb('정량평가 점수'), p.ev ? String(p.ev.quant) : '-', lb('정성평가 점수'), p.ev ? String(p.ev.qual) : '-'],
    [lb('총점'), p.ev ? `${p.ev.total}${p.ev.totalCalc ? ' (정량+정성)' : ''}` : '-', lb('그룹 내 순위'), { t: p.excluded ? '- (지급 제외로 순위 미산정)' : `${p.rankNo}위 / ${g.n}명`, bold: true }]], KW);

  // 5. 등급 산정 근거
  section('5. 등급 산정 근거');
  if (p.excluded) {
    table([[lb('등급'), '실근무기간이 지급 제외 기준에 못 미쳐 순위·등급 배분 대상에서 제외되었습니다.']], [30, 150]);
  } else {
    table([[lb('등급'), lb('인원 비율'), lb('배정 인원'), lb('순위 구간'), lb('본인')]].concat(GRADES.map(gr => {
      const b = g.bounds[gr], hit = p.ruleGrade === gr;
      const fill = hit ? C.hl : null;
      return [{ t: gr, align: 'center', fill, bold: hit }, { t: gr === 'C' ? `나머지 (${r6(100 - st.ratio.S - st.ratio.A - st.ratio.B)}%)` : `${st.ratio[gr]}% → 반올림(${g.n}×${st.ratio[gr]}%)`, fill },
        { t: `${g.rule[gr]}명`, align: 'right', fill }, { t: g.rule[gr] ? (b[0] === b[1] ? `${b[0]}위` : `${b[0]}~${b[1]}위`) : '-', fill }, { t: hit ? `◀ 본인 ${p.rankNo}위` : '', fill, bold: hit }];
    })), [20, 62, 25, 38, 35]);
    y += 1.5;
    const tieTxt = p.tieBlock ? `총점·정량·정성이 모두 같은 동점자 ${p.tieBlock.length}명 → 담당자가 지정한 순위 적용 (본인 ${p.rankNo}위)` : '해당 없음';
    const rows = [[lb('동점 시 기준'), '① 총점 → ② 정량평가 점수 → ③ 정성평가 점수 순으로 높은 사람 우선, 모두 같으면 담당자 지정'], [lb('본인 동점 여부'), tieTxt],
      [lb('산정 등급'), { t: p.manual ? `${p.grade}등급 (규칙상 ${p.ruleGrade}등급, 담당자 수동 조정)` : `${p.grade}등급 (본인 순위 ${p.rankNo}위가 ${p.grade}등급 구간에 속함)`, bold: true }]];
    if (g.n === 1) rows.push([lb('참고'), '그룹 인원이 1명이어서 규칙상 S·A·B 배정 인원이 0명이 되어 C등급으로 산정되었습니다.']);
    table(rows, [30, 150]);
  }

  // 6. 지급액 산정
  section('6. 지급액 산정');
  if (p.excluded) table([[lb('지급액'), { t: '0원 (지급 제외)', bold: true }]], [30, 150]);
  else table([[lb('계산식'), `계급별 기준액(${p.rank}) ${won(p.base)}원 × 등급별 지급률(${p.grade}) ${p.rate}% = ${won(p.base * p.rate / 100)}원`],
    [lb('끝수 처리'), `${ROUNDING_LABEL[st.rounding]} · 근무기간 비례 감액 없음`], [lb('지급액'), { t: `${won(p.amount)}원`, bold: true, color: C.blue }]], [30, 150]);

  // 7. 작년 등급
  section('7. 작년 등급');
  const chg = { up: '상승', down: '하락', same: '유지' }[p.change];
  table([[lb('작년 등급'), p.prevGrade ? `${p.prevGrade} → 올해 ${p.grade || '지급 제외'}${chg ? ` (${chg})` : ''}` : '작년 자료 없음']], [30, 150]);

  // 8. 문의처
  section('8. 문의처');
  table([[lb('담당 부서'), S.contact.dept || '', lb('연락처'), S.contact.phone || '']], KW);

  y += 5;
  doc.setFontSize(8); color(C.gray);
  T(doc.splitTextToSize('※ 본 문서는 개인정보를 포함하고 있으므로 본인 외 열람·복사·배포를 금합니다. 등급 비율·지급률·기준액은 해당 연도 지침에 따른 값이며, 산정 결과에 의문이 있으면 위 문의처로 연락하시기 바랍니다.', W), L, Math.min(y, 287));
}
function pdfFileName(p) {
  return `성과상여금_산정근거표_${safeName(p.unit)}_${safeName(p.name)}_${p.gun.replace(/\D/g, '').slice(-4) || safeName(p.gun).slice(-4)}.pdf`;
}
async function generatePdfs() {
  const persons = S.model.persons.slice();
  if (!persons.length) return;
  const noBirth = persons.filter(p => !/^\d{6}$/.test(p.birth));
  if (noBirth.length) { toast(`생년월일이 올바르지 않은 대상자가 ${noBirth.length}명 있어 생성할 수 없습니다.`); return; }
  const zip = new JSZip();
  const owner = Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, '0')).join('');
  const used = new Set();
  const job = S.job = { running: true, done: 0, total: persons.length, cancel: false, text: '준비 중…' };
  render();
  const t0 = performance.now();
  const upd = () => {
    const bar = $('#pdfProgress .progress > div'), tx = $('#pdfProgressText');
    if (bar) bar.style.width = Math.round(job.done / job.total * 100) + '%';
    if (tx) tx.textContent = job.text;
  };
  try {
    for (const p of persons) {
      if (job.cancel) { job.running = false; job.text = '중지했습니다.'; render(); return; }
      const doc = newPdf(p.birth, owner);
      drawPerson(doc, p);
      let name = pdfFileName(p);
      for (let k = 2; used.has(name); k++) name = pdfFileName(p).replace(/\.pdf$/, `_${k}.pdf`);
      used.add(name);
      zip.file(name, doc.output('arraybuffer'));
      job.done++;
      job.text = `PDF 생성 ${job.done} / ${job.total}명 (${((performance.now() - t0) / 1000).toFixed(1)}초)`;
      if (job.done % 3 === 0) { upd(); await sleep(0); }
    }
    job.text = 'ZIP으로 묶는 중…'; upd(); await sleep(0);
    const blob = await zip.generateAsync({ type: 'blob', compression: 'STORE' });
    download(blob, `성과상여금_산정근거표_${stamp()}.zip`);
    job.text = `완료: ${job.total}명 PDF를 ZIP으로 내려받았습니다. (${((performance.now() - t0) / 1000).toFixed(1)}초)`;
  } catch (e) {
    console.error(e);
    job.text = `오류로 중단했습니다: ${e.message}`;
  }
  job.running = false; job.done = job.total;
  render();
}
function previewPdf() {
  const q = ($('#previewQ') && $('#previewQ').value.trim()) || '';
  const p = q ? S.model.persons.find(x => x.gun === q || x.name === q || x.gun.endsWith(q)) : S.model.persons[0];
  if (!p) { toast('해당 대상자를 찾을 수 없습니다.'); return; }
  const doc = newPdf(null);
  drawPerson(doc, p);
  const url = URL.createObjectURL(doc.output('blob'));
  const w = window.open(url, '_blank');
  if (!w) download(doc.output('blob'), pdfFileName(p));
  setTimeout(() => URL.revokeObjectURL(url), 120000);
}

/* ---------------- 샘플 자료 ---------------- */
async function downloadSamples() {
  toast('가상 샘플 자료를 만드는 중…');
  await sleep(30);
  const files = window.BonusSamples.make(new Date().getFullYear() - 1);
  const zip = new JSZip();
  for (const f of files) zip.file(f.path, f.data);
  download(await zip.generateAsync({ type: 'blob' }), '성과상여금_가상샘플자료.zip');
}

/* ---------------- PWA ---------------- */
function initPwa() {
  const mode = $('#runMode');
  const standalone = window.matchMedia('(display-mode: standalone)').matches;
  if (location.protocol === 'file:' || !('serviceWorker' in navigator)) { mode.textContent = '설치 없이 실행 중'; return; }
  mode.textContent = standalone ? '설치된 앱으로 실행 중' : '브라우저에서 실행 중';
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); S.installEvt = e; if (S.screen === 'home') render(); });
  window.addEventListener('appinstalled', () => { S.installEvt = null; toast('앱이 설치되었습니다. 바탕화면·작업표시줄 아이콘으로 실행할 수 있습니다.'); if (S.screen === 'home') render(); });
  navigator.serviceWorker.register('sw.js').then(reg => {
    const show = w => { S.waitingWorker = w; $('#updateBanner').hidden = false; };
    if (reg.waiting && navigator.serviceWorker.controller) show(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const nw = reg.installing;
      if (nw) nw.addEventListener('statechange', () => { if (nw.state === 'installed' && navigator.serviceWorker.controller) show(nw); });
    });
    reg.update().catch(() => { /* 오프라인이면 다음 실행 때 다시 확인 */ });
  }).catch(() => { mode.textContent = '설치 없이 실행 중 (서비스 워커 사용 불가)'; });
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (S.updateRequested) location.reload(); });
}
function updateNet() {
  const el = $('#netStatus');
  el.textContent = navigator.onLine ? '온라인' : '오프라인';
  el.className = 'badge ' + (navigator.onLine ? 'on' : 'off');
}

/* ---------------- 시작 ---------------- */
$('#appVersion').textContent = 'v' + APP_VERSION;
window.addEventListener('online', updateNet);
window.addEventListener('offline', updateNet);
updateNet();
recompute();
render();
initPwa();
// 자동 점검용 (개발자 도구에서 사용)
window.__bonus = { S, addFiles, recompute, render, buildModel, allocate, calcAmount };
