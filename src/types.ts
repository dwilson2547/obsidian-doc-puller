export interface RepoConfig {
	id: string;
	/** "owner/repo" or a full GitHub URL */
	repoPath: string;
	/** Folders inside the repo to pull, e.g. ["docs", "guides"]. Empty array means whole repo root. */
	docsFolders: string[];
	/** Specific file paths (repo-relative) to always pull, e.g. ["README.md"]. */
	fileWhitelist: string[];
	/** Vault-relative destination folder, e.g. "Notes/MyProject" */
	destination: string;
	/** Branch to pull from, default "main" */
	branch: string;
	/** SHA of the last synced commit (for update detection) */
	lastCommitSha: string;
	/** True if a newer commit exists on GitHub than what was last synced */
	hasUpdates: boolean;
}

export interface DocPullerSettings {
	githubToken: string;
	repos: RepoConfig[];
}

export const DEFAULT_SETTINGS: DocPullerSettings = {
	githubToken: '',
	repos: [],
};
