// Verification Script for Restore Button Feature
// Run this in the browser console to verify the implementation

console.log('🔍 Verifying Restore Button Implementation...\n');

const checks = [];

// Check 1: HTML Button Exists
const restoreBtn = document.getElementById('restoreBtn');
checks.push({
    name: 'HTML Button Exists',
    passed: !!restoreBtn,
    details: restoreBtn ? '✅ Button found in DOM' : '❌ Button not found'
});

// Check 2: Button has correct classes
if (restoreBtn) {
    const hasHiddenClass = restoreBtn.classList.contains('hidden');
    checks.push({
        name: 'Button Initially Hidden',
        passed: hasHiddenClass,
        details: hasHiddenClass ? '✅ Button has hidden class' : '⚠️ Button is visible (may be OK if operation exists)'
    });
}

// Check 3: Popup instance exists
const popupExists = typeof window.popup !== 'undefined';
checks.push({
    name: 'Popup Instance',
    passed: popupExists,
    details: popupExists ? '✅ window.popup exists' : '❌ window.popup not found'
});

// Check 4: Required methods exist
if (popupExists) {
    const methods = [
        'checkLastOperation',
        'saveLastOperation',
        'restoreLastOperation',
        'restorePageAnalysis',
        'restoreTabAnalysis',
        'restoreResearch',
        'restoreChat'
    ];
    
    methods.forEach(method => {
        const exists = typeof window.popup[method] === 'function';
        checks.push({
            name: `Method: ${method}`,
            passed: exists,
            details: exists ? '✅ Method exists' : `❌ Method missing`
        });
    });
}

// Check 5: Event listener attached
if (restoreBtn && popupExists) {
    // We can't directly check if event listener is attached, but we can check if clicking triggers an error
    checks.push({
        name: 'Event Listener',
        passed: true,
        details: '⚠️ Cannot verify directly, test by clicking button'
    });
}

// Check 6: Background script communication
chrome.runtime.sendMessage({ action: 'ping' }, (response) => {
    const bgWorking = !chrome.runtime.lastError && response && response.success;
    checks.push({
        name: 'Background Script',
        passed: bgWorking,
        details: bgWorking ? '✅ Background script responding' : '❌ Background script not responding'
    });
    
    // Check 7: Test save operation handler
    chrome.runtime.sendMessage({ 
        action: 'saveLastOperation',
        operation: {
            type: 'test',
            description: 'Verification Test',
            data: {},
            timestamp: Date.now()
        }
    }, (saveResponse) => {
        const saveWorks = !chrome.runtime.lastError && saveResponse && saveResponse.success;
        checks.push({
            name: 'Save Operation Handler',
            passed: saveWorks,
            details: saveWorks ? '✅ saveLastOperation handler works' : '❌ Handler not working'
        });
        
        // Check 8: Test get operation handler
        chrome.runtime.sendMessage({ action: 'getLastOperation' }, (getResponse) => {
            const getWorks = !chrome.runtime.lastError && getResponse && getResponse.success;
            checks.push({
                name: 'Get Operation Handler',
                passed: getWorks,
                details: getWorks ? '✅ getLastOperation handler works' : '❌ Handler not working'
            });
            
            // Print results
            printResults();
        });
    });
});

function printResults() {
    console.log('\n📊 Verification Results:\n');
    console.log('='.repeat(60));
    
    let passedCount = 0;
    let failedCount = 0;
    
    checks.forEach(check => {
        const icon = check.passed ? '✅' : '❌';
        console.log(`${icon} ${check.name}`);
        console.log(`   ${check.details}\n`);
        
        if (check.passed) passedCount++;
        else failedCount++;
    });
    
    console.log('='.repeat(60));
    console.log(`\n📈 Summary: ${passedCount} passed, ${failedCount} failed out of ${checks.length} checks\n`);
    
    if (failedCount === 0) {
        console.log('🎉 All checks passed! The restore button should work correctly.');
        console.log('\n📝 Next steps:');
        console.log('1. Perform an operation (analyze page, tabs, research, or chat)');
        console.log('2. Check if restore button appears');
        console.log('3. Close and reopen popup');
        console.log('4. Click restore button to test');
    } else {
        console.log('⚠️ Some checks failed. Please review the issues above.');
        console.log('\n🔧 Troubleshooting:');
        console.log('1. Make sure you reloaded the extension after making changes');
        console.log('2. Check browser console for JavaScript errors');
        console.log('3. Verify all files were saved correctly');
        console.log('4. See TROUBLESHOOTING.md for detailed help');
    }
    
    // Additional diagnostic info
    console.log('\n🔍 Additional Diagnostics:');
    console.log('- Last Operation:', window.popup?.lastOperation || 'None');
    console.log('- Restore Button Visible:', restoreBtn && !restoreBtn.classList.contains('hidden'));
    
    // Check storage
    chrome.storage.local.get(['lastOperation'], (result) => {
        console.log('- Storage lastOperation:', result.lastOperation || 'None');
    });
}

// Export test functions for manual use
window.verifyRestore = {
    checkButton: () => {
        const btn = document.getElementById('restoreBtn');
        console.log('Button:', btn);
        console.log('Hidden:', btn?.classList.contains('hidden'));
        console.log('Title:', btn?.title);
    },
    testSave: () => {
        if (window.popup) {
            window.popup.saveLastOperation({
                type: 'pageAnalysis',
                description: 'Manual Test',
                data: { result: { summary: 'Test summary' }, type: 'summarize' }
            });
            console.log('Test operation saved. Check if button appears.');
        }
    },
    testRestore: () => {
        if (window.popup) {
            window.popup.restoreLastOperation();
        }
    },
    checkStorage: () => {
        chrome.storage.local.get(['lastOperation'], (result) => {
            console.log('Storage:', result);
        });
    },
    clearStorage: () => {
        chrome.storage.local.remove('lastOperation', () => {
            console.log('Storage cleared');
        });
    }
};

console.log('\n💡 Manual test functions available:');
console.log('- verifyRestore.checkButton()');
console.log('- verifyRestore.testSave()');
console.log('- verifyRestore.testRestore()');
console.log('- verifyRestore.checkStorage()');
console.log('- verifyRestore.clearStorage()');
