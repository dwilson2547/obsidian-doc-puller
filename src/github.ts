import { requestUrl } from 'obsidian';

const API_BASE = 'https://api.github.com';

function authHeaders(token: string): Record<string, string> {
	const h: Record<string, string> = {
		'Accept': 'application/vnd.github.v3+json',
	};
	if (token) h['Authorization'] = `token ${token}`;
	return h;
}

/**
 * Parse a repo path like "owner/repo" or a full GitHub URL into { owner, repo }.
 */
export function parseRepoPath(repoPath: string): { owner: string; repo: string } {
	const urlMatch = repoPath.match(/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?(?:\/.*)?$/);
	if (urlMatch) {
		const owner = urlMatch[1];
		const repo = urlMatch[2];
		if (!owner || !repo) throw new Error(`Invalid GitHub URL: ${repoPath}`);
		return { owner, repo };
	}
	const parts = repoPath.trim().split('/');
	if (parts.length >= 2 && parts[0] && parts[1]) {
		return { owner: parts[0], repo: parts[1] };
	}
	throw new Error(`Invalid repo path "${repoPath}". Use "owner/repo" format or a full GitHub URL.`);
}

/**
 * Get the SHA of the most recent commit that touched a given path (or the branch head if no path).
 */
export async function getLatestCommitSha(
	token: string,
	owner: string,
	repo: string,
	branch: string,
	path: string,
): Promise<string> {
	const pathParam = path ? `&path=${encodeURIComponent(path)}` : '';
	const res = await requestUrl({
		url: `${API_BASE}/repos/${owner}/${repo}/commits?sha=${encodeURIComponent(branch)}&per_page=1${pathParam}`,
		headers: authHeaders(token),
	});
	if (res.status !== 200) {
		throw new Error(`GitHub API error ${res.status} fetching commits for ${owner}/${repo}`);
	}
	const commits = res.json as Array<{ sha: string }>;
	const first = commits[0];
	if (!first) throw new Error(`No commits found for ${owner}/${repo} on branch "${branch}"`);
	return first.sha;
}

export interface TreeItem {
	path: string;
	type: 'blob' | 'tree';
	sha: string;
	size?: number;
}

/**
 * Retrieve the full recursive file tree for a branch.
 * Returns the branch head commit SHA and the list of tree items.
 */
export async function getRepoTree(
	token: string,
	owner: string,
	repo: string,
	branch: string,
): Promise<{ commitSha: string; tree: TreeItem[]; truncated: boolean }> {
	const branchRes = await requestUrl({
		url: `${API_BASE}/repos/${owner}/${repo}/branches/${encodeURIComponent(branch)}`,
		headers: authHeaders(token),
	});
	if (branchRes.status !== 200) {
		throw new Error(`GitHub API error ${branchRes.status} fetching branch "${branch}" for ${owner}/${repo}`);
	}
	const branchData = branchRes.json as { commit: { sha: string } };
	const commitSha = branchData.commit.sha;

	const treeRes = await requestUrl({
		url: `${API_BASE}/repos/${owner}/${repo}/git/trees/${commitSha}?recursive=1`,
		headers: authHeaders(token),
	});
	if (treeRes.status !== 200) {
		throw new Error(`GitHub API error ${treeRes.status} fetching tree for ${owner}/${repo}`);
	}
	const treeData = treeRes.json as { tree: TreeItem[]; truncated: boolean };
	return {
		commitSha,
		tree: treeData.tree,
		truncated: treeData.truncated,
	};
}

const BINARY_EXTENSIONS = new Set([
	'png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'ico', 'tiff', 'tif',
	'pdf', 'zip', 'gz', 'tar', 'rar', '7z', 'exe', 'dll', 'so', 'dylib',
	'woff', 'woff2', 'ttf', 'eot', 'otf', 'mp3', 'mp4', 'wav', 'avi',
	'mov', 'mkv', 'flac', 'ogg', 'webm', 'db', 'sqlite', 'class', 'jar',
]);

export function isTextFile(filePath: string): boolean {
	const dotIdx = filePath.lastIndexOf('.');
	if (dotIdx === -1) return true;
	const ext = filePath.slice(dotIdx + 1).toLowerCase();
	return !BINARY_EXTENSIONS.has(ext);
}

/**
 * Download the raw bytes of a file from GitHub.
 */
export async function downloadFile(
	token: string,
	owner: string,
	repo: string,
	filePath: string,
	branch: string,
): Promise<ArrayBuffer> {
	const encodedPath = filePath.split('/').map(s => encodeURIComponent(s)).join('/');
	const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${encodeURIComponent(branch)}/${encodedPath}`;
	const res = await requestUrl({
		url: rawUrl,
		headers: token ? { 'Authorization': `token ${token}` } : {},
	});
	if (res.status !== 200) {
		throw new Error(`Failed to download "${filePath}" from ${owner}/${repo}: HTTP ${res.status}`);
	}
	return res.arrayBuffer;
}
