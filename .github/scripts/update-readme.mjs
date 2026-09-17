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

function replaceBlock(content, marker, value) {
  const re = new RegExp(`(<!--${marker}:START-->)([\\s\\S]*?)(<!--${marker}:END-->)`);
  return content.replace(re, `$1\n${value}\n$3`);
}

const fs = await import("node:fs/promises");
let readme = await fs.readFile("README.md", "utf8");

const [repos, npm] = await Promise.all([latestRepos(), npmPackages()]);

readme = replaceBlock(readme, "REPOS", repos);
readme = replaceBlock(readme, "NPM", npm);

await fs.writeFile("README.md", readme);
