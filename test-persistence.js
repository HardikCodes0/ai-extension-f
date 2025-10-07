// Test script for persistent storage functionality
// This can be run in the browser console to test the storage features

console.log('Testing AI Browser Copilot Persistent Storage...');

// Test 1: Save user history
function testSaveUserHistory() {
    console.log('Test 1: Saving user history...');
    chrome.runtime.sendMessage({
        action: 'saveUserHistory',
        entry: {
            action: 'testAction',
            description: 'Test user action',
            result: 'Test result',
            data: { test: true }
        }
    }, (response) => {
        console.log('User history save response:', response);
    });
}

// Test 2: Save prompt history
function testSavePromptHistory() {
    console.log('Test 2: Saving prompt history...');
    chrome.runtime.sendMessage({
        action: 'savePromptHistory',
        prompt: 'Test prompt',
        response: 'Test response',
        type: 'test'
    }, (response) => {
        console.log('Prompt history save response:', response);
    });
}

// Test 3: Save task summary
function testSaveTaskSummary() {
    console.log('Test 3: Saving task summary...');
    chrome.runtime.sendMessage({
        action: 'saveTaskSummary',
        summary: {
            type: 'test',
            description: 'Test task summary',
            result: 'Test task completed',
            data: { test: true }
        }
    }, (response) => {
        console.log('Task summary save response:', response);
    });
}

// Test 4: Get persistent data
function testGetPersistentData() {
    console.log('Test 4: Getting persistent data...');
    chrome.runtime.sendMessage({
        action: 'getPersistentData'
    }, (response) => {
        console.log('Persistent data response:', response);
        if (response && response.success) {
            console.log('User History:', response.data.userHistory);
            console.log('Tab Analysis History:', response.data.tabAnalysisHistory);
            console.log('Prompt History:', response.data.promptHistory);
            console.log('Task Summaries:', response.data.taskSummaries);
        }
    });
}

// Test 5: Clear persistent data
function testClearPersistentData() {
    console.log('Test 5: Clearing persistent data...');
    chrome.runtime.sendMessage({
        action: 'clearPersistentData'
    }, (response) => {
        console.log('Clear data response:', response);
    });
}

// Run all tests
function runAllTests() {
    console.log('Running all persistence tests...');
    
    // Save some test data
    testSaveUserHistory();
    testSavePromptHistory();
    testSaveTaskSummary();
    
    // Wait a bit then retrieve data
    setTimeout(() => {
        testGetPersistentData();
    }, 1000);
}

// Export functions for manual testing
window.testPersistence = {
    saveUserHistory: testSaveUserHistory,
    savePromptHistory: testSavePromptHistory,
    saveTaskSummary: testSaveTaskSummary,
    getPersistentData: testGetPersistentData,
    clearPersistentData: testClearPersistentData,
    runAllTests: runAllTests
};

console.log('Persistence test functions loaded. Use window.testPersistence.runAllTests() to test all functionality.');
