// ==UserScript==
// @name         Safe EAFC Auto SBC Test
// @namespace    http://tampermonkey.net/
// @version      0.1
// @description  Error-safe version to test SBC functionality
// @author       Test
// @match        https://www.easports.com/*/ea-sports-fc/ultimate-team/web-app/*
// @match        https://www.ea.com/ea-sports-fc/ultimate-team/web-app/*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';
    
    console.log('🛡️ Safe EAFC Auto SBC Test - Starting...');
    
    // Wrap everything in try-catch to prevent conflicts
    try {
        
        // Safe element creation with error handling
        const createSafeElement = (tag, attributes = {}, content = '') => {
            try {
                const element = document.createElement(tag);
                
                // Safely set attributes
                Object.keys(attributes).forEach(key => {
                    try {
                        if (key === 'style') {
                            element.style.cssText = attributes[key];
                        } else {
                            element.setAttribute(key, attributes[key]);
                        }
                    } catch (e) {
                        console.warn(`Could not set attribute ${key}:`, e);
                    }
                });
                
                // Safely set content
                if (content) {
                    try {
                        element.textContent = content;
                    } catch (e) {
                        console.warn('Could not set content:', e);
                    }
                }
                
                return element;
            } catch (e) {
                console.error('Could not create element:', e);
                return null;
            }
        };
        
        // Safe DOM insertion
        const safeInsert = (element, container) => {
            try {
                if (element && container && container.appendChild) {
                    container.appendChild(element);
                    return true;
                }
            } catch (e) {
                console.warn('Could not insert element safely:', e);
                try {
                    // Alternative insertion method
                    if (container && container.insertAdjacentElement) {
                        container.insertAdjacentElement('beforeend', element);
                        return true;
                    }
                } catch (e2) {
                    console.warn('Alternative insertion also failed:', e2);
                }
            }
            return false;
        };
        
        // Create status indicator
        const createStatusIndicator = () => {
            try {
                const indicator = createSafeElement('div', {
                    style: `
                        position: fixed;
                        top: 50px;
                        right: 10px;
                        background: #2196F3;
                        color: white;
                        padding: 8px 12px;
                        border-radius: 4px;
                        font-family: Arial, sans-serif;
                        font-size: 12px;
                        z-index: 999999;
                        box-shadow: 0 2px 8px rgba(0,0,0,0.3);
                        border: 2px solid white;
                    `
                }, '🛡️ Safe Script Active');
                
                // Wait for body to be available
                const addIndicator = () => {
                    if (document.body) {
                        if (safeInsert(indicator, document.body)) {
                            console.log('✅ Status indicator added');
                            
                            // Test server connection
                            setTimeout(() => {
                                fetch('http://127.0.0.1:8000/allPlayers.csv')
                                    .then(response => {
                                        if (response.ok) {
                                            indicator.textContent = '🛡️ Safe Script + Server ✅';
                                            indicator.style.background = '#4CAF50';
                                        } else {
                                            indicator.textContent = '🛡️ Safe Script ⚠️ Server Error';
                                            indicator.style.background = '#ff9800';
                                        }
                                    })
                                    .catch(err => {
                                        indicator.textContent = '🛡️ Safe Script ❌ Server Offline';
                                        indicator.style.background = '#f44336';
                                    });
                            }, 2000);
                            
                        } else {
                            console.warn('Could not add status indicator');
                        }
                    } else {
                        setTimeout(addIndicator, 100);
                    }
                };
                
                addIndicator();
                
            } catch (e) {
                console.error('Error creating status indicator:', e);
            }
        };
        
        // Check EA FC environment safely
        const checkEAEnvironment = () => {
            try {
                console.log('🔍 Checking EA FC environment...');
                
                const checks = {
                    services: typeof window.services !== 'undefined',
                    localization: window.services?.Localization ? true : false,
                    utClasses: typeof window.UTSBCSquadDetailPanelView !== 'undefined'
                };
                
                console.log('📊 EA Environment:', checks);
                
                // If EA services are available, try to create SBC button
                if (checks.services && checks.localization) {
                    console.log('🎮 EA FC detected - attempting SBC integration...');
                    attemptSBCIntegration();
                }
                
            } catch (e) {
                console.error('Error checking EA environment:', e);
            }
        };
        
        // Attempt SBC integration safely
        const attemptSBCIntegration = () => {
            try {
                console.log('🔧 Attempting SBC integration...');
                
                // Look for SBC-related elements
                const sbcSelectors = [
                    '[class*="sbc"]',
                    '[class*="SBC"]',
                    '[class*="exchange"]',
                    '[class*="Exchange"]',
                    '.btn-exchange',
                    'button[class*="btn"]'
                ];
                
                let foundElement = null;
                for (const selector of sbcSelectors) {
                    try {
                        foundElement = document.querySelector(selector);
                        if (foundElement) {
                            console.log(`✅ Found SBC element with selector: ${selector}`);
                            break;
                        }
                    } catch (e) {
                        console.warn(`Selector failed: ${selector}`, e);
                    }
                }
                
                if (foundElement) {
                    // Create safe SBC button
                    const sbcButton = createSafeElement('button', {
                        style: `
                            background: #ff6b35;
                            color: white;
                            padding: 8px 16px;
                            border: none;
                            border-radius: 4px;
                            cursor: pointer;
                            font-weight: bold;
                            margin: 5px;
                            font-family: Arial, sans-serif;
                        `
                    }, '🎯 Test Solve SBC');
                    
                    if (sbcButton) {
                        sbcButton.addEventListener('click', () => {
                            alert('✅ SBC Button Works!\n\nThis confirms the script can interact with the EA FC page safely.');
                        });
                        
                        // Try to insert near the found element
                        if (foundElement.parentNode) {
                            safeInsert(sbcButton, foundElement.parentNode);
                            console.log('✅ SBC test button added');
                        }
                    }
                }
                
            } catch (e) {
                console.error('Error in SBC integration:', e);
            }
        };
        
        // Initialize safely
        const safeInit = () => {
            try {
                console.log('🚀 Safe initialization starting...');
                
                // Create status indicator first
                createStatusIndicator();
                
                // Check EA environment after delay
                setTimeout(() => {
                    checkEAEnvironment();
                }, 3000);
                
                // Retry check periodically
                let retryCount = 0;
                const retryInterval = setInterval(() => {
                    if (retryCount < 10) {
                        checkEAEnvironment();
                        retryCount++;
                    } else {
                        clearInterval(retryInterval);
                        console.log('🛑 Stopped retrying EA environment check');
                    }
                }, 5000);
                
            } catch (e) {
                console.error('Error in safe initialization:', e);
            }
        };
        
        // Start when ready
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', safeInit);
        } else {
            setTimeout(safeInit, 1000);
        }
        
    } catch (e) {
        console.error('🚨 Critical error in Safe EAFC Auto SBC:', e);
    }
    
})();