// Which prospective-missionary cards the kiosk shows.
//
// Until the prospective form has received its first submission, the made-up
// example cards stand in so the stake tour is visible. The sync records how many
// rows the form's sheet has (`submissions`); once that is 1 or more the examples
// are switched off for good, even if that first row can't be shown yet (e.g. the
// parent hasn't given permission). `submissions: null` means the form isn't
// configured or couldn't be read, which shows nothing rather than guessing.
export function chooseProspects(real, examples) {
  if (real && real.submissions === 0) return examples?.prospects ?? [];
  return real?.prospects ?? [];
}
