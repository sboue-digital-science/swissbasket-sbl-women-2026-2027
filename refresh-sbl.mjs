// Weekly refresh of SB League Women 2026-27 box scores (Node 18+, no dependencies).
//
// 1. Reads the season schedule on basketplan.ch.
// 2. For every game that has a final score and a FIBA LiveStats link, downloads the box score
//    ONCE and saves it as games/<game number>.json. Games already saved are never fetched again.
// 3. Rebuilds the season tables from the saved games: data.json, games.csv, teams.csv,
//    players.csv, player_games.csv.
//
// A failed download is skipped and retried at the next run; saved games are never deleted.
// Env: SBL_SCHEDULE (schedule URL), SBL_REFETCH=26-00909,… (force re-download of listed games).

import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from 'node:fs';

const SCHEDULE = process.env.SBL_SCHEDULE ||
  'https://basketplan.ch/showLeagueSchedule.do?federationId=12&seasonId=31&cateCode=L1&sex=F&leagueHoldingId=0&runde=&matchDays=';
const LS = 'https://fibalivestats.dcd.shared.geniussports.com/data/';
const REFETCH = new Set((process.env.SBL_REFETCH || '').split(',').map(s => s.trim()).filter(Boolean));
const UA = { 'user-agent': 'Mozilla/5.0 (weekly stats refresh; sboue-digital-science)' };
const sleep = ms => new Promise(r => setTimeout(r, ms));
mkdirSync('games', { recursive: true });

// ---------- schedule ----------
const txt = s => s.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();
function parseSchedule(html) {
  const phases = {};
  for (const m of html.matchAll(/class="titleBar"[\s\S]*?<td[^>]*>([\s\S]*?)<\/td>[\s\S]*?leagueHoldingId=(\d+)/g))
    phases[m[2]] = txt(m[1]).replace(/^Aper\S* du match\s*/i, '').replace(/^Spiel\S*bersicht\s*/i, '').replace(/\s*\([^)]*\)\s*$/, '');
  const rows = html.split(/<tr onmouseover="highlightThisRowColor/).slice(1).map(r => r.slice(0, r.indexOf('</tr>')));
  const games = [];
  for (const r of rows) {
    const no = (r.match(/showGameOverview\.do\?gameId=(\d+)"[^>]*>\s*([\w-]+)\s*</) || []);
    if (!no[2]) continue;
    const day = r.match(/findMatchdaysById\.do\?leagueHoldingId=(\d+)[^>]*>([\s\S]*?)<\/a>/);
    const teams = [...r.matchAll(/findTeamById\.do\?teamId=(\d+)"[^>]*>([\s\S]*?)<\/a>/g)].map(m => ({ id: +m[1], name: txt(m[2]) }));
    const sc = r.match(/>\s*(\d+)\s*<\/td>\s*<td[^>]*>\s*:\s*<\/td>\s*<td[^>]*>\s*(\d+)\s*</);
    const dt = txt(r).match(/(\d\d)\.(\d\d)\.(\d\d)(?:\s+(\d\d:\d\d))?/);
    const ls = r.match(/geniussports\.com\/u\/[A-Z]+\/(\d+)/);
    games.push({
      no: no[2], bpId: +no[1],
      date: dt ? `20${dt[3]}-${dt[2]}-${dt[1]}${dt[4] ? ' ' + dt[4] : ''}` : '',
      day: day ? txt(day[2]) : '', phase: day ? (phases[day[1]] || day[1]) : '',
      home: teams[0]?.name || '', away: teams[1]?.name || '',
      hs: sc ? +sc[1] : null, as: sc ? +sc[2] : null,
      status: sc ? 'played' : txt(r).includes('pas jou') ? 'not played' : 'other',
      ls: ls ? +ls[1] : null,
    });
  }
  return games;
}

async function get(url, json) {
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(url, { headers: UA, cache: 'no-store' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return json ? await r.json() : await r.text();
    } catch (e) { if (i === 2) throw e; await sleep(2000 * (i + 1)); }
  }
}

// ---------- one box score, kept compact ----------
function compact(g, d) {
  return {
    ...g, fetched: new Date().toISOString().slice(0, 10), attendance: d.attendance ?? null,
    tm: [1, 2].map(k => {
      const t = d.tm[k], o = { name: t.name, shortName: t.shortName, code: t.code, coach: t.coach, score: t.score,
        q: Object.keys(t).filter(x => /^p\d+_score$/.test(x)).sort((a, b) => parseInt(a.slice(1)) - parseInt(b.slice(1))).map(x => t[x]) };
      for (const x in t) if (x.startsWith('tot_')) o[x] = t[x];
      o.pl = Object.values(t.pl || {}).map(p => {
        const q = { firstName: p.firstName, familyName: p.familyName, name: p.name, no: p.shirtNumber, pos: p.playingPosition, starter: p.starter };
        for (const x in p) if (/^s[A-Z]/.test(x)) q[x] = p[x];
        return q;
      });
      return o;
    }),
  };
}

// ---------- main ----------
const html = await get(SCHEDULE);
const sched = parseSchedule(html);
if (!sched.length) throw new Error('No games found on the schedule page — its layout may have changed.');
console.log(`Schedule: ${sched.length} games, ${sched.filter(g => g.status === 'played').length} played, ${sched.filter(g => g.ls).length} with LiveStats link`);

let added = 0, failed = [];
for (const g of sched) {
  if (g.status !== 'played' || !g.ls) continue;
  const f = `games/${g.no}.json`;
  if (existsSync(f) && !REFETCH.has(g.no)) continue;
  try {
    const d = await get(`${LS}${g.ls}/data.json`, true);
    const s = [d.tm?.[1]?.score, d.tm?.[2]?.score];
    if (!d.tm?.[1]?.pl || !Object.keys(d.tm[1].pl).length) throw new Error('box score empty');
    if (!(s[0] === g.hs && s[1] === g.as) && !(s[0] === g.as && s[1] === g.hs)) console.log(`  note ${g.no}: LiveStats ${s.join(':')} vs schedule ${g.hs}:${g.as}`);
    writeFileSync(f, JSON.stringify(compact(g, d)));
    added++; console.log(`  + ${g.no} ${g.home} ${g.hs}:${g.as} ${g.away}`);
    await sleep(400);
  } catch (e) { failed.push(g.no); console.log(`  ! ${g.no}: ${e.message} (will retry next run)`); }
}
const missing = sched.filter(g => g.status === 'played' && !g.ls).map(g => g.no);
if (missing.length) console.log(`Played but no LiveStats link yet: ${missing.join(', ')}`);

// ---------- rebuild season tables from all saved games ----------
const saved = readdirSync('games').filter(f => f.endsWith('.json')).map(f => JSON.parse(readFileSync('games/' + f, 'utf8')))
  .sort((a, b) => a.date.localeCompare(b.date) || a.no.localeCompare(b.no));
const secs = m => { if (!m) return 0; const [a, b] = String(m).split(':').map(Number); return (a || 0) * 60 + (b || 0); };
const norm = s => (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
const eff = p => p.pts + p.reb + p.ast + p.stl + p.blk - (p.fga - p.fgm) - (p.fta - p.ftm) - p.to;
const r1 = x => Math.round(x * 10) / 10, pct = (m, a) => a ? Math.round(1000 * m / a) / 10 : null;

const PF = { min: 'sMinutes', pts: 'sPoints', fgm: 'sFieldGoalsMade', fga: 'sFieldGoalsAttempted', tpm: 'sThreePointersMade', tpa: 'sThreePointersAttempted',
  ftm: 'sFreeThrowsMade', fta: 'sFreeThrowsAttempted', oreb: 'sReboundsOffensive', dreb: 'sReboundsDefensive', reb: 'sReboundsTotal',
  ast: 'sAssists', stl: 'sSteals', blk: 'sBlocks', to: 'sTurnovers', pf: 'sFoulsPersonal', pm: 'sPlusMinusPoints' };
const STAT = Object.keys(PF).filter(k => k !== 'min');

// Box score names that LiveStats got wrong, per team: 'Team|name in box score' → correct name
const NAME_FIX = { 'Baden Basket 54|Brunner Nora': 'Nora Brunner' };
const logs = [], P = new Map(), T = new Map(), LAST = new Map(), TG = [], FD = new Map();   // FD: fouls drawn per player (dashboard only)   // TG: each team's stats game by game (dashboard "Evolution over time")   // LAST: date of each player's last game with minutes (dashboard popup)
for (const g of saved) {
  // LiveStats lists the home team first; swap if the scores say otherwise
  if (g.tm[0].score === g.as && g.tm[1].score === g.hs && g.hs !== g.as) g.tm.reverse();
  g.tm.forEach((t, i) => {
    const opp = g.tm[1 - i], team = i === 0 ? g.home : g.away, oppName = i === 0 ? g.away : g.home, win = t.score > opp.score;
    const tk = norm(team);
    if (!T.has(tk)) T.set(tk, { team, code: t.code, gp: 0, w: 0, l: 0, pts: 0, opp: 0, fgm: 0, fga: 0, tpm: 0, tpa: 0, ftm: 0, fta: 0, oreb: 0, dreb: 0, reb: 0, ast: 0, stl: 0, blk: 0, to: 0, pf: 0, paint: 0, second: 0, fast: 0, bench: 0, fromTo: 0 });
    const tt = T.get(tk);
    tt.gp++; win ? tt.w++ : tt.l++; tt.pts += t.score; tt.opp += opp.score;
    const tm = { fgm: 'tot_sFieldGoalsMade', fga: 'tot_sFieldGoalsAttempted', tpm: 'tot_sThreePointersMade', tpa: 'tot_sThreePointersAttempted', ftm: 'tot_sFreeThrowsMade', fta: 'tot_sFreeThrowsAttempted',
      oreb: 'tot_sReboundsOffensive', dreb: 'tot_sReboundsDefensive', reb: 'tot_sReboundsTotal', ast: 'tot_sAssists', stl: 'tot_sSteals', blk: 'tot_sBlocks', to: 'tot_sTurnovers', pf: 'tot_sFoulsPersonal',
      paint: 'tot_sPointsInThePaint', second: 'tot_sPointsSecondChance', fast: 'tot_sPointsFastBreak', bench: 'tot_sBenchPoints', fromTo: 'tot_sPointsFromTurnovers' };
    for (const k in tm) tt[k] += +t[tm[k]] || 0;
    const gt = { no: g.no, date: g.date.slice(0, 10), team, oppName, home: i === 0, pts: t.score, opp: opp.score };
    for (const k in tm) gt[k] = +t[tm[k]] || 0;
    gt.lead = +t.tot_sTimeLeading || 0;   // minutes spent in the lead (dashboard only)
    TG.push(gt);
    for (const p of t.pl) {
      const s = { sec: secs(p.sMinutes) }; for (const k of STAT) s[k] = +p[PF[k]] || 0;
      const name0 = ([p.firstName, p.familyName].filter(Boolean).join(' ') || p.name || '').replace(/\s+/g, ' ').trim();
      const name = NAME_FIX[team + '|' + name0] || name0;
      logs.push({ game: g.no, date: g.date.slice(0, 10), phase: g.phase, team, opponent: oppName, home: i === 0 ? 'H' : 'A', result: `${win ? 'W' : 'L'} ${t.score}-${opp.score}`,
        player: name, no: p.no, starter: p.starter ? 1 : 0, min: r1(s.sec / 60), ...Object.fromEntries(STAT.map(k => [k, s[k]])), eff: eff(s) });
      const pk = tk + '|' + norm(name);
      if (!P.has(pk)) P.set(pk, { team, player: name, no: p.no, pos: p.pos || '', gp: 0, gs: 0, sec: 0, ...Object.fromEntries(STAT.map(k => [k, 0])) });
      const pp = P.get(pk); pp.no = p.no || pp.no; pp.pos = p.pos || pp.pos;
      if (s.sec > 0) { pp.gp++; if (p.starter) pp.gs++; const lk = team + '|' + name, d = g.date.slice(0, 10); if (!(LAST.get(lk) >= d)) LAST.set(lk, d); }
      pp.sec += s.sec; for (const k of STAT) pp[k] += s[k];
      FD.set(team + '|' + name, (FD.get(team + '|' + name) || 0) + (+p.sFoulsOn || 0));
    }
  });
}
const players = [...P.values()].map(p => ({ team: p.team, player: p.player, no: p.no, pos: p.pos, gp: p.gp, gs: p.gs, min: r1(p.sec / 60),
  ...Object.fromEntries(STAT.map(k => [k, p[k]])), eff: eff(p),
  min_pg: p.gp ? r1(p.sec / 60 / p.gp) : 0, pts_pg: p.gp ? r1(p.pts / p.gp) : 0, reb_pg: p.gp ? r1(p.reb / p.gp) : 0, ast_pg: p.gp ? r1(p.ast / p.gp) : 0, eff_pg: p.gp ? r1(eff(p) / p.gp) : 0,
  fg_pct: pct(p.fgm, p.fga), tp_pct: pct(p.tpm, p.tpa), ft_pct: pct(p.ftm, p.fta) }))
  .sort((a, b) => a.team.localeCompare(b.team) || b.min - a.min);
const teams = [...T.values()].map(t => ({ ...t, pts_pg: r1(t.pts / t.gp), opp_pg: r1(t.opp / t.gp), diff_pg: r1((t.pts - t.opp) / t.gp),
  fg_pct: pct(t.fgm, t.fga), tp_pct: pct(t.tpm, t.tpa), ft_pct: pct(t.ftm, t.fta) }))
  .sort((a, b) => b.w / b.gp - a.w / a.gp || b.diff_pg - a.diff_pg);
const gamesOut = sched.map(g => ({ no: g.no, date: g.date, phase: g.phase, day: g.day, home: g.home, away: g.away, hs: g.hs, as: g.as, status: g.status,
  boxscore: existsSync(`games/${g.no}.json`) ? 'yes' : 'no', livestats: g.ls ? `https://fibalivestats.dcd.shared.geniussports.com/u/SUI/${g.ls}/` : '' }));

const csv = rows => { if (!rows.length) return ''; const h = Object.keys(rows[0]);
  const q = v => v == null ? '' : /[",\n;]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v);
  return '\ufeff' + [h.join(','), ...rows.map(r => h.map(k => q(r[k])).join(','))].join('\n') + '\n'; };
writeFileSync('games.csv', csv(gamesOut));
writeFileSync('teams.csv', csv(teams));
writeFileSync('players.csv', csv(players));
writeFileSync('player_games.csv', csv(logs));
writeFileSync('data.json', JSON.stringify({ asof: new Date().toISOString().slice(0, 10), schedule: SCHEDULE, games: gamesOut, teams, players }, null, 0));
console.log(`Saved games: ${saved.length} (${added} new this run${failed.length ? `, ${failed.length} failed: ${failed.join(', ')}` : ''}). Teams: ${teams.length}, players: ${players.length}.`);

// ---------- dashboard data (dash.json): box score totals + player profiles (players_info.csv) ----------
// Home towns from each team's home hall on basketplan.ch
const TEAM_CITY = {
  'Baden Basket 54': ['Baden', 47.476, 8.306], 'BCF Elfic Fribourg': ['Fribourg', 46.806, 7.162], 'Nyon Basket Féminin': ['Nyon', 46.383, 6.239],
  'Ravens de Genève LPLO': ['Geneva', 46.204, 6.143], 'GC Zürich': ['Zürich', 47.377, 8.540], 'Hélios VS Basket': ['Vétroz', 46.222, 7.279],
  'BBC Troistorrents-Chablais': ['Monthey', 46.255, 6.954], 'BC Alte Kanti Aarau': ['Aarau', 47.392, 8.044], 'Espérance Sportive Pully': ['Pully', 46.510, 6.662],
};
const CN = { SUI: 'Switzerland', USA: 'United States', FRA: 'France', CAN: 'Canada', ESP: 'Spain', POL: 'Poland', CRO: 'Croatia', GER: 'Germany', IRL: 'Ireland',
  GRE: 'Greece', ITA: 'Italy', SWE: 'Sweden', SLO: 'Slovenia', CUB: 'Cuba', HUN: 'Hungary', RUS: 'Russia', POR: 'Portugal', GBR: 'Great Britain', NED: 'Netherlands',
  ANG: 'Angola', UKR: 'Ukraine', BEL: 'Belgium', TAN: 'Tanzania', SRB: 'Serbia', MNE: 'Montenegro', BIH: 'Bosnia and Herzegovina', AUT: 'Austria', CZE: 'Czechia',
  ENG: 'England', ISR: 'Israel', LAT: 'Latvia', LTU: 'Lithuania', NGR: 'Nigeria', SEN: 'Senegal', MLI: 'Mali', CMR: 'Cameroon', BRA: 'Brazil', ARG: 'Argentina',
  AUS: 'Australia', NZL: 'New Zealand', DEN: 'Denmark', FIN: 'Finland', NOR: 'Norway', LUX: 'Luxembourg', TUR: 'Türkiye', ROU: 'Romania', BUL: 'Bulgaria',
  SVK: 'Slovakia', ALB: 'Albania', KOS: 'Kosovo', MAR: 'Morocco', COD: 'DR Congo', CGO: 'Congo', CIV: "Côte d'Ivoire", JPN: 'Japan', MEX: 'Mexico', DOM: 'Dominican Republic' };
// basketplan uses a few non-FIBA codes; map them by their two-letter country code
const ISO2_FIBA = { ME: 'MNE', RS: 'SRB', MO: 'MAC' }, CODE_FIX = { MOT: 'MNE' };   // MOT = basketplan's code for Montenegro
function readCsv(f) {
  if (!existsSync(f)) return [];
  const t = readFileSync(f, 'utf8').replace(/^﻿/, ''), rows = []; let row = [], cur = '', q = false;
  for (let i = 0; i < t.length; i++) { const c = t[i];
    if (q) { if (c === '"') { if (t[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true; else if (c === ',') { row.push(cur); cur = ''; } else if (c === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; } else if (c !== '\r') cur += c; }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  const h = rows.shift(); return rows.filter(r => r.length > 1).map(r => Object.fromEntries(h.map((k, i) => [k, r[i] ?? ''])));
}
{
  const prof = readCsv('players_info.csv');
  // manual corrections (corrections.json), applied again here in case players_info.csv predates them
  const FIX = existsSync('corrections.json') ? JSON.parse(readFileSync('corrections.json', 'utf8')).players || {} : {};
  for (const r of prof) for (const [k, v] of Object.entries(FIX[r.player_id] || {})) if (k !== 'player') r[k] = v;
  const tok = s => norm(s).replace(/-/g, ' ').split(' ').filter(Boolean);
  const findProf = (name, team) => {
    const w = new Set(tok(name)), ok = r => tok(r.family_name).every(x => w.has(x)) && tok(r.first_names).some(x => w.has(x));
    return prof.find(r => norm(r.team) === norm(team) && ok(r)) || prof.find(ok);
  };
  const code = (c, iso2) => ISO2_FIBA[iso2] || CODE_FIX[c] || c;
  const TEAMS = teams.map(t => t.team).sort((a, b) => a.localeCompare(b)), ti = new Map(TEAMS.map((t, i) => [norm(t), i]));
  const year = +new Date().toISOString().slice(0, 4);
  const posOf = (r, boxPos) => { const n = r && +String(r.positions || '').split(',')[0];
    if (n) return n <= 2 ? 'G' : n <= 4 ? 'F' : 'C';
    const b = norm(boxPos); return /guard|^g$/.test(b) ? 'G' : /forward|^f$/.test(b) ? 'F' : /center|centre|^c$/.test(b) ? 'C' : 'U'; };
  let matched = 0;
  const dp = players.map(p => {
    const r = findProf(p.player, p.team); if (r) matched++;
    const c = r ? [code(r.nationality_1, r.nationality_1_iso2), code(r.nationality_2, r.nationality_2_iso2)].filter(Boolean) : [];
    return { t: ti.get(norm(p.team)), n: p.player, gone: false, no: p.no || null, p: posOf(r, p.pos), pos: r ? r.positions_label : (p.pos || ''),
      by: r && +r.birth_year || null, age: r && +r.birth_year ? year - +r.birth_year : null, h: r && +r.height_cm || null, c: [...new Set(c)],
      gp: p.gp, min: p.min, pts: p.pts, reb: p.reb, ast: p.ast, stl: p.stl, blk: p.blk, to: p.to, eff: p.eff,
      fgm: p.fgm, fga: p.fga, tpm: p.tpm, tpa: p.tpa, ftm: p.ftm, fta: p.fta, sbl: r && r.seasons_in_sbl !== '' ? +r.seasons_in_sbl : null,
      fam: r && r.family_name ? r.family_name : p.player.split(' ').slice(-1)[0], pid: r ? r.player_id : null, pm: p.pm, pf: p.pf, fd: FD.get(p.team + '|' + p.player) || 0, last: LAST.get(p.team + '|' + p.player) || null };
  });
  const dg = sched.filter(g => g.status === 'played').map(g => ({ date: g.date.slice(0, 10), day: g.day, phase: g.phase, h: ti.get(norm(g.home)), a: ti.get(norm(g.away)), hs: g.hs, as: g.as }))
    .filter(g => g.h != null && g.a != null);
  writeFileSync('dash.json', JSON.stringify({ asof: new Date().toISOString().slice(0, 10), teams: TEAMS, tc: TEAMS.map(() => 'SUI'),
    cn: CN, city: TEAMS.map(t => TEAM_CITY[t] || null),
    // official team totals (rebounds include team rebounds)
    ts: TEAMS.map(n => { const t = teams.find(x => norm(x.team) === norm(n)); if (!t) return null;
      // rotation: bench (non-starter) minutes and points from the game logs; players averaging 10+ min over the team's games
      const L = logs.filter(r => norm(r.team) === norm(n)), min = L.reduce((s, r) => s + r.min, 0), bmin = L.filter(r => !r.starter).reduce((s, r) => s + r.min, 0);
      const pm = {}; for (const r of L) pm[r.player] = (pm[r.player] || 0) + r.min;
      return { gp: t.gp, oreb: t.oreb, dreb: t.dreb, reb: t.reb, blk: t.blk, stl: t.stl, ast: t.ast, to: t.to,
        bench: t.bench, fast: t.fast, paint: t.paint, second: t.second, fromTo: t.fromTo, lead: r1(TG.filter(x => norm(x.team) === norm(n)).reduce((s, x) => s + x.lead, 0)), bminp: min ? Math.round(1000 * bmin / min) / 10 : 0, rot: Object.values(pm).filter(m => m / t.gp >= 10).length }; }), stage: TEAMS.map(() => 2), po: false, players: dp, games: dg,
    total: sched.length,
    // short team codes (from LiveStats) and the full schedule, for the results grid
    tcode: TEAMS.map(n => (((teams.find(x => norm(x.team) === norm(n)) || {}).code || n.slice(0, 3)) + '').trim().toUpperCase()),
    // each team's stats game by game, oldest first: same definitions as the season figures in ts
    tg: TG.map(x => { const L = logs.filter(r => r.game === x.no && r.team === x.team), min = L.reduce((s, r) => s + r.min, 0);
      return { d: x.date, t: ti.get(norm(x.team)), o: ti.get(norm(x.oppName)), h: x.home ? 1 : 0, pts: x.pts, opp: x.opp, fast: x.fast, ast: x.ast,
        fg: [x.fgm, x.fga], p2: [x.fgm - x.tpm, x.fga - x.tpa], p3: [x.tpm, x.tpa], ft: [x.ftm, x.fta], epg: L.reduce((s, r) => s + r.eff, 0),
        oreb: x.oreb, dreb: x.dreb, reb: x.reb, blk: x.blk, stl: x.stl, to: x.to, bench: x.bench, paint: x.paint, second: x.second, fromTo: x.fromTo, lead: r1(x.lead),
        bminp: min ? Math.round(1000 * L.filter(r => !r.starter).reduce((s, r) => s + r.min, 0) / min) / 10 : 0, rot: L.filter(r => r.min >= 10).length }; })
      .filter(x => x.t != null && x.o != null),
    // each player's games (with minutes): [player index in players, date, opponent, home, min, pts, reb, ast, eff, +/−, won]
    plog: (() => { const pi = new Map(players.map((p, i) => [p.team + '|' + p.player, i]));
      return logs.filter(r => r.min > 0 && pi.has(r.team + '|' + r.player)).map(r => [pi.get(r.team + '|' + r.player), r.date, ti.get(norm(r.opponent)), r.home === 'H' ? 1 : 0,
        r.min, r.pts, r.reb, r.ast, r.eff, r.pm, r.result[0] === 'W' ? 1 : 0]); })(),
    fixtures: sched.map(g => ({ date: g.date.slice(0, 10), day: g.day, h: ti.get(norm(g.home)), a: ti.get(norm(g.away)), hs: g.hs, as: g.as })).filter(g => g.h != null && g.a != null) }));
  const unknown = [...new Set(dp.flatMap(p => p.c))].filter(c => !CN[c]);
  console.log(`dash.json: ${dp.length} players (${matched} with a profile), ${dg.length} games${unknown.length ? `; country codes without a name: ${unknown.join(', ')}` : ''}.`);
}
