class AICopilotPopup {
    constructor() {
        this.serverUrl = 'http://localhost:3000';
        this.currentTab = null;
        this.settings = {};
        this.currentPageContent = null; 
        this.chatHistory = []; 
        this.tabSummariesCache = new Map(); 
        this.init();
    }
    async init() {
        await this.loadSettings();
        await this.getCurrentTab();
        await this.restorePersistentState();
        this.setupEventListeners();
        this.updateUI();
        this.updateChatHint();
        
        // Check for last operation and show restore button if available
        await this.checkLastOperation();
        
        // Force display of history section after a short delay to ensure DOM is ready
        setTimeout(() => {
            this.displayPersistentHistory();
        }, 100);
    }
    async loadSettings() {
        return new Promise((resolve) => {
            chrome.storage.sync.get(['serverUrl', 'groqApiKey', 'aiModel', 'autoAnalyze', 'notifications'], (result) => {
                this.settings = {
                    serverUrl: result.serverUrl || 'http://localhost:3000',
                    groqApiKey: result.groqApiKey || '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',
                    aiModel: result.aiModel || 'llama-3.3-70b-versatile',
                    autoAnalyze: result.autoAnalyze || false,
                    notifications: result.notifications !== false
                };
                this.serverUrl = this.settings.serverUrl;
                resolve();
            });
        });
    }
    async getCurrentTab() {
        return new Promise((resolve) => {
            chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                if (tabs[0]) {
                    this.currentTab = tabs[0];
                    this.updateCurrentPageInfo();
                    try {
                        chrome.storage.local.set({
                            lastTabMeta: {
                                id: this.currentTab.id,
                                title: this.currentTab.title,
                                url: this.currentTab.url,
                                updatedAt: Date.now()
                            }
                        });
                    } catch {}
                }
                resolve();
            });
        });
    }
    setupEventListeners() {
        // Main action buttons with enhanced styling
        const analyzeBtn = document.getElementById('analyzeBtn');
        const keywordsBtn = document.getElementById('extractKeywordsBtn');
        const analyzeContentBtn = document.getElementById('analyzeContentBtn');
        const answerFormBtn = document.getElementById('answerFormBtn');
        
        analyzeBtn.classList.add('gradient-button', 'button-hover');
        if (keywordsBtn) keywordsBtn.classList.add('button-hover');
        if (analyzeContentBtn) analyzeContentBtn.classList.add('button-hover');
        
        analyzeBtn.addEventListener('click', () => this.analyzeCurrentPage('summarize'));
        if (keywordsBtn) keywordsBtn.addEventListener('click', () => this.analyzeCurrentPage('extract_keywords'));
        if (analyzeContentBtn) analyzeContentBtn.addEventListener('click', () => this.analyzeCurrentPage('analyze'));
        if (answerFormBtn) {
            answerFormBtn.addEventListener('click', () => this.answerCurrentForm());
        }
        
        // Tab management
        document.getElementById('analyzeTabsBtn').addEventListener('click', () => this.analyzeAllTabs());
        // Removed buttons are optional; guard their handlers
        const testTabsBtn = document.getElementById('testTabsBtn');
        const testBackgroundBtn = document.getElementById('testBackgroundBtn');
        const groupTabsBtn = document.getElementById('groupTabsBtn');
        if (testTabsBtn) testTabsBtn.addEventListener('click', () => this.testTabCount());
        if (testBackgroundBtn) testBackgroundBtn.addEventListener('click', () => this.testBackgroundScript());
        if (groupTabsBtn) groupTabsBtn.addEventListener('click', () => this.groupTabs());
        
        // Settings
        document.getElementById('settingsBtn').addEventListener('click', () => this.showSettings());
        document.getElementById('closeSettingsBtn').addEventListener('click', () => this.hideSettings());
        document.getElementById('saveSettingsBtn').addEventListener('click', () => this.saveSettings());
        document.getElementById('refreshBtn').addEventListener('click', () => this.refresh());
        
        // Restore button
        const restoreBtn = document.getElementById('restoreBtn');
        if (restoreBtn) {
            restoreBtn.addEventListener('click', () => this.restoreLastOperation());
        }
        
        // Settings inputs
        document.getElementById('serverUrl').value = this.settings.serverUrl;
        document.getElementById('groqApiKey').value = this.settings.groqApiKey;
        document.getElementById('aiModel').value = this.settings.aiModel;
        document.getElementById('autoAnalyze').checked = this.settings.autoAnalyze;
        document.getElementById('notifications').checked = this.settings.notifications;
        
        // Chat functionality
        const chatInput = document.getElementById('chatInput');
        const sendChatBtn = document.getElementById('sendChatBtn');
        const clearChatBtn = document.getElementById('clearChatBtn');
        
        if (chatInput && sendChatBtn) {
            sendChatBtn.addEventListener('click', () => this.sendChatMessage());
            chatInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    this.sendChatMessage();
                }
            });
        }
        
        if (clearChatBtn) {
            clearChatBtn.addEventListener('click', () => this.clearChatHistory());
        }

        // Research Assistant functionality
        const researchInput = document.getElementById('researchInput');
        const researchBtn = document.getElementById('researchBtn');
        const clearResearchBtn = document.getElementById('clearResearchBtn');
        const clearResultsBtn = document.getElementById('clearResultsBtn');
        
        if (researchBtn) {
            researchBtn.addEventListener('click', () => this.startResearch());
        }
        
        if (researchInput) {
            researchInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    this.startResearch();
                }
            });
        }
        
        if (clearResearchBtn) {
            clearResearchBtn.addEventListener('click', () => this.clearResearchResults());
        }
        if (clearResultsBtn) {
            clearResultsBtn.addEventListener('click', () => this.clearAnalysisResults());
        }
        
        // Load persistent research results on popup open
        this.loadPersistentResearchResults();
        // Load persisted chat history and analysis
        this.renderPersistedChatHistory();
        this.renderPersistedAnalysis();
        
        // Add test function to window for debugging
        window.testPersistence = this.testPersistence.bind(this);
        window.testSaveActivity = this.testSaveActivity.bind(this);
        window.checkStorage = this.checkStorage.bind(this);
    }

    async restorePersistentState() {
        try {
            console.log('Restoring persistent state...');
            
            // First test if background script is responding
            const pingResponse = await new Promise((resolve) => {
                chrome.runtime.sendMessage({ action: 'ping' }, (response) => {
                    if (chrome.runtime.lastError) {
                        console.error('Background script not responding:', chrome.runtime.lastError);
                        resolve(false);
                    } else {
                        console.log('Background script ping response:', response);
                        resolve(true);
                    }
                });
            });

            if (!pingResponse) {
                console.error('Background script not responding, using fallback storage');
                // Fallback to direct storage access
                const fallbackData = await new Promise((resolve) => {
                    chrome.storage.local.get([
                        'userHistory', 
                        'tabAnalysisHistory', 
                        'promptHistory', 
                        'taskSummaries',
                        'chatHistory',
                        'currentPageContent',
                        'lastAnalysis',
                        'lastMultiTabAnalysis'
                    ], (result) => {
                        console.log('Fallback storage data:', result);
                        resolve(result);
                    });
                });
                
                this.persistentData = {
                    userHistory: fallbackData.userHistory || [],
                    tabAnalysisHistory: fallbackData.tabAnalysisHistory || [],
                    promptHistory: fallbackData.promptHistory || [],
                    taskSummaries: fallbackData.taskSummaries || []
                };
                
                if (Array.isArray(fallbackData.chatHistory)) {
                    this.chatHistory = fallbackData.chatHistory;
                }
                if (fallbackData.currentPageContent) {
                    this.currentPageContent = fallbackData.currentPageContent;
                }
                this._persistedLastAnalysis = fallbackData.lastAnalysis || null;
                this._persistedLastMulti = fallbackData.lastMultiTabAnalysis || null;
                
                console.log('Using fallback data:', this.persistentData);
                this.displayPersistentHistory();
                return;
            }
            
            // Get comprehensive persistent data from background script
            const persistentData = await new Promise((resolve) => {
                chrome.runtime.sendMessage({ action: 'getPersistentData' }, (response) => {
                    if (chrome.runtime.lastError) {
                        console.error('Error getting persistent data:', chrome.runtime.lastError);
                        resolve({});
                    } else {
                        console.log('Received persistent data:', response);
                        resolve(response.data || {});
                    }
                });
            });

            console.log('Persistent data received:', persistentData);

            // Restore basic state
            if (Array.isArray(persistentData.chatHistory)) {
                this.chatHistory = persistentData.chatHistory;
                console.log('Restored chat history:', this.chatHistory.length, 'messages');
            }
            if (persistentData.currentPageContent) {
                this.currentPageContent = persistentData.currentPageContent;
                console.log('Restored current page content');
            }
            if (persistentData.lastTabMeta && persistentData.lastTabMeta.url) {
                // no-op now; UI updates via updateUI()
            }
            this._persistedLastAnalysis = persistentData.lastAnalysis || null;
            this._persistedLastMulti = persistentData.lastMultiTabAnalysis || null;

            // Store persistent data for UI display
            this.persistentData = {
                userHistory: persistentData.userHistory || [],
                tabAnalysisHistory: persistentData.tabAnalysisHistory || [],
                promptHistory: persistentData.promptHistory || [],
                taskSummaries: persistentData.taskSummaries || []
            };

            console.log('Stored persistent data:', this.persistentData);

            // Display persistent data in UI
            this.displayPersistentHistory();
        } catch (e) {
            console.error('Failed to restore persistent state', e);
        }
    }

    async answerCurrentForm() {
        if (!this.currentTab) {
            this.showError('No active tab found');
            return;
        }
        if (!this.currentTab.url.startsWith('http://') && !this.currentTab.url.startsWith('https://')) {
            this.showError('Open a valid webpage with a form');
            return;
        }

        this.showLoading('Scanning form and generating answers with Groq...');

        try {
            // Ensure content script and collect form schema
            const forms = await new Promise((resolve) => {
                chrome.scripting.executeScript({ target: { tabId: this.currentTab.id }, files: ['content.js'] }, () => {
                    if (chrome.runtime.lastError) {
                        resolve({ success: false, error: chrome.runtime.lastError.message });
                        return;
                    }
                    setTimeout(() => {
                        chrome.tabs.sendMessage(this.currentTab.id, { action: 'collectForm' }, (response) => {
                            if (chrome.runtime.lastError) {
                                resolve({ success: false, error: chrome.runtime.lastError.message });
                            } else {
                                resolve(response);
                            }
                        });
                    }, 100);
                });
            });

            if (!forms || !forms.success || !forms.forms || forms.forms.length === 0) {
                this.hideLoading();
                this.showError('No form detected on this page');
                return;
            }

            // Check if Groq API key is available
            if (!this.settings.groqApiKey) {
                this.hideLoading();
                this.showError('Groq API key is not configured. Please add it in the extension settings.');
                return;
            }

            // Build a compact description of questions for the model
            const questions = [];
            forms.forms.forEach((form, formIdx) => {
                (form.fields || []).forEach((f, idx) => {
                    const base = `Q${formIdx + 1}.${idx + 1}: ${f.question || '(no text)'} (type=${f.type}${f.options && f.options.length ? `, options=${f.options.join(' | ').slice(0, 500)}` : ''})`;
                    questions.push(base);
                });
            });

            const sys = 'You generate JSON answers for form questions accurately and concisely. Only output strict JSON. For single_choice, return index of best option. For multi_choice, return array of indices. For text, return a short text string. Do not invent information beyond common-sense defaults if unspecified.';

            const user = `We have a webpage form to answer.
Page: ${forms.title || ''} ${forms.url || ''}
Questions:
${questions.join('\n')}

Return JSON with this exact shape:
{
  "answers": {
    "<fieldId>": { "kind": "text|single_choice|multi_choice", "value": "string (for text)", "index": number (for single_choice), "indices": number[] (for multi_choice) }
  }
}

Field IDs you must use are provided separately below. Only return the JSON, no commentary.

Field IDs in order matching the questions above:
${forms.forms.map((form) => (form.fields || []).map(f => f.id).join(',')).filter(Boolean).join(',')}`;

            const messages = [
                { role: 'system', content: sys },
                { role: 'user', content: user }
            ];
            const GROQ_API_BASE_URL = 'https://api.groq.com/openai/v1';
            const GROQ_MODEL = this.settings.aiModel || 'llama-3.3-70b-versatile';
            const response = await fetch(`${GROQ_API_BASE_URL}/chat/completions`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.settings.groqApiKey}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    model: GROQ_MODEL,
                    messages: messages,
                    max_tokens: 600,
                    temperature: 0.4,
                    top_p: 0.9,
                    stream: false
                })
            });
            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(`Groq API error: ${errorData.error?.message || response.statusText}`);
            }
            const responseData = await response.json();
            const raw = responseData.choices[0].message.content;
            // Try to parse JSON from the model output with improved handling
            let parsed;
            try {
                // More robust JSON extraction - handle various formats the model might return
                let jsonText = raw.trim();
                // Remove markdown code blocks if present
                jsonText = jsonText.replace(/^```(?:json)?\s*|\s*```$/g, '');
                // If the response contains explanatory text, try to extract just the JSON part
                const jsonMatch = jsonText.match(/(\{[\s\S]*\})/);
                if (jsonMatch) {
                    jsonText = jsonMatch[0];
                }
                // Try to parse the extracted JSON
                parsed = JSON.parse(jsonText);
                // If no answers object exists but we have a valid JSON, create a basic structure
                if (!parsed.answers && typeof parsed === 'object') {
                    parsed = { answers: parsed };
                }
            } catch (e) {
                console.error('JSON parsing error:', e, 'Raw response:', raw);
                this.hideLoading();
                this.showError('Error parsing Groq response. Retrying with fallback parser...');
                // Fallback parsing attempt
                try {
                    // Try to extract anything that looks like JSON
                    const jsonRegex = /\{(?:[^{}]|(?:\{(?:[^{}]|(?:\{[^{}]*\}))*\}))*\}/g;
                    const matches = raw.match(jsonRegex);    
                    if (matches && matches.length > 0) {
                        // Try each match until we find valid JSON
                        for (const match of matches) {
                            try {
                                const candidate = JSON.parse(match);
                                if (candidate && typeof candidate === 'object') {
                                    parsed = candidate;
                                    // If no answers object exists but we have a valid JSON, create a basic structure
                                    if (!parsed.answers && typeof parsed === 'object') {
                                        parsed = { answers: parsed };
                                    }
                                    break;
                                }
                            } catch (innerError) {
                                // Continue to next match
                            }
                        }
                    }
                    if (!parsed) {
                        throw new Error('No valid JSON found in response');
                    }
                } catch (fallbackError) {
                    this.hideLoading();
                    this.showError('Could not parse response from Groq. Please try again.');
                    return;
                }
            }
            // Minimal validation
            if (!parsed || typeof parsed !== 'object' || !parsed.answers) {
                this.hideLoading();
                this.showError('Malformed JSON answers from Groq API. Please try again.');
                return;
            }
            await this.applyAnswersToPage(parsed.answers, forms);
        } catch (e) {
            this.hideLoading();
            this.showError('Form answering failed: ' + e.message);
        }
    }
    generateLocalFormAnswers(forms) {
        const answers = {};
        const normalize = (s) => (s || '').toString().trim().toLowerCase();
        const containsAny = (s, arr) => arr.some(k => s.includes(k));
        const emailValue = 'test@example.com';
        const phoneValue = '000-000-0000';
        const urlValue = 'https://example.com';
        const nameValue = 'Anonymous';
        const companyValue = 'N/A';
        const addressValue = 'N/A';
        const cityValue = 'N/A';
        const countryValue = 'N/A';
        const today = new Date();
        const isoDate = today.toISOString().slice(0,10);
        const timeValue = '12:00';
        const scoreOption = (q, option) => {
            const qs = normalize(q);
            const os = normalize(option);
            let score = 0;
            // Yes/No
            if (containsAny(qs, ['yes or no','do you','is it','are you','have you','would you'])) {
                if (os.includes('yes') || os.includes('true') || os.includes('agree')) score += 3;
                if (os.includes('no') || os.includes('false') || os.includes('disagree')) score += 2; // fallback
            }
            // None/Not applicable
            if (containsAny(qs, ['none','not applicable','n/a','no preference'])) {
                if (containsAny(os, ['none','n/a','not applicable','no preference'])) score += 4;
            }
            // Typical Likert mapping
            const likertMap = [
                { q: ['strongly agree','agree'], o: ['strongly agree','agree'], w: 3 },
                { q: ['strongly disagree','disagree'], o: ['strongly disagree','disagree'], w: 3 },
                { q: ['neutral'], o: ['neutral','neither'], w: 2 }
            ];
            likertMap.forEach(m => { if (containsAny(qs, m.q) && containsAny(os, m.o)) score += m.w; });
            // Keyword overlap
            const qTokens = qs.split(/[^a-z0-9]+/).filter(Boolean);
            const oTokens = os.split(/[^a-z0-9]+/).filter(Boolean);
            const overlap = oTokens.filter(t => qTokens.includes(t)).length;
            score += overlap * 0.5;
            return score;
        };

        (forms || []).forEach((form) => {
            (form.fields || []).forEach((f) => {
                const q = normalize(f.question);
                if (f.type === 'single_choice') {
                    let bestIdx = -1;
                    let bestScore = -1;
                    if (Array.isArray(f.options) && f.options.length) {
                        f.options.forEach((opt, i) => {
                            const s = scoreOption(q, opt || '');
                            if (s > bestScore) { bestScore = s; bestIdx = i; }
                        });
                        if (bestIdx === -1) bestIdx = 0;
                        answers[f.id] = { kind: 'single_choice', index: bestIdx };
                    }
                } else if (f.type === 'multi_choice') {
                    const indices = [];
                    if (Array.isArray(f.options)) {
                        f.options.forEach((opt, i) => {
                            const s = scoreOption(q, opt || '');
                            if (s >= 2) indices.push(i);
                        });
                        if (indices.length === 0 && f.options.length > 0) indices.push(0);
                    }
                    answers[f.id] = { kind: 'multi_choice', indices };
                } else {
                    // text with richer patterns
                    let val = 'N/A';
                    if (containsAny(q, ['email','e-mail'])) val = emailValue;
                    else if (containsAny(q, ['phone','mobile','contact number'])) val = phoneValue;
                    else if (containsAny(q, ['name','full name','your name'])) val = nameValue;
                    else if (containsAny(q, ['company','organization','employer'])) val = companyValue;
                    else if (containsAny(q, ['address','street'])) val = addressValue;
                    else if (containsAny(q, ['city'])) val = cityValue;
                    else if (containsAny(q, ['country','nation'])) val = countryValue;
                    else if (containsAny(q, ['date','yyyy','mm/dd','dd/mm'])) val = isoDate;
                    else if (containsAny(q, ['time','hh:mm'])) val = timeValue;
                    else if (containsAny(q, ['url','website','link'])) val = urlValue;
                    else if (containsAny(q, ['why','reason','explain','describe','feedback','comment'])) val = 'No comments.';
                    answers[f.id] = { kind: 'text', value: val };
                }
            });
        });
        return answers;
    }

    async applyAnswersToPage(rawAnswers, forms) {
        // Augment answers with selectors from detected fields
        const idToField = new Map();
        (forms.forms || []).forEach(f => (f.fields || []).forEach(field => { idToField.set(field.id, field); }));
        const augmentedAnswers = {};
        Object.entries(rawAnswers || {}).forEach(([id, ans]) => {
            const field = idToField.get(id);
            if (field) {
                augmentedAnswers[id] = Object.assign({}, ans, {
                    selector: field.selector || null,
                    containerSelector: field.selector || null,
                    kind: ans.kind || (field.type === 'text' ? 'text' : field.type === 'single_choice' ? 'single_choice' : field.type === 'multi_choice' ? 'multi_choice' : 'text')
                });
            } else {
                augmentedAnswers[id] = ans;
            }
        });
        const apply = await new Promise((resolve) => {
            chrome.tabs.sendMessage(this.currentTab.id, { action: 'applyFormAnswers', payload: { answers: augmentedAnswers } }, (response) => {
                resolve(response);
            });
        });

        this.hideLoading();
        if (apply && apply.success) {
            this.showSuccess('Form filled. Review and submit.');
            
            // Save form filling as user activity
            this.saveUserActivity({
                action: 'fillForm',
                description: `Filled form on: ${this.currentTab?.title || 'Unknown'}`,
                result: 'Form filled successfully',
                data: {
                    url: this.currentTab?.url,
                    fieldsCount: Object.keys(answers).length
                }
            });
        } else {
            this.showError(apply?.error || 'Failed to apply answers');
        }
    }

    updateUI() {
        this.updateCurrentPageInfo();
    }

    updateCurrentPageInfo() {
        if (this.currentTab) {
            document.getElementById('currentUrl').textContent = this.currentTab.url;
            
            // Check if it's a Chrome internal page
            if (this.currentTab.url.startsWith('chrome://') || 
                this.currentTab.url.startsWith('chrome-extension://') ||
                this.currentTab.url.startsWith('moz-extension://') ||
                this.currentTab.url.startsWith('edge://') ||
                this.currentTab.url.startsWith('about:')) {
                document.getElementById('pageStatus').textContent = 'Chrome internal page - cannot analyze';
                const statusDot = document.querySelector('#currentPageInfo .w-2\\.5');
                if (statusDot) {
                    statusDot.className = 'w-2.5 h-2.5 bg-yellow-500 rounded-full status-dot';
                }
            } else if (!this.currentTab.url.startsWith('http://') && !this.currentTab.url.startsWith('https://')) {
                document.getElementById('pageStatus').textContent = 'Invalid page - navigate to a website';
                const statusDot = document.querySelector('#currentPageInfo .w-2\\.5');
                if (statusDot) {
                    statusDot.className = 'w-2.5 h-2.5 bg-red-500 rounded-full status-dot';
                }
            } else {
                document.getElementById('pageStatus').textContent = 'Ready to analyze';
                const statusDot = document.querySelector('#currentPageInfo .w-2\\.5');
                if (statusDot) {
                    statusDot.className = 'w-2.5 h-2.5 bg-emerald-500 rounded-full status-dot';
                }
            }
        }
    }

    async analyzeCurrentPage(type = 'summarize') {
        if (!this.currentTab) {
            this.showError('No active tab found');
            return;
        }

        // Check if the current tab is a Chrome internal page
        if (this.currentTab.url.startsWith('chrome://') || 
            this.currentTab.url.startsWith('chrome-extension://') ||
            this.currentTab.url.startsWith('moz-extension://') ||
            this.currentTab.url.startsWith('edge://') ||
            this.currentTab.url.startsWith('about:')) {
            this.showError('Cannot analyze Chrome internal pages. Please navigate to a regular website first.');
            return;
        }

        // Check if the URL is valid for analysis
        if (!this.currentTab.url.startsWith('http://') && !this.currentTab.url.startsWith('https://')) {
            this.showError('Please navigate to a valid website (http:// or https://) to analyze content.');
            return;
        }

        this.showLoading(`Analyzing page (${type})...`);

        // Add timeout to prevent infinite loading
        const timeoutId = setTimeout(() => {
            this.hideLoading();
            this.showError('Analysis timed out. Please try again.');
        }, 30000); // 30 second timeout

        try {
            // Extract content from current tab
            const content = await this.extractPageContent();
            
            if (!content || !content.success) {
                this.hideLoading();
                this.showError('Failed to extract page content: ' + (content?.error || 'Unknown error'));
                return;
            }

            // Store page content for chat functionality
            this.currentPageContent = content.content;
            try { chrome.storage.local.set({ currentPageContent: this.currentPageContent }); } catch {}
            
            // Update chat hint to show page is ready
            this.updateChatHint();

            // Send to server for analysis
            const response = await fetch(`${this.serverUrl}/analyze`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    text: content.content,
                    type: type,
                    apiKey: this.settings.groqApiKey
                })
            });

            const result = await response.json();
            
            clearTimeout(timeoutId);
            
            if (result.success) {
                this.displayResults(result, type);
                this.hideLoading();
            } else {
                this.hideLoading();
                // Handle specific error types
                const errorMessage = result.error || 'Unknown error';
                if (errorMessage.includes('Content appears to be mostly images')) {
                    this.showError('This page appears to be image-based. Please try analyzing a text-based webpage instead.');
                } else if (errorMessage.includes('Text content is too short')) {
                    this.showError('The page content is too short to analyze. Please try a webpage with more text content.');
                } else if (errorMessage.includes('No text was provided')) {
                    this.showError('No text content was found. Please try analyzing a different webpage.');
                } else if (errorMessage.includes('No meaningful content found')) {
                    this.showError('No meaningful content found in the analyzed tabs. Please try analyzing different webpages with more text content.');
                } else if (errorMessage.includes('inappropriate response')) {
                    this.showError('The AI generated an inappropriate response. Please try analyzing the page content first, or ask a more specific question about the actual content.');
                } else {
                    this.showError('Analysis failed: ' + errorMessage);
                }
            }

        } catch (error) {
            clearTimeout(timeoutId);
            console.error('Error analyzing page:', error);
            this.hideLoading();
            this.showError('Failed to analyze page: ' + error.message);
        }
    }

    async extractPageContent() {
        return new Promise((resolve) => {
            // First, ensure content script is injected
            chrome.scripting.executeScript({
                target: { tabId: this.currentTab.id },
                files: ['content.js']
            }, () => {
                if (chrome.runtime.lastError) {
                    resolve({ success: false, error: 'Failed to inject content script: ' + chrome.runtime.lastError.message });
                    return;
                }
                
                // Wait a moment for the script to load, then send message
                setTimeout(() => {
                    chrome.tabs.sendMessage(this.currentTab.id, { action: 'extractContent' }, (response) => {
                        if (chrome.runtime.lastError) {
                            // Fallback: try to extract content directly
                            this.extractContentDirectly().then(resolve);
                        } else {
                            resolve(response);
                        }
                    });
                }, 100);
            });
        });
    }

    async extractContentDirectly() {
        try {
            // Fallback method using chrome.scripting.executeScript
            const results = await chrome.scripting.executeScript({
                target: { tabId: this.currentTab.id },
                func: () => {
                    // Remove script and style elements
                    const scripts = document.querySelectorAll('script, style, noscript');
                    scripts.forEach(el => el.remove());

                    // Get the main content
                    const contentSelectors = [
                        'main', 'article', '[role="main"]', '.content', 
                        '.post-content', '.entry-content', '.article-content', 
                        '#content', '.main-content'
                    ];

                    let mainContent = '';
                    for (const selector of contentSelectors) {
                        const element = document.querySelector(selector);
                        if (element && element.textContent.trim().length > 100) {
                            mainContent = element.textContent.trim();
                            break;
                        }
                    }

                    if (!mainContent) {
                        mainContent = document.body.textContent.trim();
                    }

                    const cleanedText = mainContent
                        .replace(/\s+/g, ' ')
                        .replace(/\n\s*\n/g, '\n')
                        .trim();

                    return {
                        title: document.title,
                        url: window.location.href,
                        content: cleanedText,
                        wordCount: cleanedText.split(/\s+/).length,
                        extractedAt: new Date().toISOString(),
                        success: true
                    };
                }
            });

            return results[0].result;
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    async testTabCount() {
        console.log('Testing tab count...');
        this.showLoading('Testing tab count...');

        try {
            chrome.tabs.query({}, (tabs) => {
                console.log(`Found ${tabs.length} tabs`);
                this.hideLoading();
                this.showSuccess(`Found ${tabs.length} tabs: ${tabs.map(t => t.title).join(', ')}`);
            });
        } catch (error) {
            console.error('Error testing tabs:', error);
            this.showError('Failed to test tabs: ' + error.message);
            this.hideLoading();
        }
    }

    async testBackgroundScript() {
        console.log('Testing background script communication...');
        this.showLoading('Testing background script...');

        try {
            chrome.runtime.sendMessage({ 
                action: 'ping' 
            }, (response) => {
                console.log('Ping response:', response);
                this.hideLoading();
                
                if (chrome.runtime.lastError) {
                    this.showError('Background script error: ' + chrome.runtime.lastError.message);
                } else if (response && response.success) {
                    this.showSuccess('Background script is responding: ' + response.message);
                } else {
                    this.showError('Background script not responding properly');
                }
            });
        } catch (error) {
            console.error('Error testing background script:', error);
            this.showError('Failed to test background script: ' + error.message);
            this.hideLoading();
        }
    }

    async analyzeAllTabs() {
        console.log('Starting analyzeAllTabs...');
        this.showLoading('Extracting content from all tabs... This may take a moment for multiple tabs.');

        // Set up listener for updates from background script
        const updateListener = (message, sender, sendResponse) => {
            if (message.action === 'updateAnalysis') {
                console.log('Received analysis update:', message.analysis);
                this.displayTabAnalysis(message.analysis);
                this.hideLoading();
                chrome.runtime.onMessage.removeListener(updateListener);
            }
        };
        
        chrome.runtime.onMessage.addListener(updateListener);

        // Add timeout to prevent hanging (longer for multi-tab analysis)
        const timeoutId = setTimeout(() => {
            console.error('Timeout waiting for background script response');
            this.showError('Multi-tab analysis timed out. This may be due to many tabs or slow content extraction. Try analyzing fewer tabs or check your internet connection.');
            this.hideLoading();
            chrome.runtime.onMessage.removeListener(updateListener);
        }, 90000); // 90 second timeout for multi-tab analysis

        try {
            console.log('Sending message to background script...');
            chrome.runtime.sendMessage({ 
                action: 'analyzeTabs',
                serverUrl: this.serverUrl 
            }, (response) => {
                console.log('Immediate response from background script:', response);
                
                if (chrome.runtime.lastError) {
                    console.error('Chrome runtime error:', chrome.runtime.lastError);
                    this.showError('Extension error: ' + chrome.runtime.lastError.message);
                    this.hideLoading();
                    chrome.runtime.onMessage.removeListener(updateListener);
                    clearTimeout(timeoutId);
                    return;
                }
                
                if (response && response.success) {
                    console.log('Initial analysis data:', response.analysis);
                    // Display initial response (shows "Processing tabs...")
                    this.displayTabAnalysis(response.analysis);
                    // Don't hide loading yet - wait for update
                } else {
                    const errorMsg = response?.error || 'Unknown error occurred';
                    console.error('Analysis failed:', errorMsg);
                    this.showError('Failed to analyze tabs: ' + errorMsg);
                    this.hideLoading();
                    chrome.runtime.onMessage.removeListener(updateListener);
                    clearTimeout(timeoutId);
                }
            });
        } catch (error) {
            clearTimeout(timeoutId);
            console.error('Error analyzing tabs:', error);
            this.showError('Failed to analyze tabs: ' + error.message);
            this.hideLoading();
            chrome.runtime.onMessage.removeListener(updateListener);
        }
    }

    async groupTabs() {
        this.showLoading('Grouping tabs...');

        try {
            chrome.runtime.sendMessage({ 
                action: 'analyzeTabs',
                serverUrl: this.serverUrl 
            }, (response) => {
                if (response.success) {
                    this.performTabGrouping(response.analysis);
                } else {
                    this.showError('Failed to group tabs: ' + response.error);
                }
                this.hideLoading();
            });
        } catch (error) {
            console.error('Error grouping tabs:', error);
            this.showError('Failed to group tabs: ' + error.message);
            this.hideLoading();
        }
    }

    performTabGrouping(analysis) {
        const tabGroups = [];
        let groupIndex = 0;

        Object.entries(analysis.groupedTabs).forEach(([domain, tabs]) => {
            if (tabs.length > 1) {
                tabGroups.push({
                    title: domain,
                    tabIds: tabs.map(tab => tab.id),
                    color: this.getGroupColor(groupIndex)
                });
                groupIndex++;
            }
        });

        if (tabGroups.length > 0) {
            chrome.runtime.sendMessage({ 
                action: 'groupTabs',
                tabGroups: tabGroups 
            }, (response) => {
                if (response.success) {
                    this.showSuccess(`Grouped ${tabGroups.length} tab groups`);
                } else {
                    this.showError('Failed to create tab groups');
                }
            });
        } else {
            this.showInfo('No similar tabs found to group');
        }
    }

    getGroupColor(index) {
        const colors = ['blue', 'red', 'yellow', 'green', 'purple', 'pink', 'cyan', 'orange'];
        return colors[index % colors.length];
    }

    displayResults(result, type) {
        const resultsSection = document.getElementById('resultsSection');
        const resultsContent = document.getElementById('resultsContent');
        
        let title = 'Summary';
        if (type === 'extract_keywords') title = 'Keywords';
        if (type === 'analyze') title = 'Analysis';

        resultsContent.innerHTML = `
            <div class="fade-in">
                <div class="flex items-center justify-between mb-4">
                    <h4 class="text-lg font-semibold gradient-text">${title}</h4>
                    <span class="text-xs text-gray-500 bg-gray-100 px-2 py-1 rounded-full">${result.originalLength} chars</span>
                </div>
                <div class="prose prose-sm max-w-none">
                    <p class="text-gray-700 leading-relaxed whitespace-pre-wrap bg-white/50 p-4 rounded-xl backdrop-blur-sm">${result.summary}</p>
                </div>
                <div class="mt-4 pt-4 border-t border-gray-200">
                    <div class="flex items-center justify-between text-xs text-gray-500">
                        <span>Analyzed at ${new Date(result.timestamp).toLocaleTimeString()}</span>
                        <button id="copyResultBtn" class="text-blue-600 hover:text-blue-800 button-hover px-2 py-1 rounded-lg hover:bg-blue-50 transition-all duration-200">Copy</button>
                    </div>
                </div>
            </div>
        `;

        // Add copy functionality
        const copyBtn = document.getElementById('copyResultBtn');
        if (copyBtn) {
            copyBtn.addEventListener('click', () => {
                navigator.clipboard.writeText(result.summary).then(() => {
                    this.showSuccess('Copied to clipboard');
                });
            });
        }

        resultsSection.classList.remove('hidden');
        resultsSection.scrollIntoView({ behavior: 'smooth' });

        // persist single-page analysis
        this.saveAnalysisPersistence({ result, type, timestamp: Date.now() });
        
        // Also save to user history for activity tracking
        this.saveUserActivity({
            action: 'analyzePage',
            description: `Analyzed page: ${this.currentTab?.title || 'Unknown'}`,
            result: result.summary,
            data: {
                type: type,
                originalLength: result.originalLength,
                url: this.currentTab?.url
            }
        });

        // Save as last operation for restore functionality
        this.saveLastOperation({
            type: 'pageAnalysis',
            description: `Page Analysis: ${this.currentTab?.title || 'Unknown'}`,
            data: {
                result: result,
                type: type,
                content: this.currentPageContent
            }
        });
    }

    displayTabAnalysis(analysis) {
        console.log('Displaying tab analysis:', analysis);
        
        const resultsSection = document.getElementById('resultsSection');
        const resultsContent = document.getElementById('resultsContent');
        
        // Store multi-tab analysis data for chat functionality
        this.multiTabAnalysis = analysis;
        this.multiTabAvailable = true;
        
        // Update chat hint to show multi-tab analysis is available
        this.updateChatHint();
        
        // Debug logging
        if (analysis.tabSummaries) {
            const successfulTabs = analysis.tabSummaries.filter(t => !t.fallback && !t.error).length;
            const fallbackTabs = analysis.tabSummaries.filter(t => t.fallback || t.error).length;
            console.log(`Analysis complete: ${successfulTabs} successful, ${fallbackTabs} fallback/error tabs`);
            analysis.tabSummaries.forEach((tab, index) => {
                const status = tab.fallback ? 'fallback' : tab.error ? 'error' : 'success';
                console.log(`Tab ${index + 1}: ${tab.title} (${status})`);
            });
        }
        
        // Overall summary section
        let overallSummaryHtml = '';
        if (analysis.overallSummary) {
            overallSummaryHtml = `
                <div class="mb-6">
                    <h4 class="text-lg font-semibold gradient-text mb-3">Overall Browsing Summary</h4>
                    <div class="bg-gradient-to-r from-blue-50 to-purple-50 rounded-xl p-4 border border-blue-100">
                        <p class="text-gray-700 leading-relaxed whitespace-pre-wrap">${analysis.overallSummary}</p>
                    </div>
                </div>
            `;
        }

        // Individual tab summaries
        let tabSummariesHtml = '';
        if (analysis.tabSummaries && analysis.tabSummaries.length > 0) {
            tabSummariesHtml = `
                <div class="mb-6">
                    <h4 class="text-lg font-semibold text-gray-800 mb-3">Tab Summaries</h4>
                    <div class="space-y-4">
                        ${analysis.tabSummaries.map((tabSummary, index) => `
                            <div class="bg-white/80 backdrop-blur-sm rounded-xl p-4 border border-gray-100 shadow-sm">
                                <div class="flex items-start justify-between mb-2">
                                    <h5 class="font-medium text-gray-800 text-sm truncate flex-1 mr-2">${tabSummary.title}</h5>
                                    <span class="text-xs text-gray-500 bg-gray-100 px-2 py-1 rounded-full whitespace-nowrap">${tabSummary.wordCount || 0} words</span>
                                </div>
                                <div class="text-xs text-gray-500 mb-2 truncate">${tabSummary.url}</div>
                                <div class="text-sm text-gray-700 leading-relaxed ${tabSummary.error ? 'text-red-600 italic' : ''}">
                                    ${tabSummary.summary}
                                </div>
                            </div>
                        `).join('')}
                    </div>
                </div>
            `;
        }

        // Duplicates section
        let duplicatesHtml = '';
        if (analysis.duplicates && analysis.duplicates.length > 0) {
            duplicatesHtml = `
                <div class="mb-4">
                    <h5 class="font-medium text-gray-800 mb-2">Potential Duplicates</h5>
                    <div class="space-y-2">
                        ${analysis.duplicates.map((dup, idx) => `
                            <div class="bg-yellow-50 border border-yellow-200 rounded-lg p-3">
                                <div class="flex items-center justify-between">
                                    <span class="font-medium text-yellow-800">${dup.domain}</span>
                                    <span class="text-sm text-yellow-600">${dup.count} tabs</span>
                                </div>
                                <div class="mt-1">
                                    <button class="text-xs bg-yellow-200 text-yellow-800 px-2 py-1 rounded hover:bg-yellow-300 close-dup-btn" data-dup-index="${idx}">
                                        Close Duplicates
                                    </button>
                                </div>
                            </div>
                        `).join('')}
                    </div>
                </div>
            `;
        }

        // Statistics section
        const statsHtml = `
                <div class="mb-4">
                <div class="grid grid-cols-3 gap-3 text-sm">
                        <div class="bg-blue-50 rounded-lg p-3">
                            <div class="font-medium text-blue-800">Total Tabs</div>
                        <div class="text-xl font-bold text-blue-600">${analysis.totalTabs || 0}</div>
                        </div>
                        <div class="bg-green-50 rounded-lg p-3">
                        <div class="font-medium text-green-800">Analyzed</div>
                        <div class="text-xl font-bold text-green-600">${analysis.analyzedTabs || 0}</div>
                        </div>
                    <div class="bg-purple-50 rounded-lg p-3">
                        <div class="font-medium text-purple-800">Domains</div>
                        <div class="text-xl font-bold text-purple-600">${Object.keys(analysis.groupedTabs || {}).length}</div>
                    </div>
                </div>
            </div>
        `;

        resultsContent.innerHTML = `
            <div class="fade-in">
                <div class="flex items-center justify-between mb-4">
                    <h3 class="text-lg font-semibold text-gray-800">Multi-Tab Analysis</h3>
                    <span class="text-xs text-gray-500">${analysis.analyzedTabs || 0}/${analysis.totalTabs} analyzed</span>
                </div>
                
                ${overallSummaryHtml}
                ${tabSummariesHtml}
                ${statsHtml}
                ${duplicatesHtml}
                
                <div class="mt-4 pt-3 border-t border-gray-200">
                    <div class="flex items-center justify-between text-xs text-gray-500">
                        <span>Analyzed at ${analysis.timestamp ? new Date(analysis.timestamp).toLocaleTimeString() : new Date().toLocaleTimeString()}</span>
                        <button id="copyAllResultsBtn" class="text-blue-600 hover:text-blue-800 button-hover px-2 py-1 rounded-lg hover:bg-blue-50 transition-all duration-200">Copy All</button>
                    </div>
                </div>
            </div>
        `;

        // Wire up copy all button
        const copyAllBtn = document.getElementById('copyAllResultsBtn');
        if (copyAllBtn) {
            copyAllBtn.addEventListener('click', () => {
                let copyText = `Multi-Tab Analysis Results\n\n`;
                if (analysis.overallSummary) {
                    copyText += `Overall Summary:\n${analysis.overallSummary}\n\n`;
                }
                if (analysis.tabSummaries) {
                    copyText += `Individual Summaries:\n`;
                    analysis.tabSummaries.forEach((tab, index) => {
                        copyText += `${index + 1}. ${tab.title}\n${tab.summary}\n\n`;
                    });
                }
                navigator.clipboard.writeText(copyText).then(() => {
                    this.showSuccess('All results copied to clipboard');
                });
            });
        }

        // Wire up duplicate close buttons
        const closeButtons = resultsContent.querySelectorAll('.close-dup-btn');
        closeButtons.forEach((btn) => {
            const index = parseInt(btn.getAttribute('data-dup-index'), 10);
            btn.addEventListener('click', () => {
                const tabs = analysis.duplicates[index]?.tabs || [];
                this.closeDuplicateTabs(tabs);
            });
        });

        resultsSection.classList.remove('hidden');
        resultsSection.scrollIntoView({ behavior: 'smooth' });

        // persist multi-tab analysis
        this.saveMultiTabAnalysisPersistence(analysis);

        // Save as last operation for restore functionality
        this.saveLastOperation({
            type: 'tabAnalysis',
            description: `Tab Analysis: ${analysis.analyzedTabs || 0} tabs`,
            data: {
                analysis: analysis
            }
        });
    }

    closeDuplicateTabs(tabs) {
        const tabIds = (tabs || []).slice(1).map(tab => tab.id);
        if (tabIds.length === 0) {
            this.showInfo('No duplicates to close');
            return;
        }
        chrome.runtime.sendMessage({ 
            action: 'closeTabs',
            tabIds: tabIds 
        }, (response) => {
            if (response && response.success) {
                this.showSuccess(`Closed ${tabIds.length} duplicate tabs`);
            } else {
                this.showError('Failed to close duplicate tabs');
            }
        });
    }

    showSettings() {
        document.getElementById('mainContent').classList.add('hidden');
        document.getElementById('settingsPanel').classList.remove('hidden');
    }

    hideSettings() {
        document.getElementById('settingsPanel').classList.add('hidden');
        document.getElementById('mainContent').classList.remove('hidden');
    }

    async saveSettings() {
        const newSettings = {
            serverUrl: document.getElementById('serverUrl').value,
            groqApiKey: document.getElementById('groqApiKey').value,
            aiModel: document.getElementById('aiModel').value,
            autoAnalyze: document.getElementById('autoAnalyze').checked,
            notifications: document.getElementById('notifications').checked
        };

        chrome.storage.sync.set(newSettings, () => {
            this.settings = newSettings;
            this.serverUrl = newSettings.serverUrl;
            this.showSuccess('Settings saved');
            this.hideSettings();
        });
    }

    refresh() {
        location.reload();
    }

    showLoading(text = 'Loading...') {
        document.getElementById('loadingText').textContent = text;
        document.getElementById('loadingState').classList.remove('hidden');
    }

    hideLoading() {
        document.getElementById('loadingState').classList.add('hidden');
    }

    showError(message) {
        this.hideLoading();
        this.showNotification(message, 'error');
    }

    showSuccess(message) {
        this.showNotification(message, 'success');
    }

    showInfo(message) {
        this.showNotification(message, 'info');
    }

    showNotification(message, type = 'info') {
        // Create notification element
        const notification = document.createElement('div');
        notification.className = `fixed top-4 right-4 z-50 px-4 py-3 rounded-xl text-white text-sm font-medium notification backdrop-blur-sm shadow-lg ${
            type === 'error' ? 'bg-red-500/90' : 
            type === 'success' ? 'bg-green-500/90' : 
            'bg-blue-500/90'
        }`;
        notification.textContent = message;
        
        document.body.appendChild(notification);
        
        // Remove after 3 seconds with fade out
        setTimeout(() => {
            notification.style.opacity = '0';
            notification.style.transform = 'translateX(100%) scale(0.8)';
            setTimeout(() => {
                notification.remove();
            }, 300);
        }, 3000);
    }

    // Chat functionality methods
    async sendChatMessage() {
        const chatInput = document.getElementById('chatInput');
        const message = chatInput.value.trim();
        
        if (!message) return;
        
        // Check if this is a research request
        if (this.detectResearchIntent(message)) {
            const researchTopic = this.extractResearchTopic(message);
            if (researchTopic) {
                // Set the research input and trigger research
                const researchInput = document.getElementById('researchInput');
                if (researchInput) {
                    researchInput.value = researchTopic;
                    this.startResearch();
                    chatInput.value = '';
                    return;
                }
            }
        }
        
        // Check if this is a multi-tab question
        const isMultiTabQuestion = this.detectMultiTabQuestion(message);
        
        // For multi-tab questions, we don't need currentPageContent - we'll extract from all tabs
        if (isMultiTabQuestion) {
            // Multi-tab questions are always allowed - we'll extract content from all tabs
            console.log('Multi-tab question detected, will extract content from all tabs');
        } else if (!this.currentPageContent) {
            // For single-page questions, try to analyze the current page automatically
            console.log('No page content available, attempting to analyze current page automatically');
            this.showLoading('Extracting page content...');
            
            try {
                const content = await this.extractPageContent();
                console.log('Page content extraction result:', content);
                
                if (content && content.success && content.content && content.content.trim().length > 50) {
                    this.currentPageContent = content.content;
                    console.log('Successfully extracted page content for chat');
                    this.updateChatHint();
                } else {
                    this.hideLoading();
                    this.showError('Please analyze the current page first, or ask a multi-tab question using words like "compare" or "which is better"');
                    return;
                }
            } catch (error) {
                console.error('Error extracting page content:', error);
                this.hideLoading();
                this.showError('Please analyze the current page first, or ask a multi-tab question using words like "compare" or "which is better"');
                return;
            }
        }

        // Add user message to chat and persist
        this.chatHistory.push({ role: 'user', content: message });
        try { chrome.storage.local.set({ chatHistory: this.chatHistory.slice(-50) }); } catch {}
        this.addChatMessage(message, 'user');
        chatInput.value = '';
        
        // Disable input while processing
        chatInput.disabled = true;
        document.getElementById('sendChatBtn').disabled = true;

        try {
            let requestBody;
            
            if (isMultiTabQuestion) {
                // Multi-tab question - extract content from all tabs
                this.showLoading('Analyzing all tabs for your question...');
                const allTabContents = await this.extractAllTabContentsForChat();
                
                requestBody = {
                    question: message,
                    isMultiTab: true,
                    allTabContents: allTabContents,
                    chatHistory: this.chatHistory.slice(-5),
                    apiKey: this.settings.groqApiKey
                };
            } else {
                // Single page question
                if (!this.currentPageContent) {
                    this.showError('Please analyze the page first before asking questions');
                    return;
                }
                
                requestBody = {
                    question: message,
                    isMultiTab: false,
                    pageContent: this.currentPageContent,
                    chatHistory: this.chatHistory.slice(-5),
                    apiKey: this.settings.groqApiKey
                };
            }

            // Send chat request to server
            const response = await fetch(`${this.serverUrl}/chat`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(requestBody)
            });

            const result = await response.json();
            
            if (result.success) {
                this.addChatMessage(result.answer, 'assistant', result.sources);
                this.chatHistory.push({ role: 'assistant', content: result.answer });
                try { chrome.storage.local.set({ chatHistory: this.chatHistory.slice(-50) }); } catch {}
                
                // Save prompt and response to persistent history
                this.savePromptToHistory(message, result.answer, isMultiTabQuestion ? 'multi-tab-chat' : 'single-page-chat');

                // Save as last operation for restore functionality
                this.saveLastOperation({
                    type: 'chat',
                    description: `Chat: ${message.substring(0, 50)}${message.length > 50 ? '...' : ''}`,
                    data: {
                        messages: this.chatHistory.slice(-10)
                    }
                });
            } else {
                // Handle server errors with better messaging
                const errorMessage = result.error || 'Unknown error occurred';
                this.addChatMessage(`Sorry, I encountered an error: ${errorMessage}`, 'assistant');
                
                // Show helpful guidance based on error type
                if (errorMessage.includes('Page content is required')) {
                    this.showError('Please analyze the current page first, or ask a multi-tab question using words like "compare" or "which is better"');
                } else if (errorMessage.includes('Content appears to be mostly images')) {
                    this.showError('This page appears to be image-based. Please try analyzing a text-based webpage instead.');
                } else if (errorMessage.includes('Text content is too short')) {
                    this.showError('The page content is too short to analyze. Please try a webpage with more text content.');
                } else if (errorMessage.includes('No text was provided')) {
                    this.showError('No text content was found. Please try analyzing a different webpage.');
                } else if (errorMessage.includes('No meaningful content found')) {
                    this.showError('No meaningful content found in the analyzed tabs. Please try analyzing different webpages with more text content.');
                } else if (errorMessage.includes('inappropriate response')) {
                    this.showError('The AI generated an inappropriate response. Please try analyzing the page content first, or ask a more specific question about the actual content.');
                }
            }

        } catch (error) {
            console.error('Error sending chat message:', error);
            this.addChatMessage('Sorry, I encountered an error while processing your question.', 'assistant');
        } finally {
            // Re-enable input
            chatInput.disabled = false;
            document.getElementById('sendChatBtn').disabled = false;
            chatInput.focus();
            this.hideLoading();
        }
    }

    // Detect if the question requires multi-tab analysis
    detectMultiTabQuestion(message) {
        const multiTabKeywords = [
            'compare', 'comparison', 'which is better', 'best option', 'all tabs', 'across tabs',
            'different tabs', 'multiple tabs', 'between', 'versus', 'vs', 'difference',
            'similar', 'conflicting', 'contradictory', 'all pages', 'every tab',
            'what are the differences', 'how do they compare', 'which one', 'better option',
            'pros and cons', 'advantages', 'disadvantages', 'cost comparison', 'price comparison',
            'roi', 'return on investment', 'best value', 'cheapest', 'most expensive',
            'recommendation', 'should i choose', 'which should i', 'help me decide'
        ];
        
        const lowerMessage = message.toLowerCase();
        const isMultiTab = multiTabKeywords.some(keyword => lowerMessage.includes(keyword));
        
        // If no page content and not clearly multi-tab, suggest multi-tab approach
        if (!this.currentPageContent && !isMultiTab && !this.multiTabAvailable) {
            console.log('No page content and not multi-tab question, suggesting multi-tab approach');
            return true; // Treat as multi-tab to avoid errors
        }
        
        return isMultiTab;
    }

    // Extract content from all tabs for multi-tab questions
    async extractAllTabContentsForChat() {
        return new Promise((resolve) => {
            chrome.tabs.query({}, async (tabs) => {
                const tabContents = [];
                const maxTabsToProcess = 10;
                
                for (let i = 0; i < Math.min(tabs.length, maxTabsToProcess); i++) {
                    const tab = tabs[i];
                    
                    // Skip Chrome internal pages and non-HTTP pages
                    if (tab.url.startsWith('chrome://') || 
                        tab.url.startsWith('chrome-extension://') ||
                        tab.url.startsWith('moz-extension://') ||
                        tab.url.startsWith('edge://') ||
                        tab.url.startsWith('about:') ||
                        (!tab.url.startsWith('http://') && !tab.url.startsWith('https://'))) {
                        continue;
                    }
                    
                    try {
                        const content = await this.extractTabContentForChat(tab.id);
                        if (content && content.success && content.content && content.content.trim().length > 50) {
                            tabContents.push({
                                id: tab.id,
                                title: tab.title,
                                url: tab.url,
                                content: content.content,
                                wordCount: content.wordCount || 0
                            });
                        }
                    } catch (error) {
                        console.error(`Error extracting content from tab ${tab.id}:`, error);
                    }
                }
                
                resolve(tabContents);
            });
        });
    }

    // Extract content from a single tab for chat
    async extractTabContentForChat(tabId) {
        return new Promise((resolve) => {
            chrome.scripting.executeScript({
                target: { tabId: tabId },
                files: ['content.js']
            }, () => {
                if (chrome.runtime.lastError) {
                    resolve({ success: false, error: 'Failed to inject content script' });
                    return;
                }
                
                setTimeout(() => {
                    chrome.tabs.sendMessage(tabId, { action: 'extractContent' }, (response) => {
                        if (chrome.runtime.lastError) {
                            resolve({ success: false, error: 'Failed to extract content' });
                        } else {
                            resolve(response);
                        }
                    });
                }, 100);
            });
        });
    }

    addChatMessage(message, sender, sources = null) {
        const chatMessages = document.getElementById('chatMessages');
        if (!chatMessages) return;

        const messageDiv = document.createElement('div');
        messageDiv.className = `flex ${sender === 'user' ? 'justify-end' : 'justify-start'} fade-in`;
        
        const messageContent = document.createElement('div');
        messageContent.className = `max-w-[80%] px-3 py-2 rounded-lg text-sm ${
            sender === 'user' 
                ? 'bg-blue-500 text-white' 
                : 'bg-gray-100 text-gray-800'
        }`;
        
        if (sender === 'assistant' && sources && sources.length > 0) {
            // Enhanced display for assistant messages with sources
            messageContent.innerHTML = `
                <div class="mb-2">${message}</div>
                <div class="mt-2 pt-2 border-t border-gray-300">
                    <div class="text-xs text-gray-600 font-medium mb-1">Sources:</div>
                    <div class="space-y-1">
                        ${sources.map(source => `
                            <div class="text-xs text-gray-500 truncate" title="${source.url}">
                                📄 ${source.title}
                            </div>
                        `).join('')}
                    </div>
                </div>
            `;
        } else {
        messageContent.textContent = message;
        }
        
        messageDiv.appendChild(messageContent);
        chatMessages.appendChild(messageDiv);
        
        // Scroll to bottom
        chatMessages.scrollTop = chatMessages.scrollHeight;
        
        // Limit chat history to prevent memory issues
        if (chatMessages.children.length > 20) {
            chatMessages.removeChild(chatMessages.firstChild);
        }

        // persist chat messages
        try {
            chrome.storage.local.set({ chatHistory: this.chatHistory.slice(-50) });
        } catch {}
    }

    clearChatHistory() {
        this.chatHistory = [];
        const chatMessages = document.getElementById('chatMessages');
        if (chatMessages) {
            chatMessages.innerHTML = '';
        }
        chrome.storage.local.remove('chatHistory');
    }

    updateChatHint() {
        const chatHint = document.getElementById('chatHint');
        if (!chatHint) return;
        
        if (this.multiTabAvailable) {
            chatHint.innerHTML = `
                ✅ <strong>Multi-tab analysis ready!</strong> Ask questions like "compare products", "which is better", or "research about AI trends"
            `;
            chatHint.className = 'text-xs text-green-600';
        } else if (this.currentPageContent) {
            chatHint.innerHTML = `
                ✅ <strong>Page analyzed!</strong> Ask questions about this page, use "compare" for multi-tab questions, or "research about X" for web research
            `;
            chatHint.className = 'text-xs text-green-600';
        } else {
            chatHint.innerHTML = `
                💡 <strong>Chat options:</strong> Analyze this page first, ask multi-tab questions using "compare", or start research with "research about X"
            `;
            chatHint.className = 'text-xs text-gray-500';
        }
    }

    // Cache tab summaries to avoid reprocessing
    cacheTabSummary(tabId, summary, timestamp) {
        this.tabSummariesCache.set(tabId, {
            summary: summary,
            timestamp: timestamp,
            cached: true
        });
    }

    // Get cached tab summary if available and not too old
    getCachedTabSummary(tabId, maxAge = 300000) { // 5 minutes default
        const cached = this.tabSummariesCache.get(tabId);
        if (cached && (Date.now() - cached.timestamp) < maxAge) {
            return cached.summary;
        }
        return null;
    }

    // Clear old cached summaries
    clearOldCache(maxAge = 300000) { // 5 minutes default
        const now = Date.now();
        for (const [tabId, cached] of this.tabSummariesCache.entries()) {
            if ((now - cached.timestamp) > maxAge) {
                this.tabSummariesCache.delete(tabId);
            }
        }
    }

    // Research Assistant Methods
    async startResearch() {
        const researchInput = document.getElementById('researchInput');
        const topic = researchInput?.value?.trim();
        
        if (!topic) {
            this.showError('Please enter a research topic');
            return;
        }

        // Check if Groq API key is available
        if (!this.settings.groqApiKey) {
            this.showError('Groq API key is not configured. Please add it in the extension settings.');
            return;
        }

        this.showLoading('Starting research...');
        
        // Add timeout to prevent infinite loading
        const timeoutId = setTimeout(() => {
            this.hideLoading();
            this.showError('Research timed out. Please try again.');
        }, 120000); // 2 minute timeout for research

        try {
            const response = await fetch(`${this.serverUrl}/research`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    topic: topic,
                    maxResults: 25,
                    apiKey: this.settings.groqApiKey
                })
            });

            const result = await response.json();
            clearTimeout(timeoutId);
            
            if (result.success) {
                this.displayResearchResults(result);
                this.hideLoading();
                
                // Save research as task summary
                this.saveTaskSummary({
                    type: 'research',
                    topic: topic,
                    summary: result.summary,
                    sourcesCount: result.sources.length,
                    searchTerms: result.searchTerms
                });
                
                // Also save as user activity
                this.saveUserActivity({
                    action: 'research',
                    description: `Researched: ${topic}`,
                    result: result.summary,
                    data: {
                        topic: topic,
                        sourcesCount: result.sources.length,
                        searchTerms: result.searchTerms
                    }
                });
                
                // Ask user if they want to open all sources automatically
                setTimeout(() => {
                    this.showAutoOpenPrompt(result.sources);
                }, 1000);
            } else {
                this.hideLoading();
                this.showError('Research failed: ' + (result.error || 'Unknown error'));
            }

        } catch (error) {
            clearTimeout(timeoutId);
            console.error('Error in research:', error);
            this.hideLoading();
            this.showError('Research failed: ' + error.message);
        }
    }

    displayResearchResults(result) {
        const resultsSection = document.getElementById('resultsSection');
        const resultsContent = document.getElementById('resultsContent');
        
        // Store research results for potential caching
        this.cacheResearchResult(result.topic, result);
        
        resultsContent.innerHTML = `
            <div class="fade-in">
                <div class="flex items-center justify-between mb-4">
                    <h4 class="text-lg font-semibold gradient-text">Research Results</h4>
                    <span class="text-xs text-gray-500 bg-gray-100 px-2 py-1 rounded-full">${result.extractedPages} sources</span>
                </div>
                
                <div class="mb-6">
                    <h5 class="font-semibold text-gray-800 mb-2">Topic: ${result.topic}</h5>
                    <div class="text-sm text-gray-600 mb-3">
                        <span class="font-medium">Search Terms:</span> ${result.searchTerms.join(', ')}
                    </div>
                </div>
                
                <div class="prose prose-sm max-w-none mb-6">
                    <div class="bg-gradient-to-r from-blue-50 to-purple-50 rounded-xl p-4 border border-blue-100">
                        <h6 class="font-semibold text-gray-800 mb-2">Research Summary</h6>
                        <div class="text-gray-700 leading-relaxed whitespace-pre-wrap">${result.summary}</div>
                    </div>
                </div>
                
                <div class="mb-4">
                    <div class="flex items-center justify-between mb-3">
                        <h6 class="font-semibold text-gray-800">Sources</h6>
                        <button id="openAllSourcesBtn" class="text-xs bg-purple-500 text-white px-3 py-1 rounded-lg hover:bg-purple-600 transition-all duration-200 button-hover">
                            <svg class="w-3 h-3 inline mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"></path>
                            </svg>
                            Open All Sources
                        </button>
                    </div>
                    <div class="space-y-3">
                        ${result.sources.map((source, index) => `
                            <div class="bg-white/80 backdrop-blur-sm rounded-lg p-3 border border-gray-100">
                                <div class="flex items-start justify-between mb-2">
                                    <h7 class="font-medium text-gray-800 text-sm flex-1 mr-2">${source.title}</h7>
                                    <span class="text-xs text-gray-500 bg-gray-100 px-2 py-1 rounded-full whitespace-nowrap">${source.wordCount} words</span>
                                </div>
                                <div class="text-xs text-gray-500 mb-2 truncate">${source.url}</div>
                                <div class="text-sm text-gray-700 leading-relaxed">
                                    ${source.snippet}
                                </div>
                                <div class="mt-2 flex space-x-2">
                                    <a href="${source.url}" target="_blank" class="text-xs text-blue-600 hover:text-blue-800 button-hover px-2 py-1 rounded hover:bg-blue-50 transition-all duration-200">
                                        View Source →
                                    </a>
                                    <button class="open-source-btn text-xs text-purple-600 hover:text-purple-800 button-hover px-2 py-1 rounded hover:bg-purple-50 transition-all duration-200" data-url="${source.url}" data-title="${source.title}">
                                        Open in New Tab
                                    </button>
                                </div>
                            </div>
                        `).join('')}
                    </div>
                </div>
                
                <div class="mt-4 pt-4 border-t border-gray-200">
                    <div class="flex items-center justify-between text-xs text-gray-500">
                        <span>Research completed at ${new Date(result.timestamp).toLocaleTimeString()}</span>
                        <button id="copyResearchBtn" class="text-blue-600 hover:text-blue-800 button-hover px-2 py-1 rounded-lg hover:bg-blue-50 transition-all duration-200">Copy Research</button>
                    </div>
                </div>
            </div>
        `;

        // Add copy functionality
        const copyBtn = document.getElementById('copyResearchBtn');
        if (copyBtn) {
            copyBtn.addEventListener('click', () => {
                let copyText = `Research Results: ${result.topic}\n\n`;
                copyText += `Search Terms: ${result.searchTerms.join(', ')}\n\n`;
                copyText += `Summary:\n${result.summary}\n\n`;
                copyText += `Sources:\n`;
                result.sources.forEach((source, index) => {
                    copyText += `${index + 1}. ${source.title}\n${source.url}\n${source.snippet}\n\n`;
                });
                
                navigator.clipboard.writeText(copyText).then(() => {
                    this.showSuccess('Research results copied to clipboard');
                });
            });
        }

        // Add "Open All Sources" functionality
        const openAllBtn = document.getElementById('openAllSourcesBtn');
        if (openAllBtn) {
            openAllBtn.addEventListener('click', () => {
                this.openAllResearchSources(result.sources);
            });
        }

        // Add individual "Open in New Tab" functionality
        const openSourceBtns = resultsContent.querySelectorAll('.open-source-btn');
        openSourceBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                const url = btn.getAttribute('data-url');
                const title = btn.getAttribute('data-title');
                this.openResearchSource(url, title);
            });
        });

        resultsSection.classList.remove('hidden');
        resultsSection.scrollIntoView({ behavior: 'smooth' });

        // Also persist as lastAnalysis for quick restore of latest visible state
        this.saveAnalysisPersistence({ result, type: 'research', timestamp: Date.now() });

        // Save as last operation for restore functionality
        this.saveLastOperation({
            type: 'research',
            description: `Research: ${result.topic}`,
            data: {
                result: result,
                topic: result.topic
            }
        });
    }

    // Cache research results for quick access with persistent storage
    cacheResearchResult(topic, result) {
        const cacheKey = `research_${topic.toLowerCase().replace(/\s+/g, '_')}`;
        const cacheData = {
            result: result,
            timestamp: Date.now(),
            topic: topic
        };
        
        // Store in localStorage for persistence
        try {
            const existingCache = JSON.parse(localStorage.getItem('researchCache') || '{}');
            existingCache[cacheKey] = cacheData;
            
            // Keep only last 10 research results
            const cacheKeys = Object.keys(existingCache);
            if (cacheKeys.length > 10) {
                const oldestKey = cacheKeys.reduce((oldest, key) => 
                    existingCache[key].timestamp < existingCache[oldest].timestamp ? key : oldest
                );
                delete existingCache[oldestKey];
            }
            
            localStorage.setItem('researchCache', JSON.stringify(existingCache));
            
            // Also store in chrome storage for cross-session persistence
            chrome.storage.local.set({
                [cacheKey]: cacheData
            });
            // keep a list of recent keys for quick retrieval
            const listKey = 'research_keys';
            chrome.storage.local.get([listKey], (o) => {
                const arr = Array.isArray(o[listKey]) ? o[listKey] : [];
                const updated = [cacheKey, ...arr.filter(k => k !== cacheKey)].slice(0, 10);
                chrome.storage.local.set({ [listKey]: updated });
            });
        } catch (error) {
            console.error('Error caching research result:', error);
        }
    }

    // Get cached research result if available
    getCachedResearchResult(topic, maxAge = 3600000) { // 1 hour default
        try {
            const cacheKey = `research_${topic.toLowerCase().replace(/\s+/g, '_')}`;
            const existingCache = JSON.parse(localStorage.getItem('researchCache') || '{}');
            const cached = existingCache[cacheKey];
            
            if (cached && (Date.now() - cached.timestamp) < maxAge) {
                return cached.result;
            }
        } catch (error) {
            console.error('Error retrieving cached research:', error);
        }
        return null;
    }

    // Load persistent research results from storage
    async loadPersistentResearchResults() {
        try {
            const results = await new Promise((resolve) => {
                chrome.storage.local.get(null, (items) => {
                    const researchItems = Object.keys(items)
                        .filter(key => key.startsWith('research_'))
                        .map(key => items[key])
                        .filter(item => item && item.result && item.timestamp)
                        .sort((a, b) => b.timestamp - a.timestamp)
                        .slice(0, 5); // Show last 5 research results
                    resolve(researchItems);
                });
            });

            if (results.length > 0) {
                this.displayPersistentResearchResults(results);
            }
        } catch (error) {
            console.error('Error loading persistent research results:', error);
        }
    }

    // Display persistent research results
    displayPersistentResearchResults(results) {
        const resultsContent = document.getElementById('resultsContent');
        if (!resultsContent) return;

        let html = '<div class="space-y-4">';
        html += '<div class="flex items-center justify-between mb-4">';
        html += '<h3 class="text-lg font-semibold text-gray-800">Recent Research</h3>';
        html += '<span class="text-xs text-gray-500">Persistent across sessions</span>';
        html += '</div>';

        results.forEach((item, index) => {
            const timeAgo = this.getTimeAgo(item.timestamp);
            html += `
                <div class="bg-white/80 backdrop-blur-sm rounded-xl p-4 border border-gray-100 mb-4">
                    <div class="flex items-center justify-between mb-2">
                        <h4 class="font-semibold text-gray-800">${item.topic}</h4>
                        <span class="text-xs text-gray-500">${timeAgo}</span>
                    </div>
                    <div class="text-sm text-gray-600 mb-3">${item.result.summary.substring(0, 200)}...</div>
                    <div class="flex items-center justify-between">
                        <span class="text-xs text-gray-500">${item.result.sources.length} sources</span>
                        <button onclick="popup.openResearchResult('${item.topic}')" class="px-3 py-1 bg-blue-100 text-blue-600 text-xs rounded-md hover:bg-blue-200 transition-colors">
                            View Full Results
                        </button>
                    </div>
                </div>
            `;
        });

        html += '</div>';
        resultsContent.innerHTML = html;
        
        // Show results section
        const resultsSection = document.getElementById('resultsSection');
        if (resultsSection) {
            resultsSection.classList.remove('hidden');
        }
    }

    // Open specific research result
    openResearchResult(topic) {
        const cacheKey = `research_${topic.toLowerCase().replace(/\s+/g, '_')}`;
        const cached = localStorage.getItem('researchCache');
        if (cached) {
            const existingCache = JSON.parse(cached);
            const data = existingCache[cacheKey];
            if (data) {
                this.displayResearchResults(data.result);
            }
        }
    }

    // Clear all research results
    clearResearchResults() {
        try {
            // Clear localStorage
            localStorage.removeItem('researchCache');
            
            // Clear chrome storage
            chrome.storage.local.get(null, (items) => {
                const researchKeys = Object.keys(items).filter(key => key.startsWith('research_'));
                chrome.storage.local.remove(researchKeys);
                chrome.storage.local.remove('research_keys');
            });
            
            // Clear UI
            const resultsContent = document.getElementById('resultsContent');
            if (resultsContent) {
                resultsContent.innerHTML = '<div class="text-center text-gray-500 py-8">No research results yet</div>';
            }
            
            // Hide results section
            const resultsSection = document.getElementById('resultsSection');
            if (resultsSection) {
                resultsSection.classList.add('hidden');
            }
            
            this.showNotification('Research results cleared', 'success');
        } catch (error) {
            console.error('Error clearing research results:', error);
            this.showError('Failed to clear research results');
        }
    }

    // Persistence helpers
    saveAnalysisPersistence(payload) {
        try {
            chrome.storage.local.set({ lastAnalysis: payload });
            
            // Also save to comprehensive persistent storage
            if (payload.result) {
                chrome.runtime.sendMessage({
                    action: 'saveUserHistory',
                    entry: {
                        action: 'analyzePage',
                        description: `Analyzed page: ${payload.result.title || 'Unknown'}`,
                        result: payload.result.summary,
                        data: {
                            type: payload.type,
                            originalLength: payload.result.originalLength,
                            timestamp: payload.timestamp
                        }
                    }
                });
            }
        } catch {}
    }

    saveMultiTabAnalysisPersistence(analysis) {
        try {
            chrome.storage.local.set({ lastMultiTabAnalysis: analysis });
        } catch {}
    }

    savePromptToHistory(prompt, response, type = 'chat') {
        try {
            chrome.runtime.sendMessage({
                action: 'savePromptHistory',
                prompt: prompt,
                response: response,
                type: type
            });
        } catch (error) {
            console.error('Error saving prompt to history:', error);
        }
    }

    saveTaskSummary(summary) {
        try {
            chrome.runtime.sendMessage({
                action: 'saveTaskSummary',
                summary: summary
            });
        } catch (error) {
            console.error('Error saving task summary:', error);
        }
    }

    saveUserActivity(entry) {
        try {
            console.log('Saving user activity:', entry);
            
            // Try background script first
            chrome.runtime.sendMessage({
                action: 'saveUserHistory',
                entry: entry
            }, (response) => {
                if (chrome.runtime.lastError) {
                    console.warn('Background script not responding, using direct storage:', chrome.runtime.lastError);
                    this.saveUserActivityDirect(entry);
                } else if (response && response.success) {
                    console.log('User activity saved successfully via background script');
                } else {
                    console.error('Failed to save user activity via background script:', response);
                    this.saveUserActivityDirect(entry);
                }
            });
        } catch (error) {
            console.error('Error saving user activity:', error);
            this.saveUserActivityDirect(entry);
        }
    }

    saveUserActivityDirect(entry) {
        try {
            console.log('Saving user activity directly to storage:', entry);
            chrome.storage.local.get(['userHistory'], (result) => {
                const history = result.userHistory || [];
                const newEntry = {
                    ...entry,
                    timestamp: Date.now(),
                    id: Date.now() + Math.random()
                };
                history.push(newEntry);
                
                // Keep only last 100 entries
                const trimmedHistory = history.slice(-100);
                chrome.storage.local.set({ userHistory: trimmedHistory }, () => {
                    console.log('User activity saved directly, total entries:', trimmedHistory.length);
                    
                    // Update local persistent data
                    if (this.persistentData) {
                        this.persistentData.userHistory = trimmedHistory;
                        this.populateHistoryData();
                    }
                });
            });
        } catch (error) {
            console.error('Error saving user activity directly:', error);
        }
    }

    renderPersistedChatHistory() {
        try {
            if (!Array.isArray(this.chatHistory) || this.chatHistory.length === 0) return;
            this.chatHistory.slice(-20).forEach((msg) => {
                const role = msg.role === 'assistant' ? 'assistant' : 'user';
                this.addChatMessage(msg.content, role);
            });
        } catch {}
    }

    renderPersistedAnalysis() {
        try {
            if (this._persistedLastMulti && this._persistedLastMulti.tabSummaries) {
                this.displayTabAnalysis(this._persistedLastMulti);
                return;
            }
            if (this._persistedLastAnalysis && this._persistedLastAnalysis.result) {
                const { result, type } = this._persistedLastAnalysis;
                if (type === 'research') {
                    this.displayResearchResults(result);
                } else {
                    this.displayResults(result, type || 'summarize');
                }
            }
        } catch {}
    }

    displayPersistentHistory() {
        console.log('Displaying persistent history...');
        
        if (!this.persistentData) {
            console.log('No persistent data available, initializing empty data');
            this.persistentData = {
                userHistory: [],
                tabAnalysisHistory: [],
                promptHistory: [],
                taskSummaries: []
            };
        }

        console.log('Displaying persistent history:', this.persistentData);
        
        // Always add history section to the UI
        this.addHistorySectionToUI();
    }

    addHistorySectionToUI() {
        // Check if history section already exists
        if (document.getElementById('historySection')) {
            console.log('History section already exists, updating data');
            this.populateHistoryData();
            return;
        }

        const mainContent = document.getElementById('mainContent');
        if (!mainContent) {
            console.log('Main content not found');
            return;
        }

        console.log('Creating history section...');

        // Create history section
        const historySection = document.createElement('div');
        historySection.id = 'historySection';
        historySection.className = 'space-y-4';
        historySection.innerHTML = `
            <div class="flex items-center justify-between">
                <div class="flex items-center space-x-2">
                    <h2 class="text-lg font-semibold text-gray-800">Activity History</h2>
                    <div class="flex-1 h-px bg-gradient-to-r from-gray-200 to-transparent"></div>
                </div>
                <button id="clearHistoryBtn" class="px-3 py-1 text-xs bg-red-100 text-red-600 rounded-md hover:bg-red-200 transition-colors duration-200" title="Clear all history">
                    Clear All
                </button>
            </div>
            
            <div class="bg-white/80 backdrop-blur-sm rounded-2xl p-4 border border-gray-100">
                <div class="grid grid-cols-2 gap-4 mb-4">
                    <div class="text-center p-3 bg-blue-50 rounded-lg">
                        <div class="text-2xl font-bold text-blue-600" id="userHistoryCount">0</div>
                        <div class="text-xs text-blue-500">User Actions</div>
                    </div>
                    <div class="text-center p-3 bg-green-50 rounded-lg">
                        <div class="text-2xl font-bold text-green-600" id="tabAnalysisCount">0</div>
                        <div class="text-xs text-green-500">Tab Analyses</div>
                    </div>
                </div>
                
                <div class="space-y-3" id="recentActivity">
                    <!-- Recent activity will be populated here -->
                </div>
                
                <div class="mt-4 pt-3 border-t border-gray-200">
                    <button id="viewFullHistoryBtn" class="w-full text-sm text-gray-600 hover:text-gray-800 py-2 px-3 rounded-lg hover:bg-gray-50 transition-colors duration-200">
                        View Full History
                    </button>
                </div>
            </div>
        `;

        // Insert before the loading state
        const loadingState = document.getElementById('loadingState');
        if (loadingState) {
            mainContent.insertBefore(historySection, loadingState);
        } else {
            mainContent.appendChild(historySection);
        }

        console.log('History section created');

        // Add event listeners
        this.setupHistoryEventListeners();
        
        // Populate the history data
        this.populateHistoryData();
    }

    setupHistoryEventListeners() {
        const clearHistoryBtn = document.getElementById('clearHistoryBtn');
        const viewFullHistoryBtn = document.getElementById('viewFullHistoryBtn');

        if (clearHistoryBtn) {
            clearHistoryBtn.addEventListener('click', () => {
                this.clearAllHistory();
            });
        }

        if (viewFullHistoryBtn) {
            viewFullHistoryBtn.addEventListener('click', () => {
                this.showFullHistoryModal();
            });
        }
    }

    populateHistoryData() {
        if (!this.persistentData) {
            console.log('No persistent data to populate');
            return;
        }

        console.log('Populating history data:', this.persistentData);

        // Update counts
        const userHistoryCount = document.getElementById('userHistoryCount');
        const tabAnalysisCount = document.getElementById('tabAnalysisCount');
        const recentActivity = document.getElementById('recentActivity');

        if (userHistoryCount) {
            userHistoryCount.textContent = this.persistentData.userHistory.length;
            console.log('Updated user history count:', this.persistentData.userHistory.length);
        }
        if (tabAnalysisCount) {
            tabAnalysisCount.textContent = this.persistentData.tabAnalysisHistory.length;
            console.log('Updated tab analysis count:', this.persistentData.tabAnalysisHistory.length);
        }

        if (recentActivity) {
            // Show recent activity (last 5 items)
            const recentItems = [
                ...this.persistentData.userHistory.slice(-3),
                ...this.persistentData.tabAnalysisHistory.slice(-2)
            ].sort((a, b) => b.timestamp - a.timestamp).slice(0, 5);

            console.log('Recent items to display:', recentItems);

            if (recentItems.length === 0) {
                recentActivity.innerHTML = '<div class="text-center text-gray-500 py-4">No recent activity</div>';
            } else {
                recentActivity.innerHTML = recentItems.map(item => `
                    <div class="flex items-center space-x-3 p-2 rounded-lg hover:bg-gray-50 transition-colors duration-200">
                        <div class="w-2 h-2 bg-blue-500 rounded-full"></div>
                        <div class="flex-1 min-w-0">
                            <div class="text-sm font-medium text-gray-800 truncate">${item.description || item.action || 'Activity'}</div>
                            <div class="text-xs text-gray-500">${this.getTimeAgo(item.timestamp)}</div>
                        </div>
                    </div>
                `).join('');
            }
        } else {
            console.log('Recent activity element not found');
        }
    }

    clearAllHistory() {
        if (confirm('Are you sure you want to clear all history? This action cannot be undone.')) {
            chrome.runtime.sendMessage({ action: 'clearPersistentData' }, (response) => {
                if (response && response.success) {
                    this.persistentData = {
                        userHistory: [],
                        tabAnalysisHistory: [],
                        promptHistory: [],
                        taskSummaries: []
                    };
                    this.populateHistoryData();
                    this.showSuccess('All history cleared');
                } else {
                    this.showError('Failed to clear history');
                }
            });
        }
    }

    showFullHistoryModal() {
        // Create a modal to show full history
        const modal = document.createElement('div');
        modal.className = 'fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50';
        modal.innerHTML = `
            <div class="bg-white rounded-2xl p-6 max-w-2xl w-full mx-4 max-h-[80vh] overflow-hidden">
                <div class="flex items-center justify-between mb-4">
                    <h3 class="text-lg font-semibold text-gray-800">Full Activity History</h3>
                    <button id="closeHistoryModal" class="text-gray-400 hover:text-gray-600">
                        <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
                        </svg>
                    </button>
                </div>
                <div class="overflow-y-auto max-h-96 space-y-3" id="fullHistoryContent">
                    <!-- Full history will be populated here -->
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        // Populate full history
        this.populateFullHistory(modal.querySelector('#fullHistoryContent'));

        // Add close event listener
        modal.querySelector('#closeHistoryModal').addEventListener('click', () => {
            modal.remove();
        });

        // Close on backdrop click
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.remove();
            }
        });
    }

    populateFullHistory(container) {
        if (!this.persistentData) return;

        const allItems = [
            ...this.persistentData.userHistory.map(item => ({ ...item, type: 'user' })),
            ...this.persistentData.tabAnalysisHistory.map(item => ({ ...item, type: 'analysis' })),
            ...this.persistentData.promptHistory.map(item => ({ ...item, type: 'prompt' })),
            ...this.persistentData.taskSummaries.map(item => ({ ...item, type: 'task' }))
        ].sort((a, b) => b.timestamp - a.timestamp);

        if (allItems.length === 0) {
            container.innerHTML = '<div class="text-center text-gray-500 py-8">No history available</div>';
            return;
        }

        container.innerHTML = allItems.map(item => `
            <div class="p-3 rounded-lg border border-gray-100 hover:bg-gray-50 transition-colors duration-200">
                <div class="flex items-start justify-between mb-2">
                    <div class="flex-1 min-w-0">
                        <div class="text-sm font-medium text-gray-800">
                            ${item.description || item.action || item.prompt || 'Activity'}
                        </div>
                        <div class="text-xs text-gray-500 mt-1">
                            ${this.getTimeAgo(item.timestamp)} • ${item.type}
                        </div>
                    </div>
                </div>
                ${item.result ? `<div class="text-xs text-gray-600 mt-2 line-clamp-2">${item.result}</div>` : ''}
            </div>
        `).join('');
    }

    clearAnalysisResults() {
        try {
            chrome.storage.local.remove(['lastAnalysis', 'lastMultiTabAnalysis']);
            const resultsSection = document.getElementById('resultsSection');
            const resultsContent = document.getElementById('resultsContent');
            if (resultsContent) resultsContent.innerHTML = '<div class="text-center text-gray-500 py-8">No analysis yet</div>';
            if (resultsSection) resultsSection.classList.add('hidden');
            this.showSuccess('Analysis results cleared');
        } catch (e) {
            this.showError('Failed to clear analysis results');
        }
    }

    // Get time ago string
    getTimeAgo(timestamp) {
        const now = Date.now();
        const diff = now - timestamp;
        const minutes = Math.floor(diff / 60000);
        const hours = Math.floor(diff / 3600000);
        const days = Math.floor(diff / 86400000);
        
        if (days > 0) return `${days}d ago`;
        if (hours > 0) return `${hours}h ago`;
        if (minutes > 0) return `${minutes}m ago`;
        return 'Just now';
    }

    // Detect research intent from text/voice input
    detectResearchIntent(text) {
        const researchKeywords = [
            'research about', 'research on', 'do research', 'find information about',
            'look up', 'investigate', 'study about', 'learn about', 'explore',
            'what is', 'tell me about', 'information about', 'facts about'
        ];
        
        const lowerText = text.toLowerCase();
        return researchKeywords.some(keyword => lowerText.includes(keyword));
    }

    // Extract research topic from text
    extractResearchTopic(text) {
        const researchPatterns = [
            /research about (.+)/i,
            /research on (.+)/i,
            /do research on (.+)/i,
            /find information about (.+)/i,
            /look up (.+)/i,
            /investigate (.+)/i,
            /study about (.+)/i,
            /learn about (.+)/i,
            /explore (.+)/i,
            /what is (.+)/i,
            /tell me about (.+)/i,
            /information about (.+)/i,
            /facts about (.+)/i
        ];
        
        for (const pattern of researchPatterns) {
            const match = text.match(pattern);
            if (match && match[1]) {
                return match[1].trim();
            }
        }
        
        return text.trim(); // Fallback to original text
    }

    // Open a single research source in a new tab
    openResearchSource(url, title) {
        if (!url) {
            this.showError('Invalid URL');
            return;
        }

        try {
            chrome.tabs.create({
                url: url,
                active: false // Open in background
            }, (tab) => {
                if (chrome.runtime.lastError) {
                    this.showError('Failed to open source: ' + chrome.runtime.lastError.message);
                } else {
                    this.showSuccess(`Opened: ${title}`);
                }
            });
        } catch (error) {
            console.error('Error opening research source:', error);
            this.showError('Failed to open source: ' + error.message);
        }
    }

    // Open all research sources in new tabs
    openAllResearchSources(sources) {
        if (!sources || sources.length === 0) {
            this.showError('No sources to open');
            return;
        }

        this.showLoading(`Opening ${sources.length} research sources...`);
        
        let openedCount = 0;
        let errorCount = 0;
        const maxConcurrent = 3; // Limit concurrent tab creation
        
        const openNextBatch = (startIndex) => {
            const batch = sources.slice(startIndex, startIndex + maxConcurrent);
            const promises = batch.map((source, index) => {
                return new Promise((resolve) => {
                    chrome.tabs.create({
                        url: source.url,
                        active: false // Open in background
                    }, (tab) => {
                        if (chrome.runtime.lastError) {
                            console.error(`Failed to open ${source.title}:`, chrome.runtime.lastError.message);
                            errorCount++;
                        } else {
                            openedCount++;
                        }
                        resolve();
                    });
                });
            });

            Promise.all(promises).then(() => {
                const nextIndex = startIndex + maxConcurrent;
                if (nextIndex < sources.length) {
                    // Small delay between batches to avoid overwhelming the browser
                    setTimeout(() => openNextBatch(nextIndex), 500);
                } else {
                    this.hideLoading();
                    if (openedCount > 0) {
                        this.showSuccess(`Opened ${openedCount} research sources${errorCount > 0 ? ` (${errorCount} failed)` : ''}`);
                    } else {
                        this.showError('Failed to open any sources');
                    }
                }
            });
        };

        // Start opening tabs
        openNextBatch(0);
    }

    // Show auto-open prompt after research completion
    showAutoOpenPrompt(sources) {
        if (!sources || sources.length === 0) return;

        // Create a notification-style prompt
        const prompt = document.createElement('div');
        prompt.className = 'fixed top-4 right-4 z-50 bg-white rounded-xl shadow-lg border border-gray-200 p-4 max-w-sm fade-in';
        prompt.innerHTML = `
            <div class="flex items-start space-x-3">
                <div class="w-8 h-8 bg-purple-100 rounded-lg flex items-center justify-center flex-shrink-0">
                    <svg class="w-4 h-4 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"></path>
                    </svg>
                </div>
                <div class="flex-1">
                    <h4 class="font-semibold text-gray-800 text-sm mb-1">Research Complete!</h4>
                    <p class="text-xs text-gray-600 mb-3">Found ${sources.length} sources. Would you like to open them all in new tabs?</p>
                    <div class="flex space-x-2">
                        <button id="autoOpenYes" class="text-xs bg-purple-500 text-white px-3 py-1 rounded-lg hover:bg-purple-600 transition-all duration-200">
                            Yes, Open All
                        </button>
                        <button id="autoOpenNo" class="text-xs bg-gray-200 text-gray-700 px-3 py-1 rounded-lg hover:bg-gray-300 transition-all duration-200">
                            No Thanks
                        </button>
                    </div>
                </div>
                <button id="autoOpenClose" class="text-gray-400 hover:text-gray-600 transition-all duration-200">
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
                    </svg>
                </button>
            </div>
        `;

        document.body.appendChild(prompt);

        // Add event listeners
        const yesBtn = prompt.querySelector('#autoOpenYes');
        const noBtn = prompt.querySelector('#autoOpenNo');
        const closeBtn = prompt.querySelector('#autoOpenClose');

        const removePrompt = () => {
            prompt.style.opacity = '0';
            prompt.style.transform = 'translateX(100%) scale(0.8)';
            setTimeout(() => prompt.remove(), 300);
        };

        yesBtn.addEventListener('click', () => {
            this.openAllResearchSources(sources);
            removePrompt();
        });

        noBtn.addEventListener('click', removePrompt);
        closeBtn.addEventListener('click', removePrompt);

        // Auto-remove after 10 seconds
        setTimeout(removePrompt, 10000);
    }

    // Test function for debugging persistence
    testPersistence() {
        console.log('Testing persistence...');
        
        // Test saving data
        chrome.runtime.sendMessage({
            action: 'saveUserHistory',
            entry: {
                action: 'test',
                description: 'Test entry',
                result: 'Test result',
                data: { test: true }
            }
        }, (response) => {
            console.log('Save response:', response);
            
            // Test retrieving data
            setTimeout(() => {
                chrome.runtime.sendMessage({
                    action: 'getPersistentData'
                }, (response) => {
                    console.log('Retrieve response:', response);
                    if (response && response.success) {
                        console.log('User history:', response.data.userHistory);
                        console.log('Tab analysis:', response.data.tabAnalysisHistory);
                        console.log('Prompt history:', response.data.promptHistory);
                        console.log('Task summaries:', response.data.taskSummaries);
                    }
                });
            }, 1000);
        });
    }

    // Test saving user activity
    testSaveActivity() {
        console.log('Testing save user activity...');
        this.saveUserActivity({
            action: 'test',
            description: 'Test activity',
            result: 'Test result',
            data: { test: true, timestamp: Date.now() }
        });
        
        // Refresh the history display
        setTimeout(() => {
            this.displayPersistentHistory();
        }, 1000);
    }

    // Check current storage
    checkStorage() {
        console.log('Checking current storage...');
        chrome.storage.local.get(null, (data) => {
            console.log('All stored data:', data);
            
            // Also get via background script
            chrome.runtime.sendMessage({
                action: 'getPersistentData'
            }, (response) => {
                console.log('Persistent data via background:', response);
            });
        });
    }

    // Check if there's a last operation to restore
    async checkLastOperation() {
        try {
            const response = await new Promise((resolve) => {
                chrome.runtime.sendMessage({ action: 'getLastOperation' }, (response) => {
                    if (chrome.runtime.lastError) {
                        console.error('Error getting last operation:', chrome.runtime.lastError);
                        resolve({ success: false });
                    } else {
                        resolve(response);
                    }
                });
            });

            if (response && response.success && response.operation) {
                this.lastOperation = response.operation;
                const restoreBtn = document.getElementById('restoreBtn');
                if (restoreBtn) {
                    restoreBtn.classList.remove('hidden');
                    restoreBtn.title = `Restore: ${response.operation.description || response.operation.type}`;
                }
                console.log('Last operation available:', response.operation);
            }
        } catch (error) {
            console.error('Error checking last operation:', error);
        }
    }

    // Save the last operation
    saveLastOperation(operation) {
        try {
            const operationData = {
                type: operation.type,
                description: operation.description,
                data: operation.data,
                timestamp: Date.now()
            };

            chrome.runtime.sendMessage({
                action: 'saveLastOperation',
                operation: operationData
            }, (response) => {
                if (chrome.runtime.lastError) {
                    console.warn('Failed to save last operation:', chrome.runtime.lastError);
                } else if (response && response.success) {
                    this.lastOperation = operationData;
                    const restoreBtn = document.getElementById('restoreBtn');
                    if (restoreBtn) {
                        restoreBtn.classList.remove('hidden');
                        restoreBtn.title = `Restore: ${operationData.description || operationData.type}`;
                    }
                    console.log('Last operation saved:', operationData);
                }
            });
        } catch (error) {
            console.error('Error saving last operation:', error);
        }
    }

    // Restore the last operation
    async restoreLastOperation() {
        if (!this.lastOperation) {
            this.showError('No operation to restore');
            return;
        }

        this.showLoading(`Restoring ${this.lastOperation.description || this.lastOperation.type}...`);

        try {
            switch (this.lastOperation.type) {
                case 'pageAnalysis':
                    await this.restorePageAnalysis(this.lastOperation.data);
                    break;
                case 'tabAnalysis':
                    await this.restoreTabAnalysis(this.lastOperation.data);
                    break;
                case 'research':
                    await this.restoreResearch(this.lastOperation.data);
                    break;
                case 'chat':
                    await this.restoreChat(this.lastOperation.data);
                    break;
                default:
                    this.hideLoading();
                    this.showError('Unknown operation type');
                    return;
            }

            this.hideLoading();
            this.showSuccess(`Restored: ${this.lastOperation.description || this.lastOperation.type}`);
        } catch (error) {
            console.error('Error restoring operation:', error);
            this.hideLoading();
            this.showError('Failed to restore operation: ' + error.message);
        }
    }

    // Restore page analysis
    async restorePageAnalysis(data) {
        if (data && data.result) {
            this.displayResults(data.result, data.type || 'summarize');
            if (data.content) {
                this.currentPageContent = data.content;
            }
        }
    }

    // Restore tab analysis
    async restoreTabAnalysis(data) {
        if (data && data.analysis) {
            this.displayTabAnalysis(data.analysis);
        }
    }

    // Restore research
    async restoreResearch(data) {
        if (data && data.result) {
            this.displayResearchResults(data.result, data.topic);
        }
    }

    // Restore chat
    async restoreChat(data) {
        if (data && data.messages) {
            this.chatHistory = data.messages;
            this.renderPersistedChatHistory();
        }
    }
}

// Initialize popup when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
	window.popup = new AICopilotPopup();
});

