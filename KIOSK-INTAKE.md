# Kiosk intake and local review

Run `npm run dev` and use the local URL printed by Vite. Add
`?sample=1&act=leaders&i=0&freeze=1&fast=12` for the sample bishop.
Use `i=1` for the stake presidency and `i=2` for an auxiliary president.
Use `?sample=1&fast=8` to see the rotation with all sections.

## Missionary returns

The existing **Missionaries** tab of Stake Conference Planning has the
current roster in column A and recently returned missionaries in column D.
Enter each actual return date in column E, on the same row, as a Sheets
date or YYYY-MM-DD. Each returned entry should identify a single display
mission, in the same format as the current roster. An undated entry logs a
warning and is skipped. A dated entry drops off on the one-year anniversary
in Vancouver time. The returned feed uses the authenticated Sheets roster.

## Leader profiles

Use the [Stake Leadership Profiles form](https://docs.google.com/forms/d/1JKb70CnyTa0EZ7fB1ZWPgWFzyahKxgAqDbCI6oznloY/edit)
and its linked [response sheet](https://docs.google.com/spreadsheets/d/1g7xNxnokrthUOLesBYlJwQJCUFNhQZDxa44qWNoEiho/edit).
The form collects verified Google email. It must match the address listed
in the Van Stake Org Chart. Each scheduled sync checks current callings
against the newest response and includes only consented profiles.
Respondent emails stay out of the kiosk manifest.

For a live dry run, set `LEADER_ORG_CHART_ID` and
`LEADER_PROFILES_SHEET_ID` in the local sync environment, then run
`npm run sync:dry`. The kiosk service account needs Viewer access to both
sheets and to the form upload folder so it can download approved profile
photos. Keep the response sheet and uploads private. Set both IDs as GitHub
Actions secrets when ready to use the existing three-hour schedule.

The unit panel uses dated membership totals from StakeOS, approximate
area from the kiosk map polygons, and current weather at the meetinghouse.
The Korean branch's city-wide figure comes from the
[2021 Census Profile for Vancouver](https://www12.statcan.gc.ca/census-recensement/2021/dp-pd/prof/details/page.cfm?DGUIDlist=2021A00055915022%2C2021S051259150494&GENDERlist=1%2C2%2C3&HEADERlist=0&Lang=E&STATISTIClist=1&SearchText=vancouver),
using ethnic or cultural origin in private households. Estimating resident
population by ward would require overlaying verified ward boundaries with
[Statistics Canada dissemination blocks](https://www150.statcan.gc.ca/n1/en/catalogue/92-163-X)
and their population counts.
