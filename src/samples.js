'use strict';
/* 가상 샘플 자료 생성기 (PRD 11장). 실제 인물 정보 아님.
 * 부대 20개 × 약 10명, 부대마다 열 이름·순서·날짜 형식이 다름.
 * 1_오류포함: 의도적 예외 사례 전부 포함 / 2_오류수정본: 오류(E)만 고친 자료 (경고는 유지)
 */
window.BonusSamples = (function () {
  const pad = (n, w = 2) => String(n).padStart(w, '0');
  const DAY = 86400000;
  const dn = (y, m, d) => Math.round(Date.UTC(y, m - 1, d) / DAY);
  const ds = n => new Date(n * DAY).toISOString().slice(0, 10);
  const r1 = x => Math.round(x * 10) / 10;

  function make(Y) {
    let seed = 20251020;
    const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
    const pick = a => a[Math.floor(rnd() * a.length)];
    const SUR = ['김', '이', '박', '최', '정', '강', '조', '윤', '장', '임', '한', '오', '서', '신', '권', '황', '안', '송', '류', '홍'];
    const GIV = ['민준', '서연', '도윤', '지우', '하준', '서윤', '시우', '지민', '주원', '하은', '예준', '수아', '지호', '지유', '준서', '채원', '건우', '다은', '현우', '예린', '우진', '소율', '선우', '가은', '유준', '나연', '연우', '윤서', '정우', '수빈'];
    // 부대마다 계급 3~4종 (모든 조합에 '상사'가 있어 전입·전출자가 같은 계급을 유지), 대령은 1인 그룹용
    const RANK_SETS = [['중위', '소위', '상사'], ['상사', '중사', '하사'], ['중령', '소령', '대위', '상사'], ['원사', '상사', '중사', '하사']];
    const JOBS = ['행정', '군수', '전산', '시설', '통신'];
    const usedNames = new Set();
    const newName = () => { let n; do n = pick(SUR) + pick(GIV); while (usedNames.has(n)); usedNames.add(n); return n; };
    const birth = () => pad(Math.floor(70 + rnd() * 34) % 100) + pad(1 + Math.floor(rnd() * 12)) + pad(1 + Math.floor(rnd() * 28));
    const oldStart = () => dn(Y - 1 - Math.floor(rnd() * 8), 1 + Math.floor(rnd() * 12), 1 + Math.floor(rnd() * 27));
    const score = () => { const q = r1(40 + rnd() * 30), l = r1(10 + rnd() * 20); return { q, l, t: r1(q + l) }; };

    // ---- 기본 인원 ----
    const units = [];
    let gunSeq = 0;
    for (let u = 1; u <= 20; u++) {
      const name = `제${pad(u)}부대`;
      const ranks = RANK_SETS[u % 4];
      const people = [];
      for (let k = 0; k < 10; k++) {
        gunSeq++;
        people.push({
          gun: `${pad(10 + (gunSeq % 15))}-7${pad(u)}${pad(gunSeq, 5)}`, name: newName(), birth: birth(), unit: name,
          rank: ranks[k % ranks.length], job: pick(JOBS), start: oldStart(), end: null, leaves: [], tin: null, tout: null, sc: score()
        });
      }
      units.push({ u, name, people });
    }
    const P = (u, k) => units[u - 1].people[k];

    // ---- 의도적 예외 사례 ----
    P(2, 9).start = dn(Y, 11, 15);                                   // W01 근무기간 2개월 미만 (47일)
    P(3, 2).leaves = [[dn(Y, 3, 1), dn(Y, 5, 31)]];                  // W02 휴직
    P(4, 3).leaves = [[dn(Y, 2, 1), dn(Y, 2, 28)], [dn(Y, 9, 1), dn(Y, 9, 30)]];  // W02 휴직 2건 (쉼표 구분)
    P(5, 4).leaves = [[dn(Y, 6, 1), dn(Y, 6, 30)], [dn(Y, 10, 1), dn(Y, 10, 31)]]; P(5, 4).extraLeaveRow = true;  // 휴직 2건 (행 추가)
    // 전입·전출 A: 제06부대(4개월) → 제07부대(8개월) → 제07부대 배정
    const ta = P(6, 9); ta.rank = '상사'; ta.end = dn(Y, 4, 30); ta.tout = dn(Y, 5, 1);
    units[6].people.push(Object.assign({}, ta, { unit: '제07부대', start: dn(Y, 5, 1), end: null, tin: dn(Y, 5, 1), tout: null, leaves: [] }));
    // 전입·전출 B: 근무기간이 같은 경우 (제08부대 181일, 제09부대 181일) → 평가 기간 마지막 날 소속 제09부대
    const tb = P(8, 9); tb.rank = '상사'; tb.start = dn(Y - 3, 3, 2); tb.end = dn(Y, 6, 30); tb.tout = dn(Y, 7, 1);
    units[8].people.push(Object.assign({}, tb, { unit: '제09부대', start: dn(Y, 7, 4), end: null, tin: dn(Y, 7, 4), tout: null, leaves: [] }));
    // W04 완전 동점자: 제12부대 같은 계급 2명
    P(12, 3).sc = Object.assign({}, P(12, 0).sc);
    // W05 1인 그룹: 제13부대 대령 1명
    P(13, 9).rank = '대령';
    // 오류 사례 (오류포함본에만)
    const onlyRoster = P(10, 5);                                     // E02 명단에만 있음
    const dupA = P(11, 5), dupB = P(11, 6);                          // E04 같은 부대 군번 중복
    const missRank = P(14, 1);                                       // E01 계급 누락
    const badDate = P(15, 2);                                        // E05 시작일 > 종료일
    const badBirth = P(16, 3);                                       // E06 생년월일 형식 오류
    const evalOnly = { gun: '25-7999999', name: '평가만', unit: '제10부대', sc: score() };  // E03 평가에만 있음

    // ---- 부대별 양식 차이 ----
    const VAR = {
      gun: ['군번', '사번', '개인번호', '군 번', '직원번호'],
      name: ['성명', '이름', '성 명'],
      birth: ['생년월일', '생년월일(YYMMDD)', '생일'],
      unit: ['소속부대', '소속', '부대명'],
      rank: ['계급', '직급'],
      job: ['직군', '직렬'],
      start: ['근무시작일', '근무 시작일', '근무개시일'],
      end: ['근무종료일', '근무 종료일', '종료일'],
      leaveStart: ['휴직시작일', '휴직 시작'],
      leaveEnd: ['휴직종료일', '복직일'],
      tin: ['전입일', '전입 일자'],
      tout: ['전출일', '전출 일자']
    };
    const xlsx = (sheets) => {
      const wb = XLSX.utils.book_new();
      for (const s of sheets) {
        const ws = XLSX.utils.aoa_to_sheet(s.aoa);
        if (s.dateCols) {
          const range = XLSX.utils.decode_range(ws['!ref']);
          for (let R = s.headerRow + 1; R <= range.e.r; R++) for (const c of s.dateCols) {
            const cell = ws[XLSX.utils.encode_cell({ r: R, c })];
            if (cell && cell.t === 'n') cell.z = 'yyyy-mm-dd';
          }
        }
        ws['!cols'] = s.aoa[s.headerRow].map(() => ({ wch: 13 }));
        XLSX.utils.book_append_sheet(wb, ws, s.name);
      }
      return new Uint8Array(XLSX.write(wb, { bookType: 'xlsx', type: 'array' }));
    };

    function rosterFile(unit, fixed) {
      const u = unit.u;
      const keys = ['gun', 'name', 'birth', 'unit', 'rank', 'job', 'start', 'end', 'leaveStart', 'leaveEnd', 'tin', 'tout'].filter(k => !(k === 'unit' && u % 5 === 0) && !(k === 'job' && u % 6 === 0));
      if (u % 3 === 1) { const i = keys.indexOf('rank'); keys.splice(i, 1); keys.splice(1, 0, 'rank'); }      // 열 순서 바꾸기
      if (u % 4 === 3) { const i = keys.indexOf('birth'); keys.splice(i, 1); keys.push('birth'); }
      const head = keys.map((k, i) => VAR[k][(u + i) % VAR[k].length]);
      const dateMode = u % 3;  // 0: 엑셀 날짜, 1: 2025.03.01, 2: 2025-03-01
      const fd = n => n == null ? null : dateMode === 0 ? n + 25569 : dateMode === 1 ? ds(n).replace(/-/g, '.') : ds(n);
      const rows = [];
      for (const p of unit.people) {
        let q = Object.assign({}, p);
        if (!fixed) {
          if (p === dupB) q.gun = dupA.gun;
          if (p === missRank) q.rank = '';
          if (p === badDate) { q.start = dn(Y, 8, 1); q.end = dn(Y, 3, 1); }
          if (p === badBirth) q.birth = q.birth.slice(0, 4);
        } else if (p === badDate) { q.start = dn(Y, 3, 1); q.end = null; }
        const leaves = p.extraLeaveRow ? q.leaves.slice(0, 1) : q.leaves;
        const val = (k, qq, lv) => {
          switch (k) {
            case 'gun': return qq.gun; case 'name': return qq.name; case 'unit': return qq.unit; case 'rank': return qq.rank; case 'job': return qq.job;
            case 'birth': return u % 7 === 0 && /^\d{6}$/.test(qq.birth) ? Number(qq.birth) : qq.birth;
            case 'start': return fd(qq.start); case 'end': return fd(qq.end); case 'tin': return fd(qq.tin); case 'tout': return fd(qq.tout);
            case 'leaveStart': return lv.length ? (lv.length > 1 ? lv.map(l => ds(l[0])).join(', ') : fd(lv[0][0])) : null;
            case 'leaveEnd': return lv.length ? (lv.length > 1 ? lv.map(l => ds(l[1])).join(', ') : fd(lv[0][1])) : null;
          }
          return null;
        };
        rows.push(keys.map(k => val(k, q, leaves)));
        if (p.extraLeaveRow) rows.push(keys.map(k => (k === 'gun' || k === 'name') ? val(k, q, []) : (k === 'leaveStart' || k === 'leaveEnd') ? val(k, q, q.leaves.slice(1)) : null));
      }
      const aoa = [];
      if (u % 4 === 2) aoa.push([`${Y}년 성과상여금 지급대상자 명단 (${unit.name})`], []);
      const headerRow = aoa.length;
      aoa.push(head, ...rows);
      const dateCols = dateMode === 0 ? keys.map((k, i) => ['start', 'end', 'tin', 'tout', 'leaveStart', 'leaveEnd'].includes(k) ? i : -1).filter(i => i >= 0) : null;
      return { path: `${fixed ? '2_오류수정본' : '1_오류포함_원본'}/${unit.name}_지급대상자명단.xlsx`, data: xlsx([{ name: '명단', aoa, headerRow, dateCols }]) };
    }

    function evalFile(fixed) {
      const aoa = [['군번', '성명', '소속', '정량평가', '정성평가', '총점']];
      const seen = new Set();
      for (const unit of units) for (const p of unit.people) {
        if (seen.has(p.gun)) continue;           // 전입·전출자는 평가 1건
        seen.add(p.gun);
        if (!fixed && p === onlyRoster) continue;
        if (!fixed && p === dupB) continue;      // 중복 군번 사람은 평가 1건만
        aoa.push([p.gun, p.name, p.unit, p.sc.q, p.sc.l, unit.u === 17 ? null : p.sc.t]);   // 제17부대는 총점 비움 → 자동 계산
      }
      if (!fixed) aoa.push([evalOnly.gun, evalOnly.name, evalOnly.unit, evalOnly.sc.q, evalOnly.sc.l, evalOnly.sc.t]);
      return { path: `${fixed ? '2_오류수정본' : '1_오류포함_원본'}/평가결과_인사평가과.xlsx`, data: xlsx([{ name: '평가결과', aoa, headerRow: 0 }]) };
    }

    function prevFile() {
      const aoa = [['군번', '성명', '소속 부대', '계급', '등급']];
      const seen = new Set();
      for (const unit of units) for (const p of unit.people) {
        if (seen.has(p.gun)) continue;
        seen.add(p.gun);
        if (rnd() < 0.1) continue;   // 작년에는 없던 사람
        const r = rnd();
        aoa.push([p.gun, p.name, p.unit, p.rank, r < 0.2 ? 'S' : r < 0.6 ? 'A' : r < 0.9 ? 'B' : 'C']);
      }
      return { path: `3_작년결과/${Y - 1}년_성과상여금_결과.xlsx`, data: xlsx([{ name: '개인별 산정 결과', aoa, headerRow: 0 }]) };
    }

    const out = [];
    for (const fixed of [false, true]) {
      for (const unit of units) out.push(rosterFile(unit, fixed));
      out.push(evalFile(fixed));
    }
    out.push(prevFile());
    const readme = [
      `성과상여금 도우미 - 가상 샘플 자료 (평가 기간 ${Y}-01-01 ~ ${Y}-12-31)`,
      '실제 인물 정보가 아닌 무작위로 만든 자료입니다.',
      '',
      '[1_오류포함_원본] 부대 20개 명단 + 평가결과 1개. 아래 예외 사례가 들어 있습니다.',
      `  W01 근무기간 2개월 미만 : 제02부대 ${P(2, 9).name}`,
      `  W02 휴직               : 제03부대 ${P(3, 2).name}, 제04부대 ${P(4, 3).name}(2건, 쉼표 구분), 제05부대 ${P(5, 4).name}(2건, 행 추가)`,
      `  W03 전입·전출          : ${ta.name}(제06→제07부대), ${tb.name}(제08→제09부대, 근무기간 같음)`,
      `  W04 완전 동점자        : 제12부대 ${P(12, 0).name}, ${P(12, 3).name}`,
      `  W05 1인 그룹           : 제13부대 대령 ${P(13, 9).name}`,
      `  E01 필수 항목 누락     : 제14부대 ${missRank.name}(계급)`,
      `  E02 명단에만 있음      : 제10부대 ${onlyRoster.name}`,
      `  E03 평가에만 있음      : ${evalOnly.gun} ${evalOnly.name}`,
      `  E04 군번 중복          : 제11부대 ${dupA.name}, ${dupB.name}`,
      `  E05 날짜 오류          : 제15부대 ${badDate.name}(시작일 > 종료일)`,
      `  E06 생년월일 오류      : 제16부대 ${badBirth.name}`,
      '',
      '[2_오류수정본] 위 오류(E)만 고친 자료입니다. 경고(W)는 남아 있어 확인 후 다음 단계로 진행할 수 있습니다.',
      '[3_작년결과] 작년 등급 비교용 파일입니다. 산정 결과 화면의 [작년 결과 엑셀 불러오기]로 넣으세요.',
      '',
      '양식 차이: 부대마다 열 이름(군번/사번/개인번호…)과 열 순서, 날짜 형식(엑셀 날짜/2025.03.01/2025-03-01)이 다르고,',
      '일부 부대는 제목 행이 있거나 소속 부대 열이 없습니다(파일 이름에서 부대명을 읽음).'
    ].join('\r\n');
    out.unshift({ path: '읽어보기.txt', data: new TextEncoder().encode('﻿' + readme) });
    return out;
  }
  return { make };
})();
