// ==UserScript==
// @name         Debug EAFC Auto SBC
// @namespace    http://tampermonkey.net/
// @version      0.1
// @description  Debug version to check if script loads on EA FC
// @author       Debug
// @match        https://www.easports.com/*/ea-sports-fc/ultimate-team/web-app/*
// @match        https://www.ea.com/ea-sports-fc/ultimate-team/web-app/*
// @match        https://www.ea.com/*
// @match        https://www.easports.com/*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';
    
    console.log('🚀 DEBUG: Script started loading...');
    console.log('🌐 Current URL:', window.location.href);
    console.log('📍 Domain:', window.location.hostname);
    console.log('📄 Page title:', document.title);
    
    // Create debug indicator
    const debugDiv = document.createElement('div');
    debugDiv.innerHTML = `
        🔍 DEBUG ACTIVE<br>
        URL: ${window.location.href}<br>
        Domain: ${window.location.hostname}<br>
        Title: ${document.title}
    `;
    debugDiv.style.cssText = `
        position: fixed;
        top: 10px;
        left: 10px;
        background: #ff6b35;
        color: white;
        padding: 10px;
        z-index: 99999;
        font-family: monospace;
        font-size: 12px;
        border-radius: 5px;
        max-width: 300px;
        box-shadow: 0 2px 10px rgba(0,0,0,0.5);
    `;
    
    // Wait for page to load
    const addDebugInfo = () => {
        document.body.appendChild(debugDiv);
        
        // Check for EA FC specific elements
        setTimeout(() => {
            const services = window.services;
            const UTSBCSquadDetailPanelView = window.UTSBCSquadDetailPanelView;
            const UTSBCSetTileView = window.UTSBCSetTileView;
            
            debugDiv.innerHTML += `<br><br>🔧 EA FC Objects:`;
            debugDiv.innerHTML += `<br>services: ${services ? '✅' : '❌'}`;
            debugDiv.innerHTML += `<br>UTSBCSquadDetailPanelView: ${UTSBCSquadDetailPanelView ? '✅' : '❌'}`;
            debugDiv.innerHTML += `<br>UTSBCSetTileView: ${UTSBCSetTileView ? '✅' : '❌'}`;
            
            // Check if we're in SBC area
            const sbcElements = document.querySelectorAll('[class*="sbc"], [class*="SBC"], [id*="sbc"], [id*="SBC"]');
            debugDiv.innerHTML += `<br>SBC elements found: ${sbcElements.length}`;
            
            // Look for exchange button
            const exchangeBtn = document.querySelector('[class*="exchange"], [class*="Exchange"], button[class*="btn"]');
            debugDiv.innerHTML += `<br>Exchange button: ${exchangeBtn ? '✅' : '❌'}`;
            
            // Test server connection
            fetch('http://127.0.0.1:8000/allPlayers.csv')
                .then(response => {
                    debugDiv.innerHTML += `<br>🌐 Server: ${response.ok ? '✅ Connected' : '❌ Error'}`;
                })
                .catch(err => {
                    debugDiv.innerHTML += `<br>🌐 Server: ❌ Failed`;
                });
                
        }, 3000);
    };
    
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', addDebugInfo);
    } else {
        addDebugInfo();
    }
    
    // Log when specific EA FC functions are available
    const checkInterval = setInterval(() => {
        if (window.services && window.services.Localization) {
            console.log('🎮 EA FC services loaded!');
            debugDiv.innerHTML += `<br>🎮 EA FC Ready: ✅`;
            clearInterval(checkInterval);
        }
    }, 1000);
    
})();