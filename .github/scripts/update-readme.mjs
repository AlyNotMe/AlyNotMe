const USER = "AlyNotMe";
const NPM_ORG = "forjajs";
const token = process.env.GITHUB_TOKEN;

const gh = async (path, { graphql = false, body } = {}) => {
  const url = graphql ? "https://api.github.com/graphql" : `https://api.github.com${path}`;
  const res = await fetch(url, {
    method: graphql ? "POST" : "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
    },
    body: graphql ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${path} -> ${res.status} ${await res.text()}`);
  return res.json();
};

const relativeTime = (iso) => {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 60) return `${mins} min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}j`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} mois`;
  return `${Math.floor(months / 12)} an(s)`;
};

async function latestRepos() {
  const repos = await gh(`/users/${USER}/repos?per_page=100&sort=pushed`);
  const top = repos.filter((r) => !r.fork).slice(0, 5);
  const lines = await Promise.all(
    top.map(async (r) => {
      const branch = r.default_branch;
      return `- ↻ **[${r.name}](${r.html_url})** — pushé il y a ${relativeTime(r.pushed_at)}, sur \`${branch}\``;
    })
  );
  lines.push(`\n[voir tous les repos →](https://github.com/${USER}?tab=repositories)`);
  return lines.join("\n");
}

async function npmPackages() {
  try {
    const res = await fetch(`https://registry.npmjs.org/-/org/${NPM_ORG}/package`);
    if (!res.ok) return "_Aucun package publié pour le moment._";
    const pkgs = Object.keys(await res.json());
    if (!pkgs.length) return "_Aucun package publié pour le moment._";
    const rows = await Promise.all(
      pkgs.map(async (name) => {
        const meta = await fetch(`https://registry.npmjs.org/${encodeURIComponent(name)}`).then((r) => r.json());
        const latest = meta["dist-tags"]?.latest ?? "?";
        const desc = meta.description ?? "";
        return `| [\`${name}\`](https://www.npmjs.com/package/${name}) | v${latest} | ${desc} |`;
      })
    );
    return ["| Package | Version | Description |", "|---|---|---|", ...rows].join("\n");
  } catch {
    return "_Impossible de récupérer les packages npm._";
  }
}

async function topLanguages() {
  const repos = await gh(`/users/${USER}/repos?per_page=100`);
  const totals = {};
  const perRepo = await Promise.all(
    repos
      .filter((r) => !r.fork)
      .map((r) => gh(`/repos/${USER}/${r.name}/languages`).catch(() => ({})))
  );
  for (const langs of perRepo) {
    for (const [lang, bytes] of Object.entries(langs)) totals[lang] = (totals[lang] || 0) + bytes;
  }
  const sum = Object.values(totals).reduce((a, b) => a + b, 0) || 1;
  const top = Object.entries(totals)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);
  return top
    .map(([lang, bytes]) => `\`${lang}\` ${((bytes / sum) * 100).toFixed(1)}%`)
    .join(" · ");
}

async function activityStats() {
  const user = await gh(`/users/${USER}`);
  const repos = await gh(`/users/${USER}/repos?per_page=100`);
  const orgs = await gh(`/users/${USER}/orgs`);
  const stars = repos.filter((r) => !r.fork).reduce((a, r) => a + r.stargazers_count, 0);

  const prSearch = await gh(`/search/issues?q=author:${USER}+type:pr`);
  const issueSearch = await gh(`/search/issues?q=author:${USER}+type:issue`);

  const since = new Date(Date.now() - 365 * 24 * 3600 * 1000).toISOString();
  const query = {
    query: `query($login:String!,$from:DateTime!){ user(login:$login){ contributionsCollection(from:$from){ contributionCalendar{ totalContributions } totalCommitContributions restrictedContributionsCount } } }`,
    variables: { login: USER, from: since },
  };
  let contributions = "—";
  let commits = "—";
  try {
    const data = await gh(null, { graphql: true, body: query });
    const cc = data.data.user.contributionsCollection;
    contributions = cc.contributionCalendar.totalContributions;
    commits = cc.totalCommitContributions + cc.restrictedContributionsCount;
  } catch {
    /* GraphQL unavailable, keep placeholders */
  }

  const memberSince = new Date(user.created_at).getFullYear();

  const rows = [
    ["Repos publics", user.public_repos],
    ["Contributions (12 mois)", contributions],
    ["Commits (12 mois)", commits],
    ["Pull requests", prSearch.total_count],
    ["Issues ouvertes", issueSearch.total_count],
    ["Stars reçues", stars],
    ["Organisations", orgs.length],
    ["Membre depuis", memberSince],
  ].map(([label, value]) => `| ${label} | **${value}** |`);
  return ["| Métrique | Valeur |", "|---|---|", ...rows].join("\n");
}

function replaceBlock(content, marker, value) {
  const re = new RegExp(`(<!--${marker}:START-->)([\\s\\S]*?)(<!--${marker}:END-->)`);
  return content.replace(re, `$1\n${value}\n$3`);
}

const fs = await import("node:fs/promises");
let readme = await fs.readFile("README.md", "utf8");

const [repos, npm, langs, stats] = await Promise.all([
  latestRepos(),
  npmPackages(),
  topLanguages(),
  activityStats(),
]);

readme = replaceBlock(readme, "REPOS", repos);
readme = replaceBlock(readme, "NPM", npm);
readme = replaceBlock(readme, "LANGS", langs);
readme = replaceBlock(readme, "STATS", stats);

await fs.writeFile("README.md", readme);
