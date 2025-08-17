const { Plugin, PluginSettingTab, Setting } = require('obsidian');

class CustomTypographyPlugin extends Plugin {
    async onload() {
        console.log('Loading Custom Typography Plugin');
        await this.loadSettings();
        this.addSettingTab(new CustomTypographySettingTab(this.app, this));
        this.loadStyles();
    }

    onunload() {
        console.log('Unloading Custom Typography Plugin');
        this.removeStyles();
    }

    loadStyles() {
        const styles = {
            munpia: `
                .markdown-preview-view {
                    width: 109mm;
                    min-height: 100vh;
                    margin: 8mm auto;
                    padding: 0mm 0mm 50mm; 
                    display: flex;
                    justify-content: center;
                    align-items: flex-start;
                }
                .markdown-preview-sizer {
                    width: 100%;
                    max-width: 109mm;
                    height: auto;
                }
                .markdown-preview-sizer > div {
                    width: 100%;
                }
            `,
            novelpia: `
                .markdown-preview-view {
                    width: 115mm;
                    min-height: 100vh;
                    margin: 5mm auto;
                    padding: 5mm 0mm 50mm;
                    display: flex;
                    justify-content: center;
                    align-items: flex-start;
                }
                .markdown-preview-sizer {
                    width: 100%;
                    max-width: 115mm;
                    height: auto;
                }
                .markdown-preview-sizer > div {
                    width: 100%;
                }
            `
        };
    
        const style = document.createElement('style');
        style.id = 'custom-typography-style';
        style.textContent = styles[this.settings.selectedStyle];
        document.head.appendChild(style);
    }

    removeStyles() {
        const style = document.getElementById('custom-typography-style');
        if (style) {
            style.remove();
        }
    }

    async loadSettings() {
        this.settings = Object.assign({ selectedStyle: 'munpia' }, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }
}

class CustomTypographySettingTab extends PluginSettingTab {
    constructor(app, plugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display() {
        const { containerEl } = this;

        containerEl.empty();

        new Setting(containerEl)
            .setName('Select typography style')
            .setDesc('Choose the typography style to apply.')
            .addDropdown(dropdown => dropdown
                .addOption('munpia', 'Munpia')
                .addOption('novelpia', 'Novelpia')
                .setValue(this.plugin.settings.selectedStyle)
                .onChange(async (value) => {
                    this.plugin.settings.selectedStyle = value;
                    await this.plugin.saveSettings();
                    this.plugin.removeStyles();
                    this.plugin.loadStyles();
                }));
    }
}

module.exports = CustomTypographyPlugin;
/* nosourcemap */