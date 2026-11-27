// One-off (re-runnable) collection of SB League Women player profiles from swiss.basketball (Node 18+, no dependencies).
// Reads the season's player list, then each player's profile, and writes players_info.csv (one row per player).
// Env: SBL_LEAGUE (default 6 = SB League Women), SBL_SEASON (default 31 = 2026/2027).

import { writeFileSync } from 'node:fs';

const BASE = 'https://swiss.basketball/basketplan/';
const LEAGUE = process.env.SBL_LEAGUE || '6', SEASON = process.env.SBL_SEASON || '31';
const UA = { 'user-agent': 'Mozilla/5.0 (player list refresh; sboue-digital-science)' };
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function get(url) {
  for (let i = 0; i < 3; i++) {
    try { const r = await fetch(url, { headers: UA }); if (!r.ok) throw new Error('HTTP ' + r.status); return await r.text(); }
    catch (e) { if (i === 2) throw e; await sleep(2000 * (i + 1)); }
  }
}
const ent = s => (s || '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
const attrs = tag => Object.fromEntries([...tag.matchAll(/(\w+)="([^"]*)"/g)].map(m => [m[1], ent(m[2])]));
const POS = { 1: 'PG', 2: 'SG', 3: 'SF', 4: 'PF', 5: 'C' };

const list = await get(`${BASE}showPersonsPlayingInLeagueXML.do?lang=fr&xmlView=rss&leagueId=${LEAGUE}&seasonId=${SEASON}`);
const roster = [...list.matchAll(/<PlayerTeam ([^>]*)>([\s\S]*?)<\/PlayerTeam>/g)].map(m => {
  const a = attrs(m[1]), id = (m[2].match(/<playerId id="(\d+)"/) || [])[1];
  const teams = [...m[2].matchAll(/<TeamAndClub ([^>]*)>[\s\S]*?<teamId id="(\d+)"/g)].map(t => ({ ...attrs(t[1]), teamId: t[2] }));
  return { id, ...a, teams };
}).filter(p => p.id);
if (!roster.length) throw new Error('Player list is empty — the feed may have changed.');
console.log(`Player list: ${roster.length} players`);

const rows = [], failed = [];
for (const p of roster) {
  try {
    const x = await get(`${BASE}showPersonStatisticOverView.do?lang=fr&xmlView=rss&personId=${p.id}&personStatisticOverViewMode=seasonLeagueLeagueHolding`);
    const o = attrs((x.match(/<PersonOverView ([^>]*)>/) || ['', ''])[1]);
    const pic = (x.match(/<personPicturePath>\s*<String>([^<]*)<\/String>/) || [])[1];
    // every season / competition / team the player appears in, with games played
    const hist = new Map();
    for (const s of x.matchAll(/<PersonOverViewSeason ([^>]*)>([\s\S]*?)<\/PersonOverViewSeason>/g)) {
      const season = attrs(s[1]).seasonName;
      for (const h of s[2].matchAll(/<PersonOverViewLeagueHolding ([^>]*)>/g)) {
        const a = attrs(h[1]), k = `${season}|${a.leagueName}|${a.teamName}`;
        hist.set(k, (hist.get(k) || 0) + (+a.gameCount || 0));
      }
    }
    const H = [...hist].map(([k, g]) => { const [season, league, team] = k.split('|'); return { season, league, team, g }; });
    const cur = H.filter(h => h.season === '2026/2027'), past = H.filter(h => h.season !== '2026/2027');
    const sbl = cur.filter(h => h.league === 'SB League Women').reduce((s, h) => s + h.g, 0);
    const pos = (o.positionsStr || '').split(',').map(s => s.trim()).filter(Boolean);
    rows.push({
      player_id: p.id,
      name: p.pseudonym || p.name,
      family_name: o.playerFamilyName || p.familyName,
      first_names: o.playerFirstName || p.firstName,
      team: p.teams.map(t => t.teamName).join(' / '),
      club: p.teams.map(t => t.clubName).join(' / '),
      birth_year: o.birthYear || '',
      height_cm: o.size || '',
      positions: pos.join(','),
      positions_label: pos.map(n => POS[n] || n).join('/'),
      nationality_1: o.nationality_1 || '',
      nationality_2: o.nationality_2 || '',
      sbl_games_2026_27: sbl,
      other_competitions_2026_27: cur.filter(h => h.league !== 'SB League Women').map(h => `${h.league} – ${h.team} (${h.g})`).join('; '),
      seasons_in_sbl: new Set(H.filter(h => h.league === 'SB League Women').map(h => h.season)).size,
      history: past.sort((a, b) => b.season.localeCompare(a.season)).map(h => `${h.season} ${h.league} – ${h.team} (${h.g})`).join('; '),
      photo_url: pic ? 'https://www.basketplan.ch/' + pic : '',
      profile_url: `https://swiss.basketball/national-competitions/sbl/women/players?pid=${p.id}&league=LNAF`,
    });
    await sleep(300);
  } catch (e) { failed.push(p.id); console.log(`  ! ${p.id} ${p.name}: ${e.message}`); }
}
rows.sort((a, b) => a.team.localeCompare(b.team) || a.name.localeCompare(b.name));
const q = v => v == null ? '' : /[",\n;]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v);
const h = Object.keys(rows[0]);
writeFileSync('players_info.csv', '﻿' + [h.join(','), ...rows.map(r => h.map(k => q(r[k])).join(','))].join('\n') + '\n');
console.log(`players_info.csv: ${rows.length} players${failed.length ? `, ${failed.length} failed: ${failed.join(', ')}` : ''}.`);
if (failed.length) process.exitCode = 1;
