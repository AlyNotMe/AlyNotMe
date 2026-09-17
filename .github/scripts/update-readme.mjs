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
  const orgs = await gh(`/users/${USER}/orgs`);
  const repoLists = await Promise.all([
    gh(`/users/${USER}/repos?per_page=100&sort=pushed`),
    ...orgs.map((o) => gh(`/orgs/${o.login}/repos?per_page=100&sort=pushed&type=public`)),
  ]);
  const seen = new Set();
  const repos = repoLists
    .flat()
    .filter((r) => !r.fork && !seen.has(r.full_name) && seen.add(r.full_name))
    .sort((a, b) => new Date(b.pushed_at) - new Date(a.pushed_at))
    .slice(0, 5);
  const lines = repos.map(
    (r) => `- ↻ **[${r.full_name}](${r.html_url})** — pushé il y a ${relativeTime(r.pushed_at)}, sur \`${r.default_branch}\``
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

async function extraStats() {
  const user = await gh(`/users/${USER}`);
  const orgs = await gh(`/users/${USER}/orgs`);
  const memberSince = new Date(user.created_at).getFullYear();
  return `**Repos publics :** ${user.public_repos} · **Organisations :** ${orgs.length} · **Membre depuis :** ${memberSince}`;
}

function replaceBlock(content, marker, value) {
  const re = new RegExp(`(<!--${marker}:START-->)([\\s\\S]*?)(<!--${marker}:END-->)`);
  return content.replace(re, `$1\n\n${value}\n\n$3`);
}

const fs = await import("node:fs/promises");
let readme = await fs.readFile("README.md", "utf8");

const [repos, npm, extra] = await Promise.all([latestRepos(), npmPackages(), extraStats()]);

readme = replaceBlock(readme, "REPOS", repos);
readme = replaceBlock(readme, "NPM", npm);
readme = replaceBlock(readme, "EXTRA", extra);

await fs.writeFile("README.md", readme);
