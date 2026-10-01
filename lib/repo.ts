// Where this project lives, and the one path from a wrong number on screen
// to the form that fixes it.
//
// Until now there was none. The footer linked to the author's GitHub
// profile, the console banner carried the repo URL where nobody reads it,
// and the heading's only link went to the wiki. So .github/ISSUE_TEMPLATE/
// wrong-perk-data.yml — which asks exactly the right four questions — sat
// behind a door that could not be reached from the site it is about.
export const REPO_URL = "https://github.com/flexeykinDev/dbd-perk-randomizer";

/**
 * A pre-filled "this perk is wrong" issue.
 *
 * GitHub's issue forms accept a field's `id` as a query parameter, so the
 * perk is already filled in by the time the form opens — the reporter
 * arrives having only to say what is wrong, which is the part they know.
 * `name` is the first input in wrong-perk-data.yml; if that id is ever
 * renamed, this quietly stops pre-filling and the form still opens.
 */
export function wrongDataUrl(perkName: string): string {
  const params = new URLSearchParams({
    template: "wrong-perk-data.yml",
    name: perkName,
  });
  return `${REPO_URL}/issues/new?${params}`;
}
