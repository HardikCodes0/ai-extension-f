// Background service worker for AI Browser Copilot
chrome.runtime.onInstalled.addListener((details) => {
  console.log('AI Browser Copilot extension installed');
  
  // Set default settings
  chrome.storage.sync.set({
    serverUrl: 'http://localhost:3000',
    ollamaModel: 'mistral:7b',
    autoAnalyze: false,
    notifications: true
  });

  // Initialize persistent storage structure
  chrome.storage.local.get(['userHistory', 'tabAnalysisHistory', 'promptHistory', 'taskSummaries'], (result) => {
    const defaultData = {
      userHistory: result.userHistory || [],
      tabAnalysisHistory: result.tabAnalysisHistory || [],
      promptHistory: result.promptHistory || [],
      taskSummaries: result.taskSummaries || [],
      lastUpdated: Date.now()
    };
    chrome.storage.local.set(defaultData);
  });
});

// Function to extract content from a tab
async function extractTabContent(tabId) {
  return new Promise((resolve) => {
    // First, ensure content script is injected
    chrome.scripting.executeScript({
      target: { tabId: tabId },
      files: ['content.js']
    }, () => {
      if (chrome.runtime.lastError) {
        console.log(`Failed to inject content script for tab ${tabId}:`, chrome.runtime.lastError.message);
        // Fallback: try to extract content directly
        extractContentDirectly(tabId).then(resolve);
        return;
      }
      
      // Wait a moment for the script to load, then send message
      setTimeout(() => {
        chrome.tabs.sendMessage(tabId, { action: 'extractContent' }, (response) => {
          if (chrome.runtime.lastError) {
            console.log(`Failed to send message to tab ${tabId}:`, chrome.runtime.lastError.message);
            // Fallback: try to extract content directly
            extractContentDirectly(tabId).then(resolve);
          } else {
            resolve(response);
          }
        });
      }, 200); // Increased timeout for script loading
    });
  });
}

// Fallback method for content extraction
async function extractContentDirectly(tabId) {
  try {
    // Fallback method using chrome.scripting.executeScript
    const results = await chrome.scripting.executeScript({
      target: { tabId: tabId },
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

// Extract content from all tabs with timeout and parallel processing
async function extractAllTabContents(tabs, serverUrl) {
  const tabContents = [];
  const maxTabsToProcess = 5; // Reduced from 10 to prevent timeouts
  const maxProcessingTime = 30000; // 30 seconds max processing time
  
  console.log(`Processing ${tabs.length} tabs, max ${maxTabsToProcess}`);
  
  // Create a timeout promise
  const timeoutPromise = new Promise((_, reject) => {
    setTimeout(() => reject(new Error('Content extraction timeout')), maxProcessingTime);
  });
  
  // Process tabs in parallel with timeout
  const processTabs = async () => {
    const validTabs = tabs.filter(tab => {
      // Skip Chrome internal pages and non-HTTP pages
      if (tab.url.startsWith('chrome://') || 
          tab.url.startsWith('chrome-extension://') ||
          tab.url.startsWith('moz-extension://') ||
          tab.url.startsWith('edge://') ||
          tab.url.startsWith('about:') ||
          (!tab.url.startsWith('http://') && !tab.url.startsWith('https://'))) {
        console.log(`Skipping tab: ${tab.url} (internal page)`);
        return false;
      }
      return true;
    }).slice(0, maxTabsToProcess);
    
    console.log(`Processing ${validTabs.length} valid tabs`);
    
    // Process tabs in parallel (but limit concurrency)
    const processTab = async (tab, index) => {
      console.log(`Processing tab ${index + 1}: ${tab.title} (${tab.url})`);
      
      try {
        // Single attempt with shorter timeout
        const content = await Promise.race([
          extractTabContent(tab.id),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Tab extraction timeout')), 5000))
        ]);
        
        if (content && content.success && content.content && content.content.trim().length > 50) {
          return {
            id: tab.id,
            title: tab.title,
            url: tab.url,
            content: content.content,
            wordCount: content.wordCount || 0,
            isImagePage: content.isImagePage || false
          };
        } else {
          console.log(`❌ Failed to extract sufficient content from tab ${tab.id}`);
          return {
            id: tab.id,
            title: tab.title,
            url: tab.url,
            content: `Content from ${tab.title}: Unable to extract detailed content from this page.`,
            wordCount: 10,
            fallback: true
          };
        }
      } catch (error) {
        console.error(`Error extracting content from tab ${tab.id}:`, error);
        return {
          id: tab.id,
          title: tab.title,
          url: tab.url,
          content: `Content from ${tab.title}: Error extracting content - ${error.message}`,
          wordCount: 10,
          error: true
        };
      }
    };
    
    // Process tabs in batches of 3 to avoid overwhelming the system
    const batchSize = 3;
    for (let i = 0; i < validTabs.length; i += batchSize) {
      const batch = validTabs.slice(i, i + batchSize);
      const batchResults = await Promise.all(batch.map((tab, batchIndex) => 
        processTab(tab, i + batchIndex)
      ));
      tabContents.push(...batchResults);
      
      // Small delay between batches
      if (i + batchSize < validTabs.length) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
    
    return tabContents;
  };
  
  try {
    const results = await Promise.race([processTabs(), timeoutPromise]);
    console.log(`Extracted content from ${results.length} tabs (${results.filter(t => !t.fallback && !t.error).length} successful, ${results.filter(t => t.fallback || t.error).length} fallback)`);
    return results;
  } catch (error) {
    console.error('Content extraction timeout or error:', error);
    // Return whatever we have so far
    console.log(`Returning ${tabContents.length} tabs processed before timeout`);
    return tabContents;
  }
}

// Listen for tab updates
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url && !tab.url.startsWith('chrome://')) {
    console.log('Tab updated:', tab.title);
    
    // Store tab information for analysis
    chrome.storage.local.get(['tabs'], (result) => {
      const tabs = result.tabs || [];
      const existingTabIndex = tabs.findIndex(t => t.id === tabId);
      
      const tabInfo = {
        id: tabId,
        title: tab.title,
        url: tab.url,
        lastUpdated: Date.now(),
        analyzed: false
      };
      
      if (existingTabIndex >= 0) {
        tabs[existingTabIndex] = tabInfo;
      } else {
        tabs.push(tabInfo);
      }
      
      // Keep only last 50 tabs to avoid storage bloat
      if (tabs.length > 50) {
        tabs.splice(0, tabs.length - 50);
      }
      
      chrome.storage.local.set({ tabs });
    });
  }
});

// Listen for tab removal
chrome.tabs.onRemoved.addListener((tabId) => {
  chrome.storage.local.get(['tabs'], (result) => {
    const tabs = result.tabs || [];
    const filteredTabs = tabs.filter(t => t.id !== tabId);
    chrome.storage.local.set({ tabs: filteredTabs });
  });
});

// Handle messages from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('Background script received message:', request);
  
  if (request.action === 'ping') {
    console.log('Ping received, responding...');
    sendResponse({ success: true, message: 'Background script is working' });
    return true;
  }
  
  if (request.action === 'getAllTabs') {
    chrome.tabs.query({}, (tabs) => {
      const tabData = tabs.map(tab => ({
        id: tab.id,
        title: tab.title,
        url: tab.url,
        active: tab.active,
        windowId: tab.windowId
      }));
      sendResponse({ success: true, tabs: tabData });
    });
    return true; // Will respond asynchronously
  }
  
  if (request.action === 'analyzeTabs') {
    console.log('Starting tab analysis...');
    
    // Respond immediately to keep the port open
    const immediateResponse = {
      success: true,
      analysis: {
        totalTabs: 0,
        analyzedTabs: 0,
        tabAnalyses: [],
        overallSummary: 'Processing tabs...',
        groupedTabs: {},
        duplicates: [],
        timestamp: new Date().toISOString()
      }
    };
    
    // Send immediate response
    sendResponse(immediateResponse);
    
    // Then do the actual work asynchronously
    chrome.tabs.query({}, async (tabs) => {
      console.log(`Found ${tabs.length} tabs`);
      
      const tabData = tabs.map(tab => ({
        id: tab.id,
        title: tab.title,
        url: tab.url,
        active: tab.active,
        windowId: tab.windowId
      }));
      
      // Extract content from all tabs
      console.log('Extracting content from tabs...');
      const tabContents = await extractAllTabContents(tabs, request.serverUrl);
      console.log(`Extracted content from ${tabContents.length} tabs`);
      
      // Send to server for analysis with timeout
      try {
        console.log('Sending to server for analysis...');
        
        // Create AbortController for timeout
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 60000); // 1 minute timeout for entire analysis
        
        // Get API key from storage
        const settings = await new Promise((resolve) => {
          chrome.storage.sync.get(['groqApiKey'], (result) => {
            resolve(result);
          });
        });

        const response = await fetch(`${request.serverUrl}/analyze-tabs`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ 
            tabs: tabData,
            tabContents: tabContents,
            apiKey: settings.groqApiKey
          }),
          signal: controller.signal
        });
        
        clearTimeout(timeoutId);
        const analysisData = await response.json();
        console.log('Server analysis complete:', analysisData);
        
        // Save tab analysis to persistent storage
        saveTabAnalysis({
          type: 'multi-tab',
          totalTabs: analysisData.totalTabs,
          analyzedTabs: analysisData.analyzedTabs,
          overallSummary: analysisData.overallSummary,
          tabSummaries: analysisData.tabSummaries,
          groupedTabs: analysisData.groupedTabs,
          duplicates: analysisData.duplicates
        });

        // Save user history entry
        saveUserHistory({
          action: 'analyzeAllTabs',
          description: `Analyzed ${analysisData.totalTabs} tabs`,
          result: analysisData.overallSummary,
          data: {
            totalTabs: analysisData.totalTabs,
            analyzedTabs: analysisData.analyzedTabs,
            domains: Object.keys(analysisData.groupedTabs || {}).length
          }
        });

        // Send final analysis to popup
        chrome.runtime.sendMessage({
          action: 'updateAnalysis',
          analysis: analysisData
        }).catch(error => {
          console.log('Could not send final analysis to popup:', error);
        });
        
      } catch (error) {
        console.error('Error analyzing tabs with server:', error);
        
        // Check if it's a timeout error
        const isTimeout = error.name === 'AbortError' || error.message.includes('timeout');
        
        // Create fallback analysis with tab summaries
        const tabSummaries = tabContents.map(tab => ({
          id: tab.id,
          title: tab.title,
          url: tab.url,
          summary: `Content from ${tab.title}: ${tab.content.substring(0, 300)}...`,
          wordCount: tab.wordCount || 0,
          fallback: true
        }));
        
        // Group tabs by domain for fallback
        const groupedTabs = {};
        tabs.forEach(tab => {
          try {
            const url = new URL(tab.url);
            const domain = url.hostname;
            if (!groupedTabs[domain]) {
              groupedTabs[domain] = [];
            }
            groupedTabs[domain].push(tab);
          } catch (e) {
            if (!groupedTabs['special']) {
              groupedTabs['special'] = [];
            }
            groupedTabs['special'].push(tab);
          }
        });
        
        // Fallback: create local analysis without server
        const fallbackAnalysis = {
          success: true,
          totalTabs: tabs.length,
          analyzedTabs: tabContents.length,
          tabSummaries: tabSummaries,
          overallSummary: `Analyzed ${tabContents.length} tabs. ${isTimeout ? 'Analysis timed out - showing extracted content.' : 'Server not available - showing extracted content.'}`,
          groupedTabs: groupedTabs,
          duplicates: [],
          timestamp: new Date().toISOString()
        };
        
        chrome.runtime.sendMessage({
          action: 'updateAnalysis',
          analysis: fallbackAnalysis
        }).catch(error => {
          console.log('Could not send fallback analysis to popup:', error);
        });
      }
    });
    
    return false; // Don't keep the port open since we already responded
  }
  
  if (request.action === 'closeTabs') {
    const tabIds = request.tabIds;
    chrome.tabs.remove(tabIds, () => {
      sendResponse({ success: true });
    });
    return true;
  }
  
  if (request.action === 'groupTabs') {
    const tabGroups = request.tabGroups;
    
    // Guard: tabGroups API availability and non-empty groups
    if (!chrome.tabGroups || typeof chrome.tabGroups.update !== 'function') {
      sendResponse({ success: false, error: 'tabGroups API not available in this browser/version.' });
      return true;
    }

    const validGroups = (tabGroups || []).filter(g => Array.isArray(g.tabIds) && g.tabIds.length > 0);
    if (validGroups.length === 0) {
      sendResponse({ success: false, error: 'No valid tab groups to create.' });
      return true;
    }

    let remaining = validGroups.length;
    validGroups.forEach((group) => {
      chrome.tabs.group({ tabIds: group.tabIds }, (groupId) => {
        if (chrome.runtime.lastError) {
          console.warn('Failed grouping tabs:', chrome.runtime.lastError.message);
        } else if (groupId) {
          chrome.tabGroups.update(groupId, {
            title: group.title,
            color: group.color || 'blue'
          });
        }
        if (--remaining === 0) {
          sendResponse({ success: true });
        }
      });
    });
    return true;
  }

  if (request.action === 'getPersistentData') {
    getPersistentData().then(data => {
      sendResponse({ success: true, data });
    });
    return true;
  }

  if (request.action === 'saveUserHistory') {
    saveUserHistory(request.entry);
    sendResponse({ success: true });
    return true;
  }

  if (request.action === 'savePromptHistory') {
    savePromptHistory(request.prompt, request.response, request.type);
    sendResponse({ success: true });
    return true;
  }

  if (request.action === 'saveTaskSummary') {
    saveTaskSummary(request.summary);
    sendResponse({ success: true });
    return true;
  }

  if (request.action === 'clearPersistentData') {
    chrome.storage.local.remove([
      'userHistory', 
      'tabAnalysisHistory', 
      'promptHistory', 
      'taskSummaries'
    ], () => {
      sendResponse({ success: true });
    });
    return true;
  }

  if (request.action === 'saveLastOperation') {
    chrome.storage.local.set({ lastOperation: request.operation }, () => {
      sendResponse({ success: true });
    });
    return true;
  }

  if (request.action === 'getLastOperation') {
    chrome.storage.local.get(['lastOperation'], (result) => {
      sendResponse({ success: true, operation: result.lastOperation || null });
    });
    return true;
  }

  if (request.action === 'showNotification') {
    // Check if notifications API is available
    if (chrome.notifications && chrome.notifications.create) {
      chrome.notifications.create({
        type: 'basic',
        iconUrl: 'icons/icon48.png',
        title: request.title || 'AI Browser Copilot',
        message: request.message || 'Notification from AI Browser Copilot'
      });
    } else {
      console.log('Notifications not available:', request.title || 'AI Browser Copilot', request.message || 'Notification from AI Browser Copilot');
    }
    sendResponse({ success: true });
    return true;
  }
});

// Storage management functions
function saveUserHistory(entry) {
  console.log('Saving user history entry:', entry);
  chrome.storage.local.get(['userHistory'], (result) => {
    const history = result.userHistory || [];
    const newEntry = {
      ...entry,
      timestamp: Date.now(),
      id: Date.now() + Math.random()
    };
    history.push(newEntry);
    
    // Keep only last 100 entries to prevent storage bloat
    const trimmedHistory = history.slice(-100);
    chrome.storage.local.set({ userHistory: trimmedHistory }, () => {
      console.log('User history saved, total entries:', trimmedHistory.length);
    });
  });
}

function saveTabAnalysis(analysis) {
  console.log('Saving tab analysis:', analysis);
  chrome.storage.local.get(['tabAnalysisHistory'], (result) => {
    const history = result.tabAnalysisHistory || [];
    history.push({
      ...analysis,
      timestamp: Date.now(),
      id: Date.now() + Math.random()
    });
    
    // Keep only last 50 analyses
    const trimmedHistory = history.slice(-50);
    chrome.storage.local.set({ tabAnalysisHistory: trimmedHistory }, () => {
      console.log('Tab analysis saved, total entries:', trimmedHistory.length);
    });
  });
}

function savePromptHistory(prompt, response, type = 'chat') {
  console.log('Saving prompt history:', { prompt, response, type });
  chrome.storage.local.get(['promptHistory'], (result) => {
    const history = result.promptHistory || [];
    history.push({
      prompt,
      response,
      type,
      timestamp: Date.now(),
      id: Date.now() + Math.random()
    });
    
    // Keep only last 200 prompts
    const trimmedHistory = history.slice(-200);
    chrome.storage.local.set({ promptHistory: trimmedHistory }, () => {
      console.log('Prompt history saved, total entries:', trimmedHistory.length);
    });
  });
}

function saveTaskSummary(summary) {
  console.log('Saving task summary:', summary);
  chrome.storage.local.get(['taskSummaries'], (result) => {
    const summaries = result.taskSummaries || [];
    summaries.push({
      ...summary,
      timestamp: Date.now(),
      id: Date.now() + Math.random()
    });
    
    // Keep only last 30 task summaries
    const trimmedSummaries = summaries.slice(-30);
    chrome.storage.local.set({ taskSummaries: trimmedSummaries }, () => {
      console.log('Task summary saved, total entries:', trimmedSummaries.length);
    });
  });
}

function getPersistentData() {
  return new Promise((resolve) => {
    chrome.storage.local.get([
      'userHistory', 
      'tabAnalysisHistory', 
      'promptHistory', 
      'taskSummaries',
      'tabs',
      'lastAnalysis',
      'lastMultiTabAnalysis',
      'chatHistory',
      'currentPageContent'
    ], (result) => {
      console.log('Retrieved persistent data:', result);
      resolve(result);
    });
  });
}

// Clean up old data periodically
chrome.alarms.create('cleanup', { periodInMinutes: 60 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'cleanup') {
    chrome.storage.local.get(['tabs', 'userHistory', 'tabAnalysisHistory', 'promptHistory', 'taskSummaries'], (result) => {
      const oneDayAgo = Date.now() - (24 * 60 * 60 * 1000);
      const oneWeekAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
      
      // Clean up old tab data
      const tabs = result.tabs || [];
      const recentTabs = tabs.filter(tab => tab.lastUpdated > oneDayAgo);
      
      // Clean up old user history (keep 1 week)
      const userHistory = (result.userHistory || []).filter(entry => entry.timestamp > oneWeekAgo);
      
      // Clean up old tab analysis (keep 1 week)
      const tabAnalysisHistory = (result.tabAnalysisHistory || []).filter(entry => entry.timestamp > oneWeekAgo);
      
      // Clean up old prompts (keep 1 week)
      const promptHistory = (result.promptHistory || []).filter(entry => entry.timestamp > oneWeekAgo);
      
      // Clean up old task summaries (keep 1 week)
      const taskSummaries = (result.taskSummaries || []).filter(entry => entry.timestamp > oneWeekAgo);
      
      const updates = {};
      if (recentTabs.length !== tabs.length) updates.tabs = recentTabs;
      if (userHistory.length !== (result.userHistory || []).length) updates.userHistory = userHistory;
      if (tabAnalysisHistory.length !== (result.tabAnalysisHistory || []).length) updates.tabAnalysisHistory = tabAnalysisHistory;
      if (promptHistory.length !== (result.promptHistory || []).length) updates.promptHistory = promptHistory;
      if (taskSummaries.length !== (result.taskSummaries || []).length) updates.taskSummaries = taskSummaries;
      
      if (Object.keys(updates).length > 0) {
        chrome.storage.local.set(updates);
        console.log('Cleaned up old data:', Object.keys(updates));
      }
    });
  }
});

