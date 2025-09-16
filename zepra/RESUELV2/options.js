// Modern Options.js - Complete Rewrite
class ModernOptionsManager {
  constructor() {
    this.currentSection = 'theme-api';
    this.hasUnsavedChanges = false;
    this.originalValues = {};
    this.editingPromptId = null;
    
    this.initializeElements();
    this.bindEvents();
    this.loadSettings();
    this.setupNavigation();
  }

  initializeElements() {
    this.elements = {
      // Navigation
      navLinks: document.querySelectorAll('.nav-link'),
      navIndicator: document.querySelector('.nav-indicator'),
      contentSections: document.querySelectorAll('.content-section'),
      
      // Modal controls
      closeModal: document.getElementById('closeModal'),
      saveBar: document.getElementById('saveBar'),
      resetChanges: document.getElementById('resetChanges'),
      saveChanges: document.getElementById('saveChanges'),
      statusMessage: document.getElementById('statusMessage'),
      loadingOverlay: document.getElementById('loadingOverlay'),
      
      // Form elements
      primaryColor: document.getElementById('primaryColor'),
      cerebrasKey: document.getElementById('cerebrasKey'),
      cerebrasModel: document.getElementById('cerebrasModel'),
      ocrKey: document.getElementById('ocrKey'),
      ipdataKey: document.getElementById('ipdataKey'),
      testIpdata: document.getElementById('testIpdata'),
      typingSpeed: document.getElementById('typingSpeed'),
      showReasoning: document.getElementById('showReasoning'),
      reasonLang: document.getElementById('reasonLang'),
      ocrLang: document.getElementById('ocrLang'),
      webWidth: document.getElementById('webWidth'),
      webHeight: document.getElementById('webHeight'),
      
      // Prompts
      promptForm: document.getElementById('promptForm'),
      promptName: document.getElementById('promptName'),
      promptTags: document.getElementById('promptTags'),
      promptHotkey: document.getElementById('promptHotkey'),
      promptText: document.getElementById('promptText'),
      savePrompt: document.getElementById('savePrompt'),
      cancelPrompt: document.getElementById('cancelPrompt'),
      promptTable: document.getElementById('promptTable')?.querySelector('tbody'),
      
      // Sites
      siteName: document.getElementById('siteName'),
      siteUrl: document.getElementById('siteUrl'),
      addSite: document.getElementById('addSite'),
      sitesList: document.getElementById('sitesList')
    };
  }

  bindEvents() {
    // Add click sound to all buttons
    this.addClickSounds();
    
    // Close modal
    this.elements.closeModal?.addEventListener('click', () => this.closeModal());
    
    // Navigation
    this.elements.navLinks?.forEach(link => {
      link.addEventListener('click', (e) => this.handleNavigation(e));
    });
    
    // Save bar actions
    this.elements.resetChanges?.addEventListener('click', () => this.resetChanges());
    this.elements.saveChanges?.addEventListener('click', () => this.saveAllChanges());
    
    // Form change tracking
    this.trackFormChanges();
    
    // Specific actions
    this.elements.testIpdata?.addEventListener('click', () => this.testIpdataConnection());
    this.elements.primaryColor?.addEventListener('input', (e) => this.updateThemeColor(e.target.value));
    
    // Prompt management
    this.elements.savePrompt?.addEventListener('click', () => this.savePrompt());
    this.elements.cancelPrompt?.addEventListener('click', () => this.cancelPromptEdit());
    
    // Site management
    this.elements.addSite?.addEventListener('click', () => this.addCustomSite());
    
    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => this.handleKeyboard(e));
  }

  async loadSettings() {
    try {
      const settings = await chrome.storage.local.get([
        'cerebrasApiKey', 'cerebrasModel', 'ocrApiKey', 'ipdataApiKey',
        'typingSpeed', 'ocrLang', 'customWebSize', 'primaryColor',
        'showReasoning', 'reasonLang'
      ]);

      // Populate form fields
      if (this.elements.cerebrasKey) this.elements.cerebrasKey.value = settings.cerebrasApiKey || '';
      if (this.elements.cerebrasModel) this.elements.cerebrasModel.value = settings.cerebrasModel || 'gpt-oss-120b';
      if (this.elements.ocrKey) this.elements.ocrKey.value = settings.ocrApiKey || '';
      if (this.elements.ipdataKey) this.elements.ipdataKey.value = settings.ipdataApiKey || '';
      if (this.elements.typingSpeed) this.elements.typingSpeed.value = settings.typingSpeed || 'normal';
      if (this.elements.ocrLang) this.elements.ocrLang.value = settings.ocrLang || 'eng';
      if (this.elements.webWidth) this.elements.webWidth.value = settings.customWebSize?.width || 1000;
      if (this.elements.webHeight) this.elements.webHeight.value = settings.customWebSize?.height || 800;
      if (this.elements.showReasoning) this.elements.showReasoning.checked = settings.showReasoning || false;
      if (this.elements.reasonLang) this.elements.reasonLang.value = settings.reasonLang || '';
      if (this.elements.primaryColor) this.elements.primaryColor.value = settings.primaryColor || '#39ff14';

      // Apply theme
      if (settings.primaryColor) {
        this.updateThemeColor(settings.primaryColor);
      }

      // Store original values for change tracking
      this.storeOriginalValues();
      
      // Load additional data
      await this.loadPrompts();
      await this.loadSites();
      
    } catch (error) {
      console.error('Error loading settings:', error);
      this.showStatus('Error loading settings', 'error');
    }
  }

  storeOriginalValues() {
    this.originalValues = {
      cerebrasKey: this.elements.cerebrasKey?.value || '',
      cerebrasModel: this.elements.cerebrasModel?.value || '',
      ocrKey: this.elements.ocrKey?.value || '',
      ipdataKey: this.elements.ipdataKey?.value || '',
      typingSpeed: this.elements.typingSpeed?.value || '',
      ocrLang: this.elements.ocrLang?.value || '',
      webWidth: this.elements.webWidth?.value || '',
      webHeight: this.elements.webHeight?.value || '',
      showReasoning: this.elements.showReasoning?.checked || false,
      reasonLang: this.elements.reasonLang?.value || '',
      primaryColor: this.elements.primaryColor?.value || ''
    };
  }

  trackFormChanges() {
    const formElements = [
      this.elements.cerebrasKey, this.elements.cerebrasModel, this.elements.ocrKey,
      this.elements.ipdataKey, this.elements.typingSpeed, this.elements.ocrLang,
      this.elements.webWidth, this.elements.webHeight, this.elements.showReasoning,
      this.elements.reasonLang, this.elements.primaryColor
    ];

    formElements.forEach(element => {
      if (!element) return;
      
      const eventType = element.type === 'checkbox' ? 'change' : 'input';
      element.addEventListener(eventType, () => this.checkForChanges());
    });
  }

  checkForChanges() {
    const currentValues = {
      cerebrasKey: this.elements.cerebrasKey?.value || '',
      cerebrasModel: this.elements.cerebrasModel?.value || '',
      ocrKey: this.elements.ocrKey?.value || '',
      ipdataKey: this.elements.ipdataKey?.value || '',
      typingSpeed: this.elements.typingSpeed?.value || '',
      ocrLang: this.elements.ocrLang?.value || '',
      webWidth: this.elements.webWidth?.value || '',
      webHeight: this.elements.webHeight?.value || '',
      showReasoning: this.elements.showReasoning?.checked || false,
      reasonLang: this.elements.reasonLang?.value || '',
      primaryColor: this.elements.primaryColor?.value || ''
    };

    const hasChanges = Object.keys(currentValues).some(key => 
      currentValues[key] !== this.originalValues[key]
    );

    if (hasChanges !== this.hasUnsavedChanges) {
      this.hasUnsavedChanges = hasChanges;
      this.toggleSaveBar(hasChanges);
    }
  }

  toggleSaveBar(show) {
    if (this.elements.saveBar) {
      this.elements.saveBar.classList.toggle('visible', show);
    }
  }

  setupNavigation() {
    // Position indicator on the active nav item
    this.updateNavIndicator();
  }

  handleNavigation(e) {
    e.preventDefault();
    const link = e.currentTarget;
    const section = link.dataset.section;
    
    if (section === this.currentSection) return;
    
    // Update active states
    this.elements.navLinks?.forEach(l => l.classList.remove('active'));
    link.classList.add('active');
    
    // Switch content sections with animation
    this.switchSection(section);
    
    // Update indicator position
    this.updateNavIndicator();
    
    this.currentSection = section;
  }

  switchSection(newSection) {
    // Hide current section
    const currentEl = document.getElementById(this.currentSection);
    if (currentEl) {
      currentEl.classList.remove('active');
    }
    
    // Show new section with delay for smooth transition
    setTimeout(() => {
      const newEl = document.getElementById(newSection);
      if (newEl) {
        newEl.classList.add('active');
      }
    }, 200);
  }

  updateNavIndicator() {
    const activeLink = document.querySelector('.nav-link.active');
    if (!activeLink || !this.elements.navIndicator) return;
    
    const linkRect = activeLink.getBoundingClientRect();
    const sidebarRect = activeLink.closest('.nav-sidebar').getBoundingClientRect();
    const offset = linkRect.top - sidebarRect.top + linkRect.height / 2 - 24; // Center the indicator
    
    this.elements.navIndicator.style.transform = `translateY(${offset}px)`;
    
    // Add a subtle glow effect
    this.elements.navIndicator.style.boxShadow = `
      0 0 20px rgba(139, 92, 246, 0.8),
      0 0 40px rgba(139, 92, 246, 0.4),
      0 0 60px rgba(139, 92, 246, 0.2)
    `;
  }

  updateThemeColor(color) {
    document.documentElement.style.setProperty('--accent-color', color);
    // Update any other theme-dependent elements
    const indicator = this.elements.navIndicator;
    if (indicator) {
      indicator.style.background = `linear-gradient(180deg, ${color}, ${color}dd)`;
    }
  }

  async testIpdataConnection() {
    const key = this.elements.ipdataKey?.value?.trim();
    if (!key) {
      this.showStatus('Please enter an API key first', 'error');
      return;
    }

    try {
      this.showLoading(true);
      this.showStatus('Testing connection...', 'info');
      
      const response = await chrome.runtime.sendMessage({
        type: 'TEST_IPDATA',
        key: key
      });

      if (response?.ok) {
        this.showStatus('Connection successful!', 'success');
      } else {
        this.showStatus(`Test failed: ${response?.error || 'Unknown error'}`, 'error');
      }
    } catch (error) {
      this.showStatus(`Test failed: ${error.message}`, 'error');
    } finally {
      this.showLoading(false);
    }
  }

  async saveAllChanges() {
    try {
      const settings = {
        cerebrasApiKey: this.elements.cerebrasKey?.value?.trim() || '',
        cerebrasModel: this.elements.cerebrasModel?.value || 'gpt-oss-120b',
        ocrApiKey: this.elements.ocrKey?.value?.trim() || '',
        ipdataApiKey: this.elements.ipdataKey?.value?.trim() || '',
        typingSpeed: this.elements.typingSpeed?.value || 'normal',
        ocrLang: this.elements.ocrLang?.value || 'eng',
        customWebSize: {
          width: parseInt(this.elements.webWidth?.value) || 1000,
          height: parseInt(this.elements.webHeight?.value) || 800
        },
        primaryColor: this.elements.primaryColor?.value || '#39ff14',
        showReasoning: this.elements.showReasoning?.checked || false,
        reasonLang: this.elements.reasonLang?.value?.trim() || ''
      };

      await chrome.storage.local.set(settings);
      
      // Update original values
      this.storeOriginalValues();
      this.hasUnsavedChanges = false;
      this.toggleSaveBar(false);
      
      this.showStatus('Settings saved successfully!', 'success');
      
    } catch (error) {
      console.error('Error saving settings:', error);
      this.showStatus(`Error saving settings: ${error.message}`, 'error');
    }
  }

  resetChanges() {
    // Restore original values
    Object.keys(this.originalValues).forEach(key => {
      const element = this.elements[key];
      if (!element) return;
      
      if (element.type === 'checkbox') {
        element.checked = this.originalValues[key];
      } else {
        element.value = this.originalValues[key];
      }
    });

    // Update theme
    this.updateThemeColor(this.originalValues.primaryColor);
    
    this.hasUnsavedChanges = false;
    this.toggleSaveBar(false);
    this.showStatus('Changes reverted', 'info');
  }

  // Prompt Management
  async loadPrompts() {
    try {
      const { customPrompts = [] } = await chrome.storage.sync.get('customPrompts');
      this.renderPromptTable(customPrompts);
    } catch (error) {
      console.error('Error loading prompts:', error);
    }
  }

  renderPromptTable(prompts) {
    if (!this.elements.promptTable) return;
    
    this.elements.promptTable.innerHTML = '';
    
    prompts.forEach(prompt => {
      const row = document.createElement('tr');
      const tags = Array.isArray(prompt.tags) ? prompt.tags.join(', ') : '';
      
      row.innerHTML = `
        <td>${prompt.name || ''}</td>
        <td>${tags}</td>
        <td>${prompt.hotkey || ''}</td>
        <td>
          <button class="btn btn-reset" data-edit="${prompt.id}" style="margin-right: 8px;">Edit</button>
          <button class="btn btn-reset" data-delete="${prompt.id}">Delete</button>
        </td>
      `;
      
      this.elements.promptTable.appendChild(row);
    });
    
    // Bind edit/delete events
    this.elements.promptTable.querySelectorAll('[data-edit]').forEach(btn => {
      btn.addEventListener('click', (e) => this.editPrompt(e.target.dataset.edit));
    });
    
    this.elements.promptTable.querySelectorAll('[data-delete]').forEach(btn => {
      btn.addEventListener('click', (e) => this.deletePrompt(e.target.dataset.delete));
    });
  }

  async editPrompt(id) {
    try {
      const { customPrompts = [] } = await chrome.storage.sync.get('customPrompts');
      const prompt = customPrompts.find(p => p.id === id);
      
      if (!prompt) return;
      
      this.elements.promptName.value = prompt.name || '';
      this.elements.promptTags.value = Array.isArray(prompt.tags) ? prompt.tags.join(', ') : '';
      this.elements.promptHotkey.value = prompt.hotkey || '';
      this.elements.promptText.value = prompt.text || '';
      
      this.editingPromptId = id;
    } catch (error) {
      console.error('Error editing prompt:', error);
    }
  }

  async deletePrompt(id) {
    if (!confirm('Are you sure you want to delete this prompt?')) return;
    
    try {
      const { customPrompts = [] } = await chrome.storage.sync.get('customPrompts');
      const updatedPrompts = customPrompts.filter(p => p.id !== id);
      
      await chrome.storage.sync.set({ customPrompts: updatedPrompts });
      await this.loadPrompts();
      
      this.showStatus('Prompt deleted successfully', 'success');
    } catch (error) {
      console.error('Error deleting prompt:', error);
      this.showStatus('Error deleting prompt', 'error');
    }
  }

  async savePrompt() {
    const name = this.elements.promptName?.value?.trim();
    const text = this.elements.promptText?.value?.trim();
    
    if (!name || !text) {
      this.showStatus('Name and prompt text are required', 'error');
      return;
    }
    
    try {
      const { customPrompts = [] } = await chrome.storage.sync.get('customPrompts');
      
      const tags = this.elements.promptTags?.value
        ?.split(',')
        ?.map(t => t.trim())
        ?.filter(Boolean) || [];
      
      const hotkey = this.elements.promptHotkey?.value?.trim() || '';
      
      if (this.editingPromptId) {
        // Update existing prompt
        const index = customPrompts.findIndex(p => p.id === this.editingPromptId);
        if (index >= 0) {
          customPrompts[index] = {
            ...customPrompts[index],
            name, text, tags, hotkey
          };
        }
      } else {
        // Add new prompt
        customPrompts.push({
          id: Date.now().toString(),
          name, text, tags, hotkey
        });
      }
      
      await chrome.storage.sync.set({ customPrompts });
      await this.loadPrompts();
      this.cancelPromptEdit();
      
      this.showStatus('Prompt saved successfully', 'success');
      
    } catch (error) {
      console.error('Error saving prompt:', error);
      this.showStatus('Error saving prompt', 'error');
    }
  }

  cancelPromptEdit() {
    this.elements.promptName.value = '';
    this.elements.promptTags.value = '';
    this.elements.promptHotkey.value = '';
    this.elements.promptText.value = '';
    this.editingPromptId = null;
  }

  // Site Management
  async loadSites() {
    try {
      let { customSites = [] } = await chrome.storage.local.get('customSites');
      
      if (!customSites.length) {
        customSites = [
          { name: 'Easemate Chat', url: 'https://www.easemate.ai/webapp/chat' },
          { name: 'Whoer', url: 'https://whoer.net/' },
          { name: 'AI Humanizer', url: 'https://bypassai.writecream.com/' },
          { name: 'Prinsh Notepad', url: 'https://notepad.prinsh.com/' }
        ];
        await chrome.storage.local.set({ customSites });
      }
      
      this.renderSites(customSites);
    } catch (error) {
      console.error('Error loading sites:', error);
    }
  }

  renderSites(sites) {
    if (!this.elements.sitesList) return;
    
    this.elements.sitesList.innerHTML = '';
    
    sites.forEach((site, index) => {
      const siteEl = document.createElement('div');
      siteEl.className = 'site-item';
      siteEl.style.cssText = `
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 12px;
        margin-bottom: 8px;
        background: rgba(0, 0, 0, 0.3);
        border: 1px solid rgba(139, 92, 246, 0.2);
        border-radius: 8px;
        transition: all 0.3s ease;
      `;
      
      siteEl.innerHTML = `
        <div>
          <div style="font-weight: 600; color: #e2e8f0;">${site.name}</div>
          <div style="font-size: 12px; color: #94a3b8; margin-top: 2px;">${site.url}</div>
        </div>
        <button class="btn btn-reset" data-delete-site="${index}">Delete</button>
      `;
      
      this.elements.sitesList.appendChild(siteEl);
    });
    
    // Bind delete events
    this.elements.sitesList.querySelectorAll('[data-delete-site]').forEach(btn => {
      btn.addEventListener('click', (e) => this.deleteSite(parseInt(e.target.dataset.deleteSite)));
    });
  }

  async addCustomSite() {
    const name = this.elements.siteName?.value?.trim();
    const url = this.elements.siteUrl?.value?.trim();
    
    if (!name || !url) {
      this.showStatus('Name and URL are required', 'error');
      return;
    }
    
    try {
      const { customSites = [] } = await chrome.storage.local.get('customSites');
      customSites.push({ name, url });
      
      await chrome.storage.local.set({ customSites });
      
      this.elements.siteName.value = '';
      this.elements.siteUrl.value = '';
      
      await this.loadSites();
      this.showStatus('Site added successfully', 'success');
      
    } catch (error) {
      console.error('Error adding site:', error);
      this.showStatus('Error adding site', 'error');
    }
  }

  async deleteSite(index) {
    try {
      const { customSites = [] } = await chrome.storage.local.get('customSites');
      customSites.splice(index, 1);
      
      await chrome.storage.local.set({ customSites });
      await this.loadSites();
      
      this.showStatus('Site deleted successfully', 'success');
    } catch (error) {
      console.error('Error deleting site:', error);
      this.showStatus('Error deleting site', 'error');
    }
  }

  addClickSounds() {
    try {
      const clickSound = new Audio(chrome.runtime.getURL('src/media/click.mp3'));
      clickSound.volume = 0.3;
      
      document.addEventListener('click', (e) => {
        if (e.target.matches('button, .nav-link, .toggle-slider')) {
          clickSound.currentTime = 0;
          clickSound.play().catch(() => {}); // Ignore audio errors
        }
      });
    } catch (error) {
      // Ignore if audio files don't exist
    }
  }

  // Utility methods
  showLoading(show) {
    if (!this.elements.loadingOverlay) return;
    this.elements.loadingOverlay.classList.toggle('visible', show);
  }

  showStatus(message, type = 'info') {
    if (!this.elements.statusMessage) return;
    
    this.elements.statusMessage.textContent = message;
    this.elements.statusMessage.className = `status-message ${type}`;
    this.elements.statusMessage.style.display = 'block';
    
    setTimeout(() => {
      this.elements.statusMessage.style.display = 'none';
    }, 3000);
  }

  handleKeyboard(e) {
    // ESC to close modal
    if (e.key === 'Escape') {
      this.closeModal();
    }
    
    // Ctrl+S to save
    if (e.ctrlKey && e.key === 's') {
      e.preventDefault();
      if (this.hasUnsavedChanges) {
        this.saveAllChanges();
      }
    }
  }

  closeModal() {
    if (this.hasUnsavedChanges) {
      if (!confirm('You have unsaved changes. Are you sure you want to close?')) {
        return;
      }
    }
    
    window.close();
  }
}

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  new ModernOptionsManager();
});

// Handle window resize for responsive indicator positioning
window.addEventListener('resize', () => {
  if (window.optionsManager) {
    window.optionsManager.updateNavIndicator();
  }
});

// Store instance globally for debugging
document.addEventListener('DOMContentLoaded', () => {
  window.optionsManager = new ModernOptionsManager();
});