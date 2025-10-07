# Restore Button Troubleshooting Guide

## Issue Fixed: Duplicate Message Listeners

**Problem**: The background.js had two separate `chrome.runtime.onMessage.addListener` blocks, which could cause message handling issues.

**Solution**: Merged all message handlers into a single listener block.

## How to Test the Fix

### Step 1: Reload the Extension
1. Open Chrome and go to `chrome://extensions/`
2. Find "AI Browser Copilot"
3. Click the **Reload** button (circular arrow icon)
4. Check for any errors in the extension card

### Step 2: Open Developer Tools
1. Click on "service worker" link in the extension card (this opens background script console)
2. Keep this console open to see background script logs
3. Also open the popup and right-click → Inspect to see popup console

### Step 3: Test the Restore Button

#### Test 1: Save an Operation
1. Open the extension popup
2. Navigate to any webpage (not chrome:// pages)
3. Click "Analyze Current Page"
4. Wait for the analysis to complete
5. **Check**: The restore button should appear in the header (undo arrow icon)
6. **Console check**: Look for "Last operation saved:" in the popup console

#### Test 2: Restore After Closing
1. After completing Test 1, close the popup
2. Reopen the popup
3. **Check**: The restore button should still be visible
4. Hover over it to see the tooltip
5. Click the restore button
6. **Expected**: Previous analysis results should reappear

#### Test 3: Test with Tab Analysis
1. Open multiple tabs (3-5 tabs)
2. Open the extension popup
3. Click "Analyze All Tabs"
4. Wait for analysis to complete
5. **Check**: Restore button appears
6. Close and reopen popup
7. Click restore button
8. **Expected**: Tab analysis results restored

### Step 4: Use the Debug Tool
1. Navigate to `chrome-extension://[YOUR_EXTENSION_ID]/test-restore.html`
   - To find your extension ID, go to chrome://extensions/ and look under the extension name
2. Run each test button in sequence:
   - **Test Background Script** - Should show ✅ Success
   - **Save Test Operation** - Should show ✅ Success
   - **Check Last Operation** - Should show the saved operation
   - **Check Chrome Storage** - Should show lastOperation data

## Common Issues and Solutions

### Issue 1: Restore Button Never Appears

**Possible Causes:**
- Background script not loaded properly
- Message handlers not registered
- JavaScript errors in popup.js

**Solutions:**
1. Check browser console for JavaScript errors
2. Reload the extension completely
3. Check that `checkLastOperation()` is being called in `init()`
4. Verify the button exists in HTML: `<button id="restoreBtn">`

**Debug Commands (in popup console):**
```javascript
// Check if button exists
document.getElementById('restoreBtn')

// Check if lastOperation is set
window.popup.lastOperation

// Manually check for last operation
chrome.runtime.sendMessage({ action: 'getLastOperation' }, console.log)
```

### Issue 2: Button Appears But Doesn't Work

**Possible Causes:**
- Event listener not attached
- restoreLastOperation() method has errors
- Data format mismatch

**Solutions:**
1. Check popup console for errors when clicking
2. Verify event listener is attached in setupEventListeners()
3. Test manually:
```javascript
window.popup.restoreLastOperation()
```

### Issue 3: Button Disappears After Reload

**Possible Causes:**
- Storage not persisting
- checkLastOperation() not being called
- Storage permissions issue

**Solutions:**
1. Check storage permissions in manifest.json
2. Verify storage contents:
```javascript
chrome.storage.local.get(['lastOperation'], console.log)
```
3. Check that init() calls checkLastOperation()

### Issue 4: Wrong Data Restored

**Possible Causes:**
- Data structure mismatch
- Wrong restore method called
- Cached old data

**Solutions:**
1. Clear storage and test fresh:
```javascript
chrome.storage.local.remove('lastOperation')
```
2. Check the operation type matches the restore method
3. Verify data structure in console

## Manual Testing Checklist

- [ ] Extension loads without errors
- [ ] Background script console shows no errors
- [ ] Popup opens without errors
- [ ] Restore button exists in HTML (check with inspect element)
- [ ] After page analysis, restore button becomes visible
- [ ] Restore button has correct tooltip on hover
- [ ] Clicking restore button shows loading indicator
- [ ] Previous results are displayed correctly
- [ ] Button persists after closing/reopening popup
- [ ] Works with all operation types (page, tabs, research, chat)

## Console Commands for Debugging

### In Popup Console:
```javascript
// Check popup instance
window.popup

// Check last operation
window.popup.lastOperation

// Check if button is hidden
document.getElementById('restoreBtn').classList.contains('hidden')

// Manually trigger restore
window.popup.restoreLastOperation()

// Check storage
chrome.storage.local.get(['lastOperation'], console.log)

// Save test operation
window.popup.saveLastOperation({
    type: 'pageAnalysis',
    description: 'Test Operation',
    data: { result: { summary: 'Test' }, type: 'summarize' }
})
```

### In Background Console:
```javascript
// Check if handlers are registered
chrome.runtime.onMessage.hasListeners()

// Test save operation
chrome.storage.local.set({
    lastOperation: {
        type: 'pageAnalysis',
        description: 'Manual Test',
        data: {},
        timestamp: Date.now()
    }
}, () => console.log('Saved'))

// Check storage
chrome.storage.local.get(['lastOperation'], console.log)
```

## Expected Console Output

### When Saving Operation:
```
Saving last operation: {type: "pageAnalysis", description: "...", ...}
Last operation saved: {type: "pageAnalysis", ...}
```

### When Checking on Init:
```
Restoring persistent state...
Checking last operation...
Last operation available: {type: "pageAnalysis", ...}
```

### When Restoring:
```
Restoring Page Analysis: ...
Restored: Page Analysis: ...
```

## If Nothing Works

1. **Complete Reset:**
   ```javascript
   // In popup console
   chrome.storage.local.clear()
   chrome.storage.sync.clear()
   ```
   Then reload the extension

2. **Check Extension Permissions:**
   - Ensure "storage" permission is in manifest.json
   - Reload extension after any manifest changes

3. **Verify File Changes:**
   - Confirm background.js has the merged message listener
   - Confirm popup.html has the restore button
   - Confirm popup.js has all the restore methods

4. **Browser Issues:**
   - Try in incognito mode
   - Try restarting Chrome
   - Check Chrome version (needs Manifest V3 support)

## Success Indicators

✅ **Working Correctly When:**
- Restore button appears after any operation
- Button stays visible after closing/reopening
- Clicking button restores previous results
- No console errors
- Tooltip shows correct description
- All operation types work (page, tabs, research, chat)

## Need More Help?

If the issue persists:
1. Check all console outputs (both popup and background)
2. Run the test-restore.html debug tool
3. Verify all files were saved correctly
4. Check for any JavaScript syntax errors
5. Ensure you reloaded the extension after changes
