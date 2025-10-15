// ==UserScript==
// @name         Simple EAFC Auto SBC Test
// @namespace    http://tampermonkey.net/
// @version      0.1
// @description  Simplified version to test SBC button creation
// @author       Test
// @match        https://www.easports.com/*/ea-sports-fc/ultimate-team/web-app/*
// @match        https://www.ea.com/ea-sports-fc/ultimate-team/web-app/*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';
    
    console.log('🎮 Simple EAFC Auto SBC Test - Starting...');
    
    // Simple button creation function
    const createSimpleButton = (text, callback) => {
        const button = document.createElement('button');
        button.innerHTML = text;
        button.style.cssText = `
            background: #4CAF50;
            color: white;
            padding: 10px 15px;
            border: none;
            border-radius: 5px;
            cursor: pointer;
            font-weight: bold;
            margin: 5px;
        `;
        button.addEventListener('click', callback);
        return button;
    };
    
    // Function to add test button to page
    const addTestButton = () => {
        console.log('🔧 Adding test button...');
        
        // Try to find any button container on the page
        const possibleContainers = [
            document.querySelector('.btn-exchange'),
            document.querySelector('[class*="exchange"]'),
            document.querySelector('[class*="button"]'),
            document.querySelector('button'),
            document.querySelector('.footer'),
            document.querySelector('.header'),
            document.body
        ];
        
        const container = possibleContainers.find(el => el !== null);
        
        if (container) {
            const testBtn = createSimpleButton('🎯 TEST SBC BUTTON', () => {
                alert('✅ Test SBC button works!\n\nThis proves the script can create buttons on this page.');
            });
            
            // Try to insert after the container or append to it
            if (container.parentNode) {
                container.parentNode.insertBefore(testBtn, container.nextSibling);
            } else {
                container.appendChild(testBtn);
            }
            
            console.log('✅ Test button added successfully!');
        } else {
            console.log('❌ Could not find suitable container for button');
        }
    };
    
    // Function to check for EA FC objects
    const checkEAFCObjects = () => {
        console.log('🔍 Checking for EA FC objects...');
        
        const checks = {
            'services': window.services,
            'services.Localization': window.services?.Localization,
            'UTSBCSquadDetailPanelView': window.UTSBCSquadDetailPanelView,
            'getCurrentViewController': window.getCurrentViewController,
            'getControllerInstance': window.getControllerInstance
        };
        
        console.log('📊 EA FC Object Status:', checks);
        
        // If services are loaded, try to add button
        if (window.services?.Localization) {
            console.log('🎮 EA FC services detected - adding test button...');
            addTestButton();
            return true;
        }
        return false;
    };
    
    // Main initialization
    const init = () => {
        console.log('🚀 Initializing Simple EAFC Test...');
        
        // Always add a test button regardless of EA FC status
        setTimeout(() => {
            addTestButton();
        }, 2000);
        
        // Check for EA FC objects
        if (!checkEAFCObjects()) {
            console.log('⏳ EA FC not ready, will retry...');
            setTimeout(init, 3000);
        }
    };
    
    // Start when page loads
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
    
    console.log('✅ Simple EAFC Auto SBC Test - Script loaded');
    
})();