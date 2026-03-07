import { App, Modal, Notice, PluginSettingTab, Setting } from 'obsidian';
import type DocPullerPlugin from './main';
import type { RepoConfig } from './types';

// ── RepoEditModal ──────────────────────────────────────────────────────────────

export class RepoEditModal extends Modal {
	private config: RepoConfig;
	private onSave: (config: RepoConfig) => void;
	private isNew: boolean;

	constructor(app: App, config: RepoConfig, onSave: (config: RepoConfig) => void, isNew = false) {
		super(app);
		// work on a shallow copy so Cancel doesn't mutate the original
		this.config = { ...config };
		this.onSave = onSave;
		this.isNew = isNew;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl('h2', { text: this.isNew ? 'Add repository' : 'Edit repository' });

		new Setting(contentEl)
			.setName('Repository')
			.setDesc('Format: owner/repo  or  https://github.com/owner/repo')
			.addText(t => t
				.setPlaceholder('Owner/repo')
				.setValue(this.config.repoPath)
				.onChange(v => { this.config.repoPath = v.trim(); }));

		new Setting(contentEl)
			.setName('Docs folders')
			.setDesc('Folders inside the repo to pull (one per line). Leave empty to pull the whole repo root.')
			.addTextArea(t => {
				t.setPlaceholder('One folder per line');
				t.setValue(this.config.docsFolders.join('\n'));
				t.inputEl.rows = 3;
				t.onChange(v => {
					this.config.docsFolders = v.split('\n').map(s => s.trim()).filter(Boolean);
				});
			});

		new Setting(contentEl)
			.setName('File whitelist')
			.setDesc('Specific repo-relative file paths to always pull (one per line), e.g. `README.md`')
			.addTextArea(t => {
				t.setPlaceholder('One file path per line');
				t.setValue(this.config.fileWhitelist.join('\n'));
				t.inputEl.rows = 3;
				t.onChange(v => {
					this.config.fileWhitelist = v.split('\n').map(s => s.trim()).filter(Boolean);
				});
			});

		new Setting(contentEl)
			.setName('Destination')
			.setDesc('Vault folder where files will be written, e.g. Notes/my-project')
			.addText(t => t
				.setPlaceholder('Notes/my-project')
				.setValue(this.config.destination)
				.onChange(v => { this.config.destination = v.trim(); }));

		new Setting(contentEl)
			.setName('Branch')
			.setDesc('Branch to pull from')
			.addText(t => t
				.setValue(this.config.branch)
				.onChange(v => { this.config.branch = v.trim() || 'main'; }));

		new Setting(contentEl)
			.addButton(b => b
				.setButtonText('Save')
				.setCta()
				.onClick(() => {
					if (!this.config.repoPath) {
						new Notice('Repository path is required');
						return;
					}
					if (!this.config.destination) {
						new Notice('Destination folder is required');
						return;
					}
					this.onSave(this.config);
					this.close();
				}))
			.addButton(b => b
				.setButtonText('Cancel')
				.onClick(() => this.close()));
	}

	onClose() {
		this.contentEl.empty();
	}
}

// ── DocPullerSettingTab ────────────────────────────────────────────────────────

export class DocPullerSettingTab extends PluginSettingTab {
	plugin: DocPullerPlugin;

	constructor(app: App, plugin: DocPullerPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		// ── GitHub credentials ────────────────────────────────────────────────
		new Setting(containerEl).setName('GitHub credentials').setHeading();

		new Setting(containerEl)
			.setName('Personal access token')
			.setDesc('Required for private repos and to avoid rate-limiting. Use a classic token with repo scope, or a fine-grained token with read access to repository contents.')
			.addText(t => {
				t.inputEl.type = 'password';
				t.setValue(this.plugin.settings.githubToken)
					.onChange(async v => {
						this.plugin.settings.githubToken = v;
						await this.plugin.saveSettings();
					});
			});

		// ── Repositories ──────────────────────────────────────────────────────
		new Setting(containerEl).setName('Repositories').setHeading();

		new Setting(containerEl)
			.addButton(b => {
				b.setButtonText('Sync all').setCta();
				b.onClick(() => {
					b.setDisabled(true);
					b.setButtonText('Syncing…');
					this.plugin.syncAll()
						.then(() => { b.setDisabled(false); b.setButtonText('Sync all'); this.display(); })
						.catch(err => { b.setDisabled(false); b.setButtonText('Sync all'); new Notice(String(err)); });
				});
			})
			.addButton(b => {
				b.setButtonText('Check for updates');
				b.onClick(() => {
					b.setDisabled(true);
					b.setButtonText('Checking…');
					this.plugin.checkForUpdates()
						.then(() => { b.setDisabled(false); b.setButtonText('Check for updates'); this.display(); })
						.catch(err => { b.setDisabled(false); b.setButtonText('Check for updates'); new Notice(String(err)); });
				});
			});

		// ── Table ─────────────────────────────────────────────────────────────
		if (this.plugin.settings.repos.length === 0) {
			containerEl.createEl('p', {
				text: 'No repositories configured yet. Use the button below to add one.',
				cls: 'doc-puller-empty',
			});
		} else {
			const table = containerEl.createEl('table', { cls: 'doc-puller-table' });
			const thead = table.createEl('thead');
			const headerRow = thead.createEl('tr');
			for (const heading of ['Repository', 'Status', 'Actions']) {
				headerRow.createEl('th', { text: heading });
			}

			const tbody = table.createEl('tbody');
			for (const repo of this.plugin.settings.repos) {
				this.renderRepoRow(tbody, repo);
			}
		}

		// ── Add button ────────────────────────────────────────────────────────
		new Setting(containerEl)
			.addButton(b => b
				.setButtonText('Add repository')
				.setCta()
				.onClick(() => {
					const newRepo: RepoConfig = {
						id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
						repoPath: '',
						docsFolders: ['docs'],
						fileWhitelist: [],
						destination: '',
						branch: 'main',
						lastCommitSha: '',
						hasUpdates: false,
					};
					new RepoEditModal(this.app, newRepo, saved => {
						this.plugin.settings.repos.push(saved);
						this.plugin.saveSettings()
							.then(() => this.display())
							.catch(err => console.error(err));
					}, true).open();
				}));
	}

	private renderRepoRow(tbody: HTMLTableSectionElement, repo: RepoConfig): void {
		const tr = tbody.createEl('tr');

		tr.createEl('td', { text: repo.repoPath });

		// Status cell
		const statusTd = tr.createEl('td');
		if (!repo.lastCommitSha) {
			statusTd.createSpan({ text: 'Not synced', cls: 'doc-puller-status-none' });
		} else if (repo.hasUpdates) {
			statusTd.createSpan({ text: '⬆ Updates available', cls: 'doc-puller-status-update' });
		} else {
			statusTd.createSpan({ text: '✓ Up to date', cls: 'doc-puller-status-ok' });
		}

		// Actions cell
		const actionsTd = tr.createEl('td', { cls: 'doc-puller-actions' });

		const syncBtn = actionsTd.createEl('button', { text: 'Sync' });
		syncBtn.addEventListener('click', () => {
			syncBtn.disabled = true;
			syncBtn.textContent = '…';
			this.plugin.syncRepo(repo)
				.then(() => { syncBtn.disabled = false; syncBtn.textContent = 'Sync'; this.display(); })
				.catch(err => {
					syncBtn.disabled = false;
					syncBtn.textContent = 'Sync';
					new Notice(`Sync failed: ${err instanceof Error ? err.message : String(err)}`);
				});
		});

		const editBtn = actionsTd.createEl('button', { text: 'Edit' });
		editBtn.addEventListener('click', () => {
			new RepoEditModal(this.app, repo, saved => {
				const idx = this.plugin.settings.repos.findIndex(r => r.id === repo.id);
				if (idx !== -1) this.plugin.settings.repos[idx] = saved;
				this.plugin.saveSettings()
					.then(() => this.display())
					.catch(err => console.error(err));
			}).open();
		});

		const deleteBtn = actionsTd.createEl('button', { text: 'Delete', cls: 'mod-warning' });
		deleteBtn.addEventListener('click', () => {
			this.plugin.settings.repos = this.plugin.settings.repos.filter(r => r.id !== repo.id);
			this.plugin.saveSettings()
				.then(() => this.display())
				.catch(err => console.error(err));
		});
	}
}
