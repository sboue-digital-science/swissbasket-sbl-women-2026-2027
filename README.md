# SB League Women 2026-27 — box score statistics

Season statistics for the Swiss SB League Women, built from the FIBA LiveStats box score of every game
listed on the [basketplan.ch schedule](https://basketplan.ch/showLeagueSchedule.do?federationId=12&seasonId=31&cateCode=L1&sex=F&leagueHoldingId=0&runde=&matchDays=).

## Files

| File | What it holds |
|---|---|
| `players.csv` | One row per player per team: games, starts, minutes, all box score totals, FIBA efficiency, per-game averages and shooting % |
| `teams.csv` | One row per team: record, points for/against, shooting, rebounds, and extras (points in the paint, second-chance, fast-break, bench, from turnovers) |
| `games.csv` | Every scheduled game: date, phase, teams, score, whether its box score is saved, LiveStats link |
| `player_games.csv` | Game log: one row per player per game |
| `data.json` | The same tables in one file, for a dashboard |
| `games/<game number>.json` | The saved box score of each game (downloaded once, never again) |
| `players_info.csv` | Player profiles from swiss.basketball: team, club, birth year, height, positions, citizenships, games this season per competition, past seasons, photo and profile links |
| `refresh-sbl.mjs` | The weekly box score script (Node 18+, no dependencies) |
| `players-sbl.mjs` | The player profile script |

The CSV files open directly in Excel or Google Sheets.

## How it updates

`.github/workflows/refresh-sbl.yml` runs every **Monday morning** (and on demand from the Actions tab → *Run workflow*).
Each run reads the schedule, downloads only the games that have a final score and are not yet in `games/`,
then rebuilds the tables from all saved games. A download that fails is retried at the next run.

New phases (play-offs etc.) are picked up automatically as long as they appear on the same schedule page.

To force a game to be downloaded again (e.g. after a stat correction), run the workflow by hand and enter its
game number (e.g. `26-00909`) in the *refetch* box.

## Player profiles

`players_info.csv` is not updated automatically. To refresh it, open the **Actions** tab → *SBL Women player profiles (run by hand)* → **Run workflow**. It reads the season's player list on swiss.basketball and each player's profile (about two minutes).

Positions use the 1–5 numbering: 1 PG, 2 SG, 3 SF, 4 PF, 5 C. Only the birth year is published, not the full date.

## Notes

- Efficiency = PTS + REB + AST + STL + BLK − missed FG − missed FT − TO (FIBA formula).
- A game counts as played for a player when she was on court (minutes > 0); players listed but not used are kept with 0 games.
- Players are matched across games by team and full name — LiveStats has no player ID. A player who changes team gets one row per team.
- Box scores have no date of birth, height or citizenship.
