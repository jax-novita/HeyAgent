/**
 * Deterministic multi-step GitHub browser mission.
 * Facts via GitHub API; UI walkthrough in ONE browser tab (no tab spam).
 */
import type { PreferredBrowser } from "./browser-nav.js";
import { browserTourVerified } from "./browser-agent.js";

interface GhIssue {
  number: number;
  title: string;
  html_url: string;
  comments: number;
  user?: { login: string; html_url: string };
  pull_request?: unknown;
}

interface GhRepo {
  full_name: string;
  html_url: string;
  stargazers_count: number;
  description: string | null;
  fork: boolean;
}

async function ghGet<T>(path: string): Promise<T> {
  const res = await fetch(`https://api.github.com${path}`, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "HeyAgent",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GitHub API ${res.status}: ${body.slice(0, 200)}`);
  }
  return (await res.json()) as T;
}

function parseRepo(input: string): { owner: string; repo: string } {
  const cleaned = input.trim().replace(/^https?:\/\/github\.com\//i, "").replace(/\.git$/, "");
  const m = cleaned.match(/^([^/\s]+)\/([^/\s#?]+)/);
  if (!m) return { owner: "microsoft", repo: "TypeScript" };
  return { owner: m[1], repo: m[2] };
}

/**
 * Full mission in ONE tab:
 * repo → issues(comments) → top issue → author → author repos → back to issue
 */
export async function githubBrowseMission(opts: {
  repo?: string;
  browser?: PreferredBrowser;
  openBrowser?: boolean;
}): Promise<string> {
  const { owner, repo } = parseRepo(opts.repo ?? "microsoft/TypeScript");
  const browser = opts.browser ?? "auto";
  const openBrowser = opts.openBrowser !== false;
  const steps: string[] = [];

  const repoUrl = `https://github.com/${owner}/${repo}`;
  const issuesSortedUrl = `https://github.com/${owner}/${repo}/issues?q=is%3Aissue+is%3Aopen+sort%3Acomments-desc`;

  const issues = await ghGet<GhIssue[]>(
    `/repos/${owner}/${repo}/issues?state=open&sort=comments&direction=desc&per_page=10`,
  );
  const issue =
    issues.find((i) => i && i.number && i.title && !("pull_request" in i && i.pull_request)) ??
    issues[0];
  if (!issue) {
    return "ERROR: не нашёл open issues.";
  }

  const author = issue.user?.login ?? "unknown";
  const authorUrl = issue.user?.html_url ?? `https://github.com/${author}`;
  const issueUrl = issue.html_url;
  const authorReposUrl = `https://github.com/${author}?tab=repositories&sort=stargazers`;

  const repos = await ghGet<GhRepo[]>(
    `/users/${encodeURIComponent(author)}/repos?sort=stars&direction=desc&per_page=30&type=owner`,
  );
  const top = [...repos]
    .filter((r) => !r.fork)
    .sort((a, b) => b.stargazers_count - a.stargazers_count)
    .slice(0, 3);

  const tour = [repoUrl, issuesSortedUrl, issueUrl, authorUrl, authorReposUrl, issueUrl];

  if (openBrowser) {
    await browserTourVerified(tour, browser, 1500);
    steps.push(`1. Репозиторий (одна вкладка): ${repoUrl}`);
    steps.push(`2. Issues по обсуждаемости: ${issuesSortedUrl}`);
    steps.push(
      `3. Самый обсуждаемый issue: #${issue.number} «${issue.title}» (${issue.comments} comments)\n   ${issueUrl}`,
    );
    steps.push(`4. Профиль автора: ${author}\n   ${authorUrl}`);
    steps.push(`5. Репозитории автора (по ★): ${authorReposUrl}`);
    steps.push("   Топ-3 (списком, без лишних вкладок):");
    for (const [idx, r] of top.entries()) {
      steps.push(
        `   ${idx + 1}) ${r.full_name} ★${r.stargazers_count} — ${r.description ?? "(no description)"}\n      ${r.html_url}`,
      );
    }
    steps.push(`6. Вернулся к issue (та же вкладка): ${issueUrl}`);
    steps.push("");
    steps.push("Навигация: ONE tab через CDP (не Ctrl+L), без спама вкладок.");
  } else {
    steps.push(`1. ${repoUrl}`);
    steps.push(`2. ${issuesSortedUrl}`);
    steps.push(`3. #${issue.number} ${issue.title} — ${issueUrl}`);
    steps.push(`4. ${author} — ${authorUrl}`);
    steps.push("5. Топ-3:");
    for (const [idx, r] of top.entries()) {
      steps.push(`   ${idx + 1}) ${r.full_name} ★${r.stargazers_count} — ${r.html_url}`);
    }
    steps.push(`6. Назад: ${issueUrl}`);
  }

  return [
    `GitHub mission DONE для ${owner}/${repo}:`,
    ...steps,
    "",
    "Итог:",
    `- Issue: #${issue.number} ${issue.title}`,
    `- Автор: ${author}`,
    `- Репозитории: ${top.map((r) => r.full_name).join(", ") || "(нет)"}`,
  ].join("\n");
}

/** Generic same-tab URL tour for similar multi-step web tasks. */
export async function browserMissionTour(opts: {
  urls: string[];
  browser?: PreferredBrowser;
}): Promise<string> {
  const urls = opts.urls ?? [];
  if (urls.length < 1) return "ERROR: нужен список urls";
  return browserTourVerified(urls, opts.browser ?? "auto");
}
