// Test script for activity persistence
// Run this in the browser console to test if activities are being saved

console.log('=== AI Browser Copilot Activity Persistence Test ===');

// Test 1: Check if extension is loaded
function testExtensionLoaded() {
    console.log('Test 1: Checking if extension is loaded...');
    
    if (typeof window.popup !== 'undefined') {
        console.log('✅ Extension popup is loaded');
        return true;
    } else {
        console.log('❌ Extension popup not found');
        return false;
    }
}

// Test 2: Test saving user activity
function testSaveActivity() {
    console.log('Test 2: Testing save user activity...');
    
    if (window.testSaveActivity) {
        window.testSaveActivity();
        console.log('✅ Test activity saved');
        return true;
    } else {
        console.log('❌ testSaveActivity function not found');
        return false;
    }
}

// Test 3: Check storage directly
function testStorageDirect() {
    console.log('Test 3: Checking storage directly...');
    
    chrome.storage.local.get(['userHistory'], (result) => {
        console.log('Direct storage check - userHistory:', result.userHistory);
        if (result.userHistory && result.userHistory.length > 0) {
            console.log('✅ Data found in storage:', result.userHistory.length, 'entries');
            result.userHistory.forEach((entry, index) => {
                console.log(`  ${index + 1}. ${entry.description} (${new Date(entry.timestamp).toLocaleString()})`);
            });
        } else {
            console.log('❌ No data found in storage');
        }
    });
}

// Test 4: Test full persistence cycle
function testFullCycle() {
    console.log('Test 4: Testing full persistence cycle...');
    
    // Clear existing data first
    chrome.storage.local.clear(() => {
        console.log('Cleared existing data');
        
        // Wait a bit, then save test data
        setTimeout(() => {
            if (window.testSaveActivity) {
                window.testSaveActivity();
                
                // Wait and check if data persisted
                setTimeout(() => {
                    chrome.storage.local.get(['userHistory'], (result) => {
                        if (result.userHistory && result.userHistory.length > 0) {
                            console.log('✅ Full cycle test passed - data persisted');
                            console.log('Saved entries:', result.userHistory.length);
                        } else {
                            console.log('❌ Full cycle test failed - data not persisted');
                        }
                    });
                }, 2000);
            }
        }, 1000);
    });
}

// Test 5: Simulate real user activities
function testRealActivities() {
    console.log('Test 5: Simulating real user activities...');
    
    // Simulate page analysis
    if (window.popup && window.popup.saveUserActivity) {
        window.popup.saveUserActivity({
            action: 'analyzePage',
            description: 'Analyzed page: Test Page',
            result: 'This is a test page analysis result',
            data: { type: 'summarize', url: 'https://example.com' }
        });
        
        // Simulate research
        window.popup.saveUserActivity({
            action: 'research',
            description: 'Researched: AI Technology',
            result: 'Found 10 sources about AI technology trends',
            data: { topic: 'AI Technology', sourcesCount: 10 }
        });
        
        // Simulate tab analysis
        window.popup.saveUserActivity({
            action: 'analyzeAllTabs',
            description: 'Analyzed 5 tabs',
            result: 'Found 3 different domains with various content',
            data: { totalTabs: 5, domains: 3 }
        });
        
        console.log('✅ Simulated real activities');
        
        // Check storage after a delay
        setTimeout(() => {
            testStorageDirect();
        }, 1000);
    } else {
        console.log('❌ saveUserActivity function not available');
    }
}

// Run all tests
function runAllTests() {
    console.log('Running all persistence tests...');
    
    if (testExtensionLoaded()) {
        setTimeout(() => testSaveActivity(), 500);
        setTimeout(() => testStorageDirect(), 1000);
        setTimeout(() => testRealActivities(), 1500);
        setTimeout(() => testFullCycle(), 2000);
    }
}

// Export functions for manual testing
window.activityTests = {
    testExtensionLoaded,
    testSaveActivity,
    testStorageDirect,
    testRealActivities,
    testFullCycle,
    runAllTests
};

console.log('Activity persistence test functions loaded.');
console.log('Run window.activityTests.runAllTests() to test all functionality.');
console.log('Or run individual tests like window.activityTests.testSaveActivity()');
