import { App, FuzzySuggestModal, Notice, Plugin, Vault } from 'obsidian';
import { DocPullerSettingTab } from './settings';
import { DEFAULT_SETTINGS, DocPullerSettings, RepoConfig } from './types';
import {
	downloadFile,
	getLatestCommitSha,
	getRepoTree,
	isTextFile,
	parseRepoPath,
} from './github';

// ── Vault helpers ──────────────────────────────────────────────────────────────

async function ensureFolder(vault: Vault, folderPath: string): Promise<void> {
	if (!folderPath) return;
	const parts = folderPath.split('/').filter(Boolean);
	let current = '';
	for (const part of parts) {
		current = current ? `${current}/${part}` : part;
		if (!(await vault.adapter.exists(current))) {
			await vault.adapter.mkdir(current);
		}
	}
}

function getVaultPath(filePath: string, docsFolder: string, destination: string): string {
	const prefix = docsFolder ? `${docsFolder}/` : '';
	const relative = prefix && filePath.startsWith(prefix) ? filePath.slice(prefix.length) : filePath;
	return destination ? `${destination}/${relative}` : relative;
}

// ── Repo picker modal ──────────────────────────────────────────────────────────

class RepoPicker extends FuzzySuggestModal<RepoConfig> {
	private repos: RepoConfig[];
	private onChoose: (repo: RepoConfig) => void;

	constructor(app: App, repos: RepoConfig[], onChoose: (repo: RepoConfig) => void) {
		super(app);
		this.repos = repos;
		this.onChoose = onChoose;
		this.setPlaceholder('Select a repository to sync…');
	}

	getItems(): RepoConfig[] { return this.repos; }
	getItemText(repo: RepoConfig): string { return `${repo.repoPath}  →  ${repo.destination}`; }
	onChooseItem(repo: RepoConfig): void { this.onChoose(repo); }
}

// ── Plugin ─────────────────────────────────────────────────────────────────────

export default class DocPullerPlugin extends Plugin {
	settings: DocPullerSettings;

	async onload() {
		await this.loadSettings();

		// Ribbon icon – sync all
		this.addRibbonIcon('folder-sync', 'Sync all doc sources', async () => {
			await this.syncAll();
		});

		// Commands
		this.addCommand({
			id: 'sync-all',
			name: 'Sync all repos',
			callback: async () => { await this.syncAll(); },
		});

		this.addCommand({
			id: 'sync-one',
			name: 'Sync repo…',
			callback: () => {
				if (this.settings.repos.length === 0) {
					new Notice('No repositories configured. Open settings to add one.');
					return;
				}
				new RepoPicker(this.app, this.settings.repos, repo => {
					this.syncRepo(repo).catch(err => {
						const msg = err instanceof Error ? err.message : String(err);
						new Notice(`Sync failed for ${repo.repoPath}: ${msg}`);
					});
				}).open();
			},
		});

		this.addCommand({
			id: 'check-updates',
			name: 'Check all repos for updates',
			callback: async () => { await this.checkForUpdates(); },
		});

		this.addSettingTab(new DocPullerSettingTab(this.app, this));
	}

	onunload() { /* nothing to clean up */ }

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData() as Partial<DocPullerSettings>);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	// ── Sync logic ───────────────────────────────────────────────────────────

	/**
	 * Download all files in the configured docs folder into the destination vault path.
	 * Updates lastCommitSha and clears hasUpdates on success.
	 */
	async syncRepo(repo: RepoConfig): Promise<void> {
		const { owner, repo: repoName } = parseRepoPath(repo.repoPath);
		const token = this.settings.githubToken;

		new Notice(`Syncing ${repo.repoPath}…`);

		const { commitSha, tree, truncated } = await getRepoTree(token, owner, repoName, repo.branch);

		if (truncated) {
			throw new Error(
				`Repository tree for ${repo.repoPath} is too large to retrieve completely. ` +
				'Consider specifying a more specific docs folder.',
			);
		}

		const prefix = repo.docsFolder ? `${repo.docsFolder}/` : '';
		const files = tree.filter(item =>
			item.type === 'blob' && (prefix === '' || item.path.startsWith(prefix)),
		);

		if (files.length === 0) {
			new Notice(`No files found under "${repo.docsFolder || '(root)'}" in ${repo.repoPath}`);
			return;
		}

		let written = 0;
		for (const file of files) {
			const vaultPath = getVaultPath(file.path, repo.docsFolder, repo.destination);
			const folderPath = vaultPath.includes('/') ? vaultPath.slice(0, vaultPath.lastIndexOf('/')) : '';
			await ensureFolder(this.app.vault, folderPath);

			const data = await downloadFile(token, owner, repoName, file.path, repo.branch);
			if (isTextFile(file.path)) {
				await this.app.vault.adapter.write(vaultPath, new TextDecoder().decode(data));
			} else {
				await this.app.vault.adapter.writeBinary(vaultPath, data);
			}
			written++;
		}

		// Persist updated commit SHA
		const idx = this.settings.repos.findIndex(r => r.id === repo.id);
		if (idx !== -1) {
			const entry = this.settings.repos[idx];
			if (entry) {
				entry.lastCommitSha = commitSha;
				entry.hasUpdates = false;
			}
		}
		await this.saveSettings();

		new Notice(`✓ Synced ${written} file${written === 1 ? '' : 's'} from ${repo.repoPath}`);
	}

	/** Sync every configured repository in sequence. */
	async syncAll(): Promise<void> {
		if (this.settings.repos.length === 0) {
			new Notice('No repositories configured. Open settings to add one.');
			return;
		}
		let success = 0;
		let failed = 0;
		for (const repo of this.settings.repos) {
			try {
				await this.syncRepo(repo);
				success++;
			} catch (err) {
				failed++;
				const msg = err instanceof Error ? err.message : String(err);
				new Notice(`✗ Failed to sync ${repo.repoPath}: ${msg}`);
			}
		}
		new Notice(`Sync complete: ${success} succeeded, ${failed} failed.`);
	}

	/**
	 * For each configured repo, fetch the latest commit SHA and compare with
	 * the stored SHA. Sets hasUpdates = true where a newer commit exists.
	 */
	async checkForUpdates(): Promise<void> {
		if (this.settings.repos.length === 0) {
			new Notice('No repositories configured.');
			return;
		}
		const token = this.settings.githubToken;
		let updates = 0;
		for (const repo of this.settings.repos) {
			try {
				const { owner, repo: repoName } = parseRepoPath(repo.repoPath);
				const latest = await getLatestCommitSha(token, owner, repoName, repo.branch, repo.docsFolder);
				const changed = repo.lastCommitSha !== latest;
				repo.hasUpdates = changed;
				if (changed) updates++;
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				new Notice(`Could not check ${repo.repoPath}: ${msg}`);
			}
		}
		await this.saveSettings();
		if (updates === 0) {
			new Notice('All repos are up to date.');
		} else {
			new Notice(`${updates} repo${updates === 1 ? '' : 's'} have updates available.`);
		}
	}
}
