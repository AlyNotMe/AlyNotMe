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

async function myLastPush(fullName) {
  try {
    const events = await gh(`/repos/${fullName}/events?per_page=100`);
    const mine = events.find((e) => e.type === "PushEvent" && e.actor?.login === USER);
    return mine?.created_at ?? null;
  } catch {
    return null;
  }
}

async function latestRepos() {
  const orgs = await gh(`/users/${USER}/orgs`);
  const repoLists = await Promise.all([
    gh(`/users/${USER}/repos?per_page=100&sort=pushed`),
    ...orgs.map((o) => gh(`/orgs/${o.login}/repos?per_page=100&sort=pushed&type=public`)),
  ]);
  const candidates = repoLists.flat();
  const myDates = await Promise.all(candidates.map((r) => myLastPush(r.full_name)));
  const ownRepos = candidates
    .map((r, i) => ({
      full_name: r.full_name,
      html_url: r.html_url,
      date: myDates[i],
      kind: "push",
    }))
    .filter((e) => e.date);

  const prSearch = await gh(`/search/issues?q=author:${USER}+type:pr&sort=updated&order=desc&per_page=15`);
  const prEntries = prSearch.items.map((item) => ({
    full_name: item.repository_url.replace("https://api.github.com/repos/", ""),
    html_url: item.pull_request.html_url,
    date: item.pull_request.merged_at ?? item.updated_at,
    kind: "pr",
    title: item.title,
    merged: Boolean(item.pull_request.merged_at),
  }));

  const seen = new Set();
  const entries = [...ownRepos, ...prEntries]
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .filter((e) => !seen.has(e.full_name) && seen.add(e.full_name))
    .slice(0, 5);

  const colors = "bg_color=15130f&text_color=ece7dd&accent_color=e08a4f";
  const lines = entries.map((e) => {
    let badge;
    if (e.kind === "push") {
      badge = `https://github-readme-stats-kms.vercel.app/api/repo-status?repo=${encodeURIComponent(e.full_name)}&${colors}`;
    } else {
      const state = e.merged ? "merged" : "open";
      badge = `https://github-readme-stats-kms.vercel.app/api/repo-status?pr_repo=${encodeURIComponent(e.full_name)}&pr_title=${encodeURIComponent(e.title)}&pr_date=${encodeURIComponent(e.date)}&pr_state=${state}&${colors}`;
    }
    return `[![${e.full_name}](${badge})](${e.html_url})`;
  });
  const list = lines.join("<br/>\n");
  return `<table><tr><td>\n\n${list}\n\n</td></tr></table>\n\n[voir tous les repos →](https://github.com/${USER}?tab=repositories)`;
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
