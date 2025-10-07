// Content script for extracting page content
(function() {
  'use strict';

  // Utility: generate a robust CSS selector for an element
  function getElementSelector(element) {
    try {
      if (!element) return null;
      if (element.id) return `#${CSS.escape(element.id)}`;
      const parts = [];
      let el = element;
      while (el && el.nodeType === 1 && parts.length < 5) {
        let selector = el.nodeName.toLowerCase();
        if (el.className) {
          const className = Array.from(el.classList).slice(0, 2).map(c => `.${CSS.escape(c)}`).join('');
          selector += className;
        }
        const siblingIndex = Array.from(el.parentNode ? el.parentNode.children : []).filter(e => e.nodeName === el.nodeName).indexOf(el) + 1;
        if (siblingIndex > 0) selector += `:nth-of-type(${siblingIndex})`;
        parts.unshift(selector);
        el = el.parentElement;
      }
      return parts.join(' > ');
    } catch (e) {
      return null;
    }
  }

  // Detect forms and questions (generic + Google Forms heuristics)
  function detectForms() {
    const forms = [];

    // 1) Native HTML forms
    const htmlForms = Array.from(document.querySelectorAll('form'));
    htmlForms.forEach((form, formIndex) => {
      const fields = [];
      const inputs = form.querySelectorAll('input, textarea, select');
      inputs.forEach((input) => {
        const type = (input.getAttribute('type') || input.tagName.toLowerCase()).toLowerCase();
        if ([ 'hidden', 'submit', 'button', 'reset', 'file' ].includes(type)) return;
        const label = input.getAttribute('aria-label') || (input.labels && input.labels[0] ? input.labels[0].innerText : '') || input.placeholder || '';
        const qText = label || (input.closest('label') ? input.closest('label').innerText : '') || '';
        let options = [];
        if (input.tagName.toLowerCase() === 'select') {
          options = Array.from(input.options).map(o => o.textContent.trim()).filter(Boolean);
        }
        if (type === 'radio' || type === 'checkbox') {
          // group by name
          const name = input.name;
          if (name && !fields.some(f => f.name === name)) {
            const group = form.querySelectorAll(`input[name="${CSS.escape(name)}"]`);
            const groupOptions = Array.from(group).map(g => {
              const labelEl = g.closest('label') || form.querySelector(`label[for="${CSS.escape(g.id)}"]`);
              const text = (labelEl ? labelEl.innerText : g.getAttribute('aria-label')) || 'Option';
              return text.trim();
            }).filter(Boolean);
            fields.push({ id: `form${formIndex}-${name}`, name, type: type === 'radio' ? 'single_choice' : 'multi_choice', question: qText || name, options: groupOptions, selector: null, groupName: name });
          }
          return;
        }
        fields.push({ id: `form${formIndex}-${getElementSelector(input) || Math.random().toString(36).slice(2)}`, name: input.name || '', type: 'text', question: qText, options, selector: getElementSelector(input) });
      });
      if (fields.length > 0) {
        forms.push({ kind: 'html_form', selector: getElementSelector(form), fields });
      }
    });

    // 2) Google Forms (no native inputs; uses roles and spans)
    // Heuristics for Google Forms: questions are often in elements with role="listitem"
    const gfCandidates = Array.from(document.querySelectorAll('[role="listitem"], div[jscontroller], div[role="radiogroup"], div[role="group"], div[role="list"]'));
    const gfFields = [];
    gfCandidates.forEach((container, idx) => {
      try {
        // Question text
        let qNode = container.querySelector('.M7eMe, .Y2Zypf, .z12JJ, .Qr7Oae, .exportItemTitle, [role="heading"]');
        let question = (qNode ? qNode.textContent : '').trim();
        if (!question) {
          // Try aria-label from inputs
          const anyInput = container.querySelector('[role="textbox"], input, textarea');
          if (anyInput && anyInput.getAttribute('aria-label')) question = anyInput.getAttribute('aria-label').trim();
        }
        if (!question) return;

        // Options detection
        const radioOptions = Array.from(container.querySelectorAll('[role="radio"]'));
        const checkboxOptions = Array.from(container.querySelectorAll('[role="checkbox"]'));
        const selectLike = container.querySelector('[role="combobox"]');
        const textInput = container.querySelector('[role="textbox"], input[type="text"], textarea');

        if (radioOptions.length > 0) {
          const options = radioOptions.map(o => (o.getAttribute('aria-label') || o.textContent || '').trim()).filter(Boolean);
          if (options.length > 0) {
            gfFields.push({ id: `gform-radio-${idx}`, type: 'single_choice', question, options, selector: getElementSelector(container), role: 'radio' });
          }
        } else if (checkboxOptions.length > 0) {
          const options = checkboxOptions.map(o => (o.getAttribute('aria-label') || o.textContent || '').trim()).filter(Boolean);
          if (options.length > 0) {
            gfFields.push({ id: `gform-check-${idx}`, type: 'multi_choice', question, options, selector: getElementSelector(container), role: 'checkbox' });
          }
        } else if (selectLike) {
          const label = selectLike.getAttribute('aria-label') || question;
          gfFields.push({ id: `gform-select-${idx}`, type: 'single_choice', question: label, options: [], selector: getElementSelector(container), role: 'combobox' });
        } else if (textInput) {
          gfFields.push({ id: `gform-text-${idx}`, type: 'text', question, options: [], selector: getElementSelector(textInput) });
        }
      } catch (e) {}
    });
    if (gfFields.length > 0) {
      forms.push({ kind: 'google_form_like', selector: null, fields: gfFields });
    }

    return forms;
  }

  // Fill answers into the detected forms
  async function applyFormAnswers(payload) {
    const { answers } = payload || {};
    if (!answers) return { success: false, error: 'No answers provided' };

    function clickIfVisible(el) {
      if (!el) return;
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        el.click();
      }
    }

    // Fill HTML forms
    Object.entries(answers).forEach(([fieldId, answer]) => {
      try {
        // Attempt direct selector first
        let target = null;
        if (answer && typeof answer === 'object' && answer.selector) {
          target = document.querySelector(answer.selector);
        }
        if (!target && answer && answer.selectorFallback) {
          target = document.querySelector(answer.selectorFallback);
        }
        if (!target && typeof fieldId === 'string' && fieldId.startsWith('form')) {
          const sel = fieldId.split('-').slice(1).join('-');
          try { target = document.querySelector(sel); } catch(e) {}
        }

        // Google Forms containers by role
        if (!target && answer && answer.containerSelector) {
          target = document.querySelector(answer.containerSelector);
        }

        if (!target) return;

        if (answer.kind === 'text') {
          const input = target.matches('input, textarea, [role="textbox"]') ? target : target.querySelector('input, textarea, [role="textbox"]');
          if (input) {
            if (input.getAttribute('role') === 'textbox' && input.tagName.toLowerCase() === 'div') {
              input.focus();
              document.execCommand('insertText', false, answer.value || '');
            } else {
              input.value = answer.value || '';
              input.dispatchEvent(new Event('input', { bubbles: true }));
              input.dispatchEvent(new Event('change', { bubbles: true }));
            }
          }
        } else if (answer.kind === 'single_choice') {
          // Try native select/radio first
          const select = target.matches('select') ? target : target.querySelector('select');
          if (select && typeof answer.index === 'number') {
            const idx = Math.max(0, Math.min(select.options.length - 1, answer.index));
            select.selectedIndex = idx;
            select.dispatchEvent(new Event('change', { bubbles: true }));
            return;
          }
          const radio = target.querySelectorAll('input[type="radio"], [role="radio"]');
          if (radio.length && typeof answer.index === 'number') {
            const choice = radio[answer.index];
            if (choice) clickIfVisible(choice);
            return;
          }
        } else if (answer.kind === 'multi_choice') {
          const checkboxes = target.querySelectorAll('input[type="checkbox"], [role="checkbox"]');
          if (checkboxes.length && Array.isArray(answer.indices)) {
            answer.indices.forEach(i => { if (checkboxes[i]) clickIfVisible(checkboxes[i]); });
          }
        }
      } catch (e) {
        // ignore and continue
      }
    });

    return { success: true };
  }

  // Function to extract clean text content from the page
  function extractPageContent() {
    try {
      // Remove ALL non-text elements aggressively
      const nonTextElements = document.querySelectorAll(`
        script, style, noscript, nav, header, footer, aside, 
        img, video, audio, canvas, svg, iframe, embed, object, 
        form, input, button, select, textarea, 
        [role="button"], [role="img"], [role="presentation"],
        .advertisement, .ad, .banner, .sidebar, .menu, .navigation,
        .social, .share, .comment, .related, .recommended,
        [data-testid*="ad"], [class*="ad"], [id*="ad"],
        [data-testid*="banner"], [class*="banner"], [id*="banner"],
        [data-testid*="sidebar"], [class*="sidebar"], [id*="sidebar"]
      `.replace(/\s+/g, ' ').trim());
      
      nonTextElements.forEach(el => {
        if (el && el.parentNode) {
          el.remove();
        }
      });

      // Get the main content areas with more comprehensive selectors
      const contentSelectors = [
        'main',
        'article',
        '[role="main"]',
        '.content',
        '.post-content',
        '.entry-content',
        '.article-content',
        '#content',
        '.main-content',
        '.page-content',
        '.text-content',
        '.body-content',
        '.story-content',
        '.post-body',
        '.entry-body',
        '.article-body',
        '[data-testid*="content"]',
        '[class*="content"]',
        '[id*="content"]'
      ];

      let mainContent = '';
      let bestContent = '';
      let maxLength = 0;
      
      // Try to find main content area
      for (const selector of contentSelectors) {
        const elements = document.querySelectorAll(selector);
        for (const element of elements) {
          const text = element.textContent.trim();
          if (text.length > maxLength && text.length > 100) {
            maxLength = text.length;
            bestContent = text;
          }
        }
      }

      // Use the best content found
      if (bestContent) {
        mainContent = bestContent;
      } else {
        // Fallback to body if no main content found
        mainContent = document.body.textContent.trim();
      }

      // Clean up the text more thoroughly - only keep meaningful text
      const cleanedText = mainContent
        .replace(/\s+/g, ' ') // Replace multiple whitespace with single space
        .replace(/\n\s*\n/g, '\n') // Remove empty lines
        .replace(/[^\w\s.,!?;:()\-]/g, ' ') // Remove special characters but keep basic punctuation
        .replace(/\b\w{1,2}\b/g, '') // Remove very short words (likely noise)
        .replace(/\s+/g, ' ') // Clean up spaces again
        .trim();

      // Validate that we have meaningful text content
      const wordCount = cleanedText.split(/\s+/).filter(word => word.length > 2).length;
      const textRatio = cleanedText.replace(/[^a-zA-Z0-9\s]/g, '').length / cleanedText.length;
      
      if (cleanedText.length < 50 || wordCount < 10 || textRatio < 0.5) {
        // Last resort: get all text content and validate again
        const allText = document.documentElement.textContent
          .replace(/\s+/g, ' ')
          .replace(/[^\w\s.,!?;:()\-]/g, ' ')
          .replace(/\b\w{1,2}\b/g, '')
          .replace(/\s+/g, ' ')
          .trim();
        
        const allWordCount = allText.split(/\s+/).filter(word => word.length > 2).length;
        const allTextRatio = allText.replace(/[^a-zA-Z0-9\s]/g, '').length / allText.length;
        
        // Check if the page is mostly images or has no meaningful text
        if (allText.length < 50 || allWordCount < 10 || allTextRatio < 0.5) {
          return {
            title: document.title,
            url: window.location.href,
            content: `This page appears to be image-based or has minimal text content. Title: ${document.title}`,
            wordCount: 10,
            extractedAt: new Date().toISOString(),
            isImagePage: true
          };
        }
        
        return {
          title: document.title,
          url: window.location.href,
          content: allText,
          wordCount: allWordCount,
          extractedAt: new Date().toISOString()
        };
      }

      return {
        title: document.title,
        url: window.location.href,
        content: cleanedText,
        wordCount: cleanedText.split(/\s+/).length,
        extractedAt: new Date().toISOString()
      };
    } catch (error) {
      console.error('Error in extractPageContent:', error);
      return {
        title: document.title,
        url: window.location.href,
        content: `Error extracting content: ${error.message}`,
        wordCount: 10,
        extractedAt: new Date().toISOString()
      };
    }
  }

  // Function to get page metadata
  function getPageMetadata() {
    const metaTags = {};
    const metaElements = document.querySelectorAll('meta');
    
    metaElements.forEach(meta => {
      const name = meta.getAttribute('name') || meta.getAttribute('property');
      const content = meta.getAttribute('content');
      if (name && content) {
        metaTags[name] = content;
      }
    });

    return {
      description: metaTags.description || metaTags['og:description'] || '',
      keywords: metaTags.keywords || '',
      author: metaTags.author || metaTags['article:author'] || '',
      publishedTime: metaTags['article:published_time'] || '',
      modifiedTime: metaTags['article:modified_time'] || '',
      ogTitle: metaTags['og:title'] || '',
      ogImage: metaTags['og:image'] || ''
    };
  }

  // Listen for messages from popup or background script
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'extractContent') {
      try {
        const pageContent = extractPageContent();
        const metadata = getPageMetadata();
        
        const result = {
          ...pageContent,
          metadata: metadata,
          success: true
        };

        sendResponse(result);
      } catch (error) {
        console.error('Error extracting page content:', error);
        sendResponse({
          success: false,
          error: error.message
        });
      }
    }
    if (request.action === 'collectForm') {
      try {
        const forms = detectForms();
        sendResponse({ success: true, forms, url: window.location.href, title: document.title });
      } catch (error) {
        sendResponse({ success: false, error: error.message });
      }
    }
    if (request.action === 'applyFormAnswers') {
      applyFormAnswers(request.payload).then((r) => sendResponse(r)).catch((e) => sendResponse({ success: false, error: e.message }));
    }
    
    // Return true to indicate we will send a response asynchronously
    return true;
  });

  // Auto-extract content when page loads (for future features)
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      // Page is fully loaded, content is ready
      console.log('AI Browser Copilot: Page content ready for analysis');
    });
  } else {
    // Page is already loaded
    console.log('AI Browser Copilot: Page content ready for analysis');
  }

})();

